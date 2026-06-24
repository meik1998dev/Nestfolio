/**
 * Pure, dependency-free cash-flow rebalancing engine.
 *
 * The no-sell cousin of `rebalance.ts`: given one fresh contribution of `C`
 * dollars, decide how many dollars to add to each sub-portfolio to move the
 * tree toward its targets **without ever selling**. Overweight buckets simply
 * get $0 this month; the money flows to whoever is underweight.
 *
 * Targets are relative to the parent (same convention as `rebalance.ts`), so the
 * split is hierarchical: the top level distributes `C` across the roots, then
 * each root recursively distributes its slice across its own children.
 *
 * Per level, with `newTotal = parentValue + contribution`:
 *   need_i      = max(0, newTotal · target%_i − current_i)     // gap below target
 *   if Σneed ≥ C → split C proportional to need (can't close every gap)
 *   else         → fill every need, spread the leftover by target weight
 *
 * Valuation is injected upstream (tree.ts `rollupValues`); this module only
 * reads the already-computed `totalValue` on each node, so it runs identically
 * on the server (tests) and in the browser (the live planner).
 */

/** Minimal tree shape the planner needs — `PortfolioNode` satisfies it. */
export interface ContribInputNode {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  /** Target % relative to the parent (null = untargeted, gets $0). */
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
  /** True when no target is set: excluded from the split, always $0. */
  untargeted: boolean;
}

export interface ContributionPlan {
  /** The contribution that was distributed. */
  contribution: number;
  /** Σ of every top-level `add` — equals `contribution` (modulo rounding). */
  totalAllocated: number;
  /** Top-level dollars still short of target after this round (≥ 0). */
  topLevelShortfall: number;
  /** True when this contribution fully funds the underweight top-level buckets. */
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

/**
 * Plan how to deploy `contribution` dollars across the forest. Returns a flat,
 * render-ready list of entries (parents before children) plus top-level summary
 * figures. A non-positive or non-finite contribution yields an all-zero plan.
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
  walk(roots, grandTotal, c, opts.round, entries);

  // Top-level shortfall: the gap still open at the root level after this round.
  const topNewTotal = grandTotal + c;
  const topNeed = roots.reduce((sum, r) => {
    if (r.targetPct == null) return sum;
    return sum + Math.max(0, (topNewTotal * r.targetPct) / 100 - r.totalValue);
  }, 0);
  const topLevelShortfall = Math.max(0, topNeed - c);

  const totalAllocated = entries
    .filter((e) => e.parentId == null)
    .reduce((sum, e) => sum + e.add, 0);

  return {
    contribution: c,
    totalAllocated,
    topLevelShortfall,
    fullyFunds: c > EPSILON && topLevelShortfall < EPSILON,
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
): void {
  const newTotal = parentValue + contribution;
  const adds = allocateLevel(siblings, parentValue, contribution, round);

  siblings.forEach((node, i) => {
    const add = adds[i];
    const afterValue = node.totalValue + add;
    const nowPct = parentValue > 0 ? (node.totalValue / parentValue) * 100 : null;
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
        nowPct != null && node.targetPct != null ? nowPct - node.targetPct : null,
      add,
      untargeted: node.targetPct == null,
    });
    if (node.children.length > 0) {
      walk(node.children, node.totalValue, add, round, out);
    }
  });
}

/**
 * Decide each sibling's add for one level. Untargeted siblings always get $0;
 * the rest share `contribution` per the need/leftover policy described up top.
 */
function allocateLevel(
  siblings: ContribInputNode[],
  parentValue: number,
  contribution: number,
  round: number | undefined,
): number[] {
  const adds = siblings.map(() => 0);
  if (contribution <= EPSILON) return adds;

  const targeted = siblings
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.targetPct != null);
  if (targeted.length === 0) return adds; // no policy — nothing to push toward

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

  if (totalNeed >= contribution && totalNeed > 0) {
    // Can't close every gap — split the cash proportional to each gap.
    for (const { i } of targeted) {
      adds[i] = (contribution * need.get(i)!) / totalNeed;
    }
  } else {
    // Fund every gap, then spread the leftover by target weight (stays balanced).
    const leftover = contribution - totalNeed;
    for (const { s, i } of targeted) {
      const share =
        weightSum > 0 ? leftover * (s.targetPct! / weightSum) : leftover / targeted.length;
      adds[i] = need.get(i)! + share;
    }
  }

  return round ? reconcileRounding(adds, contribution, round, targeted.map((t) => t.i)) : adds;
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

/** Strip a `PortfolioNode` forest down to the serializable shape the planner needs. */
export function slimContribTree(roots: ContribInputNode[]): ContribInputNode[] {
  return roots.map((n) => ({
    id: n.id,
    name: n.name,
    depth: n.depth,
    parentId: n.parentId,
    targetPct: n.targetPct,
    totalValue: n.totalValue,
    children: slimContribTree(n.children),
  }));
}
