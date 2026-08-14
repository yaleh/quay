// @test-group engine
// fan-in-ff-protocol-check.test.mjs — AC62 protocol checker (判据2 能取假 / 判据3 失败路径),
// plugin/scripts/fan-in-ff-protocol-check.ts. The negative-control fixtures prove the checker can
// go RED on exactly the two protocol violations the SPEC requires (判据2), plus 判据3's retry-record
// shape, and that it reports NOT-EVALUATED (never conflated with green, 硬规则 3b) when it cannot
// judge.
//
//   RED  non-ff fan-in merge on develop (after the protocol baseline)
//   RED  suite call inside the locked section (a lock-hold interval overlapping the suite run)
//   RED  malformed ff retry record
//   NOT-EVALUATED  without a baseline (cannot tell a new non-ff fan-in from pre-protocol history)
//   NOT-EVALUATED  malformed/unpaired lock events (cannot build hold intervals)
//   PASS  clean repo / well-formed records / non-overlapping intervals
//
// Run:
//   scripts/test.sh plugin/test/fan-in-ff-protocol-check.test.mjs
//   node --test plugin/test/fan-in-ff-protocol-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  checkNonFfFanIn,
  buildLockHoldIntervals,
  checkSuiteInLock,
  checkLockHoldDuration,
  checkRetryRecordShape,
  FAN_IN_MERGE_SUBJECT_RE,
} from "../scripts/fan-in-ff-protocol-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ff-protocol-check.ts");

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

function gitCmd(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fanincheck-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "fanincheck-test");
  gitCmd(dir, "config", "user.email", "fic@example.com");
  gitCmd(dir, "branch", "-M", "master");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
}

function runChecker(args) {
  // --json is always passed so the tests can parse the machine-readable verdict; --help short-
  // circuits before JSON output (usage text on stdout), which the --help test asserts.
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--json", ...args], { encoding: "utf8" });
}

function jsonOut(r) {
  return JSON.parse(r.stdout);
}

// ── pure 判据2a: non-ff fan-in on develop ─────────────────────────────────────────────────────────────

test("PURE checkNonFfFanIn — a fan-in merge subject (convention or git auto) is a violation; empty is clean", () => {
  assert.equal(checkNonFfFanIn([]).ok, true);
  assert.equal(checkNonFfFanIn(["chore: x", "fix: y"]).ok, true);
  const v = checkNonFfFanIn(["chore: x", "merge: fan-in task/gap-a (runId: fm-1)"]);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "non-ff-fan-in-merge-on-develop");
  assert.deepEqual(v.violations, ["merge: fan-in task/gap-a (runId: fm-1)"]);
  // git's own auto subject for a task-branch merge is also a violation (it is a --no-ff merge).
  const v2 = checkNonFfFanIn(["Merge branch 'task/gap-b'"]);
  assert.equal(v2.ok, false);
  assert.ok(FAN_IN_MERGE_SUBJECT_RE.test("merge: fan-in task/x"), "convention subject matches");
  assert.ok(FAN_IN_MERGE_SUBJECT_RE.test("Merge branch 'task/y'"), "git auto subject matches");
  assert.ok(!FAN_IN_MERGE_SUBJECT_RE.test("chore: unrelated"), "unrelated subject does not match");
});

test("PURE buildLockHoldIntervals — pairs acquire/release; unpaired or unparseable ⇒ malformed", () => {
  const ok = buildLockHoldIntervals([
    { event: "acquire", epoch: 100, taskId: "a", pid: 1 },
    { event: "release", epoch: 101, taskId: "a", pid: 1 },
  ]);
  assert.equal(ok.malformed, false);
  assert.deepEqual(ok.intervals, [{ start: 100, end: 101, key: "a|1" }]);
  // release without acquire
  const bad = buildLockHoldIntervals([{ event: "release", epoch: 100, taskId: "a", pid: 1 }]);
  assert.equal(bad.malformed, true);
  // unclosed acquire
  const bad2 = buildLockHoldIntervals([{ event: "acquire", epoch: 100, taskId: "a", pid: 1 }]);
  assert.equal(bad2.malformed, true);
  // non-numeric epoch
  const bad3 = buildLockHoldIntervals([{ event: "acquire", epoch: "x", taskId: "a", pid: 1 }]);
  assert.equal(bad3.malformed, true);
});

test("PURE checkSuiteInLock — overlap ⇒ red; disjoint ⇒ clean; no suite-run ⇒ not-evaluated", () => {
  const hold = [{ start: 100, end: 101 }];
  const overlap = checkSuiteInLock(hold, { start: 90, end: 200 });
  assert.equal(overlap.ok, false);
  assert.equal(overlap.reason, "suite-call-inside-merge-lock");
  const disjoint = checkSuiteInLock(hold, { start: 500, end: 600 });
  assert.equal(disjoint.ok, true);
  assert.equal(disjoint.reason, "no-suite-lock-overlap");
  const noRun = checkSuiteInLock(hold, null);
  assert.equal(noRun.evaluated, false, "no suite-run interval ⇒ NOT-EVALUATED");
});

test("PURE checkRetryRecordShape — well-formed passes; missing/int-malformed/hex-malformed/ts-malformed red", () => {
  const good = { taskId: "a", attempt: 2, developHead: "a".repeat(40), ts: "2026-08-14T03:00:00Z" };
  assert.equal(checkRetryRecordShape([good]).ok, true);
  assert.equal(checkRetryRecordShape([]).ok, true);
  assert.equal(checkRetryRecordShape([{ ...good, taskId: "" }]).ok, false);
  assert.equal(checkRetryRecordShape([{ ...good, attempt: 0 }]).ok, false, "attempt must be ≥ 1");
  assert.equal(checkRetryRecordShape([{ ...good, attempt: "1" }]).ok, false, "attempt must be an int");
  assert.equal(checkRetryRecordShape([{ ...good, developHead: "xyz" }]).ok, false, "developHead must be 40-hex");
  assert.equal(checkRetryRecordShape([{ ...good, ts: "yesterday" }]).ok, false, "ts must be ISO …Z");
});

// ── 判据2a integration: non-ff fan-in on develop after the baseline ⇒ RED (exit 1) ────────────────────

test("判据2a — a --no-ff fan-in merge on develop after the baseline ⇒ RED (exit 1)", () => {
  const dir = makeTmp("a2a");
  try {
    initRepo(dir);
    const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    gitCmd(dir, "checkout", "-q", "-b", "task/violation");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "task work");
    gitCmd(dir, "checkout", "-q", "master");
    const merge = gitCmd(dir, "merge", "-q", "--no-ff", "task/violation", "-m", "merge: fan-in task/violation (runId: fm-x)");
    assert.equal(merge.status, 0, "seed the non-ff fan-in merge");

    const r = runChecker(["--root", dir, "--baseline", base, "--develop", "master"]);
    assert.equal(r.status, 1, `checker must be RED: ${r.stdout}${r.stderr}`);
    const out = jsonOut(r);
    assert.equal(out.ok, false);
    assert.equal(out.reason, "protocol-violation");
    const nonFf = out.checks.find((c) => c.check === "non-ff-fan-in");
    assert.equal(nonFf.ok, false);
    assert.equal(nonFf.evaluated, true);
    assert.ok(nonFf.violations.length >= 1, "names the violating merge commit");
  } finally {
    cleanup(dir);
  }
});

test("判据2a negative control — a repo with NO fan-in merge after the baseline ⇒ PASS", () => {
  const dir = makeTmp("a2clean");
  try {
    initRepo(dir);
    const base = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
    fs.writeFileSync(path.join(dir, "more.txt"), "more\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "normal commit, no fan-in merge");
    const r = runChecker(["--root", dir, "--baseline", base, "--develop", "master"]);
    assert.equal(r.status, 0, `clean repo must pass: ${r.stdout}${r.stderr}`);
    const nonFf = jsonOut(r).checks.find((c) => c.check === "non-ff-fan-in");
    assert.equal(nonFf.ok, true);
    assert.equal(nonFf.evaluated, true);
  } finally {
    cleanup(dir);
  }
});

test("判据2a — WITHOUT a baseline ⇒ NOT-EVALUATED (exit 0, evaluated:false — never conflated with green)", () => {
  const dir = makeTmp("a2nb");
  try {
    initRepo(dir);
    const r = runChecker(["--root", dir, "--develop", "master"]);
    assert.equal(r.status, 0);
    const out = jsonOut(r);
    const nonFf = out.checks.find((c) => c.check === "non-ff-fan-in");
    assert.equal(nonFf.evaluated, false);
    assert.equal(nonFf.ok, true, "not-evaluated must not be reported as red");
    assert.equal(nonFf.reason, "no-baseline (NOT-EVALUATED)");
  } finally {
    cleanup(dir);
  }
});

// ── 判据2b integration: suite call inside the locked section ⇒ RED (exit 1) ───────────────────────────

test("判据2b — a lock-hold interval overlapping the suite run ⇒ RED (exit 1)", () => {
  const dir = makeTmp("a2b");
  const st = makeTmp("a2bstate");
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(st, ".quay"), { recursive: true });
    const events = path.join(st, ".quay", "fan-in-merge-lock-events.jsonl");
    const suite = path.join(st, ".quay", "full-suite-state.json");
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", ts: "2026-08-14T03:10:00Z", epoch: 1786677000, taskId: "t1", pid: 1 }),
      JSON.stringify({ event: "release", ts: "2026-08-14T03:10:01Z", epoch: 1786677001, taskId: "t1", pid: 1 }),
    ].join("\n") + "\n", "utf8");
    fs.writeFileSync(suite, JSON.stringify({ state: "green", startedAt: "2026-08-14T03:09:50Z", finishedAt: 1786677100, scope: "main" }), "utf8");

    const r = runChecker(["--root", dir, "--lock-events", events, "--suite-state", suite]);
    assert.equal(r.status, 1, `overlap must be RED: ${r.stdout}${r.stderr}`);
    const lock = jsonOut(r).checks.find((c) => c.check === "suite-in-lock");
    assert.equal(lock.ok, false);
    assert.equal(lock.evaluated, true);
    assert.equal(lock.reason, "suite-call-inside-merge-lock");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("判据2b negative control — a lock-hold interval DISJOINT from the suite run ⇒ PASS", () => {
  const dir = makeTmp("a2bclean");
  const st = makeTmp("a2bcleanstate");
  try {
    initRepo(dir);
    fs.mkdirSync(path.join(st, ".quay"), { recursive: true });
    const events = path.join(st, ".quay", "events.jsonl");
    const suite = path.join(st, ".quay", "state.json");
    // Hold at 03:10:00–01; suite ran 02:00:00–03:00:00 (already finished, no overlap).
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", ts: "2026-08-14T03:10:00Z", epoch: 1786677000, taskId: "t1", pid: 1 }),
      JSON.stringify({ event: "release", ts: "2026-08-14T03:10:01Z", epoch: 1786677001, taskId: "t1", pid: 1 }),
    ].join("\n") + "\n", "utf8");
    fs.writeFileSync(suite, JSON.stringify({ state: "green", startedAt: "2026-08-14T02:00:00Z", finishedAt: 1786672800, scope: "main" }), "utf8");

    const r = runChecker(["--root", dir, "--lock-events", events, "--suite-state", suite]);
    assert.equal(r.status, 0, `disjoint must pass: ${r.stdout}${r.stderr}`);
    const lock = jsonOut(r).checks.find((c) => c.check === "suite-in-lock");
    assert.equal(lock.ok, true);
    assert.equal(lock.evaluated, true);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("判据2b — unpaired lock events (release without acquire) ⇒ NOT-EVALUATED, not red", () => {
  const dir = makeTmp("a2bmal");
  const st = makeTmp("a2bmalstate");
  try {
    initRepo(dir);
    const events = path.join(st, "events.jsonl");
    fs.writeFileSync(events, JSON.stringify({ event: "release", ts: "2026-08-14T03:10:00Z", epoch: 1786677000, taskId: "t1", pid: 1 }) + "\n", "utf8");
    const r = runChecker(["--root", dir, "--lock-events", events]);
    assert.equal(r.status, 0, "malformed lock events must NOT be red (cannot build intervals)");
    const lock = jsonOut(r).checks.find((c) => c.check === "suite-in-lock");
    assert.equal(lock.evaluated, false);
    assert.equal(lock.ok, true);
    assert.match(lock.reason, /unpaired-lock-events/);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── 判据1 (AC66: AC62 判据1 产物) — lock-hold covers ONLY the ff ─────────────────────────────────────

test("PURE checkLockHoldDuration — a long hold (not-ff) ⇒ red; ms-scale holds ⇒ clean; no intervals ⇒ not-evaluated", () => {
  const v = checkLockHoldDuration([], 60);
  assert.equal(v.evaluated, false);
  assert.equal(v.ok, true);
  assert.equal(v.reason, "no-lock-hold-intervals");
  const clean = checkLockHoldDuration([{ start: 100, end: 100 }, { start: 200, end: 201 }], 60);
  assert.equal(clean.ok, true);
  assert.equal(clean.evaluated, true);
  assert.equal(clean.reason, "all-lock-holds-ms-scale");
  const long = checkLockHoldDuration([{ start: 100, end: 100 }, { start: 200, end: 500 }], 60);
  assert.equal(long.ok, false);
  assert.equal(long.evaluated, true);
  assert.equal(long.reason, "lock-hold-covers-non-ff-action");
  assert.deepEqual(long.violations, [{ start: 200, end: 500 }]);
});

test("判据1 — a lock-hold interval LONGER than the ff bound ⇒ RED (exit 1) — the AC62 判据1 artifact", () => {
  const dir = makeTmp("ac66hold");
  try {
    initRepo(dir);
    const events = path.join(dir, ".quay", "fan-in-merge-lock-events.jsonl");
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    // ff-only is milliseconds; a 300s hold means the lock covered something OTHER than the ff.
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", ts: "2026-08-14T03:10:00Z", epoch: 100, taskId: "t1", pid: 1 }),
      JSON.stringify({ event: "release", ts: "2026-08-14T03:15:00Z", epoch: 400, taskId: "t1", pid: 1 }),
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--root", dir, "--lock-events", events, "--max-hold-seconds", "60"]);
    assert.equal(r.status, 1, `long hold must be RED: ${r.stdout}${r.stderr}`);
    const hold = jsonOut(r).checks.find((c) => c.check === "lock-hold-only-ff");
    assert.equal(hold.ok, false);
    assert.equal(hold.evaluated, true);
    assert.equal(hold.reason, "lock-hold-covers-non-ff-action");
  } finally {
    cleanup(dir);
  }
});

test("判据1 negative control — every real lock-hold is ms-scale (the live samples) ⇒ PASS", () => {
  const dir = makeTmp("ac66holdclean");
  try {
    initRepo(dir);
    const events = path.join(dir, ".quay", "fan-in-merge-lock-events.jsonl");
    fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
    // Real acquire/release pairs from .quay/fan-in-merge-lock-events.jsonl: all same-second (ms-scale).
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", ts: "2026-08-14T06:38:45Z", epoch: 1786689525, taskId: "gap-ac67", pid: 1063198 }),
      JSON.stringify({ event: "release", ts: "2026-08-14T06:38:45Z", epoch: 1786689525, taskId: "gap-ac67", pid: 1063198 }),
      JSON.stringify({ event: "acquire", ts: "2026-08-14T08:25:25Z", epoch: 1786695925, taskId: "gap-ac72", pid: 585488 }),
      JSON.stringify({ event: "release", ts: "2026-08-14T08:25:25Z", epoch: 1786695925, taskId: "gap-ac72", pid: 585488 }),
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--root", dir, "--lock-events", events]);
    assert.equal(r.status, 0, `ms-scale holds must pass: ${r.stdout}${r.stderr}`);
    const hold = jsonOut(r).checks.find((c) => c.check === "lock-hold-only-ff");
    assert.equal(hold.ok, true);
    assert.equal(hold.evaluated, true);
    assert.equal(hold.reason, "all-lock-holds-ms-scale");
  } finally {
    cleanup(dir);
  }
});

// ── 判据3 integration: retry-record shape ⇒ RED when malformed ───────────────────────────────────────

test("判据3 — a retry record missing the develop head ⇒ RED (exit 1)", () => {
  const dir = makeTmp("a3");
  try {
    initRepo(dir);
    const retries = path.join(dir, "retries.jsonl");
    fs.writeFileSync(retries, JSON.stringify({ taskId: "a", attempt: 1, ts: "2026-08-14T03:00:00Z" }) + "\n", "utf8");
    const r = runChecker(["--root", dir, "--retry-record", retries]);
    assert.equal(r.status, 1, `malformed retry record must be RED: ${r.stdout}${r.stderr}`);
    const shape = jsonOut(r).checks.find((c) => c.check === "retry-record-shape");
    assert.equal(shape.ok, false);
    assert.equal(shape.evaluated, true);
    assert.match(shape.reason, /malformed-retry-record/);
  } finally {
    cleanup(dir);
  }
});

test("判据3 — well-formed retry records and an absent retry file both PASS", () => {
  const dir = makeTmp("a3good");
  try {
    initRepo(dir);
    const retries = path.join(dir, "retries.jsonl");
    fs.writeFileSync(retries, [
      JSON.stringify({ taskId: "a", attempt: 1, developHead: "b".repeat(40), ts: "2026-08-14T03:00:00Z" }),
      JSON.stringify({ taskId: "b", attempt: 2, developHead: "c".repeat(40), ts: "2026-08-14T03:01:00Z" }),
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--root", dir, "--retry-record", retries]);
    assert.equal(r.status, 0, `well-formed records must pass: ${r.stdout}${r.stderr}`);
    const shape = jsonOut(r).checks.find((c) => c.check === "retry-record-shape");
    assert.equal(shape.ok, true);
    assert.equal(shape.evaluated, true);
    // Absent retry file: nothing to validate — PASS.
    const r2 = runChecker(["--root", dir, "--retry-record", path.join(dir, "nope.jsonl")]);
    assert.equal(r2.status, 0);
    const shape2 = jsonOut(r2).checks.find((c) => c.check === "retry-record-shape");
    assert.equal(shape2.ok, true);
  } finally {
    cleanup(dir);
  }
});

test("--help exits 0 with usage on stdout", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fan-in-ff-protocol-check/);
});
