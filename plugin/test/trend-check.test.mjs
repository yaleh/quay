// @test-group governance
// trend-check.test.mjs — the TREND criterion
// (tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria).
//
// PROBLEM IT FIXES: every standing quality criterion is point-in-time ("is X green now"). Nothing
// asks "is it getting WORSE than last time". The per-test-cost trend 0.251→0.464→0.321 (net +28%)
// worsened a whole day before anyone asked. This test pins trend-check.ts — the mechanical answer
// to 「比上次更贵了吗 / 离目标更近了吗」: read existing metric history (verification-round.jsonl /
// checker-cost.jsonl / suite-state-events.jsonl) and FLAG any series whose window trend worsens
// beyond a configurable threshold.
//
// Coverage map (task ACs):
//   AC2 — trend flagging: per-test cost slope over the window; worsening beyond threshold flags
//         (「比上次更贵了吗」has a mechanical answer); threshold configurable.
//   AC3 — regression control: 0.251→0.464→0.321 (net +28%) MUST be flagged; a flat sequence
//         (negative control) MUST NOT.
//   AC3b — early-RED detection latency trend: SUITE-RED latency (suite start → red recorded)
//          flagged when it worsens over the window.
//   AC5 — passive: trend-check reads existing records only; the input files are byte-unchanged
//         after a run (no new scheduling, no append).
//   AC7 — node:test + // @test-group governance.
//
// Run: scripts/test.sh plugin/test/trend-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { trendCheck, windowTrend } from "../scripts/trend-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin/scripts/trend-check.ts");

// test-isolation R6: every mkdtemp result must be cleaned up (t.after rmSync) — the shrink-only
// ratchet fails on a NEW mkdtemp-no-cleanup.
function tmpdir(t, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `trend-check-${tag}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

/** Write a fixture root with the three metric stores; returns { root, files }. */
function fixtureRoot(t, { rounds = [], checker = [], events = [] } = {}) {
  const root = tmpdir(t, "fx");
  const files = {
    rounds: path.join(root, ".quay", "verification-round.jsonl"),
    checker: path.join(root, ".quay", "checker-cost.jsonl"),
    events: path.join(root, ".quay", "suite-state-events.jsonl"),
  };
  writeJsonl(files.rounds, rounds);
  writeJsonl(files.checker, checker);
  writeJsonl(files.events, events);
  return { root, files };
}

function runCli({ root, window, threshold }) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--root", root];
  if (window !== undefined) args.push("--window", String(window));
  if (threshold !== undefined) args.push("--threshold", String(threshold));
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

// ── windowTrend unit ──────────────────────────────────────────────────────────────────────────────

test("windowTrend — a flat series never flags (negative control)", () => {
  const f = windowTrend([0.3, 0.3, 0.3], 3, 10, "suite.perTestMs", "cost");
  assert.ok(f, "a 3-point series produces a trend row");
  assert.equal(f.flagged, false, "0% change is below a +10% threshold");
  assert.equal(f.pctChange, 0);
});

test("windowTrend — fewer than 2 usable points cannot establish a trend", () => {
  assert.equal(windowTrend([], 3, 10, "s", "cost"), null, "empty series → no trend");
  assert.equal(windowTrend([0.3], 3, 10, "s", "cost"), null, "single point → no trend");
  assert.equal(windowTrend([0, 0.5], 3, 10, "s", "cost"), null, "zero first → undefined %, skipped");
});

test("windowTrend — window slices to the most recent N points", () => {
  const f = windowTrend([0.1, 0.1, 0.1, 0.2], 3, 10, "suite.perTestMs", "cost");
  assert.deepEqual(f.values, [0.1, 0.1, 0.2], "window=3 keeps the LAST 3 points");
  assert.equal(f.pctChange, 100, "(0.2 − 0.1)/0.1 = +100%");
  assert.equal(f.flagged, true);
});

// ── AC3: regression control (0.251→0.464→0.321, net +28%) ────────────────────────────────────────

test("AC3 — the 0.251→0.464→0.321 regression control MUST be flagged (net +28%)", (t) => {
  const { root } = fixtureRoot(t, {
    rounds: [
      { round: 1, at: "2026-08-05T07:00:00Z", durationMs: 251, tests: 1000, cancelled: 0, perTestMs: 0.251, pass: 1, fail: 0, load: 1 },
      { round: 2, at: "2026-08-05T08:00:00Z", durationMs: 464, tests: 1000, cancelled: 0, perTestMs: 0.464, pass: 1, fail: 0, load: 1 },
      { round: 3, at: "2026-08-05T09:00:00Z", durationMs: 321, tests: 1000, cancelled: 0, perTestMs: 0.321, pass: 1, fail: 0, load: 1 },
    ],
  });
  const { flags } = trendCheck({ root });
  const sf = flags.find((f) => f.series === "suite.perTestMs");
  assert.ok(sf, "the suite per-test cost series must appear in the flags");
  assert.equal(sf.flagged, true, "net +28% must exceed the default +10% threshold");
  assert.equal(sf.first, 0.251);
  assert.equal(sf.last, 0.321);
  assert.ok(sf.pctChange >= 27.9 && sf.pctChange <= 28.1, `pctChange ≈ +28%, got ${sf.pctChange}`);
});

test("AC3 — CLI surface reproduces the control (stdout is the Contract measure trend_flags)", (t) => {
  const { root } = fixtureRoot(t, {
    rounds: [
      { round: 1, at: "2026-08-05T07:00:00Z", perTestMs: 0.251 },
      { round: 2, at: "2026-08-05T08:00:00Z", perTestMs: 0.464 },
      { round: 3, at: "2026-08-05T09:00:00Z", perTestMs: 0.321 },
    ],
  });
  const r = runCli({ root, window: 3 });
  assert.equal(r.status, 0, `CLI exits 0 (a flag is data, not an error): ${r.stderr}`);
  const flags = JSON.parse(r.stdout);
  assert.ok(Array.isArray(flags), "stdout is a JSON array (the trend_flags measure)");
  assert.ok(flags.some((f) => f.series === "suite.perTestMs" && f.flagged), "control series flagged");
});

test("AC3 — a flat sequence is the negative control (no flag)", (t) => {
  const { root } = fixtureRoot(t, {
    rounds: [0.3, 0.3, 0.3].map((v, i) => ({ round: i + 1, perTestMs: v })),
  });
  const { flags } = trendCheck({ root });
  const sf = flags.find((f) => f.series === "suite.perTestMs");
  assert.ok(sf, "a 3-point flat series still produces a trend row");
  assert.equal(sf.flagged, false, "flat → 0% change → below threshold → no flag");
});

// ── AC2: trend flagging + configurable threshold ─────────────────────────────────────────────────

test("AC2 — threshold is configurable (a +5% worsening flags at +5 but not at +10)", (t) => {
  const { root } = fixtureRoot(t, {
    rounds: [0.200, 0.205, 0.210].map((v, i) => ({ round: i + 1, perTestMs: v })),
  });
  // +5% net: (0.210−0.200)/0.200 = +5%
  const strict = trendCheck({ root, thresholdPct: 10 });
  assert.equal(
    strict.flags.find((f) => f.series === "suite.perTestMs").flagged,
    false,
    "+5% is below the +10% threshold → no flag",
  );
  const loose = trendCheck({ root, thresholdPct: 5 });
  assert.equal(
    loose.flags.find((f) => f.series === "suite.perTestMs").flagged,
    true,
    "+5% meets the +5% threshold → flag",
  );
});

test("AC2 — criterion self-cost trend (checker-cost.jsonl) flags the ready-pool 35.8→91.2→157.0s", (t) => {
  const { root } = fixtureRoot(t, {
    checker: [
      { name: "ready-pool-check", ms: 35800, n: 19, load: 5.0, at: "2026-08-05T06:44:00Z" },
      { name: "ready-pool-check", ms: 91200, n: 24, load: 20.0, at: "2026-08-05T07:15:00Z" },
      { name: "ready-pool-check", ms: 157000, n: 24, load: 30.91, at: "2026-08-05T07:27:00Z" },
    ],
  });
  const { flags } = trendCheck({ root });
  const cf = flags.find((f) => f.series === "checker:ready-pool-check.ms");
  assert.ok(cf, "the ready-pool-check cost series must appear");
  assert.equal(cf.flagged, true, "35.8→157.0s is +338% — must flag");
  // A per-name window: another criterion with a FLAT cost must NOT flag.
  const fx2 = fixtureRoot(t, {
    checker: [
      { name: "other-check", ms: 100, n: 1, load: 1, at: "2026-08-05T06:44:00Z" },
      { name: "other-check", ms: 100, n: 1, load: 1, at: "2026-08-05T07:15:00Z" },
      { name: "other-check", ms: 101, n: 1, load: 1, at: "2026-08-05T07:27:00Z" },
    ],
  });
  const { flags: f2 } = trendCheck({ root: fx2.root });
  const oc = f2.find((f) => f.series === "checker:other-check.ms");
  assert.ok(oc, "other-check series present");
  assert.equal(oc.flagged, false, "+1% flat → no flag");
});

// ── AC3b: early-RED detection latency trend ───────────────────────────────────────────────────────

test("AC3b — worsening early-RED detection latency (suite start → red) flags", (t) => {
  // Latency grows 60s → 300s → 600s (red detection is getting later — the mitigation is degrading).
  const mkEvent = (at, startedAt) => ({ event: "SUITE-RED", at, state: { startedAt } });
  const { root } = fixtureRoot(t, {
    events: [
      mkEvent("2026-08-05T07:01:00Z", "2026-08-05T07:00:00Z"), // 60s
      mkEvent("2026-08-05T08:05:00Z", "2026-08-05T08:00:00Z"), // 300s
      mkEvent("2026-08-05T09:10:00Z", "2026-08-05T09:00:00Z"), // 600s
    ],
  });
  const { flags } = trendCheck({ root });
  const lf = flags.find((f) => f.series === "suite.redDetectLatencyMs");
  assert.ok(lf, "the early-RED latency series must appear");
  assert.equal(lf.kind, "latency");
  assert.equal(lf.flagged, true, "60→600s is +900% — must flag");
  assert.deepEqual(lf.values, [60000, 300000, 600000]);
});

test("AC3b — stable early-RED latency (negative control) does not flag", (t) => {
  const mkEvent = (at, startedAt) => ({ event: "SUITE-RED", at, state: { startedAt } });
  const { root } = fixtureRoot(t, {
    events: [
      mkEvent("2026-08-05T07:01:00Z", "2026-08-05T07:00:00Z"),
      mkEvent("2026-08-05T08:01:00Z", "2026-08-05T08:00:00Z"),
      mkEvent("2026-08-05T09:01:00Z", "2026-08-05T09:00:00Z"),
    ],
  });
  const { flags } = trendCheck({ root });
  const lf = flags.find((f) => f.series === "suite.redDetectLatencyMs");
  assert.ok(lf);
  assert.equal(lf.flagged, false, "stable 60s latency → 0% → no flag");
});

// ── AC5: passive — reads existing records, writes nothing ────────────────────────────────────────

test("AC5 — trend-check is passive: input files are byte-unchanged after a run", (t) => {
  const { root, files } = fixtureRoot(t, {
    rounds: [0.251, 0.464, 0.321].map((v, i) => ({ round: i + 1, perTestMs: v })),
    checker: [{ name: "ready-pool-check", ms: 35800, n: 19, load: 5, at: "2026-08-05T06:44:00Z" }],
    events: [{ event: "SUITE-RED", at: "2026-08-05T07:01:00Z", state: { startedAt: "2026-08-05T07:00:00Z" } }],
  });
  const before = {
    rounds: fs.readFileSync(files.rounds, "utf8"),
    checker: fs.readFileSync(files.checker, "utf8"),
    events: fs.readFileSync(files.events, "utf8"),
  };
  const r = runCli({ root });
  assert.equal(r.status, 0, `CLI exits 0: ${r.stderr}`);
  assert.equal(fs.readFileSync(files.rounds, "utf8"), before.rounds, "verification-round.jsonl untouched");
  assert.equal(fs.readFileSync(files.checker, "utf8"), before.checker, "checker-cost.jsonl untouched");
  assert.equal(fs.readFileSync(files.events, "utf8"), before.events, "suite-state-events.jsonl untouched");
});

test("AC5 — an empty history is not an error: no flags, exit 0", (t) => {
  const { root } = fixtureRoot(t, {});
  const r = runCli({ root });
  assert.equal(r.status, 0, `empty history → exit 0: ${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), [], "no history → no flags");
});

// ── AC1 integration: the runner's extended record feeds the trend criterion ──────────────────────

test("AC1 — appendSuiteDurationRecord perTestMs flows into trendCheck as the suite series", async (t) => {
  const root = tmpdir(t, "ac1");
  const { appendSuiteDurationRecord } = await import("../scripts/full-suite-runner.ts");
  // Three runs at 0.251 / 0.464 / 0.321 ms per test (the AC3 control, recorded by the runner).
  appendSuiteDurationRecord(root, { startedAt: "2026-08-05T07:00:00Z", durationMs: 251, laneCount: 1, green: true, tests: 1000, cancelled: 0 });
  appendSuiteDurationRecord(root, { startedAt: "2026-08-05T08:00:00Z", durationMs: 464, laneCount: 1, green: true, tests: 1000, cancelled: 0 });
  appendSuiteDurationRecord(root, { startedAt: "2026-08-05T09:00:00Z", durationMs: 321, laneCount: 1, green: true, tests: 1000, cancelled: 0 });
  // The runner rounds perTestMs to 3 decimals — 0.251/0.464/0.321.
  const { flags } = trendCheck({ root });
  const sf = flags.find((f) => f.series === "suite.perTestMs");
  assert.ok(sf, "the suite per-test cost series exists from runner-recorded rows");
  assert.deepEqual(sf.values, [0.251, 0.464, 0.321]);
  assert.equal(sf.flagged, true, "the AC3 control is captured through the real record path");
});
