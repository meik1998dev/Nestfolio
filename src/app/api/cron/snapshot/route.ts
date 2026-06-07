/**
 * Daily net-worth snapshot cron (EN5.1).
 *
 * Vercel Cron hits this route once a day (see `vercel.json` → crons). It iterates
 * every user that has tracked data and writes one snapshot each (idempotent: a
 * second run the same day is a no-op). This feeds the history chart (S5.3) and
 * the monthly review (S5.6).
 *
 * Protected by `CRON_SECRET`: the caller must send `Authorization: Bearer <secret>`
 * (Vercel Cron does this automatically when CRON_SECRET is set in the project).
 * GET and POST both work — Vercel Cron uses GET; POST is allowed for manual runs.
 *
 * Runs under the SERVICE role inside `takeSnapshot` (no user session exists in a
 * cron), so RLS is bypassed and every write carries an explicit user_id.
 */
import { NextResponse, type NextRequest } from "next/server";
import { allUserIdsWithData, takeSnapshot } from "@/lib/insights/snapshot";

// Snapshotting touches per-user data and must never be statically cached.
export const dynamic = "force-dynamic";

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIds = await allUserIdsWithData();
  const results = await Promise.allSettled(
    userIds.map((id) => takeSnapshot(id)),
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "rejected") failed++;
    else if (r.value.status === "created") created++;
    else skipped++;
  }

  return NextResponse.json({
    users: userIds.length,
    created,
    skipped,
    failed,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
