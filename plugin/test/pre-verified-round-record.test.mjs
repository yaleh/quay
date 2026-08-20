// @test-group engine
// pre-verified-round-record.test.mjs — gap-preverified-suite-bypasses-verification-round-ledger
// AC1/AC2: the pre-verified-suite path must write verification-round.jsonl (含 preverified 标记) so the
// trend ledger (the /tests page + suite-cost analysis data source) stays visible to the most-used
// landing path. This file pins the NEW equivalent writer (plugin/scripts/pre-verified-round-record.ts)
// — it does NOT modify plugin/scripts/per-task-suite-record.ts (the per-task ledger writer stays
// disjoint, AC3).
//
//   writer       — buildPreVerifiedRoundRecord emits a SuiteRoundRecord-compatible record with
//                  preverified:true + the reused capture's wall-clock (durationMs) + the pinned
//                  suite_head (commit); appendPreVerifiedRound numbers rounds from prior lines + 1;
//                  CLI appends one line to <shared-checkout>/.quay/verification-round.jsonl.
//   fail-closed  — a missing/invalid required field exits 2 and writes NOTHING (硬规则 3b); a
//                  pre-verified round is always state=green (the reuse path requires suite_exit=0).
//   AC3          — the writer targets verification-round.jsonl ONLY; per-task-suite-records.jsonl is
//                  untouched (职责不重复: verification-round = full-suite trend / per-task = per-task).
//   AC2          — pass/fail/cancelled/tests are OMITTED (the pre-verified capture carries no test
//                  counts — a reader must not infer "0 tests ran" from an absent count); the /tests
//                  reader (parseVerificationRound) renders absent counts as null, not 0.
//
// Run:
//   scripts/test.sh plugin/test/pre-verified-round-record.test.mjs
//   node --test plugin/test/pre-verified-round-record.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import {
  buildPreVerifiedRoundRecord,
  appendPreVerifiedRound,
  parseSuitePhases,
  detectPhaseOverlap,
  hostParallelism,
  concurrentSuiteSlots,
  countHeldSuiteLocks,
} from "../scripts/pre-verified-round-record.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WRITER = path.join(REPO_ROOT, "plugin", "scripts", "pre-verified-round-record.ts");

const _tmpDirs = [];
function tmpFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return path.join(dir, "verification-round.jsonl");
}
after(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

const BASE = {
  taskId: "gap-test-preverified",
  runId: "fm-pre-1",
  startedAt: "2026-08-17T04:30:00.000Z",
  durationMs: "936519",
  laneCount: "8",
  load: "8.03",
  commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
};

// ── AC1/AC2: the record shape ──────────────────────────────────────────────────────────────────────

test("AC1/AC2 — buildPreVerifiedRoundRecord emits a SuiteRoundRecord-compatible record with preverified:true (default)", () => {
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "123.456", cpuSource: "gnu-time" });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.preverified, true, "the pre-verified marker defaults to true (backward compat)");
  assert.equal(record.state, "green", "a pre-verified round is green by construction (suite_exit=0)");
  assert.equal(record.startedAt, "2026-08-17T04:30:00.000Z");
  assert.equal(record.durationMs, 936519, "durationMs = the reused capture's wall-clock (AC2 semantics)");
  assert.equal(record.laneCount, 8);
  assert.equal(record.load, 8.03);
  assert.equal(record.scope, "worktree", "the pre-verified suite ran against the task worktree's HEAD");
  assert.equal(record.commit, BASE.commit, "commit = the pinned suite_head (the exact HEAD verified)");
  assert.equal(record.runner, "inner", "default = inner — the fan-in suite is an inner-layer run (same default as mirror-full-suite-state.ts; gap-runner-field-hardcoded-outer-not-measurement)");
  assert.equal(record.taskId, "gap-test-preverified");
  assert.equal(record.runId, "fm-pre-1");
  assert.equal(record.cpu_time_s, 123.456);
  assert.equal(record.cpu_source, "gnu-time");
});

test("AC1 — an explicit --runner override wins over the default (gap-runner-field-hardcoded-outer-not-measurement)", () => {
  // The default flipped to "inner" (the fan-in suite is an inner-layer run); an explicit --runner
  // must still be honored (e.g. a caller that knows the nominal identity differs).
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, runner: "outer" });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.runner, "outer", "explicit --runner outer overrides the default");
  assert.equal(buildPreVerifiedRoundRecord({ ...BASE, runner: "inner" }).record.runner, "inner");
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, runner: "   " }).error ?? "", /--runner/);
});

test("AC1/AC3 — the SHARED writer emits preverified:false for a REAL-suite round (--preverified 0, gap-fan-in-realsuite-bypasses-verification-round-ledger)", () => {
  // The real-suite branch (a full suite that RAN inside this fan-in via the detached test.sh path) must
  // produce a record from the SAME writer — the `preverified` boolean flips to false, every other field
  // stays SuiteRoundRecord-compatible (AC3: 不复制).
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", cpuTimeS: "42.5", cpuSource: "gnu-time" });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.preverified, false, "a real-suite round carries preverified:false (distinct from a reused-capture round)");
  assert.equal(record.state, "green", "a real-suite round is green by construction (the fan-in only writes after suite_exit=0)");
  assert.equal(record.durationMs, 936519, "durationMs = the REAL suite's wall-clock from this fan-in's capture");
  assert.equal(record.scope, "worktree");
  assert.equal(record.commit, BASE.commit, "commit = the pinned suite_head");
  assert.equal(record.cpu_time_s, 42.5);
  assert.equal(record.cpu_source, "gnu-time");
  // boolean + string forms both accepted
  assert.equal(buildPreVerifiedRoundRecord({ ...BASE, preverified: "false" }).record.preverified, false);
  assert.equal(buildPreVerifiedRoundRecord({ ...BASE, preverified: "true" }).record.preverified, true);
  assert.equal(buildPreVerifiedRoundRecord({ ...BASE, preverified: "1" }).record.preverified, true);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, preverified: "maybe" }).error ?? "", /preverified/);
});

test("AC2 — pass/fail/cancelled/tests are OMITTED (no fabricated test counts; a reader must not infer 0)", () => {
  const { record } = buildPreVerifiedRoundRecord(BASE);
  assert.equal(record.pass, undefined, "pass is absent — the capture carries no test count");
  assert.equal(record.fail, undefined, "fail is absent");
  assert.equal(record.cancelled, undefined, "cancelled is absent");
  assert.equal(record.tests, undefined, "tests is absent");
  // The /tests reader renders absent counts as null, not 0 (observation.ts parseVerificationRound) —
  // cross-package coverage lives in packages/quay/test/serve-ac95-views.test.mjs.
});

// ── appendPreVerifiedRound: round numbering ────────────────────────────────────────────────────────

test("appendPreVerifiedRound — numbers rounds from prior line count + 1 (same as appendVerificationRound)", () => {
  const file = tmpFile("pvr-num-");
  const rec1 = buildPreVerifiedRoundRecord(BASE).record;
  appendPreVerifiedRound(file, rec1);
  const rec2 = buildPreVerifiedRoundRecord(BASE).record;
  appendPreVerifiedRound(file, rec2);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).round, 1);
  assert.equal(JSON.parse(lines[1]).round, 2);
});

// ── AC6: cpu_time_s explicit-null discipline ───────────────────────────────────────────────────────

test("AC6 — cpu_time_s null/0 normalizes to explicit null + not-wired (never a silent 0)", () => {
  const nullRec = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "null" });
  assert.equal(nullRec.record.cpu_time_s, null);
  assert.equal(nullRec.record.cpu_source, "not-wired");
  const zeroRec = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "0" });
  assert.equal(zeroRec.record.cpu_time_s, null);
  assert.equal(zeroRec.record.cpu_source, "not-wired");
});

test("AC6 — negative / non-numeric cpu_time_s fail-closed", () => {
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "-1" }).error ?? "", /cpu-time-s/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "abc" }).error ?? "", /cpu-time-s/);
});

// ── gap-verification-round-cpu-split-not-recorded: cpu_user_s / cpu_sys_s ───────────────────────────

test("AC1/AC3 — cpu_user_s/cpu_sys_s ride the record when the capture split the SAME gnu-time line (user+sys ≈ cpu_time_s)", () => {
  // The finding's real values: user=4414.230 sys=6899.653 (sys=61%); cpu_time_s = their sum.
  const { record, error } = buildPreVerifiedRoundRecord({
    ...BASE,
    cpuTimeS: "11313.883",
    cpuSource: "gnu-time",
    cpuUserS: "4414.230",
    cpuSysS: "6899.653",
  });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.cpu_time_s, 11313.883, "cpu_time_s stays the gnu-time sum (existing field preserved)");
  assert.equal(record.cpu_user_s, 4414.230, "cpu_user_s = the gnu-time %U column");
  assert.equal(record.cpu_sys_s, 6899.653, "cpu_sys_s = the gnu-time %S column");
  assert.ok(Math.abs((record.cpu_user_s + record.cpu_sys_s) - record.cpu_time_s) < 0.01, "user+sys ≈ cpu_time_s (AC2)");
});

test("AC6 — an absent split (no args / empty / null / 0) is omitted, never a fabricated 0, never a fail-closed", () => {
  // No split args → no split fields (the existing cpu_time_s-only shape is unchanged).
  const plain = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "42.5", cpuSource: "gnu-time" });
  assert.equal(plain.record.cpu_user_s, undefined, "no split args → cpu_user_s absent");
  assert.equal(plain.record.cpu_sys_s, undefined, "no split args → cpu_sys_s absent");
  // Empty strings (an unset bash capture var on a doc-only skip / not-wired round) → omitted, NOT an error.
  const empty = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "42.5", cpuSource: "gnu-time", cpuUserS: "", cpuSysS: "" });
  assert.equal(empty.error, undefined, "empty split args are 'considered + unavailable', not fail-closed");
  assert.equal(empty.record.cpu_user_s, undefined);
  assert.equal(empty.record.cpu_sys_s, undefined);
  // Literal null / 0 → omitted.
  const nullRec = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "42.5", cpuSource: "gnu-time", cpuUserS: "null", cpuSysS: "0" });
  assert.equal(nullRec.error, undefined);
  assert.equal(nullRec.record.cpu_user_s, undefined);
  assert.equal(nullRec.record.cpu_sys_s, undefined);
});

test("AC1 fail-closed — a REAL split value with a null cpu_time_s is ambiguous ⇒ error (a split without its sum)", () => {
  const r = buildPreVerifiedRoundRecord({
    ...BASE,
    cpuTimeS: "null",
    cpuSource: "not-wired",
    cpuUserS: "4414.230",
    cpuSysS: "6899.653",
  });
  assert.match(r.error ?? "", /cpu-time-s/, "a real split without its sum must fail closed (硬规则 3b)");
});

test("AC6 — negative / non-numeric split values fail-closed", () => {
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "42.5", cpuUserS: "-1" }).error ?? "", /cpu-user-s/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "42.5", cpuSysS: "abc" }).error ?? "", /cpu-sys-s/);
});

// ── 硬规则 3b: fail-closed (nothing written on a missing/invalid field) ─────────────────────────────

test("fail-closed — missing --task-id / --run-id / --commit / --started-at yields an error, never a partial record", () => {
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, taskId: "" }).error ?? "", /task-id/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, runId: undefined }).error ?? "", /run-id/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, startedAt: "not-a-time" }).error ?? "", /started-at/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, commit: "short" }).error ?? "", /commit/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, durationMs: "-5" }).error ?? "", /duration-ms/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, laneCount: "x" }).error ?? "", /lane-count/);
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, load: "-1" }).error ?? "", /load/);
});

// ── CLI: append + fail-closed + --record-file override ─────────────────────────────────────────────

test("CLI — appends ONE valid JSON line with preverified:true; second append adds a second line (append-only)", () => {
  const file = tmpFile("pvr-cli-");
  const args = [
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--record-file", file,
  ];
  const r1 = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);
  const lines1 = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines1.length, 1, "one line appended");
  const rec = JSON.parse(lines1[0]);
  assert.equal(rec.preverified, true);
  assert.equal(rec.state, "green");
  assert.equal(rec.round, 1);
  assert.equal(rec.durationMs, 936519);
  assert.equal(rec.commit, BASE.commit);
  assert.equal(rec.taskId, BASE.taskId);

  const r2 = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const lines2 = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines2.length, 2, "append-only — second run adds a second line");
  assert.equal(JSON.parse(lines2[1]).round, 2, "round numbering continues");
});

test("CLI — --preverified 0 writes a REAL-suite record (preverified:false, gap-fan-in-realsuite-bypasses-verification-round-ledger)", () => {
  const file = tmpFile("pvr-real-");
  const args = [
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--preverified", "0",
    "--cpu-time-s", "42.5",
    "--cpu-source", "gnu-time",
    "--record-file", file,
    "--json",
  ];
  const r = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.record.preverified, false);
  assert.equal(out.record.cpu_time_s, 42.5);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).preverified, false);
});

test("CLI — --cpu-user-s/--cpu-sys-s flow through to the appended record (user+sys ≈ cpu_time_s)", () => {
  const file = tmpFile("pvr-split-");
  const args = [
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--cpu-time-s", "11313.883",
    "--cpu-source", "gnu-time",
    "--cpu-user-s", "4414.230",
    "--cpu-sys-s", "6899.653",
    "--record-file", file,
    "--json",
  ];
  const r = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.record.cpu_time_s, 11313.883);
  assert.equal(out.record.cpu_user_s, 4414.230);
  assert.equal(out.record.cpu_sys_s, 6899.653);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.ok(Math.abs((rec.cpu_user_s + rec.cpu_sys_s) - rec.cpu_time_s) < 0.01, "appended record: user+sys ≈ cpu_time_s (AC2)");
});

test("CLI — an empty --cpu-user-s '' (unset capture var) is not fail-closed on a real cpu_time_s", () => {
  const file = tmpFile("pvr-empty-split-");
  const args = [
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--cpu-time-s", "42.5",
    "--cpu-source", "gnu-time",
    "--cpu-user-s", "",
    "--cpu-sys-s", "",
    "--record-file", file,
    "--json",
  ];
  const r = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `empty split args must not fail: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.record.cpu_time_s, 42.5);
  assert.equal(out.record.cpu_user_s, undefined, "empty split arg → field absent");
  assert.equal(out.record.cpu_sys_s, undefined);
});

test("CLI — fail-closed on a missing required field (exit 2, nothing written)", () => {
  const file = tmpFile("pvr-fail-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    // --commit missing
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `must fail-closed on missing --commit: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false, "nothing written on a fail-closed field error");
});

test("CLI — --json returns {ok, record, file}", () => {
  const file = tmpFile("pvr-json-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--record-file", file,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.record.preverified, true);
  assert.equal(out.file, file);
});

// ── AC3: 职责不重复 — the writer targets verification-round.jsonl ONLY ─────────────────────────────

test("AC3 — the record lands in verification-round.jsonl, NOT per-task-suite-records.jsonl (the two ledgers stay disjoint)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-disjoint-"));
  _tmpDirs.push(dir);
  const roundFile = path.join(dir, "verification-round.jsonl");
  const perTaskFile = path.join(dir, "per-task-suite-records.jsonl");
  const rec = buildPreVerifiedRoundRecord(BASE).record;
  appendPreVerifiedRound(roundFile, rec);
  assert.ok(fs.existsSync(roundFile), "verification-round.jsonl was written");
  assert.equal(fs.existsSync(perTaskFile), false, "per-task-suite-records.jsonl was NOT touched (AC3)");
});

// ── gap-fan-in-verification-round-thin-schema-phase-gap: 相字段 + 并发变量 ──────────────────────────

/** Write a fake fan-in suite log carrying test.sh's `__OVERHEAD__ <phase>_ms=N` lines. */
function writeSuiteLog(t, phaseLines = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-log-"));
  _tmpDirs.push(dir);
  const log = path.join(dir, "suite.log");
  fs.writeFileSync(log, phaseLines.join("\n") + "\n", "utf8");
  return log;
}

test("AC1 — parseSuitePhases extracts serial/main/static/lowconc phase ms from the suite log's __OVERHEAD__ lines (partial=1 tolerated)", () => {
  const log = writeSuiteLog(null, [
    "__OVERHEAD__ run_static_checks_ms=1234",
    "__OVERHEAD__ serial_phase_ms=301234",
    "__OVERHEAD__ lowconc_phase_ms=0",
    "__OVERHEAD__ main_phase_ms=512345 partial=1",
    "  not an overhead line",
    "__OVERHEAD__ build_dist_ms=479", // a non-phase label is kept but not mapped to the record
  ]);
  const phases = parseSuitePhases(log);
  assert.equal(phases.run_static_checks, 1234, "static phase = run_static_checks_ms");
  assert.equal(phases.serial_phase, 301234, "serial phase = serial_phase_ms");
  assert.equal(phases.lowconc_phase, 0, "lowconc phase = lowconc_phase_ms (0 is a real value, kept)");
  assert.equal(phases.main_phase, 512345, "main phase = main_phase_ms, partial=1 suffix tolerated");
  assert.equal(phases.build_dist, 479, "other __OVERHEAD__ labels are accumulated too (full-suite-runner parity)");
});

test("gap-fan-in-suite-log-cross-relaunch-reuse — parseSuitePhases slices by the last __FANIN_SUITE_START__ marker (current round only; stale old-round phases excluded)", () => {
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-19T00:00:00.000Z ms=100 head=old round=full",
    "__OVERHEAD__ run_static_checks_ms=1111",
    "__OVERHEAD__ serial_phase_ms=2222",
    "__FANIN_SUITE_START__ iso=2026-08-19T00:10:00.000Z ms=600 head=new round=full",
    "__OVERHEAD__ run_static_checks_ms=3333",
    "__OVERHEAD__ main_phase_ms=4444",
  ]);
  const phases = parseSuitePhases(log);
  assert.deepEqual(
    phases,
    { run_static_checks: 3333, main_phase: 4444 },
    "only the last-marker round's __OVERHEAD__ lines are parsed; the old round's 1111/2222 are excluded",
  );
});

test("AC1 — parseSuitePhases returns {} for a missing or unreadable log (never fabricates a phase)", () => {
  assert.deepEqual(parseSuitePhases(undefined), {}, "no log path → no phases");
  assert.deepEqual(parseSuitePhases(""), {}, "empty log path → no phases");
  assert.deepEqual(parseSuitePhases("/nonexistent/pvr-suite.log"), {}, "unreadable log → no phases");
});

// ── gap-phase-overlap-field-always-false-negative: phase_overlap on the fan-in landing path ────────

test("detectPhaseOverlap — the `overlap: running` marker → true; a readable log WITHOUT it → false; absent/unreadable log → null (n/a, never fabricated)", () => {
  const overlapLog = writeSuiteLog(null, ["overlap: running 5 serial + 8 lowconc files in parallel (serial conc=2, lowconc conc=3)"]);
  assert.equal(detectPhaseOverlap(overlapLog), true, "marker present → overlap ran");
  const seqLog = writeSuiteLog(null, ["selected 3 files (groups=serial)", "__GROUP__ concurrency=2 files=3 sum_ms=100"]);
  assert.equal(detectPhaseOverlap(seqLog), false, "readable log, no marker → sequential");
  assert.equal(detectPhaseOverlap(undefined), null, "no log path → n/a (cannot determine)");
  assert.equal(detectPhaseOverlap(""), null, "empty log path → n/a");
  assert.equal(detectPhaseOverlap("/nonexistent/pvr-missing.log"), null, "unreadable log → n/a");
});

test("gap-phase-overlap-field-always-false-negative — the record ALWAYS carries phase_overlap: true (overlap log), false (sequential log), null (no log)", () => {
  const overlapLog = writeSuiteLog(null, ["overlap: running 5 serial + 8 lowconc files in parallel", "__OVERHEAD__ serial_phase_ms=301000", "__OVERHEAD__ main_phase_ms=512000"]);
  const overlapRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: overlapLog, root: REPO_ROOT }).record;
  assert.equal(overlapRec.phase_overlap, true, "overlap marker → phase_overlap:true (the DoD's real fan-in round)");

  const seqLog = writeSuiteLog(null, ["selected 3 files (groups=serial)", "__OVERHEAD__ serial_phase_ms=301000"]);
  const seqRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: seqLog, root: REPO_ROOT }).record;
  assert.equal(seqRec.phase_overlap, false, "sequential log → phase_overlap:false (field present, distinguishes baseline)");

  const noLogRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "1", root: REPO_ROOT }).record;
  assert.equal(noLogRec.phase_overlap, null, "no log → phase_overlap:null (field present, value n/a)");

  const unreadableRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: "/nonexistent/pvr-missing.log", root: REPO_ROOT }).record;
  assert.equal(unreadableRec.phase_overlap, null, "unreadable log → phase_overlap:null");
});

test("AC1 — a REAL-suite record (preverified:0) with a suite log carries serial/main/static phase ms + nproc/concurrentSuiteSlots/concurrentSuitesRunning (same 口径 as full-suite-runner)", () => {
  const log = writeSuiteLog(null, [
    "__OVERHEAD__ run_static_checks_ms=12000",
    "__OVERHEAD__ serial_phase_ms=301000",
    "__OVERHEAD__ lowconc_phase_ms=0",
    "__OVERHEAD__ main_phase_ms=512000",
  ]);
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  process.env.FULL_SUITE_LOCK_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pvr-lock-")), "full-suite.lock");
  _tmpDirs.push(path.dirname(process.env.FULL_SUITE_LOCK_FILE));
  try {
    const { record, error } = buildPreVerifiedRoundRecord({
      ...BASE, preverified: "0", suiteLog: log, root: REPO_ROOT,
    });
    assert.equal(error, undefined, `build must succeed: ${error}`);
    assert.equal(record.preverified, false);
    assert.equal(record.static_phase_ms, 12000, "static_phase_ms ← run_static_checks_ms");
    assert.equal(record.serial_phase_ms, 301000, "serial_phase_ms ← serial_phase_ms");
    assert.equal(record.lowconc_phase_ms, 0, "lowconc_phase_ms ← lowconc_phase_ms");
    assert.equal(record.main_phase_ms, 512000, "main_phase_ms ← main_phase_ms");
    assert.equal(typeof record.nproc, "number", "nproc is a number (read-host)");
    assert.equal(record.concurrentSuiteSlots, concurrentSuiteSlots(), "concurrentSuiteSlots = the configured slot count (default 2; adaptive under QUAY_MAX_CONCURRENT_SUITES=1, gap-suite-lock-slot-seam-asymmetry AC2)");
    assert.equal(record.concurrentSuitesRunning, 1, "a lone round (no held other-suite slot) records concurrentSuitesRunning=1");
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
  }
});

test("AC2 — preverified=1 branch 单独定案: a reused capture WITH a recorded suite log carries phase fields; WITHOUT one records NONE (honest, not fabricated)", () => {
  // (a) the caller recorded its suite log path ⇒ the preverified round parses phases from it.
  const log = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000", "__OVERHEAD__ main_phase_ms=512000"]);
  const withLog = buildPreVerifiedRoundRecord({ ...BASE, preverified: "1", suiteLog: log, root: REPO_ROOT }).record;
  assert.equal(withLog.preverified, true);
  assert.equal(withLog.serial_phase_ms, 301000, "preverified round WITH a caller-recorded log carries phase data");
  assert.equal(withLog.main_phase_ms, 512000);

  // (b) the reused capture carries NO suite log ⇒ the row is EXPLICITLY phase-less (AC2: 不伪造).
  const withoutLog = buildPreVerifiedRoundRecord({ ...BASE, preverified: "1", root: REPO_ROOT }).record;
  assert.equal(withoutLog.preverified, true);
  assert.equal(withoutLog.static_phase_ms, undefined, "no log → no static phase field");
  assert.equal(withoutLog.serial_phase_ms, undefined, "no log → no serial phase field");
  assert.equal(withoutLog.lowconc_phase_ms, undefined, "no log → no lowconc phase field");
  assert.equal(withoutLog.main_phase_ms, undefined, "no log → no main phase field");
  // The concurrency variables ARE still present (they do not depend on the log).
  assert.equal(typeof withoutLog.nproc, "number", "nproc present regardless of log availability");
});

test("AC1 — a real-suite record with an UNREADABLE suite log records phase-less (absent-field contract, never a fabricated 0)", () => {
  const { record } = buildPreVerifiedRoundRecord({
    ...BASE, preverified: "0", suiteLog: "/nonexistent/pvr-missing.log", root: REPO_ROOT,
  });
  assert.equal(record.serial_phase_ms, undefined, "unreadable log → no serial phase");
  assert.equal(record.main_phase_ms, undefined, "unreadable log → no main phase");
});

test("AC1 — the concurrency helpers read the host + QUAY_MAX_CONCURRENT_SUITES the SAME way full-suite-runner does (seams respected)", () => {
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevSlots = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  try {
    // This test drives the KNOB — clear the seam (read FIRST since gap-suite-lock-slot-seam-asymmetry)
    // so it cannot shadow the knob from an ambient test env.
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    process.env.RESOURCE_GATE_NPROC = "8";
    process.env.QUAY_MAX_CONCURRENT_SUITES = "1";
    assert.equal(hostParallelism(), 8, "RESOURCE_GATE_NPROC is the deterministic nproc seam");
    assert.equal(concurrentSuiteSlots(), 1, "QUAY_MAX_CONCURRENT_SUITES is the slot definition point");
    process.env.QUAY_MAX_CONCURRENT_SUITES = "0";
    assert.equal(concurrentSuiteSlots(), 2, "0 fails open to the single default (never 0 slots)");
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC;
    else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevSlots === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevSlots;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
  }
});

test("AC1 — concurrentSuitesRunning=2 when another suite holds a slot [negative control, FULL_SUITE_LOCK_FILE seam]", async () => {
  const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-held-"));
  _tmpDirs.push(lockDir);
  const lockFile = path.join(lockDir, "full-suite.lock");
  const holder = spawn("flock", [lockFile + ".0", "-c", "sleep 30"], { stdio: "ignore", detached: true });
  try {
    await new Promise((r) => setTimeout(r, 250)); // let flock actually take the slot
    const prevLock = process.env.FULL_SUITE_LOCK_FILE;
    process.env.FULL_SUITE_LOCK_FILE = lockFile;
    try {
      assert.equal(countHeldSuiteLocks(REPO_ROOT), 1, "the held other-suite slot is probed (seam self-check)");
      const { record } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", root: REPO_ROOT });
      assert.equal(record.concurrentSuitesRunning, Math.min(2, concurrentSuiteSlots()), "concurrentSuitesRunning = min(1 + held-other-suite, slots) — 2 when S>=2, 1 when S=1 (adaptive, gap-suite-lock-slot-seam-asymmetry AC2)");
    } finally {
      if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
      else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    }
  } finally {
    try { process.kill(-holder.pid, "SIGKILL"); } catch { /* already gone */ }
    try { holder.kill("SIGKILL"); } catch { /* already gone */ }
  }
});

test("CLI — --suite-log wires the phase fields through to the appended record (real-suite branch)", () => {
  const file = tmpFile("pvr-phcli-");
  const log = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000", "__OVERHEAD__ main_phase_ms=512000"]);
  const args = [
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--preverified", "0",
    "--suite-log", log,
    "--record-file", file,
    "--json",
  ];
  const r = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.record.serial_phase_ms, 301000, "CLI --suite-log parses serial_phase_ms");
  assert.equal(out.record.main_phase_ms, 512000, "CLI --suite-log parses main_phase_ms");
  assert.equal(typeof out.record.nproc, "number", "CLI record carries nproc");
});
