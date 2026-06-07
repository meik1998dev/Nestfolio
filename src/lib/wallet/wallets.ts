"use server";

/**
 * Data access for the user's tracked wallet(s). Single-user app → one wallet,
 * but the schema supports many. We store ONLY the public address — never keys.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidAddress } from "@/lib/wallet/provider";
import { resolveToken } from "@/lib/price/ticker";
import type { Wallet, Holding } from "@/lib/types";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

/** The user's wallet (first one), or null if none saved yet. */
export async function getWallet(): Promise<Wallet | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Wallet) ?? null;
}

/**
 * Save (or upsert) a public BNB address. Validates format and stores only the
 * address — no signatures, no keys. Idempotent on (user_id, address).
 */
export async function addWallet(formData: FormData): Promise<void> {
  const address = String(formData.get("address") ?? "").trim();
  if (!isValidAddress(address)) {
    throw new Error("Enter a valid BNB address (0x… 40 hex characters).");
  }

  const { supabase, userId } = await requireUserId();
  const { error } = await supabase
    .from("wallets")
    .upsert(
      { user_id: userId, address, sync_status: "idle" },
      { onConflict: "user_id,address", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);

  revalidatePath("/wallet");
}

/** A synced wallet balance with its resolved ticker and last-known USD value. */
export interface WalletBalanceView {
  asset: string;
  amount: number;
  /** Resolved equity/crypto ticker, or null (stablecoin/unknown). */
  ticker: string | null;
  kind: ReturnType<typeof resolveToken>["kind"];
  /** Last-known unit price (USD) from the live_prices cache, if any. */
  unitPrice: number | null;
  /** amount × unitPrice, or amount for stablecoins (≈$1), else null. */
  usdValue: number | null;
}

/**
 * Read the synced wallet holdings joined with the cached live prices. Pure DB
 * read — never touches the network, so the page renders last-known values fast.
 * Stablecoins are valued at $1; tokenized stocks use their equity ticker price.
 */
export async function getSyncedBalances(
  walletAddress: string,
): Promise<WalletBalanceView[]> {
  const supabase = await createClient();

  const { data: holdings, error } = await supabase
    .from("holdings")
    .select("asset, amount")
    .eq("source", "wallet")
    .eq("wallet_ref", walletAddress);
  if (error) throw new Error(error.message);

  const rows = (holdings ?? []) as Pick<Holding, "asset" | "amount">[];
  if (rows.length === 0) return [];

  // Live prices are a global table; fetch the ones we need in one shot.
  const tickers = [
    ...new Set(
      rows
        .map((h) => resolveToken(h.asset).ticker)
        .filter((t): t is string => t !== null),
    ),
  ];
  const priceByTicker = new Map<string, number>();
  if (tickers.length > 0) {
    const { data: prices } = await supabase
      .from("live_prices")
      .select("ticker, price")
      .in("ticker", tickers);
    for (const p of (prices ?? []) as Array<{
      ticker: string;
      price: number;
    }>) {
      priceByTicker.set(p.ticker, Number(p.price));
    }
  }

  return rows.map((h) => {
    const resolved = resolveToken(h.asset);
    if (resolved.kind === "stablecoin") {
      return {
        asset: h.asset,
        amount: h.amount,
        ticker: null,
        kind: resolved.kind,
        unitPrice: 1,
        usdValue: h.amount,
      };
    }
    const unitPrice = resolved.ticker
      ? (priceByTicker.get(resolved.ticker) ?? null)
      : null;
    return {
      asset: h.asset,
      amount: h.amount,
      ticker: resolved.ticker,
      kind: resolved.kind,
      unitPrice,
      usdValue: unitPrice !== null ? h.amount * unitPrice : null,
    };
  });
}
