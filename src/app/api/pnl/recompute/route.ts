/**
 * POST /api/pnl/recompute — rebuild trade_events + cost_basis for the user's
 * wallet from stored transfers (the heavy, on-trade recompute of EN6.2).
 *
 * Auth via the user-scoped client; the rebuild runs through the service role
 * inside `rebuildCostBasis`. Returns the rebuild result; reports failures as a
 * non-200 with a message so the UI can toast it rather than crash.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rebuildCostBasis } from "@/lib/pnl/ledger";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: wallet } = await supabase
    .from("wallets")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!wallet) {
    return NextResponse.json(
      { error: "No wallet saved. Add a BNB address first." },
      { status: 400 },
    );
  }

  try {
    const result = await rebuildCostBasis(user.id, wallet.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Recompute failed" },
      { status: 500 },
    );
  }
}
