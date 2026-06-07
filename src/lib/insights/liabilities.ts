"use server";

/**
 * Server-side data access + mutations for liabilities (S5.2) — debts that reduce
 * net worth (loans, credit cards, mortgages). RLS scopes reads to the user; on
 * insert we set `user_id` explicitly (contract rule). Mutations revalidate the
 * dashboard so net worth reflects the change immediately.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Liability } from "@/lib/types";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

/** All liabilities for the user, oldest first (stable ordering for the UI). */
export async function listLiabilities(): Promise<Liability[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("liabilities")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Liability[];
}

/** Create a liability from a form submission. */
export async function createLiability(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const balance = Number(formData.get("balance"));
  const type = String(formData.get("type") ?? "").trim() || null;

  if (!name) throw new Error("Liability name is required");
  if (!Number.isFinite(balance) || balance < 0)
    throw new Error("Balance must be a non-negative number");

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase
    .from("liabilities")
    .insert({ user_id: userId, name, balance, type });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/liabilities");
}

/** Update a liability's name / balance / type. */
export async function updateLiability(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const balance = Number(formData.get("balance"));
  const type = String(formData.get("type") ?? "").trim() || null;

  if (!id) throw new Error("Liability id is required");
  if (!name) throw new Error("Liability name is required");
  if (!Number.isFinite(balance) || balance < 0)
    throw new Error("Balance must be a non-negative number");

  const supabase = await createClient();
  const { error } = await supabase
    .from("liabilities")
    .update({ name, balance, type })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/liabilities");
}

/** Delete a liability. */
export async function deleteLiability(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Liability id is required");

  const supabase = await createClient();
  const { error } = await supabase.from("liabilities").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/liabilities");
}
