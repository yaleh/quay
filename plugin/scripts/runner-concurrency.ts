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
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
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

// ── scripts/test.sh DIRECT-path decision logic (SPEC-execution-loop-productization P4 套件入口收进 TS) ──
// These are the pure DECISION functions scripts/test.sh used to compute inline in bash. Extracted here
// so test.sh narrows to THIN FORWARDING (gap-execution-loop-p4-suite-entry-ts-ization): the bash
// functions default_concurrency_formula / default_test_concurrency / serial_lowconc_host_default /
// lowconc_concurrency_default / has_explicit_concurrency / bucket_test_concurrency / all_flags, and the
// main_root derivation, now shell out to `node runner-concurrency.ts --<flag>` instead of holding the
// computation. The RUNNER-side
// twins live in full-suite-runner.ts (defaultLaneCount / defaultPhaseConcurrency) — deliberately NOT
// merged: the runner's defaultLaneCount carries the yielded-slot term (漏口②) and reads
// QUAY_MAX_OVERSUBSCRIPTION directly, while the DIRECT path reads the RESOURCE_GATE_OVERSUBSCRIPTION
// test seam and has no yielded term — the two are cross-checked by resource-gate.test.mjs 判据4, which
// now exercises BOTH sides as TS functions (no bash extraction).

/** Empty-string-as-unset (`${VAR:-…}`) — the bash `:-` convention every knob read below shares with
 *  suite-lock-slots.ts envValOrUndefined: an EMPTY string is UNSET, not "empty value". */
function envValOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/**
 * defaultTestConcurrency — the DIRECT-path (scripts/test.sh) MAIN-phase concurrency:
 * max(1, floor(nproc × oversub / S)). The EXACT semantics of the bash default_concurrency_formula
 * (gap-suite-budget-oversubscribe pure computation — nproc read-host via hostParallelism, oversub 旋钮③,
 * S 旋钮②): the RESOURCE_GATE_OVERSUBSCRIPTION seam is honored (unlike full-suite-runner.ts's
 * defaultLaneCount, which reads QUAY_MAX_OVERSUBSCRIPTION directly), and the yielded-slot term is ABSENT
 * (that is a runner-path-only 漏口② fix). Value validation matches bash exactly — a non-`[0-9]+(.[0-9]+)?`
 * or non-positive oversub falls to 1.
 */
export function defaultTestConcurrency(): number {
  const ncpu = hostParallelism();
  const slots = concurrentSuiteSlots();
  const oversubStr = envValOr("RESOURCE_GATE_OVERSUBSCRIPTION", envValOr("QUAY_MAX_OVERSUBSCRIPTION", "1"));
  const oversubNum = Number(oversubStr);
  const oversub = /^[0-9]+(\.[0-9]+)?$/.test(oversubStr) && Number.isFinite(oversubNum) && oversubNum > 0 ? oversubNum : 1;
  return Math.max(1, Math.floor((ncpu * oversub) / slots));
}

/**
 * defaultPhaseConcurrencyDirect — the DIRECT-path (scripts/test.sh) SERIAL PHASE concurrency:
 * max(1, floor(nproc / (S × P))). The EXACT semantics of the bash serial_lowconc_host_default
 * (gap-ac74-serial-lowconc-literal-direct-path + gap-lane-formula-ignores-phase-overlap-concurrency):
 * P = the concurrent-phase count (2 when QUAY_PHASE_OVERLAP ≠ "0" — the default — else 1). Identical in
 * value to full-suite-runner.ts's defaultPhaseConcurrency (the runner twin); kept separate so the direct
 * path's forwarder has a self-contained import (runner-concurrency.ts cannot import full-suite-runner.ts
 * — that direction would be a cycle). resource-gate.test.mjs 判据4 cross-checks the two stay equal.
 * gap-lowconc-concurrency-restore-host-derived: SERIAL and LOWCONC now SHARE this host-derived default —
 * defaultLowconcConcurrency returns the SAME max(1, floor(nproc/(S×P))), so serial_lowconc_host_default
 * binds both phases again (the lowconc=3 fixed-value split was wrong — see defaultLowconcConcurrency).
 */
export function defaultPhaseConcurrencyDirect(): number {
  const ncpu = hostParallelism();
  const slots = concurrentSuiteSlots();
  const phases = envValOr("QUAY_PHASE_OVERLAP", "1") === "0" ? 1 : 2;
  return Math.max(1, Math.floor(ncpu / (slots * phases)));
}

/** defaultLowconcConcurrency — the lowconc-phase concurrency default: HOST-DERIVED
 *  max(1, floor(nproc / (S × P))), IDENTICAL to the serial phase's default
 *  (defaultPhaseConcurrencyDirect). gap-lowconc-concurrency-restore-host-derived (用户 2026-09-02 反转):
 *  the prior fixed 3 (gap-lowconc-concurrency-8-starves-bclass-waiting) was WRONG — 人裁定
 *  「lowconc 从 8 降回 3 是错的」「lowconc 和 serial lane 数现在都是计算出来的吧？应当持这一根据当前系统
 *  环境计算的机制」, and the lowconc=8 starvation hypothesis was falsified by its own post-landing
 *  attribution (the probe-starvation root cause is the session-liveness family's own multi-cause, NOT the
 *  concurrency value). lowconc therefore returns to serial's host-derived default. Exported for
 *  full-suite-runner.ts (the runner twin must read the SAME value) and test.sh's thin forwarder
 *  (--lowconc-concurrency). */
export function defaultLowconcConcurrency(): number {
  return defaultPhaseConcurrencyDirect();
}

/**
 * hasExplicitConcurrency — whether the args already carry a --test-concurrency flag (the `=` spelling
 * with a value, or the bare `--test-concurrency` space-form marker). The DIRECT-path forwarder for the
 * bash has_explicit_concurrency (gap-full-suite-runner-concurrency-default-and-gate AC2): an explicit
 * flag is the SINGLE concurrency source, so the derived default must not be prepended.
 */
export function hasExplicitConcurrency(args: string[]): boolean {
  return args.some((a) => a === "--test-concurrency" || a.startsWith("--test-concurrency="));
}

/**
 * allFlags — true iff EVERY argument starts with '-' (the bash all_flags predicate,
 * gap-test-sh-flags-only-form-silently-runs-a-different-suite). An empty arg list is vacuously true;
 * the caller checks `$# -eq 0` first (matching the bash dispatch).
 */
export function allFlags(args: string[]): boolean {
  return args.every((a) => a.startsWith("-"));
}

/**
 * bucketTestConcurrency — the EFFECTIVE concurrency for the --buckets run({files}) runner
 * (suite-lpt-runner.mjs), the DIRECT-path forwarder for the bash bucket_test_concurrency. An explicit
 * --test-concurrency=N (valid integer ≥ 1, either spelling) wins; otherwise the derived default
 * (defaultTestConcurrency). Returns the VALUE (the runner needs a number in execArgv), not a boolean.
 */
export function bucketTestConcurrency(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--test-concurrency=")) {
      const v = a.slice("--test-concurrency=".length);
      if (/^[0-9]+$/.test(v) && Number(v) >= 1) return Number(v);
    } else if (a === "--test-concurrency") {
      const next = args[i + 1];
      if (next !== undefined && /^[0-9]+$/.test(next) && Number(next) >= 1) return Number(next);
    }
  }
  return defaultTestConcurrency();
}

/**
 * deriveMainRoot — the DIRECT-path main_root derivation (gap-gitignored-carriers-absent-in-verify-worktree
 * + gap-fan-in-worktree-quay-provisioning). QUAY_MAIN_CHECKOUT (empty-as-unset) → repoRoot; then the
 * git-derived FIRST `git worktree list --porcelain` worktree is ALWAYS preferred when it differs from
 * repoRoot (full-suite-runner.ts launches with `--root <worktree>` and sets QUAY_MAIN_CHECKOUT to the
 * WORKTREE, whose project-dir slug has no session transcripts ⇒ a false "fan-in-without-workflow" RED —
 * the git primary checkout is authoritative). Reads the FULL porcelain stream (never an early-exit awk)
 * so no SIGPIPE/EPIPE; a non-git / non-worktree cwd keeps repoRoot (fail-open, never aborts the suite).
 */
export function deriveMainRoot(repoRoot: string): string {
  let mainRoot = envValOr("QUAY_MAIN_CHECKOUT", repoRoot);
  let derived = "";
  try {
    // stdio stderr→ignore matches the bash `git worktree list --porcelain 2>/dev/null` (a non-git cwd
    // must not print git's "fatal: not a git repository" to the suite stream — it just keeps repoRoot).
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        derived = line.slice("worktree ".length);
        break;
      }
    }
  } catch {
    derived = "";
  }
  if (derived !== "" && derived !== repoRoot) mainRoot = derived;
  return mainRoot;
}

// ── CLI (scripts/test.sh thin-forwarding entry) ──────────────────────────────────────────────────────
const _runnerConcurrencyUsage = [
  "runner-concurrency.ts — the suite concurrency/lane family + scripts/test.sh DIRECT-path decision logic",
  "",
  "Flags (one per invocation; the direct-path bash functions thin-forward to these):",
  "  --default-test-concurrency   print max(1, floor(nproc × oversub / S))   (bash default_concurrency_formula)",
  "  --phase-concurrency          print max(1, floor(nproc / (S × P)))       (bash serial_lowconc_host_default)",
  "  --lowconc-concurrency        print max(1, floor(nproc / (S × P))) (bash lowconc_concurrency_default, = serial_lowconc_host_default)",
  "  --bucket-test-concurrency    print the --buckets effective concurrency   (bash bucket_test_concurrency)",
  "  --derive-main-root <repo>    print the main checkout path               (bash main_root derivation)",
  "  --has-explicit-concurrency   exit 0 iff any arg is a --test-concurrency flag (bash has_explicit_concurrency)",
  "  --all-flags                  exit 0 iff every arg starts with '-'        (bash all_flags)",
  "",
  "Exit codes: 0 = truthy / value printed; 1 = falsy (the two boolean flags); 2 = usage error.",
].join("\n");

function main(argv: string[]): number {
  const args = argv.slice(2);
  const flag = args[0];
  if (flag === undefined || flag === "--help" || flag === "-h") {
    console.log(_runnerConcurrencyUsage);
    return flag === undefined ? 2 : 0;
  }
  const rest = args.slice(1);
  switch (flag) {
    case "--default-test-concurrency":
      process.stdout.write(`${defaultTestConcurrency()}\n`);
      return 0;
    case "--phase-concurrency":
      process.stdout.write(`${defaultPhaseConcurrencyDirect()}\n`);
      return 0;
    case "--lowconc-concurrency":
      process.stdout.write(`${defaultLowconcConcurrency()}\n`);
      return 0;
    case "--bucket-test-concurrency":
      process.stdout.write(`${bucketTestConcurrency(rest)}\n`);
      return 0;
    case "--derive-main-root":
      process.stdout.write(`${deriveMainRoot(rest[0] ?? process.cwd())}\n`);
      return 0;
    case "--has-explicit-concurrency":
      return hasExplicitConcurrency(rest) ? 0 : 1;
    case "--all-flags":
      return allFlags(rest) ? 0 : 1;
    default:
      console.error(_runnerConcurrencyUsage);
      return 2;
  }
}

if (isDirectEntry(import.meta, undefined, "runner-concurrency")) {
  process.exit(main(process.argv));
}
