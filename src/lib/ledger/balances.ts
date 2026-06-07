/**
 * Pure, dependency-free ledger math. The transaction log is the source of truth;
 * account balances and the conservation invariant are *derived* from it, never
 * stored. Keeping this side-effect free makes it cheap to unit-test and lets the
 * UI re-derive balances on every render without trusting a cached number.
 *
 * Model: a transaction moves `amount` USD from `source_account` (a debit) to
 * `dest_account` (a credit). The `external` account type is the outside world
 * (salary in, expense/spend out) — `null` source/dest means the value entered or
 * left the tracked system.
 */
import type { Account, Transaction } from "@/lib/types";

/**
 * Derive each account's cash balance from the transaction log.
 * balance(account) = Σ(amount where dest = account) − Σ(amount where source = account).
 * Accounts with no activity are still present in the map (balance 0).
 */
export function deriveAccountBalances(
  accounts: Account[],
  transactions: Transaction[],
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const account of accounts) balances.set(account.id, 0);

  for (const tx of transactions) {
    if (tx.source_account && balances.has(tx.source_account)) {
      balances.set(
        tx.source_account,
        (balances.get(tx.source_account) ?? 0) - tx.amount,
      );
    }
    if (tx.dest_account && balances.has(tx.dest_account)) {
      balances.set(
        tx.dest_account,
        (balances.get(tx.dest_account) ?? 0) + tx.amount,
      );
    }
  }

  return balances;
}

/**
 * The reconciliation invariant. Every transaction debits exactly one side and
 * credits the other by the same `amount`, so the total delta across the whole
 * system — every internal account *and* the external world — is always zero.
 * A non-zero net total means a transaction leaked or duplicated value.
 *
 * We count `null` source/dest (the external world) as a real counterparty so the
 * books balance: income credits an account and debits "external" by the same
 * amount; an expense does the reverse.
 */
export function isConserved(transactions: Transaction[]): boolean {
  let net = 0;
  for (const tx of transactions) {
    // Each leg cancels: −amount on the source side, +amount on the dest side.
    net -= tx.amount; // debit source (internal or external)
    net += tx.amount; // credit dest (internal or external)
  }
  // Floating-point safe comparison; amounts are USD with cent precision.
  return Math.abs(net) < 1e-9;
}

/** A single category's spend within a month. */
export interface CategoryBreakdownEntry {
  category: string;
  total: number;
}

/**
 * Monthly expense breakdown by category. Considers only `expense` transactions
 * (account → external / expense). `month` is a `YYYY-MM` prefix; omit it to
 * total across all time. Uncategorized expenses fall under "Uncategorized".
 * Sorted by total, descending — biggest spend first, the way a budget reads.
 */
export function expenseByCategory(
  transactions: Transaction[],
  month?: string,
): CategoryBreakdownEntry[] {
  const totals = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    if (month && !tx.date.startsWith(month)) continue;
    const key = tx.category?.trim() || "Uncategorized";
    totals.set(key, (totals.get(key) ?? 0) + tx.amount);
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** Total expense spend, optionally scoped to a `YYYY-MM` month. */
export function totalExpenses(
  transactions: Transaction[],
  month?: string,
): number {
  return transactions
    .filter(
      (tx) => tx.type === "expense" && (!month || tx.date.startsWith(month)),
    )
    .reduce((sum, tx) => sum + tx.amount, 0);
}
