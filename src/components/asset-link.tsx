import Link from "next/link";
import { cn } from "@/lib/utils";
import { canonicalSymbol } from "@/lib/price/ticker";

/**
 * Links an asset symbol / ticker to its detail page (`/holdings/[asset]`). Use
 * anywhere an asset is shown — holdings, transactions, P&L, portfolios, wallet —
 * so any asset is one click from its dedicated page. The detail route resolves
 * tokenized variants (e.g. NVDAon → NVDA), so passing the raw symbol is fine.
 */
export function AssetLink({
  symbol,
  className,
  children,
}: {
  symbol: string;
  className?: string;
  children?: React.ReactNode;
}) {
  // Collapse pricing pairs (PAXG-USD → PAXG) so one asset has one label + route.
  const canonical = canonicalSymbol(symbol);
  return (
    <Link
      href={`/holdings/${encodeURIComponent(canonical)}`}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {children ?? canonical}
    </Link>
  );
}
