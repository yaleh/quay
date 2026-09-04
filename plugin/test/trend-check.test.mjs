// @test-group engine
// trend-check.test.mjs — tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.
//
// PROBLEM UNDER TEST: every existing quality criterion is point-in-time ("was it green this
// time" / "does this contract conform") — NONE is a trend criterion ("is it more expensive
// than last time"). The per-test-cost trend 0.251→0.464→0.321 (net +28%) worsened for a whole
// day before anyone asked: each point COULD pass a point-in-time band while the window as a
// whole regressed. This suite proves the trend checker (plugin/scripts/trend-check.ts) reads
// the append-only ledgers (verification-round.jsonl / checker-cost.jsonl) and flags
// deterioration even when every point is individually green.
//
// Coverage map (task ACs):
//   AC1 — full-suite-runner appends {tests, per_test_ms} (and redAt) to the
//         verification-round record; trend-check reads it (no new store).
//   AC2 — per-test cost slope over a window; threshold configurable.
//   AC3 — regression control: 0.251→0.464→0.321 (net +28%) MUST be flagged.
//   AC3b — early-RED detection latency trend (redAt − startedAt) flagged when growing.
//   AC4 — REVIEW-cadence.md gained the "比上次更贵了吗 / 离目标更近了吗" trend check item.
//   AC5 — passive: trend-check only reads, never writes/triggers a run.
//   AC6 — manager-layer task cross-annotates the trend criterion.
//   AC7 — this file uses node:test and declares // @test-group engine.
//
// Run:
//   scripts/test.sh --for-task gap-quality-criteria-are-point-in-time-no-trend-criteria

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import {
  analyzeTrends,
  suitePerTestSeries,
  redLatencySeries,
  perTaskSuiteCostSeries,
  groupCheckerRows,
  shouldFlag,
  netChange,
  normalizedSlope,
  leastSquaresSlope,
} from "../scripts/trend-check.ts";
import { run, appendVerificationRound } from "../scripts/full-suite-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TREND_CHECK = path.join(REPO_ROOT, "plugin/scripts/trend-check.ts");

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

function vrfPath(root) {
  return path.join(root, ".quay", "verification-round.jsonl");
}
function costPath(root) {
  return path.join(root, ".quay", "checker-cost.jsonl");
}

function writeVerificationRounds(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(vrfPath(root), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function writeCheckerCost(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(costPath(root), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
function perTaskPath(root) {
  return path.join(root, ".quay", "per-task-suite-records.jsonl");
}
function writePerTaskSuites(root, rows) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(perTaskPath(root), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** One green verification-round row. `perTestMs` is the recorded per_test_ms (in whatever unit the
 * ledger uses — the trend math is scale-invariant because netChange/slope are relative). */
function greenRound(round, perTestMs, { tests = 1000, durationMs, startedAt = `2026-08-05T0${round}:00:00Z` } = {}) {
  return {
    round,
    startedAt,
    durationMs: durationMs ?? perTestMs * tests,
    laneCount: 1,
    pass: tests,
    fail: 0,
    cancelled: 0,
    tests,
    per_test_ms: perTestMs,
    load: 1.0,
    state: "green",
    runner: "outer",
  };
}

/** One red+failed verification-round row with a measured early-RED latency. */
function redRound(round, latencyMs, { startedAt = `2026-08-05T0${round}:00:00Z` } = {}) {
  const redAt = new Date(Date.parse(startedAt) + latencyMs).toISOString();
  return {
    round,
    startedAt,
    durationMs: 900000,
    laneCount: 1,
    pass: 999,
    fail: 1,
    cancelled: 0,
    tests: 1000,
    per_test_ms: 900,
    redAt,
    load: 1.0,
    state: "red",
    reason: "failed",
    runner: "outer",
  };
}

// ── AC3: the regression control 0.251→0.464→0.321 MUST be captured ────────────────────────────────────

test("AC3 — the regression control 0.251→0.464→0.321 (net +28%) is flagged as a trend even though each point could pass a point-in-time band", () => {
  const root = makeTmpDir("tc-ac3-");
  const CONTROL = [0.251, 0.464, 0.321];
  writeVerificationRounds(
    root,
    CONTROL.map((perTestMs, i) => greenRound(i + 1, perTestMs)),
  );

  // First, the point-in-time blind spot: each individual reading is BELOW a plausible upper band
  // (e.g. 0.5 s/test). A point-in-time-only system sees three green readings.
  for (const v of CONTROL) assert.ok(v < 0.5, `point ${v} passes a point-in-time band (the blind spot)`);

  // The trend criterion sees the window as a whole and flags the +28% deterioration.
  const flags = analyzeTrends(root, 5, 0.1);
  const suiteFlags = flags.filter((f) => f.axis === "suite_per_test_cost");
  assert.equal(suiteFlags.length, 1, "the suite per-test-cost deterioration is flagged");
  assert.deepEqual(suiteFlags[0].values, CONTROL, "the exact 0.251→0.464→0.321 series is the flagged window");
  assert.ok(suiteFlags[0].netChange > 0.27 && suiteFlags[0].netChange < 0.29, `net change ≈ +28% (got ${suiteFlags[0].netChange})`);

  // And the CLI exits 1 (deterioration detected) — the band `trend_flags = 0` is violated.
  const cli = spawnSync("node", ["--no-warnings", "--experimental-strip-types", TREND_CHECK, "--root", root, "--window", "5", "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 1, "CLI exits 1 when a trend flag is raised");
  const parsed = JSON.parse(cli.stdout);
  assert.equal(parsed.flags.length, 1, "the JSON wrapper carries exactly the one suite flag");
  assert.equal(parsed.meta.trendIsPassive, 1, "invariant trend_is_passive=1 reported");
});

test("AC2/AC3 — negative control: a flat sequence is NOT flagged; the flagging rule is threshold-sensitive", () => {
  const root = makeTmpDir("tc-flat-");
  writeVerificationRounds(root, [0.3, 0.3, 0.3].map((perTestMs, i) => greenRound(i + 1, perTestMs)));

  assert.deepEqual(analyzeTrends(root, 5, 0.1), [], "flat sequence → no flag at default threshold");
  const cli = spawnSync("node", ["--no-warnings", "--experimental-strip-types", TREND_CHECK, "--root", root, "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 0, "CLI exits 0 when clean");
  assert.equal(JSON.parse(cli.stdout).flags.length, 0, "no flags in the JSON output");

  // A noisy-but-flat sequence must not false-positive either (slope ≈ 0).
  const noisy = [0.3, 0.32, 0.31, 0.3, 0.31];
  assert.equal(shouldFlag(noisy, 0.1), false, "noise around a flat mean is not a deterioration trend");
});

test("AC2 — the trend rule is threshold-configurable (higher threshold → no flag for the same series)", () => {
  const root = makeTmpDir("tc-thresh-");
  writeVerificationRounds(root, [0.251, 0.464, 0.321].map((perTestMs, i) => greenRound(i + 1, perTestMs)));

  assert.equal(analyzeTrends(root, 5, 0.10).length, 1, "flagged at +10% threshold");
  assert.equal(analyzeTrends(root, 5, 0.50).length, 0, "NOT flagged at +50% threshold — configurable");
});

// ── AC84 判据6: per-task-suite-records 数据源 ────────────────────────────────────────────────────────

test("AC84-6 — perTaskSuiteCostSeries drops doc-only deltas (fullSuiteRan=false), keeps real suite costs", () => {
  const rows = [
    { taskId: "a", fullSuiteRan: true, durationMs: 500000 },
    { taskId: "b", fullSuiteRan: false, skipReason: "doc-only-delta", durationMs: 5 },
    { taskId: "c", fullSuiteRan: true, durationMs: 800000 },
  ];
  assert.deepEqual(perTaskSuiteCostSeries(rows), [500000, 800000], "doc-only skipReason rows excluded");
});

test("AC84-6 — analyzeTrends reads per-task-suite-records as the ongoing suite-cost source (B3 退役后主源)", () => {
  const root = makeTmpDir("tc-ac846-");
  writePerTaskSuites(root, [
    { taskId: "t1", fullSuiteRan: true, durationMs: 100000 },
    { taskId: "t2", fullSuiteRan: true, durationMs: 200000 },
    { taskId: "t3", fullSuiteRan: true, durationMs: 400000 },
  ]);
  // no verification-round rows — per-task-suite alone must still drive the cost axis
  const flags = analyzeTrends(root, 5, 0.1);
  assert.ok(flags.some((f) => f.axis === "suite_per_task_cost"), `expected per-task cost flag, got ${JSON.stringify(flags.map((f) => f.axis))}`);
});

// ── AC3b: early-RED detection latency trend ───────────────────────────────────────────────────────────

test("AC3b — early-RED detection latency (redAt − startedAt) growing over rounds is flagged", () => {
  const root = makeTmpDir("tc-ac3b-");
  // Red detected 1s, then 5s, then 9s into the run — the early-RED mitigation degrading.
  writeVerificationRounds(root, [1000, 5000, 9000].map((latency, i) => redRound(i + 1, latency)));

  const flags = analyzeTrends(root, 5, 0.1);
  const latFlags = flags.filter((f) => f.axis === "early_red_latency");
  assert.equal(latFlags.length, 1, "the growing red-detection latency is flagged");
  assert.deepEqual(latFlags[0].values, [1000, 5000, 9000]);
  assert.ok(latFlags[0].netChange > 7, `net change is a large positive (got ${latFlags[0].netChange})`);
});

test("AC3b — the latency series only counts red+failed rounds (a green round says nothing about early-RED)", () => {
  const rows = [
    greenRound(1, 0.3),
    redRound(2, 5000),
    greenRound(3, 0.3),
    redRound(4, 9000),
  ];
  assert.deepEqual(redLatencySeries(rows), [5000, 9000], "green rounds are not latency observations");
});

test("AC3b — a gate-failed round (fail=0 + reason='gate-failed') IS an early-RED latency observation", () => {
  // gap-verification-round-reason-self-contradiction: a gate/scan red carries reason='gate-failed'
  // (NOT 'failed') — it is still a real red with a redAt, so the early-RED latency series must count
  // it. aborted/infra rounds are still excluded (no correctness conclusion).
  const rows = [
    redRound(1, 5000),
    { ...redRound(2, 7000), fail: 0, reason: "gate-failed", gate: "tmux-leak-scan" },
    { ...redRound(3, 1000), reason: "aborted" },
  ];
  assert.deepEqual(
    redLatencySeries(rows),
    [5000, 7000],
    "gate-failed counts toward early-RED latency; aborted does not",
  );
});

// ── per_checker_cost: the checker-cost.jsonl axis (task instance #10) ─────────────────────────────────

test("per_checker_cost — a checker's ms series from checker-cost.jsonl trending up is flagged (ready-pool 35.8→91.2→157 shape)", () => {
  const root = makeTmpDir("tc-cc-");
  const runs = [
    { ms: 358, load: 1.0, ts: "2026-08-05T06:44:00Z" },
    { ms: 912, load: 5.0, ts: "2026-08-05T07:15:00Z" },
    { ms: 1570, load: 10.0, ts: "2026-08-05T07:27:00Z" },
  ];
  writeCheckerCost(
    root,
    runs.map((r, i) => ({ name: "ready-pool-check", ms: r.ms, n: 24, load: r.load, exit: 0, ts: r.ts })),
  );

  const flags = analyzeTrends(root, 5, 0.1);
  const poolFlags = flags.filter((f) => f.axis === "per_checker_cost" && f.name === "ready-pool-check");
  assert.equal(poolFlags.length, 1, "the ready-pool-check cost slope is flagged WITHOUT a human hand-timing");
  assert.deepEqual(poolFlags[0].values, [358, 912, 1570]);

  // The load dimension is preserved in the ledger (the attribution correction) — a same-name series
  // with the same n is distinguishable by load; the group reader keeps ms order only, the ledger
  // keeps the full dual-dimension row for a load-aware reader.
  const byName = groupCheckerRows(
    runs.map((r) => ({ name: "ready-pool-check", ms: r.ms, load: r.load })),
  );
  assert.deepEqual(byName.get("ready-pool-check"), [358, 912, 1570], "ms series grouped in chronological order");
});

// ── AC1: the runner appends tests / per_test_ms / redAt (schema extension, no new store) ─────────────

test("AC1 — full-suite-runner appends {tests, per_test_ms} on a green run and {redAt} on a red run (verification-round.jsonl, schema extended not new)", async () => {
  const root = makeTmpDir("tc-ac1-");
  const fakeGreen = path.join(root, "green-suite.sh");
  fs.writeFileSync(
    fakeGreen,
    '#!/usr/bin/env bash\necho "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n',
    { mode: 0o755 },
  );
  const fakeRed = path.join(root, "red-suite.sh");
  fs.writeFileSync(
    fakeRed,
    '#!/usr/bin/env bash\necho "not ok 1 - boom"\necho "# tests 5"\necho "# fail 1"\nexit 1\n',
    { mode: 0o755 },
  );
  const oldSkip = process.env.QUAY_TEST_SKIP_RESOURCE_GATE;
  process.env.QUAY_TEST_SKIP_RESOURCE_GATE = "1";
  try {
    const greenCode = await run(["--root", root, "--command", `bash ${fakeGreen}`, "--lane-count", "1"]);
    assert.equal(greenCode, 0, "green suite exits 0");
    const redCode = await run(["--root", root, "--command", `bash ${fakeRed}`, "--lane-count", "1"]);
    assert.equal(redCode, 1, "red suite exits 1");
  } finally {
    if (oldSkip !== undefined) process.env.QUAY_TEST_SKIP_RESOURCE_GATE = oldSkip;
    else delete process.env.QUAY_TEST_SKIP_RESOURCE_GATE;
  }

  const lines = fs.readFileSync(vrfPath(root), "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 2, "two runs → two append-only sequence lines (never overwrite)");

  const green = JSON.parse(lines[0]);
  assert.equal(green.state, "green");
  assert.equal(green.tests, 5, "tests = pass+fail+cancelled recorded (AC1)");
  assert.ok(Number.isFinite(green.per_test_ms) && green.per_test_ms > 0, `per_test_ms recorded (AC1, got ${green.per_test_ms})`);
  assert.equal(typeof green.durationMs, "number");

  const red = JSON.parse(lines[1]);
  assert.equal(red.state, "red");
  assert.equal(red.reason, "failed");
  assert.ok(red.redAt, "redAt recorded on a real-failure red (AC3b)");
  const latency = Date.parse(red.redAt) - Date.parse(red.startedAt);
  assert.ok(Number.isFinite(latency) && latency >= 0, `redAt − startedAt latency is measurable (got ${latency}ms)`);
});

test("AC1 — trend-check reads the extended record: a recorded per_test_ms series is the suite cost axis (reader prefers the recorded field)", () => {
  const root = makeTmpDir("tc-read-");
  // A reader must tolerate an OLD line without tests/per_test_ms (backward compat) AND use the
  // recorded per_test_ms when present. Mixed store:
  writeVerificationRounds(root, [
    { round: 1, startedAt: "2026-08-05T01:00:00Z", durationMs: 200000, pass: 1000, fail: 0, cancelled: 0, load: 1, state: "green", runner: "outer" }, // old shape
    greenRound(2, 0.251),
    greenRound(3, 0.464),
    greenRound(4, 0.321),
  ]);
  // Old line derives per_test_ms = 200000/1000 = 200; the trend over the last 3 recorded points is the
  // AC3 control → flagged.
  const flags = analyzeTrends(root, 3, 0.1);
  const suiteFlags = flags.filter((f) => f.axis === "suite_per_test_cost");
  assert.equal(suiteFlags.length, 1, "the last-3-window recorded series is flagged");
  assert.deepEqual(suiteFlags[0].values, [0.251, 0.464, 0.321]);
});

// ── AC5: passive — read-only, never writes, never triggers a run ─────────────────────────────────────

test("AC5 — trend-check is passive: running it creates nothing under a fresh .quay/ dir and never spawns a suite", () => {
  const root = makeTmpDir("tc-passive-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });

  const before = fs.readdirSync(path.join(root, ".quay"));
  const cli = spawnSync("node", ["--no-warnings", "--experimental-strip-types", TREND_CHECK, "--root", root, "--json"], { encoding: "utf8" });
  const after = fs.readdirSync(path.join(root, ".quay"));

  assert.equal(cli.status, 0, "clean root → exit 0");
  assert.deepEqual(after, before, "no file created under .quay/ (no new scheduling, no writes)");
  assert.equal(JSON.parse(cli.stdout).meta.trendIsPassive, 1, "invariant trend_is_passive = 1");
  assert.equal(JSON.parse(cli.stdout).flags.length, 0, "no history → no flags");
});

// ── pure trend math unit checks ───────────────────────────────────────────────────────────────────────

test("trend math — leastSquaresSlope / netChange / normalizedSlope behave on known series", () => {
  assert.equal(leastSquaresSlope([]), 0);
  assert.equal(leastSquaresSlope([5]), 0);
  // perfect linear rise: slope 2 per step
  assert.equal(leastSquaresSlope([1, 3, 5, 7]), 2);
  // AC3 control slope (per index step)
  const control = [0.251, 0.464, 0.321];
  const slope = leastSquaresSlope(control);
  assert.ok(slope > 0, "the AC3 control has a positive regression slope");
  assert.ok(Math.abs(netChange(control) - (0.321 - 0.251) / 0.251) < 1e-9, "netChange is (last−first)/first");
  assert.ok(normalizedSlope(control) > 0.1, "normalized slope of the control exceeds the +10% threshold");
  assert.equal(netChange([3, 3, 3]), 0, "flat → zero net change");
  assert.equal(shouldFlag([3, 3, 3], 0.1), false, "flat → no flag");
  assert.equal(shouldFlag([1, 2, 3], 0.1), true, "rising → flag");
  assert.equal(shouldFlag([3, 2, 1], 0.1), false, "falling (improving) → no flag");
});

// ── AC4 / AC6 / AC7: cross-annotations and declarations ──────────────────────────────────────────────

test("AC4 — REVIEW-cadence.md gained the trend check item (比上次更贵了吗 / 离目标更近了吗)", () => {
  const cadence = fs.readFileSync(path.join(REPO_ROOT, "orchestration", "REVIEW-cadence.md"), "utf8");
  assert.ok(cadence.includes("trend-check.ts"), "the cadence references the trend-check command");
  assert.ok(cadence.includes("比上次更贵了吗") || cadence.includes("比上次更贵"), "the 'more expensive than last time' question is a review item");
  assert.ok(cadence.includes("离目标更近了吗") || cadence.includes("离目标更近"), "the 'closer to the goal' question is a review item");
});

test("AC6 — the manager-layer task cross-annotates the trend criterion (manager layer owns '看趋势')", () => {
  const managerTask = fs.readFileSync(path.join(REPO_ROOT, "tasks", "gap-productize-the-manager-layer.md"), "utf8");
  assert.ok(managerTask.includes("gap-quality-criteria-are-point-in-time-no-trend-criteria"), "the manager task references this trend-criteria task");
  assert.ok(managerTask.includes("趋势"), "the trend function is part of the manager layer");
});

test("AC7 — capability-catalog declares trend-check.ts's question (new script enters the artifact declared, AC1c)", () => {
  const catalog = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "capability-catalog.sh"), "utf8");
  assert.ok(/\[trend-check\.ts\]="[^"]+"/.test(catalog), "trend-check.ts has a declared question in the capability catalog");
});
