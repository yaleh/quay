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
//       [--runner <name>] [--root <dir>] [--record-file <file>] [--json] [--help]
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
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveSharedCheckout, toIsoTimestamp } from "./per-task-suite-record.ts";

const COMMIT_RE = /^[0-9a-f]{40}$/i;

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
      [--runner <name>] [--root <dir>] [--record-file <file>] [--json] [--help]

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
