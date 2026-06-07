import { describe, it, expect } from "vitest";
import type { Account, Transaction, TransactionType } from "@/lib/types";
import {
  deriveAccountBalances,
  isConserved,
  expenseByCategory,
  totalExpenses,
} from "./balances";

// --- Fixtures -------------------------------------------------------------

const USER = "user-1";

function account(id: string, type: Account["type"], name = id): Account {
  return {
    id,
    user_id: USER,
    name,
    type,
    currency: "USD",
    created_at: "2026-01-01T00:00:00Z",
  };
}

let seq = 0;
function tx(
  type: TransactionType,
  source: string | null,
  dest: string | null,
  amount: number,
  extra: Partial<Transaction> = {},
): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    user_id: USER,
    date: "2026-06-01",
    type,
    source_account: source,
    dest_account: dest,
    amount,
    category: null,
    note: null,
    created_at: "2026-06-01T00:00:00Z",
    ...extra,
  };
}

// Standard cast of accounts used across the scenarios.
const cash = account("cash", "cash");
const broker = account("broker", "stock");
const wallet = account("wallet", "crypto_wallet");
const external = account("external", "external");
const expense = account("expense", "expense");

// --- deriveAccountBalances per transaction type ---------------------------

describe("deriveAccountBalances", () => {
  it("income credits the destination account (external → cash)", () => {
    const balances = deriveAccountBalances(
      [cash, external],
      [tx("income", external.id, cash.id, 5000)],
    );
    expect(balances.get(cash.id)).toBe(5000);
    expect(balances.get(external.id)).toBe(-5000);
  });

  it("buy debits cash and credits the asset account", () => {
    const balances = deriveAccountBalances(
      [cash, broker],
      [
        tx("income", external.id, cash.id, 5000),
        tx("buy", cash.id, broker.id, 2000),
      ],
    );
    expect(balances.get(cash.id)).toBe(3000);
    expect(balances.get(broker.id)).toBe(2000);
  });

  it("sell debits the asset account and credits cash", () => {
    const balances = deriveAccountBalances(
      [cash, broker],
      [
        tx("buy", cash.id, broker.id, 2000),
        tx("sell", broker.id, cash.id, 500),
      ],
    );
    // cash: −2000 + 500 ; broker: +2000 − 500
    expect(balances.get(cash.id)).toBe(-1500);
    expect(balances.get(broker.id)).toBe(1500);
  });

  it("transfer moves value between two internal accounts", () => {
    const balances = deriveAccountBalances(
      [cash, wallet],
      [tx("transfer", cash.id, wallet.id, 750)],
    );
    expect(balances.get(cash.id)).toBe(-750);
    expect(balances.get(wallet.id)).toBe(750);
  });

  it("expense debits an account and credits the expense/external sink", () => {
    const balances = deriveAccountBalances(
      [cash, expense],
      [tx("expense", cash.id, expense.id, 120)],
    );
    expect(balances.get(cash.id)).toBe(-120);
    expect(balances.get(expense.id)).toBe(120);
  });

  it("leaves untouched accounts at zero and ignores unknown accounts", () => {
    const balances = deriveAccountBalances(
      [cash, broker],
      [tx("income", external.id, cash.id, 100)], // external not in account list
    );
    expect(balances.get(cash.id)).toBe(100);
    expect(balances.get(broker.id)).toBe(0);
    expect(balances.has(external.id)).toBe(false);
  });
});

// --- Reconciliation: log sum == balances ----------------------------------

describe("reconciliation", () => {
  it("the full transaction log reconciles to derived balances", () => {
    const accounts = [cash, broker, wallet, external, expense];
    const log: Transaction[] = [
      tx("income", external.id, cash.id, 10000), // salary
      tx("buy", cash.id, broker.id, 4000), // buy stock
      tx("buy", cash.id, wallet.id, 1000), // buy crypto
      tx("sell", broker.id, cash.id, 1500), // sell some stock
      tx("transfer", cash.id, wallet.id, 500), // top up wallet
      tx("expense", cash.id, expense.id, 800), // rent
      tx("expense", cash.id, expense.id, 200), // groceries
    ];

    const balances = deriveAccountBalances(accounts, log);

    // Worked numbers:
    // cash:   +10000 −4000 −1000 +1500 −500 −800 −200 = 5000
    // broker: +4000 −1500 = 2500
    // wallet: +1000 +500 = 1500
    // expense: +800 +200 = 1000
    // external: −10000
    expect(balances.get(cash.id)).toBe(5000);
    expect(balances.get(broker.id)).toBe(2500);
    expect(balances.get(wallet.id)).toBe(1500);
    expect(balances.get(expense.id)).toBe(1000);
    expect(balances.get(external.id)).toBe(-10000);

    // Sum of every account (incl. external sink) is zero — value conserved.
    const sum = [...balances.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  it("buy then sell of the same size returns the holding account to zero", () => {
    const balances = deriveAccountBalances(
      [cash, broker],
      [
        tx("buy", cash.id, broker.id, 3000),
        tx("sell", broker.id, cash.id, 3000),
      ],
    );
    expect(balances.get(broker.id)).toBe(0);
    expect(balances.get(cash.id)).toBe(0);
  });
});

// --- Conservation invariant ----------------------------------------------

describe("isConserved", () => {
  it("holds for any well-formed log (every leg cancels)", () => {
    const log = [
      tx("income", external.id, cash.id, 9999.99),
      tx("expense", cash.id, expense.id, 12.34),
      tx("transfer", cash.id, wallet.id, 0.01),
    ];
    expect(isConserved(log)).toBe(true);
  });

  it("holds for an empty log", () => {
    expect(isConserved([])).toBe(true);
  });
});

// --- Expense breakdown ----------------------------------------------------

describe("expenseByCategory", () => {
  const log: Transaction[] = [
    tx("expense", cash.id, expense.id, 1200, {
      category: "Rent",
      date: "2026-06-01",
    }),
    tx("expense", cash.id, expense.id, 300, {
      category: "Food",
      date: "2026-06-05",
    }),
    tx("expense", cash.id, expense.id, 150, {
      category: "Food",
      date: "2026-06-20",
    }),
    tx("expense", cash.id, expense.id, 90, {
      category: null,
      date: "2026-06-10",
    }),
    tx("expense", cash.id, expense.id, 500, {
      category: "Rent",
      date: "2026-05-01",
    }),
    tx("income", external.id, cash.id, 8000, { date: "2026-06-01" }), // ignored
  ];

  it("totals expenses by category for a given month, biggest first", () => {
    const breakdown = expenseByCategory(log, "2026-06");
    expect(breakdown).toEqual([
      { category: "Rent", total: 1200 },
      { category: "Food", total: 450 },
      { category: "Uncategorized", total: 90 },
    ]);
  });

  it("excludes other months and non-expense transactions", () => {
    const june = expenseByCategory(log, "2026-06");
    // May's 500 Rent is not in June; income never counts.
    expect(june.find((e) => e.category === "Rent")?.total).toBe(1200);
  });

  it("totals across all time when no month is given", () => {
    const all = expenseByCategory(log);
    expect(all.find((e) => e.category === "Rent")?.total).toBe(1700);
  });
});

describe("totalExpenses", () => {
  it("sums only expense transactions, scoped to a month", () => {
    const log = [
      tx("expense", cash.id, expense.id, 100, { date: "2026-06-01" }),
      tx("expense", cash.id, expense.id, 250, { date: "2026-06-15" }),
      tx("expense", cash.id, expense.id, 999, { date: "2026-07-01" }),
      tx("buy", cash.id, broker.id, 5000, { date: "2026-06-02" }),
    ];
    expect(totalExpenses(log, "2026-06")).toBe(350);
    expect(totalExpenses(log)).toBe(1349);
  });
});
