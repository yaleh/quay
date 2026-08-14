#!/usr/bin/env node
// per-task-suite-record.ts — AC72 判据2 writer: append ONE third-party-readable record for a
// per-task FULL-suite run to the SHARED checkout's `.quay/per-task-suite-records.jsonl`.
// (tasks/gap-ac72-cert-mechanism-retire, "cert 机制退役 + per-task suite 结果第三方可读落盘")
//
// The cert mechanism retired under AC72: inner's main thread no longer runs a full suite for every
// returned task (AC67 moved the executor into the task subagent). AC72 判据2 closes the SUCCESS-path
// gap that the protocol left open — AC62 only required a retry record on ff FAILURE; the successful
// path left zero trace, and the only per-task suite evidence lived inside inner's session
// (unreadable by manager/outer/human). This writer makes every per-task full-suite run land ONE
// record containing  taskId / runId / state / laneCount / durationMs / failed-files / 起止时刻.
//
// AC63 判据1 (tasks/gap-ac63-judgment2-no-carrier): the record ALSO carries an OPTIONAL doc-check
// trace — `docChecked` (boolean: did `bash scripts/test.sh --static-checks-doc` run before this
// fan-in's ff) + `docCheckExit` (integer 0..255, the doc check's exit code). The trace is what makes
// "有 ff 而无 doc 检查" (has ff but no doc check) structurally judgeable — before it, lock-events had
// no doc-check field and the judgment could never be false (硬规则 4). The fields are OPTIONAL (NOT in
// REQUIRED_FIELDS) because a pre-AC63 record legitimately has none — and that ABSENCE is the real
// "has ff but no doc check" sample the checker must go RED on. When PRESENT they are fail-closed
// validated: a malformed trace is never written (硬规则 3b).
//
// The record must land where THIRD PARTIES can read it — the SHARED checkout (the main worktree),
// NOT the worktree's own `.quay/` (which is the fork-inherited copy of full-suite-state.json —
// the exact phenomenon AC72 判据2 documents: four in-flight worktrees all showed runId=eac3ee98,
// startedAt=08-13T16:19:54, the inherited copy, not their own measurement). The shared checkout is
// resolved from the git COMMON dir: `git rev-parse --git-common-dir` from a worktree returns
// <main-checkout>/.git, whose parent IS the main checkout. Running inside the main checkout
// resolves to the same directory. `--record-file` overrides for hermetic tests.
//
// Fail-closed (硬规则 3b): a missing/invalid required field exits 2 and writes NOTHING — a partial
// record is never appended (the checker must never see a record it cannot judge as the "合格" shape).
//
// Usage:
//   node --experimental-strip-types plugin/scripts/per-task-suite-record.ts
//       --task-id <taskId> --run-id <runId> --state <state> --lane-count <n>
//       --duration-ms <ms> --started-at <iso> --finished-at <iso>
//       [--failed-files <csv>] [--doc-checked true|false] [--doc-check-exit <0..255>]
//       [--full-suite-ran true|false] [--skip-reason <text>] [--cpu-time-s <n>] [--load <n>]
//       [--phases <json>]
//       [--state-file <full-suite-state.json>] [--root <dir>]
//       [--record-file <file>] [--json] [--help]
//
//   --state-file <file>   read defaults from a full-suite-state.json — runId/state/laneCount/
//                         durationMs/startedAt/finishedAt are taken from it when not given
//                         explicitly (explicit flags win). failed-files are extracted from
//                         `failures[].file` when state=red and --failed-files is absent.
//   --doc-checked         OPTIONAL AC63 判据1 doc-check trace — true|false: did the fan-in's
//                         `--static-checks-doc` run before its ff. Omitted when absent (a
//                         pre-AC63 record has no doc-check trace).
//   --doc-check-exit      OPTIONAL (REQUIRES --doc-checked): the doc check's exit code 0..255.
//   --full-suite-ran      OPTIONAL gap-fan-in-suite-data-not-accounted 判据2 — true|false: did the
//                         fan-in run the FULL suite (vs. skipped it — doc-only delta)? A skip is a
//                         RECORDED DECISION, not a duration-inference. Omitted when absent (a
//                         pre-wiring record legitimately has none).
//   --skip-reason         OPTIONAL (REQUIRES --full-suite-ran false): WHY the full suite was
//                         skipped (e.g. doc-only-delta). A reason without a "full suite skipped"
//                         flag — or with fullSuiteRan true — is ambiguous (硬规则 3b).
//   --cpu-time-s          OPTIONAL — the suite's CPU time in seconds (non-negative; GNU-time
//                         User+System on a full run, 0 when the full suite was skipped).
//   --load                OPTIONAL — the /proc/loadavg 1min load at the suite's end (non-negative).
//   --phases              OPTIONAL — the per-phase DIFFERENTIAL breakdown as a JSON array of
//                         {phase, wall_ms, cpu_usec?, psi_cpu_total?, psi_io_total?, lanes?}
//                         (the gap-phase-boundary-differential-accounting PhaseDiffRecord shape).
//   --record-file <file>  override the shared-checkout record path (hermetic tests point here).
//
// Exit codes:
//   0  one record appended
//   2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

export const REQUIRED_FIELDS = [
  "taskId",
  "runId",
  "state",
  "laneCount",
  "durationMs",
  "startedAt",
  "finishedAt",
] as const;

const VALID_STATES = new Set(["green", "red", "running", "aborted"]);

/** Resolve the SHARED checkout (the main worktree) from a repo root. PURE-ish (runs git once).
 *  `git rev-parse --git-common-dir` from a linked worktree returns <main-checkout>/.git; from the
 *  main checkout itself it returns <root>/.git. The shared checkout is the PARENT of that git dir.
 *  Returns null when the root is not a git repo or the common dir cannot be resolved.
 *  @param {string} root
 *  @returns {string|null} absolute shared-checkout path */
export function resolveSharedCheckout(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  let common = String(r.stdout ?? "").trim();
  if (!common) return null;
  if (!path.isAbsolute(common)) common = path.join(root, common);
  const parent = path.dirname(common);
  return parent;
}

/** Normalize an ISO-8601 (or epoch-seconds) timestamp to an ISO-8601 string. Returns null if invalid.
 *  @param {string|number} v */
export function toIsoTimestamp(v) {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Build the record object from raw CLI values. Returns {record} or {error}. Explicit flags win over
 *  state-file defaults. Missing/invalid REQUIRED field ⇒ fail-closed (error, nothing written).
 *  @param {Record<string, any>} o — parsed CLI values + state-file values */
export function buildRecord(o) {
  const sf = o.stateFile || {};
  const state = o.state ?? sf.state;
  if (state == null || !VALID_STATES.has(String(state))) {
    return { error: `state must be one of ${[...VALID_STATES].join("|")} (got ${JSON.stringify(state)})` };
  }
  const taskId = o.taskId ?? sf.taskId;
  if (!taskId || !String(taskId).trim()) return { error: "--task-id is required" };
  const runId = o.runId ?? sf.runId;
  if (!runId || !String(runId).trim()) return { error: "--run-id is required" };
  const laneCount = o.laneCount ?? sf.laneCount;
  if (laneCount == null || !Number.isFinite(Number(laneCount)) || Number(laneCount) < 0) {
    return { error: `laneCount must be a non-negative number (got ${JSON.stringify(laneCount)})` };
  }
  const durationMs = o.durationMs ?? sf.durationMs;
  if (durationMs == null || !Number.isFinite(Number(durationMs)) || Number(durationMs) < 0) {
    return { error: `durationMs must be a non-negative number (got ${JSON.stringify(durationMs)})` };
  }
  const startedAt = toIsoTimestamp(o.startedAt ?? sf.startedAt);
  if (startedAt == null) return { error: `startedAt must be an ISO/epoch timestamp (got ${JSON.stringify(o.startedAt ?? sf.startedAt)})` };
  const finishedAt = toIsoTimestamp(o.finishedAt ?? sf.finishedAt);
  if (finishedAt == null) return { error: `finishedAt must be an ISO/epoch timestamp (got ${JSON.stringify(o.finishedAt ?? sf.finishedAt)})` };
  // ── doc-check trace (AC63 判据1 — OPTIONAL, fail-closed when present) ────────────────────────────
  // The trace is OPTIONAL (a pre-AC63 record legitimately has none — the "has ff but no doc check"
  // real sample). When given, `--doc-checked` must be a boolean; `--doc-check-exit` must be an
  // integer 0..255 AND REQUIRES `--doc-checked` (an exit code without a "did it run" flag is
  // ambiguous and must not be recorded — 硬规则 3b).
  let docChecked;
  if (o.docChecked != null) {
    const dc = String(o.docChecked).trim().toLowerCase();
    if (dc === "true") docChecked = true;
    else if (dc === "false") docChecked = false;
    else return { error: `--doc-checked must be true|false (got ${JSON.stringify(o.docChecked)})` };
  }
  let docCheckExit;
  if (o.docCheckExit != null) {
    if (docChecked == null) return { error: "--doc-check-exit requires --doc-checked (an exit code without a 'did it run' flag is ambiguous)" };
    const x = Number(o.docCheckExit);
    if (!Number.isInteger(x) || x < 0 || x > 255) return { error: `--doc-check-exit must be an integer 0..255 (got ${JSON.stringify(o.docCheckExit)})` };
    docCheckExit = x;
  }
  // ── full-suite ran/skip trace (gap-fan-in-suite-data-not-accounted — OPTIONAL, fail-closed when
  //    present) ───────────────────────────────────────────────────────────────────────────────
  // The run-vs-skip distinction (判据2). A pre-wiring record legitimately has none — that absence is
  // the exact "skip indistinguishable from a run" gap this task closes (硬规则 4). When present,
  // `--full-suite-ran` must be a real boolean; `--skip-reason` REQUIRES `--full-suite-ran false` (a
  // skip reason without a "full suite was skipped" flag — or with it true — is ambiguous, 硬规则 3b).
  let fullSuiteRan;
  if (o.fullSuiteRan != null) {
    const fr = String(o.fullSuiteRan).trim().toLowerCase();
    if (fr === "true") fullSuiteRan = true;
    else if (fr === "false") fullSuiteRan = false;
    else return { error: `--full-suite-ran must be true|false (got ${JSON.stringify(o.fullSuiteRan)})` };
  }
  let skipReason;
  if (o.skipReason != null) {
    if (fullSuiteRan !== false) return { error: "--skip-reason requires --full-suite-ran false (a skip reason without a 'full suite was skipped' flag is ambiguous)" };
    const sr = String(o.skipReason).trim();
    if (!sr) return { error: "--skip-reason must be a non-empty string (got empty)" };
    skipReason = sr;
  }
  // cpu_time_s / load — non-negative numbers (判据3). load is the /proc/loadavg 1min at suite end.
  let cpuTimeS;
  if (o.cpuTimeS != null) {
    const v = Number(o.cpuTimeS);
    if (!Number.isFinite(v) || v < 0) return { error: `--cpu-time-s must be a non-negative number (got ${JSON.stringify(o.cpuTimeS)})` };
    cpuTimeS = v;
  }
  let load;
  if (o.load != null) {
    const v = Number(o.load);
    if (!Number.isFinite(v) || v < 0) return { error: `--load must be a non-negative number (got ${JSON.stringify(o.load)})` };
    load = v;
  }
  // phases — the per-phase DIFFERENTIAL breakdown (判据3, the AC83 PhaseDiffRecord shape):
  // [{phase, wall_ms, cpu_usec?, psi_cpu_total?, psi_io_total?, lanes?}]. Shape-checked when present.
  let phases;
  if (o.phases != null) {
    let parsed;
    try {
      parsed = JSON.parse(String(o.phases));
    } catch {
      return { error: `--phases must be a valid JSON array of phase records (got ${JSON.stringify(o.phases)})` };
    }
    if (!Array.isArray(parsed)) return { error: "--phases must be a JSON array" };
    const seen = new Set();
    for (const p of parsed) {
      if (p == null || typeof p !== "object") return { error: "--phases entries must be objects" };
      const ph = p.phase;
      if (typeof ph !== "string" || !ph.trim() || seen.has(ph)) {
        return { error: `--phases entries need a unique non-empty phase name (got ${JSON.stringify(ph)})` };
      }
      seen.add(ph);
      if (p.wall_ms == null || !Number.isFinite(Number(p.wall_ms)) || Number(p.wall_ms) < 0) {
        return { error: `--phases entry ${ph} needs a non-negative wall_ms` };
      }
      for (const k of ["cpu_usec", "psi_cpu_total", "psi_io_total", "lanes"]) {
        if (p[k] != null && (!Number.isFinite(Number(p[k])) || Number(p[k]) < 0)) {
          return { error: `--phases entry ${ph}.${k} must be a non-negative number or null (got ${JSON.stringify(p[k])})` };
        }
      }
    }
    phases = parsed;
  }
  let failedFiles = [];
  if (o.failedFiles) {
    failedFiles = String(o.failedFiles).split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(sf.failures)) {
    failedFiles = sf.failures.map((f) => f?.file).filter((f) => typeof f === "string" && f);
  }
  const record = {
    ts: new Date().toISOString(),
    taskId: String(taskId).trim(),
    runId: String(runId).trim(),
    state: String(state),
    laneCount: Number(laneCount),
    durationMs: Number(durationMs),
    failedFiles,
    startedAt,
    finishedAt,
  };
  if (docChecked != null) record.docChecked = docChecked;
  if (docCheckExit != null) record.docCheckExit = docCheckExit;
  // ── full-suite ran/skip + cpu/load/phases trace (gap-fan-in-suite-data-not-accounted) ────────
  // OPTIONAL fields — a pre-wiring record legitimately has none (their absence is the "skip was
  // indistinguishable from a run" gap; a present-but-malformed value never writes, 硬规则 3b).
  if (fullSuiteRan != null) record.fullSuiteRan = fullSuiteRan;
  if (skipReason != null) record.skipReason = skipReason;
  if (cpuTimeS != null) record.cpu_time_s = cpuTimeS;
  if (load != null) record.load = load;
  if (phases != null) record.phases = phases;
  return { record };
}

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `per-task-suite-record.ts — AC72 判据2 writer: append ONE third-party-readable record for a
  per-task FULL-suite run to the SHARED checkout's .quay/per-task-suite-records.jsonl
  (taskId / runId / state / laneCount / durationMs / failed-files / 起止时刻).

Usage:
  node --experimental-strip-types plugin/scripts/per-task-suite-record.ts
      --task-id <taskId> --run-id <runId> --state <state> --lane-count <n>
      --duration-ms <ms> --started-at <iso> --finished-at <iso>
      [--failed-files <csv>] [--doc-checked true|false] [--doc-check-exit <0..255>]
      [--full-suite-ran true|false] [--skip-reason <text>] [--cpu-time-s <n>] [--load <n>]
      [--phases <json>]
      [--state-file <full-suite-state.json>] [--root <dir>]
      [--record-file <file>] [--json] [--help]

  --task-id         the task whose per-task suite ran (required)
  --run-id          the suite runId (required)
  --state           green|red|running|aborted (required)
  --lane-count      suite lane count (required, non-negative)
  --duration-ms     suite wall-clock duration in ms (required, non-negative)
  --started-at      suite start, ISO-8601 or epoch-seconds (required)
  --finished-at     suite end, ISO-8601 or epoch-seconds (required)
  --failed-files    comma-separated failing file paths (optional; auto-extracted from
                    --state-file failures[].file when absent)
  --doc-checked     AC63 判据1 doc-check trace: true|false — did the fan-in's --static-checks-doc
                    run before its ff (optional; omitted when absent)
  --doc-check-exit  the doc check's exit code 0..255 (optional; REQUIRES --doc-checked)
  --full-suite-ran  gap-fan-in-suite-data-not-accounted 判据2: true|false — did the fan-in run the
                    FULL suite vs. skipped it (a skip is a RECORDED DECISION, not a duration-
                    inference). Optional; omitted when absent (pre-wiring record)
  --skip-reason     WHY the full suite was skipped (e.g. doc-only-delta); REQUIRES
                    --full-suite-ran false (a reason without a "skipped" flag is ambiguous)
  --cpu-time-s      the suite's CPU time in seconds (non-negative; GNU-time User+System on a full
                    run, 0 when the full suite was skipped). Optional
  --load            the /proc/loadavg 1min load at suite end (non-negative). Optional
  --phases          the per-phase DIFFERENTIAL breakdown as a JSON array of
                    {phase, wall_ms, cpu_usec?, psi_cpu_total?, psi_io_total?, lanes?}
                    (AC83 PhaseDiffRecord shape). Optional; shape-checked when present
  --state-file      a full-suite-state.json to draw defaults from (explicit flags win)
  --root            repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file     override the shared-checkout record path (hermetic tests)
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
  const stateFile = getArgValue(args, "--state-file");
  const asJson = args.includes("--json");

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`per-task-suite-record: ${msg}`);
    return 2;
  };

  let stateFileValues = {};
  if (stateFile) {
    const p = path.resolve(stateFile);
    if (!fs.existsSync(p)) return fail(`state file not found: ${p}`);
    try {
      stateFileValues = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      return fail(`state file not valid JSON: ${p} (${e.message})`);
    }
  }

  const built = buildRecord({
    taskId: getArgValue(args, "--task-id"),
    runId: getArgValue(args, "--run-id"),
    state: getArgValue(args, "--state"),
    laneCount: getArgValue(args, "--lane-count"),
    durationMs: getArgValue(args, "--duration-ms"),
    failedFiles: getArgValue(args, "--failed-files"),
    startedAt: getArgValue(args, "--started-at"),
    finishedAt: getArgValue(args, "--finished-at"),
    docChecked: getArgValue(args, "--doc-checked"),
    docCheckExit: getArgValue(args, "--doc-check-exit"),
    fullSuiteRan: getArgValue(args, "--full-suite-ran"),
    skipReason: getArgValue(args, "--skip-reason"),
    cpuTimeS: getArgValue(args, "--cpu-time-s"),
    load: getArgValue(args, "--load"),
    phases: getArgValue(args, "--phases"),
    stateFile: stateFileValues,
  });
  if (built.error) return fail(built.error);
  const record = built.record;

  let recordFile;
  if (recordFileOverride) {
    recordFile = path.resolve(recordFileOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    recordFile = path.join(shared, ".quay", "per-task-suite-records.jsonl");
  }

  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.appendFileSync(recordFile, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });

  if (asJson) {
    console.log(JSON.stringify({ ok: true, record, file: recordFile }));
  } else {
    console.log(`per-task-suite-record: appended ${record.taskId} run ${record.runId} (${record.state}) → ${recordFile}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "per-task-suite-record")) {
  process.exitCode = main(process.argv);
}
