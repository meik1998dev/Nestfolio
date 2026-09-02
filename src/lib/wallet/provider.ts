/**
 * WalletProvider — read-only access to a public BNB-chain address.
 *
 * Provider = NodeReal MegaNode enhanced JSON-RPC (BSC mainnet). Behind an
 * interface so it can be swapped for direct RPC later. We use ONLY raw balances
 * + transfers here; pricing is the PriceProvider's job (never trust a DEX price
 * for tokenized stocks).
 *
 * Server-only (reads NODEREAL_API_KEY). All network errors surface to the caller
 * so the sync orchestrator can degrade gracefully.
 */
import { env } from "@/lib/env";
import { resolveToken } from "@/lib/price/ticker";
import type { TransferDirection } from "@/lib/types";

const NODEREAL_BASE = "https://bsc-mainnet.nodereal.io/v1";

/** nr_getAssetTransfers rejects block ranges of 2,000,000 or more. */
const MAX_BLOCK_SPAN = 1_999_999;

/** How many block windows to scan concurrently while hunting for activity. */
const WINDOW_CONCURRENCY = 4;

/** Page size for both enhanced APIs (server max is 100). */
const PAGE_SIZE = 100;

/** ERC-20/BEP-20 category for nr_getAssetTransfers. */
const CATEGORY_ERC20 = "20";

/**
 * The transfer index trails eth_blockNumber by a few blocks (~3s each). Pin the
 * scan head this far behind, and if the API still says "blockNum not reached",
 * step back further a bounded number of times.
 */
const HEAD_LAG_BLOCKS = 30;
const HEAD_LAG_STEP = 100;
const HEAD_LAG_RETRIES = 5;

/** A current token (or native BNB) balance on the wallet. */
export interface WalletBalance {
  tokenAddress: string;
  symbol: string;
  /** Human-readable balance (already scaled by decimals). */
  amount: number;
  decimals: number;
  /** True for native BNB (no contract). */
  native: boolean;
}

/** A normalized ERC20/BEP20 transfer, oriented to the wallet. */
export interface NormalizedTransfer {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /** ISO timestamp. */
  ts: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  /** Direction relative to the wallet. */
  direction: TransferDirection;
  /** The other party (sender for IN, receiver for OUT). */
  counterparty: string | null;
  /** Integer string in the token's smallest unit (un-scaled). */
  rawAmount: string;
  decimals: number;
}

export interface GetTransfersOptions {
  /** Only fetch transfers at/after this block. */
  fromBlock?: number;
  /** Resume from a previous page. */
  cursor?: string;
}

export interface TransfersPage {
  transfers: NormalizedTransfer[];
  /** Next-page cursor, or null when exhausted. */
  cursor: string | null;
}

export interface WalletProvider {
  getBalances(address: string): Promise<WalletBalance[]>;
  getTransfers(
    address: string,
    opts?: GetTransfersOptions,
  ): Promise<TransfersPage>;
}

/** Validate a 0x-prefixed 40-hex EVM address. */
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

/** Raw nr_getTokenHoldings row (the fields we read). */
interface NoderealHoldingRow {
  tokenAddress: string;
  /** 32-byte hex integer. */
  tokenBalance: string;
  tokenSymbol?: string;
  tokenName?: string;
  /** Hex, e.g. "0x12". */
  tokenDecimals?: string;
}

interface NoderealHoldingsResult {
  /** Hex count of token rows across all pages. */
  totalCount: string;
  /** 32-byte hex integer, wei. */
  nativeTokenBalance: string;
  details: NoderealHoldingRow[];
}

/** Raw nr_getAssetTransfers row (the fields we read). */
interface NoderealTransferRow {
  hash: string;
  logIndex: number;
  /** Hex block number. */
  blockNum: string;
  /** Unix seconds. */
  blockTimeStamp: number;
  contractAddress: string;
  asset?: string;
  /** Decimal string, e.g. "18". */
  decimal?: string;
  from: string;
  to: string;
  /** 32-byte hex integer in the token's smallest unit. */
  value: string;
}

interface NoderealTransfersResult {
  /** Empty string when there are no more pages. */
  pageKey: string;
  transfers: NoderealTransferRow[];
}

/**
 * Opaque paging state for getTransfers. The API caps a query at ~2M blocks and
 * one direction (to OR from), so we walk [from, to] in windows and query both
 * directions per window. `to` is pinned at the first call so pages stay stable
 * while the chain advances.
 */
interface TransfersCursor {
  from: number;
  to: number;
  /** Page key per direction; null once that direction is exhausted for `from`'s window. */
  inKey: string | null;
  outKey: string | null;
}

export interface NoderealWalletProviderDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class NoderealWalletProvider implements WalletProvider {
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(deps: NoderealWalletProviderDeps = {}) {
    this.apiKey = deps.apiKey ?? env.noderealApiKey();
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchImpl(`${NODEREAL_BASE}/${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `NodeReal ${res.status} on ${method}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      result?: T;
      error?: { code?: number; message?: string };
    };
    if (json.error || json.result === undefined) {
      throw new Error(
        `NodeReal ${json.error?.code ?? "?"} on ${method}: ${json.error?.message ?? "empty result"}`,
      );
    }
    return json.result;
  }

  async getBalances(address: string): Promise<WalletBalance[]> {
    const rows: NoderealHoldingRow[] = [];
    let native = "0x0";
    for (let page = 1; ; page++) {
      const res = await this.rpc<NoderealHoldingsResult>(
        "nr_getTokenHoldings",
        [address, hex(page), hex(PAGE_SIZE)],
      );
      if (page === 1) native = res.nativeTokenBalance;
      rows.push(...res.details);
      const total = parseInt(res.totalCount, 16);
      if (res.details.length < PAGE_SIZE || rows.length >= total) break;
    }

    const balances: WalletBalance[] = [
      {
        tokenAddress: "native",
        symbol: "BNB",
        amount: hexToAmount(native, 18),
        decimals: 18,
        native: true,
      },
    ];
    for (const r of rows) {
      const decimals = r.tokenDecimals ? parseInt(r.tokenDecimals, 16) : 18;
      balances.push({
        tokenAddress: r.tokenAddress,
        symbol: r.tokenSymbol ?? "?",
        amount: hexToAmount(r.tokenBalance, decimals),
        decimals,
        native: false,
      });
    }
    // NodeReal has no spam flag and a BSC wallet collects dozens of airdropped
    // junk tokens. Keep only assets the app can classify — an unknown symbol
    // can't be priced anyway, so it would only pollute the holdings table.
    return balances.filter(
      (b) => b.amount > 0 && resolveToken(b.symbol).kind !== "unknown",
    );
  }

  async getTransfers(
    address: string,
    opts: GetTransfersOptions = {},
  ): Promise<TransfersPage> {
    const wallet = address.toLowerCase();
    let state: TransfersCursor;
    if (opts.cursor) {
      state = decodeCursor(opts.cursor);
    } else {
      const latest = parseInt(
        await this.rpc<string>("eth_blockNumber", []),
        16,
      );
      state = {
        from: opts.fromBlock ?? 0,
        to: Math.max(0, latest - HEAD_LAG_BLOCKS),
        inKey: "",
        outKey: "",
      };
    }

    let headRetries = 0;
    while (state.from <= state.to) {
      // Resuming mid-window: finish that window's pending pages first.
      const resumed = state.inKey || state.outKey;
      const windows = resumed
        ? [state]
        : windowsFrom(state.from, state.to, WINDOW_CONCURRENCY);

      let results: Awaited<ReturnType<typeof this.fetchWindow>>[];
      try {
        results = await Promise.all(
          windows.map((w) => this.fetchWindow(address, w)),
        );
      } catch (err) {
        // The transfer index trails the node head; if our pinned `to` is past
        // it, step back and retry rather than failing the whole sync.
        if (!isHeadNotReached(err) || headRetries++ >= HEAD_LAG_RETRIES)
          throw err;
        state = { ...state, to: state.to - HEAD_LAG_STEP };
        continue;
      }

      const out: NormalizedTransfer[] = [];
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        const r = results[i];
        for (const row of r.rows) out.push(normalize(row, wallet));
        const windowEnd = Math.min(w.from + MAX_BLOCK_SPAN, w.to);
        if (r.inKey !== null || r.outKey !== null) {
          // More pages in this window; later windows are re-fetched next call.
          state = { from: w.from, to: w.to, inKey: r.inKey, outKey: r.outKey };
          return { transfers: finalize(out), cursor: encodeCursor(state) };
        }
        state = { from: windowEnd + 1, to: w.to, inKey: "", outKey: "" };
      }

      if (out.length > 0) {
        const cursor = state.from <= state.to ? encodeCursor(state) : null;
        return { transfers: finalize(out), cursor };
      }
      // Empty windows never consume a caller page — keep scanning.
    }

    return { transfers: [], cursor: null };
  }

  /**
   * Fetch one page per pending direction for a single block window. A direction
   * is pending while its key is a string ("" = first page); it becomes null
   * when the API returns no further pageKey.
   */
  private async fetchWindow(
    address: string,
    w: TransfersCursor,
  ): Promise<{
    rows: NoderealTransferRow[];
    inKey: string | null;
    outKey: string | null;
  }> {
    const toBlock = Math.min(w.from + MAX_BLOCK_SPAN, w.to);
    const base = {
      fromBlock: hex(w.from),
      toBlock: hex(toBlock),
      category: [CATEGORY_ERC20],
      order: "asc",
      maxCount: hex(PAGE_SIZE),
    };
    const fetchDir = async (
      key: string | null,
      dir: "toAddress" | "fromAddress",
    ) => {
      if (key === null) return { rows: [], key: null };
      const params = {
        ...base,
        [dir]: address,
        ...(key ? { pageKey: key } : {}),
      };
      const res = await this.rpc<NoderealTransfersResult>(
        "nr_getAssetTransfers",
        [params],
      );
      return { rows: res.transfers ?? [], key: res.pageKey || null };
    };

    const [inn, outt] = await Promise.all([
      fetchDir(w.inKey, "toAddress"),
      fetchDir(w.outKey, "fromAddress"),
    ]);
    return {
      rows: [...inn.rows, ...outt.rows],
      inKey: inn.key,
      outKey: outt.key,
    };
  }
}

function isHeadNotReached(err: unknown): boolean {
  return err instanceof Error && /blockNum not reached/i.test(err.message);
}

/** Split [from, to] into up to `count` consecutive API-sized windows. */
function windowsFrom(
  from: number,
  to: number,
  count: number,
): TransfersCursor[] {
  const windows: TransfersCursor[] = [];
  let start = from;
  while (start <= to && windows.length < count) {
    windows.push({ from: start, to, inKey: "", outKey: "" });
    start += MAX_BLOCK_SPAN + 1;
  }
  return windows;
}

/** Dedupe (a self-transfer shows up in both directions) and order by chain position. */
function finalize(transfers: NormalizedTransfer[]): NormalizedTransfer[] {
  const seen = new Set<string>();
  const unique = transfers.filter((t) => {
    const k = `${t.txHash}:${t.logIndex}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );
}

function encodeCursor(c: TransfersCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(s: string): TransfersCursor {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
}

function hex(n: number): string {
  return `0x${n.toString(16)}`;
}

/** Scale a hex integer by `decimals` without losing the integer part to float. */
function hexToAmount(value: string, decimals: number): number {
  const v = BigInt(value);
  const base = BigInt(10) ** BigInt(decimals);
  return Number(v / base) + Number(v % base) / Number(base);
}

/** Map a raw NodeReal transfer to our normalized, wallet-oriented shape. */
function normalize(r: NoderealTransferRow, wallet: string): NormalizedTransfer {
  const isOut = r.from?.toLowerCase() === wallet;
  return {
    txHash: r.hash,
    logIndex: Number(r.logIndex),
    blockNumber: parseInt(r.blockNum, 16),
    ts: new Date(r.blockTimeStamp * 1000).toISOString(),
    tokenAddress: r.contractAddress ?? "",
    tokenSymbol: r.asset || null,
    direction: isOut ? "out" : "in",
    counterparty: isOut ? r.to : r.from,
    rawAmount: BigInt(r.value).toString(),
    decimals: Number(r.decimal ?? 18),
  };
}

/** Default singleton for app code. Tests inject a mock provider instead. */
let _default: NoderealWalletProvider | null = null;
export function walletProvider(): NoderealWalletProvider {
  if (!_default) _default = new NoderealWalletProvider();
  return _default;
}
