import { describe, it, expect, beforeEach, vi } from "vitest";
import { runSync } from "./orchestrator";
import type { rebuildCostBasis } from "@/lib/pnl/ledger";
import type {
  WalletProvider,
  NormalizedTransfer,
  WalletBalance,
  TransfersPage,
} from "@/lib/wallet/provider";
import type { PriceProvider } from "@/lib/price/provider";

// --- In-memory fake of the bits of the Supabase service client we use --------
//
// Supports the exact chained calls the orchestrator makes against `wallets`,
// `wallet_transfers`, and `holdings`. Tiny on purpose — enough to assert
// idempotency, balance→holding mapping, and graceful failure.

const USER = "user-1";
const WALLET_ID = "wallet-1";
const ADDRESS = "0x4d67ea126736da534b6f499f49613d496066996b";

type Row = Record<string, unknown>;

let idSeq = 0;

class FakeTable {
  rows: Row[] = [];
  constructor(public name: string) {}
}

class FakeDb {
  tables: Record<string, FakeTable> = {
    wallets: new FakeTable("wallets"),
    wallet_transfers: new FakeTable("wallet_transfers"),
    holdings: new FakeTable("holdings"),
    live_prices: new FakeTable("live_prices"),
    price_history: new FakeTable("price_history"),
  };

  from(name: string) {
    return new FakeQuery(this.tables[name]);
  }
}

// A query builder that records filters and resolves like PostgREST.
class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private inFilter: [string, unknown[]] | null = null;
  private mode:
    | { kind: "select" }
    | { kind: "update"; values: Row }
    | { kind: "insert"; values: Row }
    | {
        kind: "upsert";
        values: Row[];
        onConflict: string;
        ignoreDuplicates: boolean;
      }
    | { kind: "delete" }
    | null = null;

  constructor(private table: FakeTable) {}

  select() {
    this.mode = { kind: "select" };
    return this;
  }
  insert(values: Row | Row[]) {
    this.mode = {
      kind: "insert",
      values: Array.isArray(values) ? values[0] : values,
    };
    const arr = Array.isArray(values) ? values : [values];
    for (const v of arr) {
      // Mimic the DB default-generated primary key so later reads can match rows.
      this.table.rows.push({ id: `gen-${idSeq++}`, ...v });
    }
    return Promise.resolve({ data: null, error: null });
  }
  update(values: Row) {
    this.mode = { kind: "update", values };
    return this;
  }
  delete() {
    this.mode = { kind: "delete" };
    return this;
  }
  upsert(
    values: Row[],
    opts: { onConflict: string; ignoreDuplicates?: boolean },
  ) {
    const arr = Array.isArray(values) ? values : [values];
    const keys = opts.onConflict.split(",");
    for (const v of arr) {
      const exists = this.table.rows.find((r) =>
        keys.every((k) => r[k] === v[k]),
      );
      if (exists) {
        if (!opts.ignoreDuplicates) Object.assign(exists, v);
      } else {
        this.table.rows.push({ ...v });
      }
    }
    return Promise.resolve({ data: null, error: null });
  }

  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this.applyMutationIfTerminal();
  }
  in(col: string, vals: unknown[]) {
    this.inFilter = [col, vals];
    return this.applyMutationIfTerminal();
  }

  private matches(r: Row): boolean {
    const eqOk = this.filters.every(([c, v]) => r[c] === v);
    const inOk = this.inFilter
      ? this.inFilter[1].includes(r[this.inFilter[0]])
      : true;
    return eqOk && inOk;
  }

  // update/delete become terminal once filters are applied; we resolve eagerly
  // on the LAST chained call by returning a thenable that also keeps chaining.
  private applyMutationIfTerminal() {
    return this;
  }

  private runMutation() {
    if (this.mode?.kind === "update") {
      for (const r of this.table.rows) {
        if (this.matches(r)) Object.assign(r, this.mode.values);
      }
    } else if (this.mode?.kind === "delete") {
      this.table.rows = this.table.rows.filter((r) => !this.matches(r));
    }
  }

  maybeSingle() {
    const row = this.table.rows.find((r) => this.matches(r));
    return Promise.resolve({ data: row ? { ...row } : null, error: null });
  }
  limit() {
    return this;
  }
  order() {
    return this;
  }

  // Make the query awaitable for select/update/delete chains.
  then(resolve: (v: { data: Row[]; error: null }) => void) {
    if (this.mode?.kind === "update" || this.mode?.kind === "delete") {
      this.runMutation();
      resolve({ data: [], error: null });
      return;
    }
    const data = this.table.rows
      .filter((r) => this.matches(r))
      .map((r) => ({ ...r }));
    resolve({ data, error: null });
  }
}

// --- Mock providers ----------------------------------------------------------

function makeTransfer(
  i: number,
  block: number,
  over: Partial<NormalizedTransfer> = {},
): NormalizedTransfer {
  return {
    txHash: `0xhash${i}`,
    logIndex: i,
    blockNumber: block,
    ts: "2026-06-01T00:00:00.000Z",
    tokenAddress: "0xtoken",
    tokenSymbol: "NVDAon",
    direction: "in",
    counterparty: "0xcp",
    rawAmount: "1000000000000000000",
    decimals: 18,
    ...over,
  };
}

class MockWallet implements WalletProvider {
  constructor(
    private transfers: NormalizedTransfer[],
    private balances: WalletBalance[],
  ) {}
  getTransfers(): Promise<TransfersPage> {
    return Promise.resolve({ transfers: this.transfers, cursor: null });
  }
  getBalances(): Promise<WalletBalance[]> {
    return Promise.resolve(this.balances);
  }
}

class ThrowingWallet implements WalletProvider {
  getTransfers(): Promise<TransfersPage> {
    throw new Error("NodeReal 429 rate limited");
  }
  getBalances(): Promise<WalletBalance[]> {
    throw new Error("NodeReal 429 rate limited");
  }
}

const noopPrices: PriceProvider = {
  livePrice: () => Promise.resolve(100),
  histPrice: () => Promise.resolve(100),
  goldPerGram: () => Promise.resolve(80),
};

/** Stub of the post-sync PnL rebuild — the real one needs trade_events/cost_basis tables. */
const okRebuild = () =>
  vi.fn<typeof rebuildCostBasis>(() =>
    Promise.resolve({ eventsWritten: 3, tickersUpserted: 2 }),
  );

function seedWallet(db: FakeDb, lastBlock: number | null) {
  db.tables.wallets.rows.push({
    id: WALLET_ID,
    user_id: USER,
    address: ADDRESS,
    last_synced_block: lastBlock,
    sync_status: "idle",
  });
}

const bal = (symbol: string, amount: number): WalletBalance => ({
  tokenAddress: "0x" + symbol,
  symbol,
  amount,
  decimals: 18,
  native: symbol === "BNB",
});

// --- Tests -------------------------------------------------------------------

describe("runSync — cold start", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
    seedWallet(db, null);
  });

  it("backfills transfers, maps balances→holdings, advances cursor", async () => {
    const wallet = new MockWallet(
      [makeTransfer(0, 100), makeTransfer(1, 105)],
      [bal("NVDAon", 5), bal("BNB", 2)],
    );

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild: okRebuild(),
    });

    expect(res.status).toBe("synced");
    expect(res.transfersAdded).toBe(2);
    expect(db.tables.wallet_transfers.rows).toHaveLength(2);

    // Holdings: two wallet rows in the unassigned bucket.
    const holdings = db.tables.holdings.rows;
    expect(holdings).toHaveLength(2);
    const nvda = holdings.find((h) => h.asset === "NVDAon")!;
    expect(nvda.amount).toBe(5);
    expect(nvda.source).toBe("wallet");
    expect(nvda.wallet_ref).toBe(ADDRESS);
    expect(nvda.portfolio_id).toBeNull();

    // Cursor advanced to the highest block seen.
    const w = db.tables.wallets.rows[0];
    expect(w.last_synced_block).toBe(105);
    expect(w.sync_status).toBe("synced");
  });
});

describe("runSync — idempotency", () => {
  it("re-running does not duplicate transfers", async () => {
    const db = new FakeDb();
    seedWallet(db, null);
    const transfers = [makeTransfer(0, 100), makeTransfer(1, 105)];
    const wallet = new MockWallet(transfers, [bal("NVDAon", 5)]);

    await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild: okRebuild(),
    });
    await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild: okRebuild(),
    });

    expect(db.tables.wallet_transfers.rows).toHaveLength(2);
    // Holding amount stays a single row, updated not duplicated.
    expect(
      db.tables.holdings.rows.filter((h) => h.asset === "NVDAon"),
    ).toHaveLength(1);
  });
});

describe("runSync — warm delta", () => {
  it("requests transfers from the cursor minus reorg overlap", async () => {
    const db = new FakeDb();
    seedWallet(db, 1000);

    let requestedFrom: number | undefined;
    const wallet: WalletProvider = {
      getTransfers: (_addr, opts) => {
        requestedFrom = opts?.fromBlock;
        return Promise.resolve({
          transfers: [makeTransfer(2, 1010)],
          cursor: null,
        });
      },
      getBalances: () => Promise.resolve([bal("NVDAon", 7)]),
    };

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild: okRebuild(),
    });

    expect(requestedFrom).toBe(980); // 1000 − 20-block overlap
    expect(res.status).toBe("synced");
    expect(db.tables.wallets.rows[0].last_synced_block).toBe(1010);
  });
});

describe("runSync — holding reconciliation", () => {
  it("updates held amounts and prunes tokens no longer held", async () => {
    const db = new FakeDb();
    seedWallet(db, 100);
    // Pre-existing wallet holdings.
    db.tables.holdings.rows.push(
      {
        id: "h1",
        user_id: USER,
        asset: "NVDAon",
        amount: 5,
        source: "wallet",
        wallet_ref: ADDRESS,
        portfolio_id: null,
      },
      {
        id: "h2",
        user_id: USER,
        asset: "METAon",
        amount: 3,
        source: "wallet",
        wallet_ref: ADDRESS,
        portfolio_id: null,
      },
    );

    // Now only holds NVDAon (more of it); METAon is gone.
    const wallet = new MockWallet([], [bal("NVDAon", 9)]);
    await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild: okRebuild(),
    });

    const holdings = db.tables.holdings.rows;
    expect(holdings).toHaveLength(1);
    expect(holdings[0].asset).toBe("NVDAon");
    expect(holdings[0].amount).toBe(9);
  });
});

describe("runSync — post-sync PnL rebuild", () => {
  it("runs the rebuild after a successful sync and reports its counts", async () => {
    const db = new FakeDb();
    seedWallet(db, null);
    const wallet = new MockWallet([makeTransfer(0, 100)], [bal("NVDAon", 5)]);
    const rebuild = okRebuild();

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild,
    });

    expect(res.status).toBe("synced");
    expect(res.rebuild).toEqual({ eventsWritten: 3, tickersUpserted: 2 });
    expect(rebuild).toHaveBeenCalledTimes(1);
    // Same user/wallet and the SAME injected db + prices (no fresh clients).
    expect(rebuild).toHaveBeenCalledWith(USER, WALLET_ID, {
      db,
      prices: noopPrices,
    });
  });

  it("also runs on a 0-transfer sync (heals a stale cost_basis)", async () => {
    const db = new FakeDb();
    seedWallet(db, 100);
    const wallet = new MockWallet([], [bal("NVDAon", 5)]);
    const rebuild = okRebuild();

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild,
    });

    expect(res.status).toBe("synced");
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("rebuild failure → degraded, but transfers + advanced cursor are kept", async () => {
    const db = new FakeDb();
    seedWallet(db, null);
    const wallet = new MockWallet([makeTransfer(0, 100)], [bal("NVDAon", 5)]);
    const rebuild = vi.fn<typeof rebuildCostBasis>(() =>
      Promise.reject(new Error("no historical price for NVDA")),
    );

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet,
      prices: noopPrices,
      rebuild,
    });

    expect(res.status).toBe("degraded");
    expect(res.error).toMatch(/pnl rebuild: no historical price/);
    // Raw data is safe: transfers stored, cursor advanced, wallet flagged.
    expect(db.tables.wallet_transfers.rows).toHaveLength(1);
    expect(db.tables.wallets.rows[0].last_synced_block).toBe(100);
    expect(db.tables.wallets.rows[0].sync_status).toBe("degraded");
  });

  it("is NOT called when the sync itself fails", async () => {
    const db = new FakeDb();
    seedWallet(db, 500);
    const rebuild = okRebuild();

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet: new ThrowingWallet(),
      prices: noopPrices,
      rebuild,
    });

    expect(res.status).toBe("degraded");
    expect(rebuild).not.toHaveBeenCalled();
  });
});

describe("runSync — graceful failure", () => {
  it("provider throws → status degraded, last-known preserved", async () => {
    const db = new FakeDb();
    seedWallet(db, 500);
    db.tables.holdings.rows.push({
      id: "h1",
      user_id: USER,
      asset: "NVDAon",
      amount: 5,
      source: "wallet",
      wallet_ref: ADDRESS,
      portfolio_id: null,
    });

    const res = await runSync(USER, WALLET_ID, {
      db: db as never,
      wallet: new ThrowingWallet(),
      prices: noopPrices,
      rebuild: okRebuild(),
    });

    expect(res.status).toBe("degraded");
    expect(res.error).toMatch(/rate limited/);
    // Last-known holding untouched, cursor not advanced.
    expect(db.tables.holdings.rows).toHaveLength(1);
    expect(db.tables.holdings.rows[0].amount).toBe(5);
    expect(db.tables.wallets.rows[0].last_synced_block).toBe(500);
    expect(db.tables.wallets.rows[0].sync_status).toBe("degraded");
  });
});
