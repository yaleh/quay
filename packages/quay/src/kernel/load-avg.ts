// load-avg.ts — SINGLE SOURCE of the `/proc/loadavg` field-0 reading (the 1-minute load average):
// read the file, take the first whitespace-separated field as a number, and answer it — 0 when the
// field is not finite or the file cannot be read at all (best-effort: this reading is TELEMETRY, so
// an unreadable /proc must never fail the caller).
//
// Imported by ALL THREE former copies, across the plugin/product boundary — routine
// `semantic-dedup-scan` finding `loadavg-readers`, task
// gap-routine-semantic-dedup-scan-loadavg-readers:
//   · `plugin/scripts/full-suite-runner.ts`         `readLoadAvg`   — the suite round's `load` axis
//   · `packages/quay/src/gate/acceptance-runner.ts` `gateLoadAvg`   — the gate cost ledger's `load`
//   · `packages/quay/src/gate/engine.ts`            `load1`         — the gate cost row's `load`
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The first two were a BYTE-IDENTICAL 6-line body under two names — `readLoadAvg` in the mechanism
// layer and `gateLoadAvg` in the product layer, whose own doc-comment said "same reading as
// checker-cost.sh". The rename is exactly what hid the pair from name-based scans; only a body
// digest could see it. `engine.ts`'s `load1` is the same reading a third time, differing only by a
// redundant `String(…)` wrapper around an already-`string` read (`readFileSync(p, "utf8")` returns
// `string`), and its inline comment justified itself with "Inlined here (not imported from
// plugin/scripts) so the published Core package stays dependency-free" — a reason that forbids
// importing the MECHANISM layer, not importing an in-package kernel leaf, so it did not survive the
// move.
//
// The direction must be `plugin → kernel`. The same implementation CANNOT live in a `plugin/scripts`
// module and be imported by the product side: `packages/**` importing `plugin/**` is the REVERSE EDGE
// that `plugin/scripts/import-graph-check.ts`'s `reverseEdges` ratchet (baselined at 0) forbids. So
// the kernel leaf is the one placement both layers reach: the product side imports it in-package
// (`../kernel/load-avg.ts`), and the mechanism side imports it across the tree (the same shape as
// `full-suite-runner.ts` → `packages/quay/src/systemd-scope.ts` and `gate/lifecycle.ts` →
// `../kernel/task-transition.ts`).
//
// In the SHIPPED artifact the plugin bundler (packages/quay/scripts/build-plugin-dist.mjs,
// `coreSrcAliasPlugin`) re-points every `packages/quay/src/**` specifier coming from a plugin source
// onto the real Core source tree and INLINES it into the bundle — so the mechanism side's bundles
// carry this file themselves and need no `packages/` tree at runtime.
//
// KERNEL BOUNDARY (import-graph-check 第四规则): the only import here is a NODE BUILTIN, which the
// rule explicitly permits ("kernel 落点若连 node 内建都不能用就没有意义 —— 本检查器量的是【层间越界】").
// It pulls in no sibling module, so it can never participate in a value or type cycle.
//
// ⛔ NOT UNIFIED HERE — the two other `/proc/loadavg` readers in the tree are DIFFERENT predicates,
// not copies of this one, and each is named so the boundary is a decision rather than an omission
// (硬规则 5b: 修一个实例 ⇒ 在同一载体里枚举该原则的其它适用点并逐条处置):
//   · `plugin/scripts/suite-load-sampler.ts` `readLoadavg` returns `null` — NOT 0 — on an unreadable
//     /proc: the sampler's load CURVE must carry a hole, and `0` would read as "the machine went
//     idle" (硬规则 3b, the same distinction its own comment records for `readCpuStall`).
//   · `plugin/scripts/checker-cost.ts` `getLoad1` honours the `CHECKER_COST_LOAD_OVERRIDE` test seam
//     BEFORE touching /proc at all, and reads the file into a named binding first.
// Both keep their own bodies deliberately; only the three identical ones above were collapsed.

import fs from "node:fs";

/** `/proc/loadavg` field 0 (the 1-minute load average), or 0 when unreadable/non-numeric.
 *
 *  Best-effort by contract: the reading is TELEMETRY (an attribution-correction dimension, not a
 *  pass/fail input), so a missing or malformed `/proc/loadavg` answers 0 rather than throwing.
 *  `Number.isFinite` is the guard rather than truthiness — `0` is a perfectly VALID load (an idle
 *  box), so a falsy test would silently erase the most common reading on a quiet host. */
export function readLoadAvg1(): number {
  try {
    const v = Number(String(fs.readFileSync("/proc/loadavg", "utf8")).trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
