"use server";

/**
 * Server-side data access + mutations for portfolios (EN3.1 / S3.1 / S3.3).
 * RLS scopes every read/write to the signed-in user; on insert we still set
 * `user_id` explicitly (contract rule). Mutations revalidate /portfolios.
 *
 * `target_pct` is stored relative to the parent (siblings sum to 100) — see
 * the rebalance engine. We guard reparenting against cycles so the tree stays
 * finite.
 */
import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Portfolio } from "@/lib/types";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

function parseTargetPct(raw: FormDataEntryValue | null): number | null {
  const str = String(raw ?? "").trim();
  if (str === "") return null;
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error("Target % must be between 0 and 100");
  return n;
}

/**
 * All portfolios for the user, oldest first (stable ordering for the tree).
 *
 * Wrapped in React `cache()` so a single request that reads the portfolio list
 * from more than one place collapses to one DB round-trip. The streamed
 * /portfolios page now resolves it twice in the same render — once in the header
 * `PortfolioForm` Suspense, once in the body content — and this dedups them.
 */
export const listPortfolios = cache(
  async (): Promise<Portfolio[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("portfolios")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Portfolio[];
  },
);

/**
 * Would setting `nodeId`'s parent to `parentId` create a cycle? True if
 * `parentId` is the node itself or one of its descendants.
 */
function wouldCycle(
  nodeId: string,
  parentId: string | null,
  all: Portfolio[],
): boolean {
  if (!parentId) return false;
  if (parentId === nodeId) return true;
  // Walk up from the proposed parent; if we hit nodeId, it's a descendant.
  const byId = new Map(all.map((p) => [p.id, p]));
  let cur: Portfolio | undefined = byId.get(parentId);
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === nodeId) return true;
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return false;
}

/** Create a portfolio (name, optional parent, optional target %). */
export async function createPortfolio(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const parentRaw = String(formData.get("parent_id") ?? "").trim();
  const parent_id = parentRaw === "" || parentRaw === "none" ? null : parentRaw;
  const target_pct = parseTargetPct(formData.get("target_pct"));

  if (!name) throw new Error("Portfolio name is required");

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase
    .from("portfolios")
    .insert({ user_id: userId, name, parent_id, target_pct });
  if (error) throw new Error(error.message);

  revalidatePath("/portfolios");
}

/** Update a portfolio: rename, set target %, and/or reparent (cycle-guarded). */
export async function updatePortfolio(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Portfolio id is required");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Portfolio name is required");

  const parentRaw = String(formData.get("parent_id") ?? "").trim();
  const parent_id = parentRaw === "" || parentRaw === "none" ? null : parentRaw;
  const target_pct = parseTargetPct(formData.get("target_pct"));

  const { supabase } = await requireUserId();

  if (parent_id) {
    const all = await listPortfolios();
    if (wouldCycle(id, parent_id, all))
      throw new Error(
        "A portfolio can't be nested under itself or a descendant",
      );
  }

  const { error } = await supabase
    .from("portfolios")
    .update({ name, parent_id, target_pct })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/portfolios");
}

/**
 * Delete a portfolio. The schema cascades children (`on delete cascade`) and
 * un-assigns holdings (`on delete set null`), so they fall back to the
 * unassigned bucket rather than disappearing.
 */
export async function deletePortfolio(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Portfolio id is required");

  const supabase = await createClient();
  const { error } = await supabase.from("portfolios").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/portfolios");
}
