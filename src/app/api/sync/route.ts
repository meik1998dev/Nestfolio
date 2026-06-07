/**
 * POST /api/sync — trigger a wallet sync for the authenticated user.
 *
 * Used by the /wallet "Sync now" button; reusable by a cron later. Auth is
 * enforced via the user-scoped Supabase client; the heavy lifting runs through
 * the service role inside the orchestrator. Returns the sync result as JSON and
 * never 500s on a sync failure — a degraded sync is a normal, reported outcome.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSync } from "@/lib/sync/orchestrator";

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

  const result = await runSync(user.id, wallet.id);
  return NextResponse.json(result);
}
