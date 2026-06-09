import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Supabase client for Server Components, Route Handlers, and Server Actions. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component; safe to ignore when middleware refreshes sessions.
        }
      },
    },
  });
}

/**
 * Authenticated user for the current request, deduped via React `cache()`.
 *
 * `cache()` memoizes per request/render pass (not across requests), so when the
 * (app) layout and a page both need the user in the same render, Supabase
 * `auth.getUser()` runs once instead of once per call site.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
