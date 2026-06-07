"use server";

/**
 * Server-side data access + mutations for the transaction ledger. One shape
 * covers every value movement (income/buy/sell/transfer/expense) via
 * `type` + `source_account` → `dest_account`. Validation enforces which legs
 * each type requires so the books stay reconcilable.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Transaction, TransactionType } from "@/lib/types";

const TRANSACTION_TYPES: TransactionType[] = [
  "income",
  "buy",
  "sell",
  "transfer",
  "expense",
];

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

/** Full transaction log, newest first (the ledger view's default order). */
export async function listTransactions(): Promise<Transaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Transaction[];
}

/**
 * Which legs a transaction type requires.
 * - income: external/null source → an account (dest required)
 * - expense: an account → external/expense sink (source required)
 * - buy/sell/transfer: both legs are internal accounts (both required)
 */
function validateLegs(
  type: TransactionType,
  source: string | null,
  dest: string | null,
): void {
  switch (type) {
    case "income":
      if (!dest) throw new Error("Income needs a destination account");
      break;
    case "expense":
      if (!source) throw new Error("Expense needs a source account");
      break;
    case "buy":
    case "sell":
    case "transfer":
      if (!source || !dest)
        throw new Error(
          `A ${type} needs both a source and destination account`,
        );
      break;
  }
}

/** Create a transaction from a form submission. */
export async function createTransaction(formData: FormData): Promise<void> {
  const type = String(formData.get("type") ?? "") as TransactionType;
  if (!TRANSACTION_TYPES.includes(type))
    throw new Error("Invalid transaction type");

  // Empty string from a "None / External" option means no internal account.
  const source = (String(formData.get("source_account") ?? "") || null) as
    | string
    | null;
  const dest = (String(formData.get("dest_account") ?? "") || null) as
    | string
    | null;
  const amount = Number(formData.get("amount"));
  const date = String(formData.get("date") ?? "").trim();
  const category = (String(formData.get("category") ?? "").trim() || null) as
    | string
    | null;
  const note = (String(formData.get("note") ?? "").trim() || null) as
    | string
    | null;

  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("Amount must be a non-negative number");
  if (!date) throw new Error("Date is required");
  validateLegs(type, source, dest);

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    type,
    source_account: source,
    dest_account: dest,
    amount,
    date,
    // Category only meaningful for expenses; ignore it otherwise.
    category: type === "expense" ? category : null,
    note,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/transactions");
  revalidatePath("/accounts");
}

/** Delete a transaction. */
export async function deleteTransaction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Transaction id is required");

  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/transactions");
  revalidatePath("/accounts");
}
