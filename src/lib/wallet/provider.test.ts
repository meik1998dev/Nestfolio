import { describe, it, expect } from "vitest";
import { NoderealWalletProvider } from "./provider";

const ADDRESS = "0x4d67ea126736da534b6f499f49613d496066996b";
const OTHER = "0x88649f4743a758171077b98ee2003f1989b1615a";

type RpcCall = { method: string; params: unknown[] };

/** Build a fetch stub that answers JSON-RPC by method and records every call. */
function fakeRpc(handler: (call: RpcCall) => unknown): {
  fetchImpl: typeof fetch;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RpcCall;
    calls.push(body);
    const result = handler(body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const hex = (n: number) => `0x${n.toString(16)}`;

function holding(
  symbol: string,
  balance: string,
  decimals = "0x12",
  tokenAddress = "0x" + symbol.padEnd(40, "0"),
) {
  return {
    tokenAddress,
    tokenBalance: balance,
    tokenSymbol: symbol,
    tokenDecimals: decimals,
  };
}

function transferRow(o: {
  hash: string;
  logIndex: number;
  block: number;
  from: string;
  to: string;
  asset?: string;
}) {
  return {
    hash: o.hash,
    logIndex: o.logIndex,
    blockNum: hex(o.block),
    blockTimeStamp: 1_787_667_229,
    contractAddress: "0x4553cfe1c09f37f38b12dc509f676964e392f8fc",
    asset: o.asset ?? "AMZNon",
    decimal: "18",
    from: o.from,
    to: o.to,
    value: "0x00000000000000000000000000000000000000000000000008c58a588f223742",
  };
}

describe("NoderealWalletProvider.getBalances", () => {
  it("includes native BNB, scales hex balances, and drops zero + spam tokens", async () => {
    const { fetchImpl, calls } = fakeRpc(() => ({
      totalCount: "0x4",
      nativeTokenBalance: "0x0de0b6b3a7640000", // 1 BNB
      details: [
        holding("USDT", "0x056bc75e2d63100000"), // 100
        holding("NVDAon", "0x1bc16d674ec80000"), // 2
        holding("币安人生", "0x3b9aca00", "0x9"), // spam
        holding("ORCLon", "0x0"), // zero balance
      ],
    }));
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl });

    const balances = await p.getBalances(ADDRESS);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("nr_getTokenHoldings");
    expect(calls[0].params).toEqual([ADDRESS, "0x1", "0x64"]);
    expect(balances).toEqual([
      {
        tokenAddress: "native",
        symbol: "BNB",
        amount: 1,
        decimals: 18,
        native: true,
      },
      expect.objectContaining({
        symbol: "USDT",
        amount: 100,
        decimals: 18,
        native: false,
      }),
      expect.objectContaining({ symbol: "NVDAon", amount: 2 }),
    ]);
  });

  it("pages through holdings until totalCount is reached", async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        holding(`USDT`, "0x1", "0x0", hex(i)),
      );
    const { fetchImpl, calls } = fakeRpc(({ params }) => ({
      totalCount: "0x96", // 150
      nativeTokenBalance: "0x0",
      details: params[1] === "0x1" ? page(100) : page(50),
    }));
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl });

    const balances = await p.getBalances(ADDRESS);

    expect(calls.map((c) => c.params[1])).toEqual(["0x1", "0x2"]);
    // 150 USDT rows kept, native BNB dropped (zero).
    expect(balances).toHaveLength(150);
  });
});

describe("NoderealWalletProvider.getTransfers", () => {
  it("queries both directions per window, merges, dedupes and sorts", async () => {
    const { fetchImpl, calls } = fakeRpc(({ method, params }) => {
      if (method === "eth_blockNumber") return hex(500);
      const q = params[0] as Record<string, string>;
      if (q.toAddress) {
        return {
          pageKey: "",
          transfers: [
            transferRow({
              hash: "0xa",
              logIndex: 5,
              block: 20,
              from: OTHER,
              to: ADDRESS,
            }),
            transferRow({
              hash: "0xself",
              logIndex: 1,
              block: 30,
              from: ADDRESS,
              to: ADDRESS,
            }),
          ],
        };
      }
      return {
        pageKey: "",
        transfers: [
          transferRow({
            hash: "0xb",
            logIndex: 2,
            block: 10,
            from: ADDRESS,
            to: OTHER,
          }),
          transferRow({
            hash: "0xself",
            logIndex: 1,
            block: 30,
            from: ADDRESS,
            to: ADDRESS,
          }),
        ],
      };
    });
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl });

    const page = await p.getTransfers(ADDRESS, { fromBlock: 0 });

    const transferCalls = calls.filter(
      (c) => c.method === "nr_getAssetTransfers",
    );
    expect(transferCalls).toHaveLength(2);
    const q = transferCalls[0].params[0] as Record<string, unknown>;
    expect(q).toMatchObject({
      fromBlock: "0x0",
      toBlock: hex(500 - 30), // head pinned 30 blocks behind the node
      category: ["20"],
      order: "asc",
      maxCount: "0x64",
    });

    expect(page.cursor).toBeNull();
    expect(page.transfers.map((t) => [t.txHash, t.direction])).toEqual([
      ["0xb", "out"],
      ["0xa", "in"],
      ["0xself", "out"],
    ]);
    expect(page.transfers[1]).toMatchObject({
      blockNumber: 20,
      logIndex: 5,
      ts: "2026-08-25T14:13:49.000Z",
      tokenSymbol: "AMZNon",
      counterparty: OTHER,
      rawAmount: "632063435678562114",
      decimals: 18,
    });
  });

  it("follows pageKeys through an opaque cursor and finishes with null", async () => {
    const { fetchImpl } = fakeRpc(({ method, params }) => {
      if (method === "eth_blockNumber") return hex(100);
      const q = params[0] as Record<string, string>;
      if (q.fromAddress) return { pageKey: "", transfers: [] };
      if (!q.pageKey) {
        return {
          pageKey: "next",
          transfers: [
            transferRow({
              hash: "0x1",
              logIndex: 1,
              block: 1,
              from: OTHER,
              to: ADDRESS,
            }),
          ],
        };
      }
      expect(q.pageKey).toBe("next");
      return {
        pageKey: "",
        transfers: [
          transferRow({
            hash: "0x2",
            logIndex: 1,
            block: 2,
            from: OTHER,
            to: ADDRESS,
          }),
        ],
      };
    });
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl });

    const first = await p.getTransfers(ADDRESS);
    expect(first.transfers.map((t) => t.txHash)).toEqual(["0x1"]);
    expect(first.cursor).toEqual(expect.any(String));

    const second = await p.getTransfers(ADDRESS, { cursor: first.cursor! });
    expect(second.transfers.map((t) => t.txHash)).toEqual(["0x2"]);
    expect(second.cursor).toBeNull();
  });

  it("splits a long range into <2M-block windows and skips empty ones", async () => {
    const latest = 5_000_030;
    const head = 5_000_000; // latest − 30 head lag
    const { fetchImpl, calls } = fakeRpc(({ method, params }) => {
      if (method === "eth_blockNumber") return hex(latest);
      const q = params[0] as Record<string, string>;
      const from = parseInt(q.fromBlock, 16);
      const to = parseInt(q.toBlock, 16);
      expect(to - from).toBeLessThan(2_000_000);
      // Only the last window has activity, and only inbound.
      if (q.toAddress && to === head) {
        return {
          pageKey: "",
          transfers: [
            transferRow({
              hash: "0xz",
              logIndex: 0,
              block: head,
              from: OTHER,
              to: ADDRESS,
            }),
          ],
        };
      }
      return { pageKey: "", transfers: [] };
    });
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl });

    const page = await p.getTransfers(ADDRESS, { fromBlock: 0 });

    expect(page.transfers.map((t) => t.txHash)).toEqual(["0xz"]);
    expect(page.cursor).toBeNull();
    const ranges = calls
      .filter(
        (c) =>
          c.method === "nr_getAssetTransfers" &&
          (c.params[0] as { toAddress?: string }).toAddress,
      )
      .map((c) => {
        const q = c.params[0] as Record<string, string>;
        return [parseInt(q.fromBlock, 16), parseInt(q.toBlock, 16)];
      });
    expect(ranges).toEqual([
      [0, 1_999_999],
      [2_000_000, 3_999_999],
      [4_000_000, 5_000_000],
    ]);
  });

  it("pins the head behind the node and steps back when the index lags", async () => {
    const latest = 10_000;
    const indexedHead = 9_800;
    const { fetchImpl, calls } = fakeRpc(({ method, params }) => {
      if (method === "eth_blockNumber") return hex(latest);
      const q = params[0] as Record<string, string>;
      if (parseInt(q.toBlock, 16) > indexedHead) {
        throw new Error("blockNum not reached");
      }
      return { pageKey: "", transfers: [] };
    });
    // fakeRpc returns thrown handler errors as JSON-RPC errors.
    const rpcFetch = (async (url: unknown, init?: RequestInit) => {
      try {
        return await fetchImpl(url as string, init);
      } catch (e) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32000, message: (e as Error).message },
          }),
          { status: 200 },
        );
      }
    }) as unknown as typeof fetch;
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl: rpcFetch });

    const page = await p.getTransfers(ADDRESS, { fromBlock: 9_000 });

    expect(page).toEqual({ transfers: [], cursor: null });
    const tos = calls
      .filter((c) => c.method === "nr_getAssetTransfers")
      .map((c) => parseInt((c.params[0] as { toBlock: string }).toBlock, 16));
    // 9970 (latest − 30) fails, 9870 fails, 9770 succeeds.
    expect([...new Set(tos)]).toEqual([9_970, 9_870, 9_770]);
  });

  it("surfaces JSON-RPC errors as thrown errors", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "range must be less than 2000000" },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const p = new NoderealWalletProvider({ apiKey: "k", fetchImpl });

    await expect(p.getBalances(ADDRESS)).rejects.toThrow(
      "NodeReal -32000 on nr_getTokenHoldings: range must be less than 2000000",
    );
  });
});
