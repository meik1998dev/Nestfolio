/**
 * Pure, dependency-free cash-flow rebalancing engine.
 *
 * The no-sell cousin of `rebalance.ts`: given one fresh contribution of `C`
 * dollars, decide how many dollars to add to each sub-portfolio (and each
 * holding) to move the tree toward its targets **without ever selling**.
 * Buckets that are already above their post-contribution target get $0; the
 * money flows to whoever is below.
 *
 * Targets are relative to the parent (same convention as `rebalance.ts`), so the
 * split is hierarchical: a parent's contribution is apportioned across its
 * children, and each child then recursively apportions its slice. Three node
 * kinds can appear at one level:
 *   - targeted    — has `targetPct`; competes for cash via the need policy.
 *   - pass-through — no target but its subtree contains targets (e.g. a "Total"
 *     grouping node, or a "Stocks" sleeve whose holdings carry the targets); the
 *     cash flows *through* it, split pro-rata by value, down to where the targets
 *     actually live.
 *   - inert       — no target and no targeted descendant (e.g. a Cash bucket you
 *     don't want to grow); gets $0 whenever a targeted sibling exists.
 *
 * Per targeted level, with `newTotal = parentValue + contribution`:
 *   need_i = max(0, newTotal · target%_i − current_i)     // gap below target
 *   if Σneed ≥ C → split C proportional to need (can't close every gap)
 *   else         → fill every need, spread the leftover by target weight
 *
 * Valuation is injected upstream (tree.ts `rollupValues`); this module only
 * reads already-computed values, so it runs identically on the server (tests)
 * and in the browser (the live planner).
 */
import type { PortfolioNode } from "./tree";

/** Minimal tree shape the planner needs — holdings are folded in as leaves. */
export interface ContribInputNode {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  /** Target % relative to the parent (null = untargeted). */
  targetPct: number | null;
  /** Rolled-up USD value of this node. */
  totalValue: number;
  children: ContribInputNode[];
}

/** One row of the plan — what to add to a single node and where it lands. */
export interface ContributionEntry {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  targetPct: number | null;
  /** Current rolled-up USD value (before the contribution). */
  currentValue: number;
  /** Share of the parent's value now (null if parent is empty). */
  nowPct: number | null;
  /** Share of the parent's value after adding `add` (null if parent stays empty). */
  afterPct: number | null;
  /** nowPct − targetPct, in percentage points (null if either is null). */
  driftPct: number | null;
  /** Dollars to add this round — always ≥ 0 (never a sell). */
  add: number;
  /** True when no target is set: not competing for cash on its own. */
  untargeted: boolean;
}

export interface ContributionPlan {
  /** The contribution that was distributed. */
  contribution: number;
  /** Σ of every top-level `add` — equals `contribution` (modulo rounding). */
  totalAllocated: number;
  /** Dollars still short of hitting every target after this round (≥ 0). */
  shortfall: number;
  /** True when this contribution fully funds every underweight bucket. */
  fullyFunds: boolean;
  /** True when no node carries a target — nothing to rebalance toward. */
  noTargets: boolean;
  /** Flattened rows, parents before children (ready to render as a table). */
  entries: ContributionEntry[];
}

export interface ContributionOptions {
  /**
   * Round each add to the nearest multiple of this many dollars (e.g. 1 for
   * whole dollars). The per-level remainder is reconciled onto the largest add
   * so a level's adds still sum to that level's contribution. Omit for exact
   * (cents-precision) splits.
   */
  round?: number;
}

const EPSILON = 0.01;

/** Per-level allocation result: the adds, plus this level's unmet target gap. */
interface LevelResult {
  adds: number[];
  shortfall: number;
}

/**
 * Plan how to deploy `contribution` dollars across the forest. Returns a flat,
 * render-ready list of entries (parents before children) plus summary figures.
 * A non-positive or non-finite contribution yields an all-zero plan.
 */
export function planContribution(
  roots: ContribInputNode[],
  contribution: number,
  opts: ContributionOptions = {},
): ContributionPlan {
  const c = Number.isFinite(contribution) ? Math.max(0, contribution) : 0;
  const grandTotal = roots.reduce((sum, r) => sum + r.totalValue, 0);
  const noTargets = !roots.some(hasTargetInSubtree);

  const entries: ContributionEntry[] = [];
  let shortfall = 0;
  walk(roots, grandTotal, c, opts.round, entries, (s) => {
    shortfall += s;
  });

  const totalAllocated = entries
    .filter((e) => e.parentId == null)
    .reduce((sum, e) => sum + e.add, 0);

  return {
    contribution: c,
    totalAllocated,
    shortfall,
    fullyFunds: c > EPSILON && shortfall < EPSILON,
    noTargets,
    entries,
  };
}

/** Recurse a level: split `contribution` across `siblings`, then descend. */
function walk(
  siblings: ContribInputNode[],
  parentValue: number,
  contribution: number,
  round: number | undefined,
  out: ContributionEntry[],
  addShortfall: (s: number) => void,
): void {
  const newTotal = parentValue + contribution;
  const { adds, shortfall } = allocateLevel(
    siblings,
    parentValue,
    contribution,
    round,
  );
  addShortfall(shortfall);

  siblings.forEach((node, i) => {
    const add = adds[i];
    const afterValue = node.totalValue + add;
    const nowPct =
      parentValue > 0 ? (node.totalValue / parentValue) * 100 : null;
    out.push({
      id: node.id,
      name: node.name,
      depth: node.depth,
      parentId: node.parentId,
      targetPct: node.targetPct,
      currentValue: node.totalValue,
      nowPct,
      afterPct: newTotal > 0 ? (afterValue / newTotal) * 100 : null,
      driftPct:
        nowPct != null && node.targetPct != null
          ? nowPct - node.targetPct
          : null,
      add,
      untargeted: node.targetPct == null,
    });
    if (node.children.length > 0) {
      walk(node.children, node.totalValue, add, round, out, addShortfall);
    }
  });
}

/**
 * Decide each sibling's add for one level. If any sibling carries a target, use
 * the need/leftover policy among the targeted ones (inert siblings get $0). If
 * none are targeted, the cash is passing *through* a grouping level — split it
 * pro-rata by value among children that can route it onward.
 */
function allocateLevel(
  siblings: ContribInputNode[],
  parentValue: number,
  contribution: number,
  round: number | undefined,
): LevelResult {
  const adds = siblings.map(() => 0);
  if (contribution <= EPSILON) return { adds, shortfall: 0 };

  const targeted = siblings
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.targetPct != null);

  if (targeted.length === 0) {
    // Pass-through: no policy here, route cash to children that lead to targets.
    passThrough(siblings, contribution, adds);
    return { adds, shortfall: 0 };
  }

  const newTotal = parentValue + contribution;
  let totalNeed = 0;
  let weightSum = 0;
  const need = new Map<number, number>();
  for (const { s, i } of targeted) {
    const gap = Math.max(0, (newTotal * s.targetPct!) / 100 - s.totalValue);
    need.set(i, gap);
    totalNeed += gap;
    weightSum += s.targetPct!;
  }

  let shortfall = 0;
  if (totalNeed >= contribution && totalNeed > 0) {
    // Can't close every gap — split the cash proportional to each gap.
    for (const { i } of targeted) {
      adds[i] = (contribution * need.get(i)!) / totalNeed;
    }
    shortfall = totalNeed - contribution;
  } else {
    // Fund every gap, then spread the leftover by target weight (stays balanced).
    const leftover = contribution - totalNeed;
    for (const { s, i } of targeted) {
      const share =
        weightSum > 0
          ? leftover * (s.targetPct! / weightSum)
          : leftover / targeted.length;
      adds[i] = need.get(i)! + share;
    }
  }

  if (round) {
    return {
      adds: reconcileRounding(adds, contribution, round, targeted.map((t) => t.i)),
      shortfall,
    };
  }
  return { adds, shortfall };
}

/**
 * Route `contribution` through an untargeted grouping level: split it pro-rata
 * by value among children that can carry it onward (they hold value or contain
 * targeted descendants). When every eligible child is empty, split evenly.
 */
function passThrough(
  siblings: ContribInputNode[],
  contribution: number,
  adds: number[],
): void {
  const eligible = siblings
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.totalValue > EPSILON || hasTargetInSubtree(s));
  if (eligible.length === 0) return;

  const valueSum = eligible.reduce(
    (sum, { s }) => sum + Math.max(0, s.totalValue),
    0,
  );
  for (const { s, i } of eligible) {
    adds[i] =
      valueSum > EPSILON
        ? (contribution * s.totalValue) / valueSum
        : contribution / eligible.length;
  }
}

/**
 * Round each add to a multiple of `step`, then push the leftover penny/dollar
 * remainder onto the largest add so the level's adds still sum to `contribution`.
 */
function reconcileRounding(
  adds: number[],
  contribution: number,
  step: number,
  targetedIdx: number[],
): number[] {
  const rounded = adds.map((v) => Math.round(v / step) * step);
  const diff = contribution - rounded.reduce((a, b) => a + b, 0);
  if (Math.abs(diff) < EPSILON || targetedIdx.length === 0) return rounded;

  // Reconcile onto the biggest add so the adjustment is least visible.
  let biggest = targetedIdx[0];
  for (const i of targetedIdx) if (adds[i] > adds[biggest]) biggest = i;
  rounded[biggest] = Math.max(0, rounded[biggest] + diff);
  return rounded;
}

function hasTargetInSubtree(node: ContribInputNode): boolean {
  if (node.targetPct != null) return true;
  return node.children.some(hasTargetInSubtree);
}

/**
 * Build the planner's input tree from a valued `PortfolioNode` forest, folding
 * each portfolio's directly-attached holdings in as leaf children (sorted by
 * value, biggest first). A holding carries its own `target_pct` (relative to its
 * portfolio), so the engine can recommend the exact dollars to buy of each one.
 */
export function buildContribTree(
  roots: PortfolioNode[],
  holdingValues: Map<string, number>,
): ContribInputNode[] {
  const mapNode = (n: PortfolioNode): ContribInputNode => {
    const childPortfolios = n.children.map(mapNode);
    const holdingLeaves: ContribInputNode[] = n.holdings
      .map((h) => ({
        id: h.id,
        name: h.asset,
        depth: n.depth + 1,
        parentId: n.id,
        targetPct: h.target_pct,
        totalValue: holdingValues.get(h.id) ?? 0,
        children: [] as ContribInputNode[],
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
    return {
      id: n.id,
      name: n.name,
      depth: n.depth,
      parentId: n.parentId,
      targetPct: n.targetPct,
      totalValue: n.totalValue,
      children: [...childPortfolios, ...holdingLeaves],
    };
  };
  return roots.map(mapNode);
}
