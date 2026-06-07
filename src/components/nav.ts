import {
  LayoutDashboard,
  FolderTree,
  ArrowLeftRight,
  Wallet,
  TrendingUp,
  Landmark,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Primary navigation, ordered by how a wealth owner actually works:
 *  overview first, then structure, ledger, sources, performance, plumbing. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolios", label: "Portfolios", icon: FolderTree },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/pnl", label: "Profit & Loss", icon: TrendingUp },
  { href: "/accounts", label: "Accounts", icon: Landmark },
];
