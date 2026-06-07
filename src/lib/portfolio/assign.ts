"use server";

/**
 * Assign a holding to a portfolio — or unassign it (S3.2).
 *
 * IMPORTANT: this updates ONLY `portfolio_id`, and unlike F2's `updateHolding`
 * it does NOT filter by `source = 'manual'`. Wallet-synced holdings must be
 * assignable too — categorising an on-chain PAXG position into "Gold" is the
 * whole point. RLS still scopes the row to the signed-in user, so the open
 * filter is safe. We never touch `amount` or other sync-owned columns.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Set (or clear) a holding's portfolio. Pass `null` to move it back to the
 * unassigned bucket. Works for both manual and wallet-sourced holdings.
 */
export async function assignHolding(
  holdingId: string,
  portfolioId: string | null,
): Promise<void> {
  if (!holdingId) throw new Error("Holding id is required");

  const supabase = await createClient();
  const { error } = await supabase
    .from("holdings")
    .update({ portfolio_id: portfolioId })
    .eq("id", holdingId); // RLS restricts to the current user's rows
  if (error) throw new Error(error.message);

  revalidatePath("/portfolios");
}

/** Form-action wrapper: reads `holding_id` + `portfolio_id` from FormData. */
export async function assignHoldingAction(formData: FormData): Promise<void> {
  const holdingId = String(formData.get("holding_id") ?? "");
  const raw = String(formData.get("portfolio_id") ?? "").trim();
  const portfolioId = raw === "" || raw === "none" ? null : raw;
  await assignHolding(holdingId, portfolioId);
}
