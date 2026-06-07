"use server";

/**
 * Server-side data access + mutations for holdings (asset positions). This
 * feature manages MANUAL holdings only; wallet-sourced holdings (source =
 * 'wallet') are written by F4 sync and must not be clobbered here.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Holding } from "@/lib/types";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

/** All holdings for the user, newest first. */
export async function listHoldings(): Promise<Holding[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holdings")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Holding[];
}

/** Create a manual holding from a form submission. */
export async function createHolding(formData: FormData): Promise<void> {
  const asset = String(formData.get("asset") ?? "").trim();
  const amount = Number(formData.get("amount"));

  if (!asset) throw new Error("Asset is required");
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("Amount must be a non-negative number");

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase
    .from("holdings")
    .insert({ user_id: userId, asset, amount, source: "manual" });
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

/** Update a manual holding's amount. Guards against editing wallet holdings. */
export async function updateHolding(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const amount = Number(formData.get("amount"));
  if (!id) throw new Error("Holding id is required");
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("Amount must be a non-negative number");

  const supabase = await createClient();
  const { error } = await supabase
    .from("holdings")
    .update({ amount })
    .eq("id", id)
    .eq("source", "manual"); // never touch wallet-synced rows
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

/** Delete a manual holding. Wallet holdings are protected by the source filter. */
export async function deleteHolding(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Holding id is required");

  const supabase = await createClient();
  const { error } = await supabase
    .from("holdings")
    .delete()
    .eq("id", id)
    .eq("source", "manual");
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}
