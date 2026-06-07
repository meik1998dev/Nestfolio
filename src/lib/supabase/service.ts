import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client — BYPASSES Row-Level Security. Server-only.
 * Use ONLY for trusted background work (wallet sync, cron snapshots, writing the
 * global market-data tables). Always pass an explicit user_id when touching
 * user-scoped tables, since RLS is off here. Never import from client code.
 */
export function createServiceClient() {
  return createSupabaseClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
