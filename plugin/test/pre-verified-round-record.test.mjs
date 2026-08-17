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
import { spawnSync } from "node:child_process";
import {
  buildPreVerifiedRoundRecord,
  appendPreVerifiedRound,
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
  assert.equal(record.runner, "outer");
  assert.equal(record.taskId, "gap-test-preverified");
  assert.equal(record.runId, "fm-pre-1");
  assert.equal(record.cpu_time_s, 123.456);
  assert.equal(record.cpu_source, "gnu-time");
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
