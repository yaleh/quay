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

// ── the INSTANTANEOUS run-queue components (gap-resource-gate-reads-lagging-loadavg-not-instantaneous-rd) ─
// `readLoadAvg1` above answers a 1-MINUTE EXPONENTIAL MOVING AVERAGE — it remembers the last minute,
// it is not "now". `/proc/stat` carries the kernel's own current counts instead:
//     procs_running  — tasks in R state (running + runnable)
//     procs_blocked  — tasks in D state (uninterruptible sleep, e.g. I/O wait)
// Measured on this host (tokyo-alpha, 2026-10-16): load1 = 208.7 while procs_running + procs_blocked
// = 39 — a 5× gap between the lagging average and the instant. The components are recorded BESIDE
// loadavg so a later regression can decide whether the gate's overload-window criterion should read
// them instead; ⛔ that criterion is NOT changed here (a change must be driven by the component
// regression, not by the observation that the two differ).
//
// ONE home, both layers: `plugin/scripts/full-suite-runner.ts` (the suite round record) and
// `plugin/scripts/suite-load-sampler.ts` (the load curve) both import THIS function — the kernel leaf
// is the only placement both layers reach (`packages/**` → `plugin/**` is the forbidden reverse edge).
// The gate's bash side (plugin/scripts/resource-gate.sh) keeps its own awk reader: a shell function
// cannot import this one, the same deliberate split the load-avg readers already document.

/** The kernel's instantaneous run-queue counts plus their sum. */
export interface RunQueueReading {
  /** `/proc/stat` `procs_running` — tasks in R state. */
  procs_running: number;
  /** `/proc/stat` `procs_blocked` — tasks in D state (uninterruptible sleep). */
  procs_blocked: number;
  /** `procs_running + procs_blocked` — the instantaneous R+D queue depth. */
  runq: number;
}

/** Read `procs_running` / `procs_blocked` from `/proc/stat`, or **null** when either line is missing
 *  or the file cannot be read.
 *
 *  ⛔ NULL, not 0 — the one deliberate difference from `readLoadAvg1`'s best-effort 0 above. A load of
 *  0 is a real reading (an idle box); a *component* of 0 is far more often "the file went away" than
 *  "no process is runnable", and a fabricated 0 in the ledger would read as "the machine went idle"
 *  exactly when the instrument failed (硬规则 3b: 读不懂 ⇒ 独立取值，不与合格同形). Callers therefore
 *  have three distinguishable states: a number, `null` (read attempted, unavailable), and the field's
 *  absence on rows written before this reading existed. */
export function readRunQueue(): RunQueueReading | null {
  try {
    const text = fs.readFileSync("/proc/stat", "utf8");
    const running = text.match(/^procs_running[ \t]+(\d+)[ \t]*$/m);
    const blocked = text.match(/^procs_blocked[ \t]+(\d+)[ \t]*$/m);
    if (!running || !blocked) return null;
    const procs_running = Number(running[1]);
    const procs_blocked = Number(blocked[1]);
    if (!Number.isFinite(procs_running) || !Number.isFinite(procs_blocked)) return null;
    return { procs_running, procs_blocked, runq: procs_running + procs_blocked };
  } catch {
    return null;
  }
}
