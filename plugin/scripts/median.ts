// median.ts — the ONE definition of the even-average MEDIAN, and the ONE place its EMPTY POLICY is
// stated.
//
// WHY THIS FILE EXISTS (routine `semantic-dedup-scan`, finding `median-empty-policy-diverged`,
// runId `semantic-dedup-scan-1792168649663`): six `median` functions were declared over the SAME
// even-average core and disagreed about what an EMPTY sample means —
//   * `0`    — `fast-mode-telemetry.ts`, `workflow-baseline-metrics.ts`. A reading that was NEVER
//              TAKEN rendered as a real number, indistinguishable from a measured median of 0
//              (硬规则 6: 缺值 = 未查, not 「为假」).
//   * `NaN`  — `rework-predictors.ts` (via its own `mean`), `psi-failure-correlation-check.ts`
//              (via its own `pct`). Distinguishable from 0, but it is the language's ARITHMETIC
//              result leaking out of a statistic as if it were an answer.
//   * `null` — `resource-anomaly-detector.ts` (which additionally dropped non-finite values),
//              `crystallization-half-life.ts`.
// and one of the six additionally rounded the even-average to one decimal
// (`crystallization-half-life.ts`). One statistic, four readings of "no sample".
//
// ── THE POLICY, stated once, here ────────────────────────────────────────────────────────────────
// An empty sample has NO median.
//   * It is not `0` — that is a median that WAS measured, and a reader cannot tell the two apart
//     once they share a representation.
//   * It is not `NaN` — that is what an ARITHMETIC operation produces, not a statement about how
//     much evidence exists.
//   * `null` is the third state. 硬规则 3b: a judge whose output vocabulary has no "not measured"
//     value cannot report that it could not measure; it can only masquerade as a pass. So the
//     helper answers `number | null`, and it never invents a number for an empty sample.
//   A caller that genuinely needs a `number` MUST pick its own sentinel EXPLICITLY at its own call
//   site (`?? 0`, `?? Number.NaN`). That is the point of moving the choice out of the helper: the
//   decision now sits in the code that makes it, where a reviewer can see which sites conflate an
//   absent reading with a real one and which do not.
//
// Also stated once, here: values that are NOT FINITE are DROPPED rather than folded in. A missing
// or malformed reading is ABSENT from the sample, not a value in it — so it cannot drag the median
// (or, via the sort order, the even-average pairing) to a number that no observation supports. This
// is the stricter of the two behaviours the six copies had; `resource-anomaly-detector.ts` already
// filtered, the others did not, and folding NaN into a sort is not a contract anyone chose.
//
// The sort is INTERNAL (`readonly number[]`, any order accepted). `crystallization-half-life.ts`
// used to pass a pre-sorted array and the other five sorted internally — both are now just callers.
//
// ── NOT this file's business ─────────────────────────────────────────────────────────────────────
//   * `percentile` / `p90` / `quantile` — a DIFFERENT statistic with its own divergence (routine
//     finding `percentile-conventions-diverged`, rejected by the routine's rate gate, so not fixed
//     here). `pct`-style linear interpolation is not the even-average core and must not be folded
//     into it.
//   * `mean` — its own finding (`mean-empty-policy-diverged`), also rate-gated out.
//   * DISPLAY ROUNDING. `crystallization-half-life.ts` rounds its median to 1 decimal; that is a
//     presentation choice of that report, so it stays at that report's call site (where it is also
//     stated why it is a no-op for that report's integer day counts). A shared statistic must not
//     carry one consumer's formatting.
//
// Consumers: crystallization-half-life.ts / fast-mode-telemetry.ts / resource-anomaly-detector.ts
// (re-export) / rework-predictors.ts (re-export) / workflow-baseline-metrics.ts /
// psi-failure-correlation-check.ts. `plugin/test/median-ssot.test.mjs` pins the invariant that this
// is the ONLY declaration.

/**
 * The median of `xs` — exact even-average for an even sample, no rounding — or `null` when there is
 * nothing to measure (see the empty policy above). Non-finite values are dropped first.
 */
export function median(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
