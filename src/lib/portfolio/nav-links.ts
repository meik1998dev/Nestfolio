/**
 * Sidebar quick links for portfolios. Pure transform: flat portfolio rows →
 * ordered, depth-annotated nav entries (parents before children, siblings by
 * name — the same order the /portfolios tree renders). Serializable, so the
 * server layout can pass the result straight into the client AppShell.
 */
import type { Portfolio } from "@/lib/types";
import { buildPortfolioTree, flattenTree } from "./tree";

/** One sidebar link to a portfolio detail page. */
export interface PortfolioNavLink {
  href: string;
  label: string;
  /** Depth from a root (root = 0) — drives the nav indentation. */
  depth: number;
}

/** Ordered quick links for every portfolio (DFS: parents first). */
export function portfolioNavLinks(portfolios: Portfolio[]): PortfolioNavLink[] {
  // Holdings aren't needed for names/order; values just stay 0.
  return flattenTree(buildPortfolioTree(portfolios, [])).map((node) => ({
    href: `/portfolios/${node.id}`,
    label: node.name,
    depth: node.depth,
  }));
}
