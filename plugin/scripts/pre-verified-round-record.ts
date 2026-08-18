#!/usr/bin/env node
// pre-verified-round-record.ts — the SHARED verification-round writer for the fan-in suite paths.
// gap-preverified-suite-bypasses-verification-round-ledger AC1/AC2 (the pre-verified branch) +
// gap-fan-in-realsuite-bypasses-verification-round-ledger AC1/AC2 (the real-suite branch).
// writer: append ONE verification-round.jsonl record for a full-suite round that ran OUTSIDE
// full-suite-runner.ts (the only other verification-round writer) — i.e. a fan-in landing whose
// suite went through fan-in-execute.js's detached `bash scripts/test.sh` path.
//
// WHY IT EXISTS: the normal full-suite path writes verification-round.jsonl via full-suite-runner.ts's
// appendVerificationRound. The fan-in paths (fan-in-execute.js step 4) run the suite EITHER as a
// pre-verified reuse (a capture produced by the caller OUTSIDE the fan-in subagent's round — suite_head
// pinned to the worktree HEAD + suite_exit=0, ec434eb8) OR as a real detached run in this fan-in
// (`setsid bash -c 'bash scripts/test.sh'`, 9327056a) — BOTH never call full-suite-runner and never
// trigger a verification-round write. The trend ledger (the `/tests` page + suite-cost analysis data
// source) went blind to the most-used landing path (the 7h+ gap gap-preverified closed; the real-suite
// branch stayed blind at 19:45/20:36/20:52 — three real landings, zero records, 2026-08-17).
//
// THIS WRITER IS SHARED (AC3): both fan-in branches call the same writer + the same guard
// (`full_suite_ran=true`), and the `preverified` boolean (1 = reused capture, 0 = real run in this
// fan-in) comes from the suite_preverified marker — no duplicated writer for the real-suite branch
// (hard rule 5b: 在某处修好 X ≠ X 只在那一处).
//
// Record shape: SuiteRoundRecord-compatible (full-suite-runner.ts:1265) so `/tests` (parseVerificationRound
// in packages/quay/src/observation.ts) and trend-check read it. Fields:
//   round        = prior line count + 1 (same numbering appendVerificationRound uses)
//   startedAt    = the suite start (start_iso)
//   durationMs   = the suite wall-clock (wall_ms) — a real detached run's own wall clock, or the
//                  reused capture's wall clock on the pre-verified path
//   laneCount    = the suite's lane_count
//   load         = the suite's load (the /proc/loadavg 1min at the suite's end)
//   state        = "green" (both fan-in branches only write after suite_exit=0)
//   runner       = nominal identity (default "outer", matching every existing verification-round row)
//   scope        = "worktree" (the fan-in suite ran against the task worktree's HEAD)
//   commit       = the pinned suite_head (the exact HEAD that was verified)
//   cpu_time_s / cpu_source = the capture's GNU-time CPU seconds / provenance (AC6: explicit null +
//                  not-wired when the source was unavailable, NEVER 0)
//   preverified  = 1 for a reused-capture round, 0 for a real suite run in this fan-in (AC1 marker —
//                  distinguishes a reused-capture round from a full-suite-runner row AND from a real
//                  detached run)
//   taskId/runId = which fan-in produced this round (traceability; tolerated by every reader)
//   phase_overlap = whether the two-phase-overlap scheduling ACTUALLY ran, derived from the suite
//                  log's `overlap: running` marker (gap-phase-overlap-field-always-false-negative).
//                  ALWAYS present: true = overlap ran; false = log readable + marker absent
//                  (sequential); null = log absent/unreadable (n/a, never fabricated).
//
// pass/fail/cancelled/tests are OMITTED — the fan-in capture carries no test counts (the suite ran
// outside full-suite-runner). A green round has fail=0/cancelled=0, but the pass count is genuinely
// unknown; the /tests reader renders null as "—" and trend-check skips per-test cost for a row with
// no tests — both honest, neither fabricates a count.
//
// This writer is the equivalent writer the task mandates (a NEW module — it does NOT modify
// plugin/scripts/per-task-suite-record.ts, the per-task ledger writer, so the two ledgers stay
// disjoint: verification-round = full-suite trend / per-task-suite-records = per-task verification).
//
// Record shape: SuiteRoundRecord-compatible (full-suite-runner.ts:1265) so `/tests` (parseVerificationRound
// in packages/quay/src/observation.ts) and trend-check read it. Fields:
//   round        = prior line count + 1 (same numbering appendVerificationRound uses)
//   startedAt    = the reused capture's suite start (start_iso)
//   durationMs   = the reused capture's wall-clock (wall_ms) — semantics: the OUTER pre-verification
//                  suite's wall clock, NOT a re-run inside this fan-in; the `preverified: true`
//                  marker makes that explicit (AC2).
//   laneCount    = the capture's lane_count
//   load         = the capture's load (the /proc/loadavg 1min at the pre-verification suite's end)
//   state        = "green" (the pre-verified path only reuses a capture with suite_exit=0)
//   runner       = nominal identity (default "outer", matching every existing verification-round row)
//   scope        = "worktree" (the pre-verified suite ran against the task worktree's HEAD)
//   commit       = the pinned suite_head (the exact HEAD that was verified)
//   cpu_time_s / cpu_source = the capture's GNU-time CPU seconds / provenance (AC6: explicit null +
//                  not-wired when the source was unavailable, NEVER 0)
//   preverified  = true (AC1 marker — distinguishes a reused-capture round from a full-suite-runner row)
//   taskId/runId = which fan-in produced this round (traceability; tolerated by every reader)
//
// pass/fail/cancelled/tests are OMITTED — the pre-verified capture carries no test counts (the suite
// ran outside this fan-in). A green round has fail=0/cancelled=0, but the pass count is genuinely
// unknown; the /tests reader renders null as "—" and trend-check skips per-test cost for a row with
// no tests — both honest, neither fabricates a count.
//
// Fail-closed (硬规则 3b): a missing/invalid required field exits 2 and writes NOTHING — a partial
// record is never appended.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/pre-verified-round-record.ts
//       --task-id <taskId> --run-id <runId> --started-at <iso> --duration-ms <ms>
//       --lane-count <n> --load <n> --commit <sha>
//       [--preverified <0|1|true|false>] [--cpu-time-s <n|null>] [--cpu-source <name>]
//       [--suite-log <path>] [--runner <name>] [--root <dir>] [--record-file <file>]
//       [--json] [--help]
//
//   --task-id         the fan-in task whose suite landed (required)
//   --run-id          the fan-in runId (required)
//   --started-at      the suite start, ISO-8601 or epoch-seconds (required)
//   --duration-ms     the suite wall-clock in ms (required, non-negative)
//   --lane-count      suite lane count (required, non-negative)
//   --load            /proc/loadavg 1min at the suite's end (required, non-negative)
//   --commit          the pinned verified HEAD (suite_head), 40-hex (required)
//   --preverified     the reuse marker: 1/true = this round REUSED a caller-produced capture
//                     (the pre-verified branch); 0/false = the suite RAN inside this fan-in (the
//                     real-suite branch). Default 1/true (backward compat).
//   --cpu-time-s      the suite's CPU seconds — a real number, or the literal null when the source
//                     was considered and UNAVAILABLE (AC6; 0 normalizes to null)
//   --cpu-source      WHERE the cpu_time_s came from ('gnu-time' / 'not-wired'; optional)
//   --suite-log       the fan-in suite log path — parse its `__OVERHEAD__ <phase>_ms=N` lines into
//                     static/serial/lowconc/main phase fields + record nproc/concurrentSuiteSlots/
//                     concurrentSuitesRunning (same 口径 as full-suite-runner). When absent or
//                     unreadable the row is EXPLICITLY phase-less (no fabricated fields).
//   --runner          nominal runner identity (default 'outer', matching the existing ledger)
//   --root            repo root (default: cwd) — resolves the shared checkout via git common-dir
//   --record-file     override the ledger path (hermetic tests)
//   --json            machine-readable output {ok, record, file}
//   --help            this help
//
// Exit codes:
//   0  one record appended
//   2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveSharedCheckout, toIsoTimestamp } from "./per-task-suite-record.ts";

const COMMIT_RE = /^[0-9a-f]{40}$/i;

// ── phase + concurrency 口径 (gap-fan-in-verification-round-thin-schema-phase-gap) ───────────────────
// The fan-in verification-round row must carry the SAME phase / concurrency axes full-suite-runner's
// appendVerificationRound writes (static/serial/lowconc/main phase ms + nproc/concurrentSuiteSlots/
// concurrentSuitesRunning), so AC101's lane-concurrency control round (S=1) can compare the fan-in
// baseline against a full-suite-runner control round at the SAME 口径 (round 227 was the last rich row;
// 228-233 all thin — the defect this module fixes).
//
// Phase source: the fan-in suite log (--suite-log) carries test.sh's `__OVERHEAD__ <phase>_ms=N`
// fixed-overhead instrumentation — the SAME lines full-suite-runner stream-accumulates at
// plugin/scripts/full-suite-runner.ts:2849-3052. Only a phase that RAN is present (absent-field
// contract, same as the *_phase_ms spreads at :3696-3699): `static_phase_ms` ← `run_static_checks`,
// plus serial/lowconc/main. A missing/unreadable log → NO phase fields (never fabricated).
//
// Concurrency helpers below are THIN LOCAL REPLICAS of full-suite-runner's single-definition-point
// expressions (hostParallelism :1580, concurrentSuiteSlots :1536, countHeldSuiteLocks :1638) — kept
// local so the thin writer never imports the heavy full-suite-runner module; the expressions are
// byte-identical so the record is 同口径.

const PHASE_OVERHEAD_RE = /^__OVERHEAD__\s+([A-Za-z0-9_]+)_ms=(\d+)(?:\s+partial=1)?$/;

/** Parse test.sh's `__OVERHEAD__ <phase>_ms=N` lines from a suite log. Returns {} when the log is
 *  absent/unreadable (never fabricates a phase — the absent-field contract). Keyed by the raw label
 *  (`serial_phase`, `lowconc_phase`, `main_phase`, `run_static_checks`). */
export function parseSuitePhases(suiteLog) {
  const phaseMs = {};
  if (!suiteLog) return phaseMs;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return phaseMs;
  }
  for (const line of text.split("\n")) {
    const m = line.match(PHASE_OVERHEAD_RE);
    if (m) phaseMs[m[1]] = Number(m[2]);
  }
  return phaseMs;
}

// gap-phase-overlap-field-always-false-negative — the same `overlap: running` marker full-suite-runner
// latches as phaseOverlapRan (phaseMarkerOverlap = /^overlap:\s+running/). test.sh emits it ONLY when
// PHASE_OVERLAP=1 AND both serial+lowconc are non-empty (the parallel branch ACTUALLY ran) — the
// ground-truth signal, not the env intent.
const OVERLAP_RUNNING_RE = /^overlap:\s+running/;

/** Whether the suite log records that the two-phase-overlap scheduling ACTUALLY ran. Tri-state (hard
 *  rule 3b — 判不出 is a distinct value, never conflated with a boolean): true = the log carries the
 *  `overlap: running` marker (overlap ran); false = the log is readable and does NOT carry it
 *  (sequential); null = the log is absent/unreadable (n/a — the field is present but the value is
 *  honestly unknown, never fabricated). Mirrors full-suite-runner's phaseOverlapRan latch. */
export function detectPhaseOverlap(suiteLog) {
  if (!suiteLog) return null;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (OVERLAP_RUNNING_RE.test(line)) return true;
  }
  return false;
}

/** Host parallelism (nproc) — the same read-host expression as full-suite-runner.hostParallelism
 *  (RESOURCE_GATE_NPROC seam → os.availableParallelism() → os.cpus().length, floored at 1). */
export function hostParallelism() {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  return Number.isFinite(ncpu) && ncpu >= 1 ? ncpu : 1;
}

/** The configured concurrent-suite slot count (QUAY_MAX_CONCURRENT_SUITES, default 2) — the same
 *  definition-point read as full-suite-runner.concurrentSuiteSlots (clamped >= 1, fail-open to 2). */
export function concurrentSuiteSlots() {
  const raw = Number(process.env.QUAY_MAX_CONCURRENT_SUITES ?? "2");
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;
}

/** Resolve the single-flight 2-slot lock files the SAME way full-suite-runner.suiteLockPaths does:
 *  `${FULL_SUITE_LOCK_FILE}` env override → `git rev-parse --git-common-dir` from `root` (the SHARED
 *  lock dir all worktrees contend on) → fall back to `<root>/.git`. */
function suiteLockPaths(root) {
  const envOverride = process.env.FULL_SUITE_LOCK_FILE;
  let base;
  if (envOverride) {
    base = envOverride;
  } else {
    let commonDir = null;
    try {
      commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      commonDir = null;
    }
    if (!commonDir) commonDir = ".git";
    base = path.join(path.resolve(root, commonDir), "full-suite.lock");
  }
  return [`${base}.0`, `${base}.1`];
}

/** Non-blocking probe of ONE slot: false = FREE, true = HELD. Missing parent dir reads as FREE (the
 *  same fail-open as full-suite-runner.probeLockHeld). */
function probeLockHeld(lockFile) {
  if (!fs.existsSync(path.dirname(lockFile))) return false;
  try {
    execFileSync("flock", ["-n", lockFile, "true"], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

/** Number of single-flight lock slots CURRENTLY held by OTHER suites at probe time (0..S, S =
 *  concurrentSuiteSlots()). Best-effort: any error degrades to 0 (accounting never blocks a run). */
export function countHeldSuiteLocks(root) {
  try {
    const [l0, l1] = suiteLockPaths(root);
    return (probeLockHeld(l0) ? 1 : 0) + (probeLockHeld(l1) ? 1 : 0);
  } catch {
    return 0;
  }
}

/** Build the pre-verified round record. Returns {record} or {error} (fail-closed). */
export function buildPreVerifiedRoundRecord(o) {
  const taskId = o.taskId;
  if (!taskId || !String(taskId).trim()) return { error: "--task-id is required" };
  const runId = o.runId;
  if (!runId || !String(runId).trim()) return { error: "--run-id is required" };
  const startedAt = toIsoTimestamp(o.startedAt);
  if (startedAt == null) return { error: `--started-at must be an ISO/epoch timestamp (got ${JSON.stringify(o.startedAt)})` };
  const durationMs = Number(o.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return { error: `--duration-ms must be a non-negative number (got ${JSON.stringify(o.durationMs)})` };
  }
  const laneCount = Number(o.laneCount);
  if (!Number.isFinite(laneCount) || laneCount < 0) {
    return { error: `--lane-count must be a non-negative number (got ${JSON.stringify(o.laneCount)})` };
  }
  const load = Number(o.load);
  if (!Number.isFinite(load) || load < 0) {
    return { error: `--load must be a non-negative number (got ${JSON.stringify(o.load)})` };
  }
  const commit = o.commit ? String(o.commit).trim() : "";
  if (!COMMIT_RE.test(commit)) {
    return { error: `--commit must be a 40-hex commit sha (got ${JSON.stringify(o.commit)})` };
  }
  // cpu_time_s / cpu_source — a real number or EXPLICIT null + provenance (AC6, never 0).
  let cpuTimeS;
  let cpuSource;
  if (o.cpuSource != null) {
    cpuSource = String(o.cpuSource).trim();
    if (!cpuSource) return { error: "--cpu-source must be a non-empty string (got empty)" };
  }
  if (o.cpuTimeS != null) {
    const raw = String(o.cpuTimeS).trim();
    if (raw === "null" || raw === "") {
      cpuTimeS = null;
      if (cpuSource == null) cpuSource = "not-wired";
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        return { error: `--cpu-time-s must be a non-negative number, 0, or null (got ${JSON.stringify(o.cpuTimeS)})` };
      }
      if (v === 0) {
        cpuTimeS = null;
        if (cpuSource == null) cpuSource = "not-wired";
      } else {
        cpuTimeS = v;
        if (cpuSource == null) cpuSource = "gnu-time";
      }
    }
  }
  const runner = o.runner ? String(o.runner).trim() : "outer";
  if (!runner) return { error: "--runner must be a non-empty string" };
  // preverified — the shared writer's branch marker (AC3): 1/true = reused capture (pre-verified
  // branch), 0/false = the suite RAN inside this fan-in (real-suite branch). Default true for
  // backward compat with the pre-verified callers that predate the shared-flag form.
  let preverified = true;
  if (o.preverified != null) {
    const pv = String(o.preverified).trim().toLowerCase();
    if (pv === "0" || pv === "false") preverified = false;
    else if (pv === "1" || pv === "true") preverified = true;
    else return { error: `--preverified must be 0|1|true|false (got ${JSON.stringify(o.preverified)})` };
  }
  const record = {
    round: 0, // computed from prior line count in the appender
    startedAt,
    durationMs,
    laneCount,
    load,
    state: "green", // both fan-in branches only write after suite_exit=0
    runner,
    scope: "worktree", // the fan-in suite ran against the task worktree's HEAD
    commit,
    preverified, // AC1 marker — distinguishes a reused-capture round from a real detached run
    taskId: String(taskId).trim(),
    runId: String(runId).trim(),
  };
  if (o.cpuTimeS != null || cpuSource != null) {
    record.cpu_time_s = cpuTimeS;
    record.cpu_source = cpuSource ?? "not-wired";
  }
  // gap-fan-in-verification-round-thin-schema-phase-gap AC1/AC2 — phase fields + concurrency
  // variables (same 口径 as full-suite-runner's appendVerificationRound). Phase source: the suite
  // log (--suite-log). preverified 分支单独定案 (AC2): the writer parses phases from --suite-log
  // WHENEVER the path is provided AND the file is readable (a real-run capture always carries it; a
  // pre-verified capture carries it only when the caller recorded its log path) — otherwise the row
  // is EXPLICITLY phase-less (no fabricated fields). This does not conflate the two branches: a
  // preverified=1 capture WITHOUT a log path records no phase data, honestly.
  const suiteLog = o.suiteLog ? String(o.suiteLog).trim() : "";
  const phaseMs = parseSuitePhases(suiteLog);
  if (phaseMs.run_static_checks !== undefined) record.static_phase_ms = phaseMs.run_static_checks;
  if (phaseMs.serial_phase !== undefined) record.serial_phase_ms = phaseMs.serial_phase;
  if (phaseMs.lowconc_phase !== undefined) record.lowconc_phase_ms = phaseMs.lowconc_phase;
  if (phaseMs.main_phase !== undefined) record.main_phase_ms = phaseMs.main_phase;
  // gap-phase-overlap-field-always-false-negative — the fan-in landing path (this writer) must ALSO
  // carry phase_overlap (the DoD's "真实 fan-in 轮正确写入"): derive from the suite log's
  // `overlap: running` marker, mirroring full-suite-runner's phaseOverlapRan latch. Unlike
  // full-suite-runner (absent-field on a sequential round), this writer makes the field ALWAYS
  // present so a reader can distinguish the three cases — true = overlap ran; false = log readable +
  // marker absent (sequential); null = log absent/unreadable (n/a, never a fabricated boolean).
  record.phase_overlap = detectPhaseOverlap(suiteLog);
  // Concurrency variables (AC1): nproc + slots are deterministic reads; concurrentSuitesRunning =
  // 1 (this round's own slot) + currently-held OTHER-suite slots at WRITE time, capped at the slot
  // count — the same formula + clamp as full-suite-runner's round-start capture (:2591-2596). The
  // fan-in suite already exited, so "other suites still running" ≈ the concurrent pressure this
  // round experienced; a lone round records 1 (matching the full-suite-runner convention).
  const lockRoot = o.root ? path.resolve(String(o.root)) : process.cwd();
  const slots = concurrentSuiteSlots();
  record.nproc = hostParallelism();
  record.concurrentSuiteSlots = slots;
  record.concurrentSuitesRunning = Math.min(1 + countHeldSuiteLocks(lockRoot), slots);
  return { record };
}

/** Append one pre-verified round record to verification-round.jsonl (round = prior lines + 1). */
export function appendPreVerifiedRound(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prior = 0;
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    for (const l of text.split("\n")) if (l.trim()) prior++;
  }
  fs.appendFileSync(file, JSON.stringify({ ...record, round: prior + 1 }) + "\n", "utf8");
}

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `pre-verified-round-record.ts — SHARED AC1/AC2 writer: append ONE verification-round.jsonl
  record for a full-suite round that ran OUTSIDE full-suite-runner.ts (the fan-in detached suite paths):
  the pre-verified branch (suite ran OUTSIDE the fan-in subagent's round, capture reused — preverified:1)
  AND the real-suite branch (suite ran detached inside this fan-in — preverified:0). SuiteRoundRecord-
  compatible; the preverified boolean marks which branch produced the round.

Usage:
  node --experimental-strip-types plugin/scripts/pre-verified-round-record.ts
      --task-id <taskId> --run-id <runId> --started-at <iso> --duration-ms <ms>
      --lane-count <n> --load <n> --commit <sha>
      [--preverified <0|1|true|false>] [--cpu-time-s <n|null>] [--cpu-source <name>]
      [--suite-log <path>] [--runner <name>] [--root <dir>] [--record-file <file>]
      [--json] [--help]

  --task-id         the fan-in task whose suite landed (required)
  --run-id          the fan-in runId (required)
  --started-at      the suite start, ISO-8601 or epoch-seconds (required)
  --duration-ms     the suite wall-clock in ms (required, non-negative)
  --lane-count      suite lane count (required, non-negative)
  --load            /proc/loadavg 1min at the suite's end (required, non-negative)
  --commit          the pinned verified HEAD (suite_head), 40-hex (required)
  --preverified     1/true = reused a caller-produced capture (pre-verified branch); 0/false = the
                    suite RAN inside this fan-in (real-suite branch). Default 1/true.
  --cpu-time-s      the suite's CPU seconds — a real number, or the literal null when the source was
                    considered and UNAVAILABLE (AC6; 0 normalizes to null)
  --cpu-source      WHERE the cpu_time_s came from ('gnu-time' / 'not-wired'; optional)
  --suite-log       the fan-in suite log path — parse its __OVERHEAD__ <phase>_ms=N lines into
                    static/serial/lowconc/main phase fields + record nproc/concurrentSuiteSlots/
                    concurrentSuitesRunning (same 口径 as full-suite-runner). When absent or
                    unreadable the row is EXPLICITLY phase-less (no fabricated fields).
  --runner          nominal runner identity (default 'outer', matching the existing ledger)
  --root            repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file     override the ledger path (hermetic tests)
  --json            machine-readable output {ok, record, file}
  --help            this help

Exit codes:
  0  one record appended
  2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const recordFileOverride = getArgValue(args, "--record-file");
  const asJson = args.includes("--json");

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`pre-verified-round-record: ${msg}`);
    return 2;
  };

  const built = buildPreVerifiedRoundRecord({
    taskId: getArgValue(args, "--task-id"),
    runId: getArgValue(args, "--run-id"),
    startedAt: getArgValue(args, "--started-at"),
    durationMs: getArgValue(args, "--duration-ms"),
    laneCount: getArgValue(args, "--lane-count"),
    load: getArgValue(args, "--load"),
    commit: getArgValue(args, "--commit"),
    preverified: getArgValue(args, "--preverified"),
    cpuTimeS: getArgValue(args, "--cpu-time-s"),
    cpuSource: getArgValue(args, "--cpu-source"),
    runner: getArgValue(args, "--runner"),
    suiteLog: getArgValue(args, "--suite-log"),
    root,
  });
  if (built.error) return fail(built.error);
  const record = built.record;

  let recordFile;
  if (recordFileOverride) {
    recordFile = path.resolve(recordFileOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    recordFile = path.join(shared, ".quay", "verification-round.jsonl");
  }

  try {
    appendPreVerifiedRound(recordFile, record);
  } catch (e) {
    return fail(`append failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: true, record, file: recordFile }));
  } else {
    console.log(`pre-verified-round-record: appended round ${record.round} (${record.taskId} run ${record.runId}) → ${recordFile}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "pre-verified-round-record")) {
  process.exitCode = main(process.argv);
}
