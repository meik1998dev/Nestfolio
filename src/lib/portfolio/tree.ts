/**
 * Pure, dependency-free portfolio-tree math (EN3.1). Portfolios nest via
 * `parent_id` to arbitrary depth; a node's value is the sum of its own holdings
 * plus the rolled-up value of every descendant.
 *
 * Valuation is *injected*: callers pass a `Map<holdingId, usdValue>` so this
 * module never fetches prices and stays trivially testable. Keeping it side-
 * effect free lets the UI re-derive the whole tree on every render.
 */
import type { Holding, Portfolio } from "@/lib/types";

/** A portfolio node with its children, attached holdings, and rolled-up value. */
export interface PortfolioNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Target % relative to the parent (siblings should sum to 100). */
  targetPct: number | null;
  /**
   * Is the target feature on inside this node? False = the targets of its
   * children and of its own holdings are ignored (see `Portfolio.targets_enabled`).
   */
  targetsEnabled: boolean;
  /** Depth from a root (root = 0). */
  depth: number;
  /** Holdings directly attached to this node (not descendants). */
  holdings: Holding[];
  children: PortfolioNode[];
  /** USD value of holdings attached directly to this node. */
  ownValue: number;
  /** ownValue + Σ children.totalValue (recursive). */
  totalValue: number;
}

/**
 * Build the forest of portfolio trees from flat rows. Rows whose `parent_id`
 * is null (or points at a missing/cyclic parent) become roots. Children are
 * ordered by name for a stable, readable tree.
 *
 * Cycle guard: a portfolio that is its own ancestor is detached and treated as
 * a root, so a corrupt `parent_id` can never produce an infinite tree.
 */
export function buildPortfolioTree(
  portfolios: Portfolio[],
  holdings: Holding[],
): PortfolioNode[] {
  const byId = new Map<string, PortfolioNode>();
  for (const p of portfolios) {
    byId.set(p.id, {
      id: p.id,
      name: p.name,
      parentId: p.parent_id,
      targetPct: p.target_pct,
      targetsEnabled: p.targets_enabled !== false,
      depth: 0,
      holdings: [],
      children: [],
      ownValue: 0,
      totalValue: 0,
    });
  }

  // Attach holdings to their node (unassigned ones are handled by the caller).
  for (const h of holdings) {
    if (h.portfolio_id && byId.has(h.portfolio_id)) {
      byId.get(h.portfolio_id)!.holdings.push(h);
    }
  }

  const roots: PortfolioNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // A node is a root if it has no parent, an unknown parent, or a parent that
    // would form a cycle (the node is reachable from itself via parent links).
    if (!parent || formsCycle(node.id, parent, byId)) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  const byName = (a: PortfolioNode, b: PortfolioNode) =>
    a.name.localeCompare(b.name);
  roots.sort(byName);
  for (const node of byId.values()) node.children.sort(byName);

  for (const root of roots) assignDepth(root, 0);
  return roots;
}

/** Walk up from `start` via parent links; true if we reach `nodeId` (a cycle). */
function formsCycle(
  nodeId: string,
  start: PortfolioNode,
  byId: Map<string, PortfolioNode>,
): boolean {
  let cur: PortfolioNode | undefined = start;
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === nodeId) return true;
    if (seen.has(cur.id)) return true; // pre-existing cycle among ancestors
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

function assignDepth(node: PortfolioNode, depth: number): void {
  node.depth = depth;
  for (const child of node.children) assignDepth(child, depth + 1);
}

/**
 * Recursively roll up USD values into every node. Mutates and returns the same
 * nodes (in-place is fine: the tree is freshly built per request). Each node's
 * `ownValue` is the sum of its holdings' injected values; `totalValue` adds the
 * rolled-up totals of all children.
 *
 * Holdings missing from `holdingValues` are valued at 0 (graceful — a missing
 * price never crashes the rollup).
 */
export function rollupValues(
  roots: PortfolioNode[],
  holdingValues: Map<string, number>,
): PortfolioNode[] {
  for (const root of roots) rollupNode(root, holdingValues);
  return roots;
}

function rollupNode(
  node: PortfolioNode,
  holdingValues: Map<string, number>,
): number {
  let own = 0;
  for (const h of node.holdings) own += holdingValues.get(h.id) ?? 0;
  node.ownValue = own;

  let total = own;
  for (const child of node.children) {
    total += rollupNode(child, holdingValues);
  }
  node.totalValue = total;
  return total;
}

/** Flatten the forest depth-first (parents before children) for table rendering. */
export function flattenTree(roots: PortfolioNode[]): PortfolioNode[] {
  const out: PortfolioNode[] = [];
  const visit = (node: PortfolioNode) => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

/** Sum of every root's totalValue — the value of all assigned holdings. */
export function totalAssignedValue(roots: PortfolioNode[]): number {
  return roots.reduce((sum, r) => sum + r.totalValue, 0);
}
