"use server";

/**
 * Server-side data access + mutations for accounts. RLS scopes every read to the
 * signed-in user; on insert we still set `user_id` explicitly (contract rule).
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Account, AccountType } from "@/lib/types";
import { deriveAccountBalances } from "@/lib/ledger/balances";
import { listTransactions } from "@/lib/ledger/transactions";

const ACCOUNT_TYPES: AccountType[] = [
  "cash",
  "crypto_wallet",
  "gold",
  "stock",
  "expense",
  "external",
];

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

/** All accounts for the user, oldest first (stable ordering for the UI). */
export async function listAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Account[];
}

/** Account plus its derived cash balance from the transaction log. */
export interface AccountWithBalance extends Account {
  balance: number;
}

/** Accounts with balances re-derived from the full transaction log. */
export async function getAccountsWithBalances(): Promise<AccountWithBalance[]> {
  const [accounts, transactions] = await Promise.all([
    listAccounts(),
    listTransactions(),
  ]);
  const balances = deriveAccountBalances(accounts, transactions);
  return accounts.map((account) => ({
    ...account,
    balance: balances.get(account.id) ?? 0,
  }));
}

/** Create an account from a form submission. */
export async function createAccount(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as AccountType;
  const currency = String(formData.get("currency") ?? "USD").trim() || "USD";

  if (!name) throw new Error("Account name is required");
  if (!ACCOUNT_TYPES.includes(type)) throw new Error("Invalid account type");

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase
    .from("accounts")
    .insert({ user_id: userId, name, type, currency });
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

/** Delete an account. Transactions referencing it keep working — the FK is
 *  `on delete set null`, so historical legs just lose that side. */
export async function deleteAccount(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Account id is required");

  const supabase = await createClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}
