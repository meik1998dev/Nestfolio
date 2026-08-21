"use server";

/**
 * Server-side data access + mutations for the trade ledger. A transaction is one
 * asset trade — a `buy` or `sell` of `amount` units of `asset` at an optional
 * unit `price`. Manual trades live in the `transactions` table; wallet-synced
 * trades come from `trade_events` (read-only) and are merged for display.
 */
import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Transaction, TransactionType } from "@/lib/types";

const TRANSACTION_TYPES: TransactionType[] = ["buy", "sell"];

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

/**
 * Manual trade log, newest first (the ledger view's default order).
 *
 * Wrapped in React `cache()` so the streamed /transactions page — which reads
 * the ledger twice per request (once in the header `TransactionForm` Suspense
 * for its asset options, once in the body content) — collapses to one DB read.
 */
export const listTransactions = cache(async (): Promise<Transaction[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Transaction[];
});

/** One row of the unified trade history (manual + wallet-synced). */
export interface TradeRow {
  id: string;
  date: string;
  type: string;
  asset: string;
  /** Quantity of the asset. */
  amount: number;
  /** Unit price in USD, when known. */
  price: number | null;
  /** Total USD value of the trade, when known. */
  value: number | null;
  source: "manual" | "wallet";
  note: string | null;
  /** Owning wallet (wallet-sourced rows only) — scopes realized P&L of
   *  fully-closed positions to a portfolio subtree. */
  walletId?: string;
}

/**
 * Wallet-synced trades from `trade_events`, newest first. These are produced by
 * the PnL classifier (F6) and are read-only here — the wallet is their source of
 * truth. Used by the Transactions view to show synced trades alongside manual.
 *
 * Wrapped in React `cache()` for the same reason as `listTransactions`: the
 * streamed /transactions page reads wallet trades from both the header form
 * loader and the body content, and this dedups them to one DB read per request.
 */
export const listWalletTrades = cache(async (): Promise<TradeRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_events")
    .select("id, ts, type, ticker, shares, unit_price, usd_value, wallet_id")
    .order("ts", { ascending: false });
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{
      id: string;
      ts: string;
      type: string;
      ticker: string;
      shares: number;
      unit_price: number | null;
      usd_value: number | null;
      wallet_id: string;
    }>
  ).map((e) => ({
    id: e.id,
    date: e.ts.slice(0, 10),
    type: e.type,
    asset: e.ticker,
    amount: Number(e.shares),
    price: e.unit_price !== null ? Number(e.unit_price) : null,
    value: e.usd_value !== null ? Number(e.usd_value) : null,
    source: "wallet",
    note: null,
    walletId: e.wallet_id,
  }));
});

/** Create a manual trade from a form submission. */
export async function createTransaction(formData: FormData): Promise<void> {
  const type = String(formData.get("type") ?? "") as TransactionType;
  if (!TRANSACTION_TYPES.includes(type))
    throw new Error("Invalid transaction type");

  const asset = String(formData.get("asset") ?? "")
    .trim()
    .toUpperCase();
  const amount = Number(formData.get("amount"));
  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = priceRaw === "" ? null : Number(priceRaw);
  const date = String(formData.get("date") ?? "").trim();
  const note = (String(formData.get("note") ?? "").trim() || null) as
    | string
    | null;

  if (!asset) throw new Error("Asset is required");
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("Quantity must be a positive number");
  if (price !== null && (!Number.isFinite(price) || price < 0))
    throw new Error("Price must be a non-negative number");
  if (!date) throw new Error("Date is required");

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    type,
    asset,
    amount,
    price,
    date,
    note,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

/** Delete a manual trade. */
export async function deleteTransaction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Transaction id is required");

  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}
