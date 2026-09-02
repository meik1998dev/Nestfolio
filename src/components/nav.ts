import {
  LayoutDashboard,
  FolderTree,
  ArrowLeftRight,
  Wallet,
  Coins,
  Activity,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Primary navigation, ordered by how an asset owner actually works:
 *  overview first, then holdings, trades, sources, structure, performance. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/holdings", label: "Holdings", icon: Coins },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/portfolios", label: "Portfolios", icon: FolderTree },
  { href: "/performance", label: "Performance", icon: Activity },
];
