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
  parseBucketMarker,
  parseTestCounts,
  parsePerFile,
  parseCeilingFloor,
  parseRedFailures,
  hostParallelism,
  concurrentSuiteSlots,
  countHeldSuiteLocks,
  effectiveParallelism,
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

test("AC2 — pass/fail/cancelled/tests are ABSENT without a suite log (no fabricated test counts; a reader must not infer 0)", () => {
  // gap-suite-round-pass-fail-cancel-fields: WITHOUT a --suite-log (a pre-verified reuse whose caller
  // recorded no log path) the counts stay ABSENT — a reader renders them null, never a fabricated 0.
  const { record } = buildPreVerifiedRoundRecord(BASE);
  assert.equal(record.pass, undefined, "pass is absent — no log to parse a count from");
  assert.equal(record.fail, undefined, "fail is absent");
  assert.equal(record.cancelled, undefined, "cancelled is absent");
  assert.equal(record.tests, undefined, "tests is absent");
  // The /tests reader renders absent counts as null, not 0 (observation.ts parseVerificationRound) —
  // cross-package coverage lives in packages/quay/test/serve-ac95-views.test.mjs.
});

test("AC2 — pass/fail/cancelled/tests are PARSED from a suite log carrying the node:test spec summary (gap-suite-round-pass-fail-cancel-fields)", () => {
  // The fan-in suite's node:test spec reporter (test.sh dual-reporter stdout, redirected into the log)
  // emits the summary. The writer must parse it so the /tests page + Dashboard card show real counts.
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full",
    "ℹ tests 4288",
    "ℹ pass 4175",
    "ℹ fail 3",
    "ℹ cancelled 0",
    "__OVERHEAD__ serial_phase_ms=301000",
  ]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: log, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.pass, 4175, "pass ← the ℹ pass summary");
  assert.equal(record.fail, 3, "fail ← the ℹ fail summary");
  assert.equal(record.cancelled, 0, "cancelled ← the ℹ cancelled summary");
  assert.equal(record.tests, 4178, "tests = pass+fail+cancelled (the same 口径 full-suite-runner writes — never the ℹ tests line)");
});

test("AC2 — an UNREADABLE/empty suite log leaves pass/fail/cancelled/tests absent (honest, never a fabricated 0)", () => {
  const unreadable = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: "/nonexistent/pvr-missing.log", root: REPO_ROOT }).record;
  assert.equal(unreadable.pass, undefined, "unreadable log → pass absent");
  assert.equal(unreadable.fail, undefined, "unreadable log → fail absent");
  assert.equal(unreadable.cancelled, undefined, "unreadable log → cancelled absent");
  assert.equal(unreadable.tests, undefined, "unreadable log → tests absent");

  // A log WITHOUT any summary block (e.g. a scoped run that emitted no spec summary) also leaves them absent.
  const noSummary = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000"]);
  const noSummaryRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: noSummary, root: REPO_ROOT }).record;
  assert.equal(noSummaryRec.pass, undefined, "a summary-less log → pass absent");
  assert.equal(noSummaryRec.fail, undefined, "a summary-less log → fail absent");
  assert.equal(noSummaryRec.cancelled, undefined, "a summary-less log → cancelled absent");
  assert.equal(noSummaryRec.tests, undefined, "a summary-less log → tests absent");
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

test("gap-wiring-B — the suite's OWN test output mentioning `__FANIN_SUITE_START__` mid-line does NOT break the slice (anchored line-start marker), so the overlap marker stays in view", () => {
  // Real round-347 shape: the emitted marker is line 1; the suite's node:test run prints an assertion
  // description CONTAINING the marker string mid-line; the overlap markers are EARLY (before that
  // test-output line). lastIndexOf(substring) sliced from the test-output line and dropped the overlap
  // markers → phase_overlap=false + lowconc=0 on a genuine overlap log. The anchored slice must keep them.
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-20T19:25:28.290Z ms=1787253928310 head=209cfce7 round=full",
    "overlap: running 33 serial + 26 lowconc files in parallel (serial conc=8, lowconc conc=8)",
    "__OVERHEAD__ overlap_lowconc_ms=282751",
    "__OVERHEAD__ lowconc_phase_ms=0",
    "__OVERHEAD__ serial_phase_ms=282766",
    "✔ gap-fan-in-suite-log-cross-relaunch-reuse — parseSuitePhases slices by the last __FANIN_SUITE_START__ marker (current round only)",
    "__OVERHEAD__ main_phase_ms=235253",
    "__OVERHEAD__ lock_overhead_ms=221306",
  ]);
  assert.equal(detectPhaseOverlap(log), true, "the overlap marker (before the spurious mid-line mention) is still detected");
  const { record } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: log, root: REPO_ROOT });
  assert.equal(record.phase_overlap, true, "phase_overlap:true — the anchored slice keeps the early marker");
  assert.equal(record.lowconc_phase_ms, 282751, "lowconc_phase_ms = the overlap sub-time (the 78/78 defect is fixed even with test-output marker mentions)");
  assert.equal(record.serial_phase_ms, 282766, "the end-burst phases (after the mention) are still parsed");
  assert.equal(record.lock_wait_ms, 221306, "lock_wait_ms falls back to lock_overhead on a pre-marker log");
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
    assert.equal(record.concurrentSuiteSlots, concurrentSuiteSlots(), "concurrentSuiteSlots = the configured slot count (default 1; adaptive under QUAY_MAX_CONCURRENT_SUITES, gap-suite-lock-slot-seam-asymmetry AC2)");
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

// ── gap-wiring-B-verification-round-write-path AC1: lock_wait_ms / effective_parallelism /
//    lowconc_phase_ms ride the REAL landing path (previously only the dead-on-fan-in
//    full-suite-runner.ts wrote them) ─────────────────────────────────────────────────────────────

test("gap-wiring-B AC1 — effective_parallelism rides the record (cpu_time_s ÷ wall, same 口径 as full-suite-runner; absent on null/≤0 cpu_time_s)", () => {
  // The observability-holes finding's real ratio: 7162s cpu / 823s wall = 8.702.
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "7162", cpuSource: "gnu-time", durationMs: "823000" });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.effective_parallelism, 8.702, "effective_parallelism = cpu_time_s / (durationMs/1000), 3 decimals");
  // The second real sample: 6900s / 1421s = 4.856.
  const { record: r2 } = buildPreVerifiedRoundRecord({ ...BASE, cpuTimeS: "6900", cpuSource: "gnu-time", durationMs: "1421000" });
  assert.equal(r2.effective_parallelism, 4.856, "second real sample 6900/1421");
  // Unit: the exported helper mirrors full-suite-runner.effectiveParallelism (null contract).
  assert.equal(effectiveParallelism(7162, 823000), 8.702);
  assert.equal(effectiveParallelism(null, 823000), null, "null cpu_time_s → null (field absent, not a fabricated 0)");
  assert.equal(effectiveParallelism(0, 823000), null, "0 cpu_time_s → null (a 0 would read 'infinite cores')");
  assert.equal(effectiveParallelism(100, 0), null, "non-positive wall → null");
  // A caller that passes no cpu-time-s at all → the field is ABSENT (硬规则⑥ 缺值=未查≠为假).
  const noCpu = buildPreVerifiedRoundRecord({ ...BASE, root: REPO_ROOT }).record;
  assert.equal(noCpu.effective_parallelism, undefined, "no cpu_time_s → effective_parallelism absent");
});

test("gap-wiring-B AC1 — lock_wait_ms rides the record from test.sh's `__OVERHEAD__ lock_wait_ms=N` marker (absent on a marker-less log)", () => {
  const log = writeSuiteLog(null, [
    "== single-flight lock (2 slots — gap-single-flight-lock-2-slot-concurrent-suites + SSoT) ==",
    "__OVERHEAD__ lock_wait_ms=12345",
    "scripts/test.sh: acquired full-suite single-flight slot 0 (.git/full-suite.lock.0) — held for the entire run",
    "__OVERHEAD__ serial_phase_ms=301000",
  ]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: log, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.lock_wait_ms, 12345, "lock_wait_ms ← the __OVERHEAD__ lock_wait_ms marker (the flock START→acquired wall)");

  // Fallback for PRE-MARKER logs: `lock_overhead` (the whole lock-acquire wall incl. the flock wait)
  // is carried as lock_wait_ms — a REAL measurement, not a fabricated 0. This makes the field appear
  // on real full-suite fan-in rounds even when the log predates test.sh's precise marker.
  const preMarkerLog = writeSuiteLog(null, ["__OVERHEAD__ lock_overhead_ms=221306", "__OVERHEAD__ serial_phase_ms=301000"]);
  const preMarker = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: preMarkerLog, root: REPO_ROOT }).record;
  assert.equal(preMarker.lock_wait_ms, 221306, "pre-marker log → lock_wait_ms = lock_overhead (the acquire wall, real)");

  // A log WITHOUT any lock marker (e.g. a scoped/no-lock run that skipped full_suite_lock_acquire) → 缺键.
  const noLockLog = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000"]);
  const noLock = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: noLockLog, root: REPO_ROOT }).record;
  assert.equal(noLock.lock_wait_ms, undefined, "no lock marker → lock_wait_ms absent (缺键, never a fabricated 0)");

  // No log at all → absent (the phase-less contract).
  const noLog = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", root: REPO_ROOT }).record;
  assert.equal(noLog.lock_wait_ms, undefined, "no log → lock_wait_ms absent");
});

test("gap-suite-lock-starvation AC2 — lock_hold_ms rides the record from test.sh's `__OVERHEAD__ lock_hold_ms=N` marker (absent on a marker-less log)", () => {
  // lock_hold_ms (the acquire→release wall) is the HELD half that, with lock_wait_ms (the queued-wait
  // half), lets a reader distinguish「长时间持锁」(validation long task) from「worker 慢 / 排队饿死」.
  const log = writeSuiteLog(null, [
    "__OVERHEAD__ lock_wait_ms=12345",
    "__OVERHEAD__ lock_hold_ms=67890",
    "__OVERHEAD__ serial_phase_ms=301000",
  ]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: log, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.lock_hold_ms, 67890, "lock_hold_ms ← the __OVERHEAD__ lock_hold_ms marker (acquire→release wall)");

  // A log WITHOUT a lock_hold marker (e.g. a pre-cap log, or a scoped/no-lock run) → 缺键, never a fabricated 0.
  const waitOnlyLog = writeSuiteLog(null, ["__OVERHEAD__ lock_wait_ms=12345", "__OVERHEAD__ serial_phase_ms=301000"]);
  const waitOnly = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: waitOnlyLog, root: REPO_ROOT }).record;
  assert.equal(waitOnly.lock_wait_ms, 12345, "lock_wait_ms still present");
  assert.equal(waitOnly.lock_hold_ms, undefined, "no lock_hold marker → lock_hold_ms absent (缺键, never 0)");

  // No log at all → absent.
  const noLog = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", root: REPO_ROOT }).record;
  assert.equal(noLog.lock_hold_ms, undefined, "no log → lock_hold_ms absent");
});

test("gap-wiring-B AC1 — lowconc_phase_ms carries the overlap_lowconc_ms sub-time on an overlap round (no longer the subsumed 0)", () => {
  // On overlap test.sh emits lowconc_phase_ms=0 (subsumed into the serial window) AND the real
  // per-process `__OVERHEAD__ overlap_lowconc_ms=N` sub-time — the record must carry the real value.
  const overlapLog = writeSuiteLog(null, [
    "overlap: running 5 serial + 8 lowconc files in parallel",
    "__OVERHEAD__ lowconc_phase_ms=0",
    "__OVERHEAD__ overlap_lowconc_ms=183000",
    "__OVERHEAD__ serial_phase_ms=301000",
    "__OVERHEAD__ main_phase_ms=512000",
  ]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: overlapLog, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.phase_overlap, true, "overlap marker → phase_overlap:true");
  assert.equal(record.lowconc_phase_ms, 183000, "overlap round → lowconc_phase_ms = the overlap_lowconc sub-time (not the subsumed 0)");

  // A sequential round still records the raw lowconc_phase_ms (no overlap sub-time involved).
  const seqLog = writeSuiteLog(null, ["__OVERHEAD__ lowconc_phase_ms=183000", "__OVERHEAD__ serial_phase_ms=301000"]);
  const seqRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: seqLog, root: REPO_ROOT }).record;
  assert.equal(seqRec.phase_overlap, false, "sequential log → phase_overlap:false");
  assert.equal(seqRec.lowconc_phase_ms, 183000, "sequential round → raw lowconc_phase_ms");

  // An overlap round whose sub-time marker was missed (truncated) falls back to the raw value — honest.
  const missedLog = writeSuiteLog(null, [
    "overlap: running 5 serial + 8 lowconc files in parallel",
    "__OVERHEAD__ lowconc_phase_ms=0",
    "__OVERHEAD__ serial_phase_ms=301000",
  ]);
  const missedRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: missedLog, root: REPO_ROOT }).record;
  assert.equal(missedRec.phase_overlap, true, "overlap marker present");
  assert.equal(missedRec.lowconc_phase_ms, 0, "sub-time marker missed → falls back to the raw lowconc_phase_ms (0) — honest");
});

test("AC1 — the concurrency helpers read the host + QUAY_MAX_CONCURRENT_SUITES the SAME way full-suite-runner does (seams respected)", () => {
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevSlots = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  // Pin the base to an isolated temp dir with NO `.concurrency` file, so the knob this test drives is
  // authoritative — the PRODUCTION scalar (a live-suite S=1 file) would otherwise shadow the knob and
  // break the "0 fails open to default 1" step (gap-suite-slot-ssot-i5-false-positive class).
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-pin-"));
  process.env.FULL_SUITE_LOCK_FILE = path.join(pinTmp, "full-suite.lock");
  try {
    // This test drives the KNOB — clear the seam (read FIRST since gap-suite-lock-slot-seam-asymmetry)
    // so it cannot shadow the knob from an ambient test env.
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    process.env.RESOURCE_GATE_NPROC = "8";
    process.env.QUAY_MAX_CONCURRENT_SUITES = "1";
    assert.equal(hostParallelism(), 8, "RESOURCE_GATE_NPROC is the deterministic nproc seam");
    assert.equal(concurrentSuiteSlots(), 1, "QUAY_MAX_CONCURRENT_SUITES is the slot definition point");
    process.env.QUAY_MAX_CONCURRENT_SUITES = "0";
    assert.equal(concurrentSuiteSlots(), 1, "0 fails open to the single default (never 0 slots)");
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC;
    else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevSlots === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevSlots;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
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

test("CLI — a suite log with the node:test spec summary flows pass/fail/cancelled/tests into the appended record (gap-suite-round-pass-fail-cancel-fields)", () => {
  const file = tmpFile("pvr-counts-");
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full",
    "ℹ pass 4175",
    "ℹ fail 3",
    "ℹ cancelled 0",
    "__OVERHEAD__ serial_phase_ms=301000",
  ]);
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
  assert.equal(out.record.pass, 4175, "CLI record carries pass");
  assert.equal(out.record.fail, 3, "CLI record carries fail");
  assert.equal(out.record.cancelled, 0, "CLI record carries cancelled");
  assert.equal(out.record.tests, 4178, "CLI record carries tests = pass+fail+cancelled");
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.pass, 4175, "appended record: pass present");
  assert.equal(rec.fail, 3, "appended record: fail present");
  assert.equal(rec.cancelled, 0, "appended record: cancelled present");
  assert.equal(rec.tests, 4178, "appended record: tests present");
});

// ── gap-ac126-suite-bucket-execution-enable-wiring AC2/AC3: bucket fields ride the fan-in record ───
// The fan-in suite now passes `--buckets <task-id>` (fan-in-execute.js SUITE_LAUNCH); test.sh emits a
// `__BUCKETS__ buckets=<P|M|P+M|full> files=<n> full=<0|1>` marker into the suite log, and THIS writer
// (the fan-in's verification-round writer) must carry it into the record — closing the ledger gap that
// the direct test.sh run (not full-suite-runner) never wrote bucket fields (AC3). A non-bucket (default
// full) round omits the fields (absent-field contract, same as full-suite-runner).

test("parseBucketMarker — parses the __BUCKETS__ marker (M and full labels) and returns null on absent/unreadable", () => {
  const mLog = writeSuiteLog(null, ["__BUCKETS__ buckets=M files=219 full=0", "__OVERHEAD__ serial_phase_ms=301000"]);
  assert.deepEqual(parseBucketMarker(mLog), { buckets: "M", files: 219 }, "an M-only round → buckets=M files=219");

  const fullLog = writeSuiteLog(null, ["__BUCKETS__ buckets=full files=424 full=1"]);
  assert.deepEqual(parseBucketMarker(fullLog), { buckets: "full", files: 424 }, "a hub/no-bucket round → buckets=full");

  const pMlog = writeSuiteLog(null, ["__BUCKETS__ buckets=P+M files=300 full=0"]);
  assert.deepEqual(parseBucketMarker(pMlog), { buckets: "P+M", files: 300 }, "a P+M round → buckets=P+M");

  const noMarker = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000", "selected 424 files (groups=product,engine)"]);
  assert.equal(parseBucketMarker(noMarker), null, "a default full-suite log (no marker) → null (fields absent)");
  assert.equal(parseBucketMarker(undefined), null, "no log → null");
  assert.equal(parseBucketMarker("/nonexistent/pvr-missing.log"), null, "unreadable log → null");
});

test("parseBucketMarker — slices by the last __FANIN_SUITE_START__ marker (an old round's bucket marker is excluded)", () => {
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=old round=full",
    "__BUCKETS__ buckets=M files=219 full=0",
    "__FANIN_SUITE_START__ iso=2026-08-21T00:10:00.000Z ms=600 head=new round=full",
    "__BUCKETS__ buckets=P files=163 full=0",
  ]);
  assert.deepEqual(parseBucketMarker(log), { buckets: "P", files: 163 }, "only the last round's bucket marker is read");
});

// ── gap-suite-round-pass-fail-cancel-fields: pass/fail/cancelled/tests parsed from the suite log ────

test("parseTestCounts — accumulates pass/fail/cancelled across the per-phase summary blocks (serial→lowconc→main sum, same 口径 as full-suite-runner)", () => {
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full",
    "ℹ tests 629",
    "ℹ pass 628",
    "ℹ fail 0",
    "ℹ cancelled 0",
    "ℹ tests 238",
    "ℹ pass 237",
    "ℹ fail 0",
    "ℹ cancelled 0",
    "ℹ tests 4288",
    "ℹ pass 4175",
    "ℹ fail 3",
    "ℹ cancelled 0",
  ]);
  assert.deepEqual(parseTestCounts(log), { pass: 628 + 237 + 4175, fail: 0 + 0 + 3, cancelled: 0 + 0 + 0 }, "totals are the SUM across the three phase blocks (never the last block)");
});

test("parseTestCounts — accepts both the ℹ spec-reporter and the # TAP prefixes", () => {
  const log = writeSuiteLog(null, [
    "# pass 10",
    "# fail 2",
    "# cancelled 1",
    "ℹ pass 5",
    "ℹ fail 0",
    "ℹ cancelled 0",
  ]);
  assert.deepEqual(parseTestCounts(log), { pass: 15, fail: 2, cancelled: 1 }, "both prefixes accumulate");
});

test("parseTestCounts — slices by the last __FANIN_SUITE_START__ marker (an old round's summary is excluded)", () => {
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=old round=full",
    "ℹ pass 999",
    "ℹ fail 1",
    "ℹ cancelled 0",
    "__FANIN_SUITE_START__ iso=2026-08-21T00:10:00.000Z ms=600 head=new round=full",
    "ℹ pass 42",
    "ℹ fail 0",
    "ℹ cancelled 0",
  ]);
  assert.deepEqual(parseTestCounts(log), { pass: 42, fail: 0, cancelled: 0 }, "only the last round's summary is read");
});

test("parseTestCounts — returns null for a missing/unreadable/summary-less log (distinguishes 'no counts' from '0 tests')", () => {
  assert.equal(parseTestCounts(undefined), null, "no log path → null");
  assert.equal(parseTestCounts(""), null, "empty log path → null");
  assert.equal(parseTestCounts("/nonexistent/pvr-missing.log"), null, "unreadable log → null");
  const noSummary = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000", "selected 424 files (groups=product,engine)"]);
  assert.equal(parseTestCounts(noSummary), null, "a log with no spec summary → null (never {0,0,0})");
});

test("parseTestCounts — strips FORCE_COLOR ANSI so a colorized summary parses to the SAME counts as plain (gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi)", () => {
  // #684/#685 regression: host FORCE_COLOR=3 forces node:test's spec reporter to colorize its
  // summary even when redirected to a file ⇒ `ℹ pass N` arrives as `\x1b[34mℹ pass N\x1b[39m`
  // (ESC at line start). The `^[#ℹ]` anchor then never matched ⇒ parseTestCounts returned null ⇒
  // the four fields were absent. Negative control: the SAME counts parse from a colorized AND a
  // plain log (the ANSI strip is a no-op on plain lines).
  const coloredLog = writeSuiteLog(null, [
    "\x1b[34mℹ pass 628\x1b[39m",
    "\x1b[34mℹ fail 0\x1b[39m",
    "\x1b[34mℹ cancelled 0\x1b[39m",
    "\x1b[34mℹ pass 4175\x1b[39m",
    "\x1b[34mℹ fail 3\x1b[39m",
    "\x1b[34mℹ cancelled 0\x1b[39m",
  ]);
  const plainLog = writeSuiteLog(null, [
    "ℹ pass 628",
    "ℹ fail 0",
    "ℹ cancelled 0",
    "ℹ pass 4175",
    "ℹ fail 3",
    "ℹ cancelled 0",
  ]);
  assert.deepEqual(parseTestCounts(coloredLog), { pass: 628 + 4175, fail: 0 + 3, cancelled: 0 + 0 }, "colorized summary parses to the SUM across blocks");
  assert.deepEqual(parseTestCounts(plainLog), parseTestCounts(coloredLog), "colorized ≡ plain (negative control)");
});

test("AC2/AC3 — buildPreVerifiedRoundRecord carries buckets/bucket_files/bucket_duration_ms on a bucket-mode log (M-only → buckets=M; hub → buckets=full)", () => {
  // M-only replay: the fan-in suite log carries `__BUCKETS__ buckets=M files=219 full=0` → record.buckets=M.
  const mLog = writeSuiteLog(null, ["__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full", "__BUCKETS__ buckets=M files=219 full=0", "__OVERHEAD__ serial_phase_ms=301000"]);
  const mRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: mLog, root: REPO_ROOT }).record;
  assert.equal(mRec.buckets, "M", "an M-only round records buckets=M (AC2)");
  assert.equal(mRec.bucket_files, 219, "bucket_files = the selected M test-file count");
  assert.equal(mRec.bucket_duration_ms, mRec.durationMs, "bucket_duration_ms = the round's own durationMs (the round IS the bucket run)");

  // Hub-touch replay: `__BUCKETS__ buckets=full files=424 full=1` → record.buckets=full.
  const hubLog = writeSuiteLog(null, ["__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full", "__BUCKETS__ buckets=full files=424 full=1"]);
  const hubRec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: hubLog, root: REPO_ROOT }).record;
  assert.equal(hubRec.buckets, "full", "a hub-touch round records buckets=full (AC2)");
  assert.equal(hubRec.bucket_files, 424, "bucket_files = the full suite file count on a 'full' round");
  assert.equal(hubRec.bucket_duration_ms, hubRec.durationMs, "bucket_duration_ms rides the round's own durationMs");
});

test("AC2/AC3 — a NON-bucket (default full) log omits the bucket fields (absent-field contract, never a fabricated value)", () => {
  const seqLog = writeSuiteLog(null, ["__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full", "selected 424 files (groups=product,engine)", "__OVERHEAD__ serial_phase_ms=301000"]);
  const rec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: seqLog, root: REPO_ROOT }).record;
  assert.equal(rec.buckets, undefined, "no __BUCKETS__ marker → buckets absent");
  assert.equal(rec.bucket_files, undefined, "no marker → bucket_files absent");
  assert.equal(rec.bucket_duration_ms, undefined, "no marker → bucket_duration_ms absent");
  // An unreadable / absent log is also phase-less AND bucket-less (never fabricated).
  const noLog = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", root: REPO_ROOT }).record;
  assert.equal(noLog.buckets, undefined, "no log → buckets absent");
});

test("CLI — a bucket-mode --suite-log flows buckets/bucket_files/bucket_duration_ms into the appended record", () => {
  const file = tmpFile("pvr-bucket-");
  const log = writeSuiteLog(null, ["__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full", "__BUCKETS__ buckets=M files=219 full=0"]);
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
  assert.equal(out.record.buckets, "M", "CLI --suite-log parses the __BUCKETS__ marker into buckets");
  assert.equal(out.record.bucket_files, 219, "CLI record carries bucket_files");
  assert.equal(out.record.bucket_duration_ms, Number(BASE.durationMs), "CLI record carries bucket_duration_ms = durationMs");
});

// ── gap-bucket-scoped-worktree-skips-perfile-reporter: perFile/ceiling/floor_ms ride the fan-in record ──
// The bucket-scoped worktree execution path (fan-in detached `bash scripts/test.sh --buckets <task>`)
// writes its verification-round row via THIS writer, not full-suite-runner.ts. Its suite log carries the
// measure-suite-reporter lines (`__PERFILE__ duration_ms=<dur> <path> passed=<bool>` + `__CEILING__ <path>
// duration_ms=<dur> floor_ms=<floor> 封顶者/该拆`), but the writer never parsed them ⇒ perFile/ceiling/
// floor_ms were always absent on the most-used landing path (0 hits across every post-bucket round). The
// fix parses them with the SAME 口径 as full-suite-runner.ts (perFile ← measure-trend-check.parsePerFileLines;
// ceiling/floor_ms ← the same ^__CEILING__ regex at full-suite-runner.ts:2630).

test("parsePerFile — parses __PERFILE__ lines into {file,durationMs,passed}[] with normalizePerFileKey (worktree root stripped to repo-relative)", () => {
  const log = writeSuiteLog(null, [
    "__PERFILE__ duration_ms=123.456 /home/yale/work/quay-worktrees/gap-foo/plugin/test/foo.test.mjs passed=true",
    "__PERFILE__ duration_ms=999.0 /home/yale/work/quay-worktrees/gap-foo/plugin/test/bar.test.mjs passed=false",
  ]);
  const perFile = parsePerFile(log);
  assert.equal(perFile.length, 2, "two __PERFILE__ lines → two records");
  assert.deepEqual(
    perFile[0],
    { file: "plugin/test/foo.test.mjs", durationMs: 123.456, passed: true },
    "normalizePerFileKey strips the quay-worktrees/<task>/ prefix to a repo-relative key",
  );
  assert.deepEqual(
    perFile[1],
    { file: "plugin/test/bar.test.mjs", durationMs: 999, passed: false },
    "a red file carries passed=false",
  );
});

test("parsePerFile — drops duration_ms=0 lines (duration>0 filter, same 口径 as full-suite-runner) and returns [] on absent/unreadable/no-lines", () => {
  const log = writeSuiteLog(null, [
    "__PERFILE__ duration_ms=0 /home/yale/work/quay-worktrees/gap-foo/plugin/test/zero.test.mjs passed=true",
    "__PERFILE__ duration_ms=5 /home/yale/work/quay-worktrees/gap-foo/plugin/test/keep.test.mjs passed=true",
  ]);
  assert.deepEqual(parsePerFile(log), [{ file: "plugin/test/keep.test.mjs", durationMs: 5, passed: true }], "a 0-duration line is filtered out");
  assert.deepEqual(parsePerFile(undefined), [], "no log → []");
  assert.deepEqual(parsePerFile("/nonexistent/pvr-missing.log"), [], "unreadable log → []");
  const noLines = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000", "selected 424 files (groups=product,engine)"]);
  assert.deepEqual(parsePerFile(noLines), [], "a log with no __PERFILE__ lines → []");
});

test("parseCeilingFloor — parses __CEILING__ lines into ceiling (stream order) + floor_ms (DISTINCT floors)", () => {
  const log = writeSuiteLog(null, [
    "__CEILING__ /home/yale/work/quay-worktrees/gap-foo/plugin/test/slow.test.mjs duration_ms=500 floor_ms=123.4 封顶者/该拆",
    "__CEILING__ /home/yale/work/quay-worktrees/gap-foo/plugin/test/slower.test.mjs duration_ms=600 floor_ms=123.4 封顶者/该拆",
    "__CEILING__ /home/yale/work/quay-worktrees/gap-foo/plugin/test/other.test.mjs duration_ms=700 floor_ms=99 封顶者/该拆",
  ]);
  assert.deepEqual(
    parseCeilingFloor(log),
    {
      ceiling: [
        "/home/yale/work/quay-worktrees/gap-foo/plugin/test/slow.test.mjs",
        "/home/yale/work/quay-worktrees/gap-foo/plugin/test/slower.test.mjs",
        "/home/yale/work/quay-worktrees/gap-foo/plugin/test/other.test.mjs",
      ],
      floor_ms: [123.4, 99],
    },
    "ceiling keeps every capped path in stream order; floor_ms keeps DISTINCT group floors (123.4 appears once)",
  );
});

test("parseCeilingFloor — returns null on absent/unreadable (缺值=未查) and an honest empty {[],[]} on a readable log with no __CEILING__ lines", () => {
  assert.equal(parseCeilingFloor(undefined), null, "no log → null");
  assert.equal(parseCeilingFloor("/nonexistent/pvr-missing.log"), null, "unreadable log → null");
  const noLines = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000", "selected 424 files (groups=product,engine)"]);
  assert.deepEqual(parseCeilingFloor(noLines), { ceiling: [], floor_ms: [] }, "a readable log with no __CEILING__ lines → honest empty (fields stay ABSENT)");
});

test("AC1 — buildPreVerifiedRoundRecord carries perFile/ceiling/floor_ms on a bucket-mode log (the fan-in landing path no longer drops them)", () => {
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full",
    "__BUCKETS__ buckets=M files=219 full=0",
    "__PERFILE__ duration_ms=123.456 /home/yale/work/quay-worktrees/gap-foo/plugin/test/foo.test.mjs passed=true",
    "__PERFILE__ duration_ms=999 /home/yale/work/quay-worktrees/gap-foo/plugin/test/bar.test.mjs passed=true",
    "__CEILING__ /home/yale/work/quay-worktrees/gap-foo/plugin/test/slow.test.mjs duration_ms=500 floor_ms=123.4 封顶者/该拆",
  ]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: log, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.deepEqual(
    record.perFile,
    [
      { file: "plugin/test/foo.test.mjs", durationMs: 123.456, passed: true },
      { file: "plugin/test/bar.test.mjs", durationMs: 999, passed: true },
    ],
    "perFile = the parsed __PERFILE__ records (repo-relative keys, same 口径 as full-suite-runner)",
  );
  assert.deepEqual(record.floor_ms, [123.4], "floor_ms = the DISTINCT __CEILING__ floors");
  assert.deepEqual(record.ceiling, ["/home/yale/work/quay-worktrees/gap-foo/plugin/test/slow.test.mjs"], "ceiling = the capped __CEILING__ paths");
});

test("AC1 — a NON-reporter log omits perFile/ceiling/floor_ms (absent-field contract, never a fabricated [])", () => {
  const noLines = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full",
    "__BUCKETS__ buckets=M files=219 full=0",
    "selected 219 files (groups=product,engine)",
    "__OVERHEAD__ serial_phase_ms=301000",
  ]);
  const rec = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", suiteLog: noLines, root: REPO_ROOT }).record;
  assert.equal(rec.perFile, undefined, "no __PERFILE__ lines → perFile absent");
  assert.equal(rec.ceiling, undefined, "no __CEILING__ lines → ceiling absent");
  assert.equal(rec.floor_ms, undefined, "no __CEILING__ lines → floor_ms absent");
  // An absent/unreadable log is also per-file-less (never fabricated).
  const noLog = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", root: REPO_ROOT }).record;
  assert.equal(noLog.perFile, undefined, "no log → perFile absent");
  assert.equal(noLog.ceiling, undefined, "no log → ceiling absent");
  assert.equal(noLog.floor_ms, undefined, "no log → floor_ms absent");
});

test("CLI — a bucket-mode --suite-log flows perFile/ceiling/floor_ms into the appended record", () => {
  const file = tmpFile("pvr-perfile-");
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-21T00:00:00.000Z ms=100 head=x round=full",
    "__BUCKETS__ buckets=M files=219 full=0",
    "__PERFILE__ duration_ms=123.456 /home/yale/work/quay-worktrees/gap-foo/plugin/test/foo.test.mjs passed=true",
    "__CEILING__ /home/yale/work/quay-worktrees/gap-foo/plugin/test/slow.test.mjs duration_ms=500 floor_ms=123.4 封顶者/该拆",
  ]);
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
  assert.deepEqual(out.record.perFile, [{ file: "plugin/test/foo.test.mjs", durationMs: 123.456, passed: true }], "CLI record carries perFile");
  assert.deepEqual(out.record.floor_ms, [123.4], "CLI record carries floor_ms");
  assert.deepEqual(out.record.ceiling, ["/home/yale/work/quay-worktrees/gap-foo/plugin/test/slow.test.mjs"], "CLI record carries ceiling");
});

// ── gap-verification-round-static-fail-no-record: a RED fan-in round lands a record ──────────────────
// The fan-in suite path previously wrote verification-round.jsonl ONLY on the green path — a red round
// (static-check fail-closed / dynamic test fail) left 0 records, so the /tests ledger (and anything else
// that reads verification-round.jsonl) was blind to it. The writer now accepts --state red and carries
// reason/gate/failures (parsed from --suite-log) + the taskId it already had.

test("parseRedFailures — parses STATIC_CHECK_FAILED fail-closed lines into {name,exitCode,line} and test-failure lines via the shared isFailureLine 口径", () => {
  const log = writeSuiteLog(null, [
    "__FANIN_SUITE_START__ iso=2026-08-27T00:00:00.000Z ms=100 head=x round=full",
    "STATIC_CHECK_FAILED: spec-declaration-point-check exit=1",
    "✖ AC1 — resident loop does not exit after one worker (5831.7ms)",
    "ℹ fail 1",
  ]);
  const red = parseRedFailures(log);
  assert.equal(red.staticCheck, true, "a fail-closed checker fired ⇒ staticCheck=true");
  assert.equal(red.failClosed.length, 1, "one STATIC_CHECK_FAILED line → one fail-closed checker");
  assert.equal(red.failClosed[0].name, "spec-declaration-point-check", "the checker name is parsed (AC1: failures[] 含 checker 名)");
  assert.equal(red.failClosed[0].exitCode, 1);
  assert.match(red.failClosed[0].line, /^STATIC_CHECK_FAILED: spec-declaration-point-check exit=1$/);
  assert.ok(red.failureLines.some((l) => /resident loop/.test(l)), "the ✖ test-failure line is also accumulated (isFailureLine 口径)");
});

test("parseRedFailures — an absent/unreadable log returns {staticCheck:false, failClosed:[], failureLines:[]} (honest empty)", () => {
  assert.deepEqual(parseRedFailures(undefined), { staticCheck: false, failClosed: [], failureLines: [] });
  assert.deepEqual(parseRedFailures("/nonexistent/pvr-red-missing.log"), { staticCheck: false, failClosed: [], failureLines: [] });
});

test("AC1 — a red static-check round writes state=red reason=gate-failed gate=static-check + failures[] carrying the checker name", () => {
  const log = writeSuiteLog(null, ["STATIC_CHECK_FAILED: spec-declaration-point-check exit=1"]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", state: "red", suiteLog: log, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.state, "red");
  assert.equal(record.reason, "gate-failed", "a fail-closed checker (fail=0) ⇒ reason=gate-failed");
  assert.equal(record.gate, "static-check", "the named gate is static-check");
  assert.equal(record.failures.length, 1);
  assert.equal(record.failures[0].staticCheck, true);
  assert.match(record.failures[0].line, /spec-declaration-point-check/, "failures[] carries the checker name (AC1)");
  assert.equal(record.taskId, BASE.taskId, "the red record carries taskId (AC3)");
  assert.equal(record.runId, BASE.runId);
});

test("AC2 — a red test-failure round writes state=red reason=failed + failures[] (no gate)", () => {
  const log = writeSuiteLog(null, [
    "✖ AC1 — resident loop does not exit after one worker (5831.7ms)",
    "ℹ fail 1",
  ]);
  const { record, error } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", state: "red", suiteLog: log, root: REPO_ROOT });
  assert.equal(error, undefined, `build must succeed: ${error}`);
  assert.equal(record.state, "red");
  assert.equal(record.reason, "failed", "a test failure ⇒ reason=failed (the reason axis, AC2)");
  assert.equal(record.gate, undefined, "a test failure carries no gate (fail>0 ⇒ reason=failed)");
  assert.ok(record.failures.length > 0, "failures[] carries the matched failure lines");
  assert.ok(record.failures.some((f) => /resident loop/.test(f.line)), "the failing test name rides failures[]");
  assert.equal(record.taskId, BASE.taskId, "the red record carries taskId (AC3)");
});

test("AC4 — a red round with NO parseable failure signal still records reason=failed (fail-closed, never a fabricated gate)", () => {
  const log = writeSuiteLog(null, ["__OVERHEAD__ serial_phase_ms=301000"]); // a red log with no failure line
  const { record } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", state: "red", suiteLog: log, root: REPO_ROOT });
  assert.equal(record.state, "red");
  assert.equal(record.reason, "failed", "a red run IS a failure even when the log's signal shape was unparseable");
  assert.equal(record.gate, undefined, "no gate is fabricated when the cause is unparseable");
  assert.equal(record.failures, undefined, "failures[] absent when no failure line parsed");
});

test("AC4 — the green path is unchanged: no --state ⇒ state=green with no reason/gate/failures (no regression)", () => {
  const { record } = buildPreVerifiedRoundRecord({ ...BASE, preverified: "0", root: REPO_ROOT });
  assert.equal(record.state, "green");
  assert.equal(record.reason, undefined);
  assert.equal(record.gate, undefined);
  assert.equal(record.failures, undefined);
});

test("--state must be green|red (invalid value fail-closed)", () => {
  assert.match(buildPreVerifiedRoundRecord({ ...BASE, state: "blue" }).error ?? "", /--state/);
  assert.equal(buildPreVerifiedRoundRecord({ ...BASE, state: "GREEN" }).record.state, "green", "case-insensitive green accepted");
  assert.equal(buildPreVerifiedRoundRecord({ ...BASE, state: "RED" }).record.state, "red", "case-insensitive red accepted");
});

test("CLI — --state red writes a red static-check record (reason=gate-failed gate=static-check + taskId)", () => {
  const file = tmpFile("pvr-redcli-");
  const log = writeSuiteLog(null, ["STATIC_CHECK_FAILED: spec-declaration-point-check exit=1"]);
  const args = [
    "--task-id", BASE.taskId,
    "--run-id", BASE.runId,
    "--started-at", BASE.startedAt,
    "--duration-ms", BASE.durationMs,
    "--lane-count", BASE.laneCount,
    "--load", BASE.load,
    "--commit", BASE.commit,
    "--preverified", "0",
    "--state", "red",
    "--suite-log", log,
    "--record-file", file,
    "--json",
  ];
  const r = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.record.state, "red");
  assert.equal(out.record.reason, "gate-failed");
  assert.equal(out.record.gate, "static-check");
  assert.equal(out.record.taskId, BASE.taskId);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "one line appended");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.reason, "gate-failed");
  assert.equal(rec.gate, "static-check");
  assert.match(rec.failures[0].line, /spec-declaration-point-check/);
});
