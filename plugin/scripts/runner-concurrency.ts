// runner-concurrency.ts — the concurrency/lane family, extracted from full-suite-runner.ts
// (gap-ac128-hub-split-harness-concerns).
//
// WHY A SEPARATE FILE: full-suite-runner.ts is a HUB file (any change forces the full suite). The
// concurrency family (concurrentSuiteSlots / hostParallelism / stripConcurrencyFlags /
// spliceConcurrency) is HARNESS-CRITICAL — it decides the suite's lane count and slot budget — so this
// file is ALSO a hub (listed in suite-bucket-hub-list.ts HUB_FILES). Extracting it out of the monolith
// shrinks that monolith WITHOUT weakening the hub rule (a change here still forces the full suite).
//
// Moved verbatim from full-suite-runner.ts: concurrentSuiteSlots (the 旋钮② slot-count reader),
// hostParallelism (nproc — read-host, never a literal), stripConcurrencyFlags + spliceConcurrency
// (the AC2 REPLACE splice). Re-exported from full-suite-runner.ts so its public API surface is
// unchanged.

import os from "node:os";
import { suiteLockSlotCount } from "./suite-lock-slots.ts";

/**
 * QUAY_MAX_CONCURRENT_SUITES — knob ② (旋钮②) of the 人 2026-08-13 框架: the concurrent full-suite
 * SLOT count S (current 2). The SINGLE definition point for "how many suites may run at once" —
 * tasks/gap-single-flight-lock-2-slot-concurrent-suites + gap-concurrency-literal-only-at-definition-
 * points. Every concurrency value derived from it (per-suite lane budget, lock slot count, the
 * resource-gate per-suite budget) READS this env var — never a literal 2 (the id note: "勿把 2 当设计
 * 常量"). Clamped to >= 1 — an invalid/zero setting fails open to the single-suite default so a
 * misconfigured host degrades to the old 1-slot behavior, never to 0 lanes.
 */
export function concurrentSuiteSlots(): number {
  return suiteLockSlotCount();
}
/**
 * Host parallelism (nproc) — the SAME source expression as defaultLaneCount (:972-973):
 * RESOURCE_GATE_NPROC (the deterministic test seam) → os.availableParallelism() → os.cpus().length,
 * floored at 1. gap-ac44-concurrent-phases-read-host-parallelism (hard-rule-4 推论二): a
 * machine-spec-dependent LITERAL (the old `= 6`) is the same defect class as `cpuQuota:"400%"` — a
 * value that happens to equal the current host's capacity becomes a real silent limit (or silent
 * oversubscription) on a different host. Read the host instead.
 */
export function hostParallelism(): number {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  return Number.isFinite(ncpu) && ncpu >= 1 ? ncpu : 1;
}
/**
 * AC2 — strip any existing `--test-concurrency=*` from a command string, both the `=` spelling
 * (`--test-concurrency=8`) and the SPACE spelling (`--test-concurrency 8`). The splice is a
 * REPLACE so the spawned process carries exactly ONE --test-concurrency (the effective value).
 */
export function stripConcurrencyFlags(cmd: string): string {
  let out = cmd.replace(/\s+--test-concurrency=\d+/g, "");
  out = out.replace(/\s+--test-concurrency\s+\d+/g, "");
  return out.trim();
}
/** Build the spawned command with the effective laneCount spliced as the ONLY --test-concurrency. */
export function spliceConcurrency(cmd: string, laneCount: number): string {
  const stripped = stripConcurrencyFlags(cmd);
  return `${stripped} --test-concurrency=${laneCount}`;
}
