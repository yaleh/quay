// dist-stats.ts — the ONE definition of the NOT-EVALUATED-string percentile summary `dist`, and
// the ONE place its EMPTY POLICY is stated.
//
// WHY THIS FILE EXISTS (routine `semantic-dedup-scan`, finding `dist-stats`, runId
// `semantic-dedup-scan-1793780123988`): `duration-report.ts` and `fan-in-queueing-model.ts` each
// declared a BYTE-IDENTICAL `dist(xs:number[]):Dist` percentile summary (n/min/median/p90/max/mean)
// — plus the `percentile` index helper, the `Dist` shape, and the `NOT_EVALUATED`/`MaybeNum`
// vocabulary it is built on — with no shared import between the two. The same pair had already been
// flagged twice (findings `dist-stat-byte-identical` / `E1`) and rate-gated out; `dist-stats` is
// the third recurrence, now filed.
//
// ── THE POLICY, stated once, here ────────────────────────────────────────────────────────────────
// An EMPTY sample has no distribution. `Dist.n` answers how many readings exist (0 when none), and
// every statistic field answers `NOT_EVALUATED` when there is nothing to measure — ⛔ not `0`, not
// `null`, not `NaN`. `0` is only ever a MEASURED zero, so a reader can tell a measured zero from a
// sample that was never taken (硬规则 6).
//
// This is the STRING-SENTINEL cluster. `defect-latency-pair.ts` carries a DIFFERENT statistic with
// the SAME shape but a DIFFERENT empty policy (`null`): that divergence is the separate, rate-gated
// `percentile-duplicate` / `percentile-conventions-diverged` finding and is deliberately NOT folded
// in here — one leaf, one policy; reconciling the two sentinels is a decision that belongs to that
// finding, not this one.
//
// `percentile` takes an ALREADY-SORTED array (the same contract as the two removed copies) and
// answers the nearest-rank index `floor((n-1)*p)` clamped to [0, n-1]. The sort is INTERNAL to
// `dist`; callers of `percentile` sort at their own call site.
//
// Consumers: duration-report.ts (re-export) / fan-in-queueing-model.ts (re-export) — both keep
// their existing public surface, so relaxed-dispatch-ledger.ts, touches-relax-tighten.ts and the
// two .test.mjs files still import `percentile`/`dist`/`NOT_EVALUATED` through them.
// plugin/test/dist-stats-ssot.test.mjs pins that this is the ONLY declaration for THIS cluster.

export const NOT_EVALUATED = "NOT-EVALUATED" as const;
export type MaybeNum = number | typeof NOT_EVALUATED;

export interface Dist {
  n: number;
  min: MaybeNum;
  median: MaybeNum;
  p90: MaybeNum;
  max: MaybeNum;
  mean: MaybeNum;
}

/** Nearest-rank percentile of an ALREADY-SORTED sample, or `NOT_EVALUATED` when there is nothing to
 *  measure (see the empty policy above). */
export function percentile(sorted: number[], p: number): MaybeNum {
  if (sorted.length === 0) return NOT_EVALUATED;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}

/** The one-arg distribution summary (n/min/median/p90/max/mean). Sorts internally and does NOT
 *  mutate its argument. Empty ⇒ `n = 0` and every statistic `NOT_EVALUATED`. */
export function dist(xs: number[]): Dist {
  if (xs.length === 0) {
    return { n: 0, min: NOT_EVALUATED, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, mean: NOT_EVALUATED };
  }
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}
