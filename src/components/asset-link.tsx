import Link from "next/link";
import { cn } from "@/lib/utils";

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
  return (
    <Link
      href={`/holdings/${encodeURIComponent(symbol)}`}
      className={cn("hover:text-primary hover:underline", className)}
    >
      {children ?? symbol}
    </Link>
  );
}
