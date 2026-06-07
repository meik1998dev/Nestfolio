/**
 * WalletProvider — read-only access to a public BNB-chain address.
 *
 * Provider = Moralis Web3 Data API (BSC). Behind an interface so it can be
 * swapped for direct RPC later. We use ONLY raw balances + transfers here; we do
 * NOT trust Moralis `usd_price` for tokenized stocks (thin-liquidity DEX price).
 * Pricing is the PriceProvider's job.
 *
 * Server-only (reads MORALIS_API_KEY). All network errors surface to the caller
 * so the sync orchestrator can degrade gracefully.
 */
import { env } from "@/lib/env";
import type { TransferDirection } from "@/lib/types";

const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";
const CHAIN = "bsc";

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

/** Raw Moralis token-balance row (the fields we read). */
interface MoralisTokenRow {
  token_address?: string;
  symbol?: string;
  balance_formatted?: string;
  decimals?: number | string;
  native_token?: boolean;
  possible_spam?: boolean;
}

/** Raw Moralis transfer row (the fields we read). */
interface MoralisTransferRow {
  transaction_hash: string;
  log_index: number | string;
  block_number: number | string;
  block_timestamp: string;
  address?: string; // token contract
  token_symbol?: string;
  token_decimals?: number | string;
  from_address: string;
  to_address: string;
  value: string; // raw integer string
}

export interface MoralisWalletProviderDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class MoralisWalletProvider implements WalletProvider {
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(deps: MoralisWalletProviderDeps = {}) {
    this.apiKey = deps.apiKey ?? env.moralisApiKey();
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const qs = new URLSearchParams({ chain: CHAIN, ...params }).toString();
    const res = await this.fetchImpl(`${MORALIS_BASE}${path}?${qs}`, {
      headers: {
        "X-API-Key": this.apiKey,
        accept: "application/json",
        // Cloudflare blocks the default lib UA; send a browser UA.
        "User-Agent": "Mozilla/5.0 (Nestfolio wallet sync)",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Moralis ${res.status} on ${path}: ${body.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }

  async getBalances(address: string): Promise<WalletBalance[]> {
    const json = await this.get<{ result?: MoralisTokenRow[] }>(
      `/wallets/${address}/tokens`,
      { exclude_spam: "true" },
    );
    const rows = json.result ?? [];
    return rows
      .filter((r) => !r.possible_spam && r.balance_formatted !== undefined)
      .map((r) => ({
        tokenAddress: r.token_address ?? "native",
        symbol: r.symbol ?? "?",
        amount: Number(r.balance_formatted ?? 0),
        decimals: Number(r.decimals ?? 18),
        native: Boolean(r.native_token),
      }))
      .filter((b) => b.amount > 0);
  }

  async getTransfers(
    address: string,
    opts: GetTransfersOptions = {},
  ): Promise<TransfersPage> {
    const params: Record<string, string> = { order: "ASC", limit: "100" };
    if (opts.fromBlock !== undefined)
      params.from_block = String(opts.fromBlock);
    if (opts.cursor) params.cursor = opts.cursor;

    const json = await this.get<{
      result?: MoralisTransferRow[];
      cursor?: string | null;
    }>(`/${address}/erc20/transfers`, params);

    const wallet = address.toLowerCase();
    const transfers = (json.result ?? []).map((r) => normalize(r, wallet));

    return { transfers, cursor: json.cursor || null };
  }
}

/** Map a raw Moralis transfer to our normalized, wallet-oriented shape. */
function normalize(r: MoralisTransferRow, wallet: string): NormalizedTransfer {
  const isOut = r.from_address?.toLowerCase() === wallet;
  return {
    txHash: r.transaction_hash,
    logIndex: Number(r.log_index),
    blockNumber: Number(r.block_number),
    ts: new Date(r.block_timestamp).toISOString(),
    tokenAddress: r.address ?? "",
    tokenSymbol: r.token_symbol ?? null,
    direction: isOut ? "out" : "in",
    counterparty: isOut ? r.to_address : r.from_address,
    rawAmount: r.value,
    decimals: Number(r.token_decimals ?? 18),
  };
}

/** Default singleton for app code. Tests inject a mock provider instead. */
let _default: MoralisWalletProvider | null = null;
export function walletProvider(): MoralisWalletProvider {
  if (!_default) _default = new MoralisWalletProvider();
  return _default;
}
