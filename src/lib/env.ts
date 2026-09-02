/**
 * Centralized environment access with light validation.
 * Public vars are safe in the browser; server vars throw if read on the client.
 */

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function serverOnly(name: string, value: string | undefined): string {
  if (typeof window !== "undefined") {
    throw new Error(
      `${name} is server-only and must not be read in the browser`,
    );
  }
  return required(name, value);
}

export const env = {
  // Public (browser-safe)
  supabaseUrl: () =>
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () =>
    required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),

  // Server-only
  supabaseServiceRoleKey: () =>
    serverOnly(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  noderealApiKey: () =>
    serverOnly("NODEREAL_API_KEY", process.env.NODEREAL_API_KEY),
  finnhubApiKey: () => process.env.FINNHUB_API_KEY ?? "",
  twelveDataApiKey: () => process.env.TWELVE_DATA_API_KEY ?? "",
};
