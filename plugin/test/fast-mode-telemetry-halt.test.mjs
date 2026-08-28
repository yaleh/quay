// @test-group engine
// fast-mode-telemetry-halt.test.mjs — gap-tasksperhour-counts-halted-time-as-slow-work (AC1–AC8):
// tasksPerHour used to put halted wall-clock in its denominator, so a `.halt` pause read as
// degraded throughput — and rewarded picking light tasks. The fix subtracts RECORDED halt intervals
// (the append-only halt event log) from the window denominator, exposing both windowHours (already
// reduced) and haltedHours (the subtracted amount) so the deduction is independently verifiable.
//
// This file covers AC1 (data-source decision + conservative missed-record semantics), AC2 (both
// numbers exposed + independent verification), AC3 (zero-halt byte-identical invariance), AC4
// (artificial halt raises the reading by exactly count/(elapsed−halted)), AC5 (tonight's real
// 09:33:12Z→10:32:00Z halt retrocalculation + AC18 expiry shift), AC6 (numerator untouched — 10x
// task-size differences contribute equally) and AC8 (node:test + @test-group engine).
//
// Run:
//   node --test plugin/test/fast-mode-telemetry-halt.test.mjs
//   scripts/test.sh plugin/test/fast-mode-telemetry-halt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// REPO_ROOT must resolve to the same directory regardless of where this test lives.
function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "fast-mode-telemetry.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fm-halt-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--experimental-strip-types", CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function importCli() {
  return import(CLI);
}

/**
 * Build start+end events for a list of {taskId, start, end?, outcome?} entries. Unique runIds per
 * entry (index-based) so duplicate taskIds pair apart. An entry with no `end` is an in-progress start.
 */
function buildFixtureEvents(cli, entries) {
  return entries.flatMap((t, i) => {
    const runId = `fixture-${i}-${String(t.taskId).replace(/[^A-Za-z0-9._-]/g, "-")}`;
    const startEv = cli.buildStartEvent({ taskId: t.taskId, runId, recordedAtMs: t.start });
    if (t.end == null) return [startEv];
    return [startEv, cli.buildEndEvent({ taskId: t.taskId, runId, outcome: t.outcome ?? "done", recordedAtMs: t.end })];
  });
}

// ── Tonight's real halt (task body + .halt content, 2026-08-03) ───────────────────────────────────────
// `.halt` self-reported placement 09:33:12Z (commit landed 09:55:08Z — 22 min late) and was lifted at
// ~10:32Z (removal not yet committed when measured). These are the interval endpoints for AC5.
const HALT_PLACE = Date.parse("2026-08-03T09:33:12Z");
const HALT_LIFT = Date.parse("2026-08-03T10:32:00Z");
const HALTED_HOURS = (HALT_LIFT - HALT_PLACE) / 3_600_000; // 0.98h
// The outer loop measured count=37 / 24.0402h = 1.5391 at 10:32:10Z. Reproduce that window exactly:
// windowEnd = MEASURE, windowStart = MEASURE − 24.0402h (earliest startedAtMs of the 37 tasks).
const MEASURE = Date.parse("2026-08-03T10:32:10Z");
const WS = MEASURE - Math.round(24.0402 * 3_600_000);
const COUNT = 37;
const BASE_WINDOW_HOURS = (MEASURE - WS) / 3_600_000; // exactly 24.0402h


// ── AC1: data source decision + conservative missed-record semantics ────────────────────────────────

test("AC1 — the module header documents the data-source decision (git history rejected, append-only log chosen)", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert.match(src, /DATA SOURCE \(AC1\)/, "header must document the data-source decision");
  assert.match(src, /halt-events\.jsonl/, "header must name the append-only halt log");
  assert.match(src, /git[\s-]*(history)/i, "header must name the rejected git-history candidate");
  assert.match(src, /22 min|09:55:08Z|09:33:12Z/, "header must record the measured 22-min git-history deviation");
  assert.match(src, /conservative|保守/i, "header must record the conservative missed-record direction");
});

test("AC1 — a halt start with no matching end subtracts NOTHING (conservative, degrades to pre-fix)", async () => {
  const cli = await importCli();
  const evs = buildFixtureEvents(cli, [
    { taskId: "a", start: 0, end: 3_600_000 },
    { taskId: "b", start: 1_000, end: 7_200_000 },
  ]);
  const base = cli.aggregate(evs, { nowMs: 7_200_000 });
  const open = cli.aggregate(evs, { nowMs: 7_200_000, haltEvents: [{ event: "start", atMs: 3_600_000 }] });
  assert.equal(open.haltedHours, 0, "unclosed halt must subtract nothing");
  assert.equal(open.windowHours, base.windowHours, "window unchanged");
  assert.equal(open.tasksPerHour, base.tasksPerHour, "reading degrades to the pre-fix value");
});

test("AC1 — an orphan halt end (no matching start) subtracts NOTHING (conservative)", async () => {
  const cli = await importCli();
  const evs = buildFixtureEvents(cli, [{ taskId: "a", start: 0, end: 3_600_000 }]);
  const base = cli.aggregate(evs, { nowMs: 3_600_000 });
  const orphan = cli.aggregate(evs, { nowMs: 3_600_000, haltEvents: [{ event: "end", atMs: 3_600_000 }] });
  assert.equal(orphan.haltedHours, 0, "orphan end must subtract nothing");
  assert.equal(orphan.windowHours, base.windowHours);
  assert.equal(orphan.tasksPerHour, base.tasksPerHour);
});

test("AC1 — the halt event log is excluded from the task event stream (never pollutes tasks/orphaned)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    runCli(tmp, "--halt-start", "--atMs", "2026-08-03T09:33:12Z", "--reason", "archguard");
    runCli(tmp, "--halt-end", "--atMs", "2026-08-03T10:32:00Z");
    // --since pins the window start (no task events exist, so without it the window is empty).
    const rep = runCli(tmp, "--report", "--since", "2026-08-03T09:00:00Z", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);
    assert.equal(out.tasks.length, 0, "halt lines must not become completed tasks");
    assert.equal(out.orphaned.length, 0, "halt lines must not become orphaned");
    assert.equal(out.inProgress.length, 0, "halt lines must not become in-progress");
    assert.ok(Math.abs(out.haltedHours - HALTED_HOURS) < 0.001,
      "the halt log must still feed haltedHours through its own dedicated reader");
  } finally {
    cleanup(tmp);
  }
});

// ── AC2: both numbers exposed; deduction independently verifiable ──────────────────────────────────

test("AC2 — --report --json exposes windowHours AND haltedHours plus the halted interval", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-halt-t");
    assert.equal(s.status, 0, s.stderr);
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-halt-t", "--runId", runId, "--outcome", "done");
    runCli(tmp, "--halt-start", "--atMs", "2026-08-03T09:33:12Z");
    runCli(tmp, "--halt-end", "--atMs", "2026-08-03T10:32:00Z");
    const rep = runCli(tmp, "--report", "--since", "2026-08-03T09:00:00Z", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);
    assert.ok("windowHours" in out, "windowHours must be exposed (already reduced)");
    assert.ok("haltedHours" in out, "haltedHours must be exposed (the subtracted amount)");
    assert.ok(Array.isArray(out.halted) && out.halted.length === 1, "halted[] must carry the interval");
    assert.ok(Math.abs(out.haltedHours - HALTED_HOURS) < 0.001, `haltedHours ≈0.98h, got ${out.haltedHours.toFixed(4)}`);
    // Independent verification: elapsed − windowHours == haltedHours (windowStart/End already in the report).
    const elapsed = (Date.parse(out.windowEnd) - Date.parse(out.windowStart)) / 3_600_000;
    assert.ok(Math.abs((elapsed - out.windowHours) - out.haltedHours) < 1e-9,
      `elapsed(${elapsed.toFixed(3)}) − windowHours(${out.windowHours.toFixed(3)}) must equal haltedHours(${out.haltedHours.toFixed(3)})`);
  } finally {
    cleanup(tmp);
  }
});

// ── AC3: zero-halt invariance (byte-identical) ─────────────────────────────────────────────────────

test("AC3 — a zero-halt window is byte-identical with and without haltEvents (negative control 1)", async () => {
  const cli = await importCli();
  const evs = buildFixtureEvents(cli, [
    { taskId: "a", start: 0, end: 3_600_000 },
    { taskId: "b", start: 1_000, end: 7_200_000 },
  ]);
  const base = cli.aggregate(evs, { nowMs: 7_200_000 });
  const withEmpty = cli.aggregate(evs, { nowMs: 7_200_000, haltEvents: [] });
  const withNull = cli.aggregate(evs, { nowMs: 7_200_000, haltEvents: null });
  assert.equal(withEmpty.windowHours, base.windowHours, "windowHours must be byte-identical");
  assert.equal(withEmpty.tasksPerHour, base.tasksPerHour, "tasksPerHour must be byte-identical");
  assert.equal(withEmpty.haltedHours, 0, "no halt ⇒ haltedHours = 0");
  assert.equal(withNull.windowHours, base.windowHours, "absent haltEvents ⇒ same as pre-fix");
  assert.equal(withNull.tasksPerHour, base.tasksPerHour, "absent haltEvents ⇒ same as pre-fix");
  // And with no halt, windowHours == elapsed exactly.
  const elapsed = (Date.parse(base.windowEnd) - Date.parse(base.windowStart)) / 3_600_000;
  assert.equal(base.windowHours, elapsed, "no halt ⇒ windowHours == elapsed");
});

test("AC3 — CLI-level: no halt log present ⇒ haltedHours = 0 and windowHours == elapsed", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-halt-t");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-halt-t", "--runId", runId, "--outcome", "done");
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);
    assert.equal(out.haltedHours, 0, "no halt log ⇒ haltedHours = 0");
    const elapsed = (Date.parse(out.windowEnd) - Date.parse(out.windowStart)) / 3_600_000;
    assert.equal(out.windowHours, elapsed, "windowHours == elapsed when nothing is halted");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4: artificial halt raises the reading by exactly count/(elapsed−halted) ──────────────────────

test("AC4 — an artificial 1h halt raises tasksPerHour by exactly count/(elapsed−halted) (negative control 2)", async () => {
  const cli = await importCli();
  const evs = buildFixtureEvents(cli, [
    { taskId: "a", start: 0, end: 3_600_000 },
    { taskId: "b", start: 1_000, end: 7_200_000 },
  ]);
  // Window [0, 2h], count=2 → 2/2h = 1.0. Inject a 1h halt [1h, 2h] → 2/(2−1) = 2.0.
  const base = cli.aggregate(evs, { nowMs: 7_200_000 });
  const halt = [{ event: "start", atMs: 3_600_000 }, { event: "end", atMs: 7_200_000 }];
  const adj = cli.aggregate(evs, { nowMs: 7_200_000, haltEvents: halt });
  assert.equal(base.tasksPerHour, 1.0, `base 2/2h = 1.0, got ${base.tasksPerHour}`);
  assert.equal(adj.haltedHours, 1.0, `halted = 1h, got ${adj.haltedHours}`);
  assert.equal(adj.windowHours, 1.0, `windowHours = elapsed(2) − halted(1) = 1, got ${adj.windowHours}`);
  assert.equal(adj.tasksPerHour, 2.0, `count/(elapsed−halted) = 2/1 = 2.0, got ${adj.tasksPerHour}`);
  assert.ok(adj.tasksPerHour > base.tasksPerHour, "subtracting halt time must RAISE the reading");
});

test("AC4 — CLI round-trip: --halt-start/--halt-end record, --report reflects the exact rise", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-halt-t");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-halt-t", "--runId", runId, "--outcome", "done");
    const hs = runCli(tmp, "--halt-start", "--atMs", "2026-08-03T09:33:12Z", "--reason", "archguard-cold-start");
    assert.equal(hs.status, 0, hs.stderr);
    const he = runCli(tmp, "--halt-end", "--atMs", "2026-08-03T10:32:00Z");
    assert.equal(he.status, 0, he.stderr);

    const rep = runCli(tmp, "--report", "--since", "2026-08-03T09:00:00Z", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);
    assert.ok(Math.abs(out.haltedHours - HALTED_HOURS) < 0.001, `CLI-computed haltedHours ≈0.98, got ${out.haltedHours.toFixed(4)}`);
    // The halt interval must appear in the report for independent inspection.
    assert.ok(out.halted.length === 1, `one halted interval expected, got ${JSON.stringify(out.halted)}`);
    // The raw halt log file exists under .workflow-events/.
    assert.ok(fs.existsSync(path.join(tmp, ".workflow-events", "halt-events.jsonl")), "halt log file must exist");
  } finally {
    cleanup(tmp);
  }
});

// ── AC5: tonight's real halt retrocalculation + AC18 expiry shift ──────────────────────────────────

test("AC5 — tonight's real halt (09:33:12Z→10:32:00Z): tph 1.5391→1.6045, AC18 expiry +0.98h", async () => {
  const cli = await importCli();
  // Reproduce the outer loop's measured window: 37 completed tasks, windowStart = WS (earliest start),
  // windowEnd = MEASURE (all ends precede 10:32:10Z), count = 37.
  const evs = buildFixtureEvents(cli, Array.from({ length: COUNT }, (_, i) => ({
    taskId: `real-${i}`,
    start: WS + i * 1000,
    end: MEASURE - 1000 - i * 1000,
  })));
  const base = cli.aggregate(evs, { nowMs: MEASURE });
  const halt = [{ event: "start", atMs: HALT_PLACE }, { event: "end", atMs: HALT_LIFT }];
  const adj = cli.aggregate(evs, { nowMs: MEASURE, haltEvents: halt });

  // Pre-halt: matches the outer loop's 37/24.0402h ≈ 1.5391 at 10:32:10Z.
  assert.equal(base.tasks.length, COUNT, "numerator = 37 completed tasks");
  assert.ok(Math.abs(base.windowHours - BASE_WINDOW_HOURS) < 1e-9, `windowHours = ${BASE_WINDOW_HOURS}`);
  assert.ok(Math.abs(base.tasksPerHour - 1.5391) < 0.001, `pre-halt tph ≈1.5391, got ${base.tasksPerHour.toFixed(4)}`);

  // Post-halt: windowHours = elapsed − 0.98h; tph = 37/23.0602 ≈ 1.6045.
  assert.ok(Math.abs(adj.haltedHours - HALTED_HOURS) < 1e-9, `haltedHours = ${HALTED_HOURS}h, got ${adj.haltedHours}`);
  assert.ok(Math.abs(adj.windowHours - (BASE_WINDOW_HOURS - HALTED_HOURS)) < 1e-9,
    `windowHours = elapsed − halted, got ${adj.windowHours.toFixed(4)}`);
  const expectedTph = COUNT / (BASE_WINDOW_HOURS - HALTED_HOURS);
  assert.ok(Math.abs(adj.tasksPerHour - expectedTph) < 1e-9,
    `post-halt tph = count/(elapsed−halted) ≈${expectedTph.toFixed(4)}, got ${adj.tasksPerHour.toFixed(4)}`);
  assert.ok(adj.tasksPerHour > base.tasksPerHour, "subtracting the real halt must RAISE the reading");
  assert.ok(adj.tasksPerHour >= 1.5, `after correction the reading clears the AC18 gate: ${adj.tasksPerHour.toFixed(4)}`);

  // AC18 expiry: the ≥1.5 gate needs 37/1.5 = 24.6667h of WINDOW. Without the halt, that is 24.6667h
  // of elapsed; with the halt subtracted, it takes 24.6667h + 0.98h of elapsed — the halt pushes the
  // expiry out by exactly its own duration.
  const thresholdNoHalt = COUNT / 1.5;
  const thresholdWithHalt = COUNT / 1.5 + HALTED_HOURS;
  const remainingNoHalt = thresholdNoHalt - BASE_WINDOW_HOURS;    // ≈0.626h (≈37.6 min after 10:32:10Z)
  const remainingWithHalt = thresholdWithHalt - BASE_WINDOW_HOURS; // ≈1.607h (≈96.4 min)
  assert.ok(Math.abs(remainingNoHalt - (COUNT / 1.5 - BASE_WINDOW_HOURS)) < 1e-9);
  assert.ok(Math.abs(remainingWithHalt - remainingNoHalt - HALTED_HOURS) < 1e-9,
    `the halt shifts AC18 expiry by exactly its own duration (${HALTED_HOURS.toFixed(3)}h)`);
  assert.ok(remainingWithHalt > remainingNoHalt, "with the halt subtracted, the gate lasts longer");
});

// ── AC6: numerator untouched — 10x task-size differences contribute equally ────────────────────────

test("AC6 — two tasks whose durations differ 10x contribute equally to tasksPerHour (numerator is flat)", async () => {
  const cli = await importCli();
  const tenH = 10 * 3_600_000;
  const evs1 = buildFixtureEvents(cli, [
    { taskId: "short", start: 0, end: 3_600_000 },   // 1h
    { taskId: "long", start: 0, end: tenH },          // 10h — same window [0, 10h]
  ]);
  const evs2 = buildFixtureEvents(cli, [
    { taskId: "long", start: 0, end: tenH },          // swap which task is the long one
    { taskId: "short", start: 0, end: 3_600_000 },
  ]);
  const r1 = cli.aggregate(evs1, { nowMs: tenH });
  const r2 = cli.aggregate(evs2, { nowMs: tenH });
  assert.equal(r1.tasks.length, 2, "numerator = 2 completed tasks (the 1h and the 10h task both count 1)");
  assert.equal(r2.tasks.length, 2);
  assert.equal(r1.windowHours, r2.windowHours, "same window ⇒ same denominator");
  assert.equal(r1.tasksPerHour, r2.tasksPerHour,
    "a 10x duration difference must NOT change tasksPerHour — the numerator is not size-weighted");
  assert.ok(Math.abs(r1.tasksPerHour - 2 / 10) < 1e-9, `count/windowHours = 2/10 = 0.2, got ${r1.tasksPerHour}`);
  // Sanity: the per-task duration DOES differ (that is the premise); only the throughput reading is flat.
  const byId = Object.fromEntries(r1.tasks.map((t) => [t.taskId, t.minutes]));
  assert.ok(Math.abs(byId.short - 60) < 1e-9, `the short task must be 1h, got ${byId.short}`);
  assert.ok(Math.abs(byId.long - 600) < 1e-9, `the long task must be 10h, got ${byId.long}`);
});

// ── AC8: node:test + @test-group engine ─────────────────────────────────────────────────────────

test("AC8 — this file declares @test-group engine and imports node:test", () => {
  const src = fs.readFileSync(__filename, "utf8");
  assert.match(src, /\/\/ @test-group engine/, "file must declare // @test-group engine");
  assert.match(src, /import \{ test \} from "node:test"/, "file must use node:test");
});

