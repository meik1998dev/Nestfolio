/**
 * Pure, dependency-free allocation/rebalance engine (EN3.3).
 *
 * Targets are **relative to the parent** (Open Q #5, decided): the children of
 * one node carry `target_pct` values that should sum to 100. The engine
 * compares each child's actual share of its parent's value against that target,
 * reports the drift, and computes the exact USD buy/sell to reach the target —
 * recursively, at the top level and inside every sub-portfolio.
 *
 * "Reach target" keeps the parent's current total fixed: a child's target value
 * is `parentTotal * target_pct / 100`, and the suggested delta is
 * `targetValue − currentValue` (positive → buy, negative → sell). Because the
 * targets sum to 100, the buys and sells within one parent net to zero — you
 * fund every buy by selling the overweights.
 *
 * Valuation is injected upstream (see tree.ts `rollupValues`); this module reads
 * the already-computed `totalValue` on each node.
 */
import type { PortfolioNode } from "./tree";

export type RebalanceAction = "buy" | "sell" | "hold";

/** Per-node rebalance result, relative to the node's parent. */
export interface RebalanceEntry {
  id: string;
  name: string;
  depth: number;
  /** Target % relative to parent (null if no target set on this node). */
  targetPct: number | null;
  /** Actual % of the parent's total value (null if parent has zero value). */
  actualPct: number | null;
  /** actualPct − targetPct, in percentage points (null if either is null). */
  driftPct: number | null;
  /** Current rolled-up USD value of this node. */
  currentValue: number;
  /** USD value this node should hold to hit its target (null if no target). */
  targetValue: number | null;
  /** targetValue − currentValue: positive = buy, negative = sell (null if no target). */
  deltaUSD: number | null;
  action: RebalanceAction;
}

/** A parent and the rebalance entries for its direct children (one "level"). */
export interface RebalanceLevel {
  parentId: string | null;
  parentName: string;
  parentValue: number;
  /** Whether the children's targets sum to ~100% (only meaningful if any set). */
  targetsValid: boolean;
  /** Sum of children's target_pct (children without a target count as 0). */
  targetSum: number;
  /** How many children carry an explicit target. */
  targetedChildren: number;
  children: RebalanceEntry[];
}

/** Trades smaller than this (USD) are treated as "hold" — avoids churn on dust. */
const REBALANCE_EPSILON = 0.01;

/**
 * Compute one rebalance level: given a parent's total value and its children
 * (with rolled-up `totalValue` and `targetPct`), return each child's actual %,
 * drift, and the exact USD delta to reach its relative target.
 */
export function rebalanceLevel(parent: {
  id: string | null;
  name: string;
  totalValue: number;
  children: PortfolioNode[];
}): RebalanceLevel {
  const parentValue = parent.totalValue;

  let targetSum = 0;
  let targetedChildren = 0;
  for (const child of parent.children) {
    if (child.targetPct != null) {
      targetSum += child.targetPct;
      targetedChildren += 1;
    }
  }

  const children: RebalanceEntry[] = parent.children.map((child) => {
    const actualPct =
      parentValue > 0 ? (child.totalValue / parentValue) * 100 : null;

    let targetValue: number | null = null;
    let deltaUSD: number | null = null;
    let driftPct: number | null = null;
    let action: RebalanceAction = "hold";

    if (child.targetPct != null) {
      targetValue = (parentValue * child.targetPct) / 100;
      deltaUSD = targetValue - child.totalValue;
      if (actualPct != null) driftPct = actualPct - child.targetPct;
      if (deltaUSD > REBALANCE_EPSILON) action = "buy";
      else if (deltaUSD < -REBALANCE_EPSILON) action = "sell";
    }

    return {
      id: child.id,
      name: child.name,
      depth: child.depth,
      targetPct: child.targetPct,
      actualPct,
      driftPct,
      currentValue: child.totalValue,
      targetValue,
      deltaUSD,
      action,
    };
  });

  // Valid when no targets are set (nothing to enforce) OR they sum to ~100%.
  const targetsValid =
    targetedChildren === 0 || Math.abs(targetSum - 100) < 0.01;

  return {
    parentId: parent.id,
    parentName: parent.name,
    parentValue,
    targetsValid,
    targetSum,
    targetedChildren,
    children,
  };
}

/**
 * Recursively compute rebalance levels for the whole forest. The synthetic
 * top-level "Total" level treats every root portfolio as a sibling (their
 * `target_pct` is relative to total assigned value). Then one level per node
 * that has children. Levels with no children are omitted, and so are nodes
 * with the target feature switched off (`targetsEnabled === false`) — their
 * children's targets are not part of the policy.
 */
export function rebalanceTree(roots: PortfolioNode[]): RebalanceLevel[] {
  const levels: RebalanceLevel[] = [];

  const totalValue = roots.reduce((sum, r) => sum + r.totalValue, 0);
  if (roots.length > 0) {
    levels.push(
      rebalanceLevel({
        id: null,
        name: "Total portfolio",
        totalValue,
        children: roots,
      }),
    );
  }

  const visit = (node: PortfolioNode) => {
    if (node.children.length > 0 && node.targetsEnabled !== false) {
      levels.push(
        rebalanceLevel({
          id: node.id,
          name: node.name,
          totalValue: node.totalValue,
          children: node.children,
        }),
      );
    }
    // Recurse regardless: the setting is not inherited, so a sub-portfolio of a
    // disabled node can still run its own targets.
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);

  return levels;
}

/**
 * Validate that a set of sibling target percentages sums to ~100% (S3.3).
 * Empty / all-null sets are valid (no policy set yet). Used by the UI hint and
 * by the create/update server actions.
 */
export function siblingTargetsValid(targets: Array<number | null>): boolean {
  const set = targets.filter((t): t is number => t != null);
  if (set.length === 0) return true;
  const sum = set.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.01;
}
