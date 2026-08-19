// @test-group governance
// fast-mode-telemetry.test.mjs — gap-fast-mode-no-telemetry: RED/GREEN tests for the fast-mode
// metering CLI (fast-mode-telemetry.ts, byte-identical mirrors). Covers AC2–AC5 and AC10 (DoD),
// plus the --report write-split regression (gap-telemetry-report-writes-and-deadlocks-readiness):
// AC1 --report is pure-read, AC2 --snapshot is the explicit persist, AC3 20x --report leaves
// git status clean, AC4 --snapshot stdout is byte-identical to the file it wrote.
//
// HALT-DENOMINATOR TESTS live in the governance sibling
// fast-mode-telemetry-halt.test.mjs (gap-tasksperhour-counts-halted-time-as-slow-work, AC1–AC8);
// this engine file only pins the report SHAPE (haltedHours/halted present, 0 without a halt log)
// so the default suite keeps covering the new fields.
//
// Run:
//   scripts/test.sh plugin/test/fast-mode-telemetry.test.mjs
//   node --test plugin/test/fast-mode-telemetry.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const EXP_SCRIPTS = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts");
const CLI = path.join(PLUGIN_SCRIPTS, "fast-mode-telemetry.ts");
const CLI_MIRROR = path.join(EXP_SCRIPTS, "fast-mode-telemetry.ts");
const SCHEMA = path.join(PLUGIN_SCRIPTS, "workflow-event-schema.mjs");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fm-telemetry-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--experimental-strip-types", CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
    // Deterministic slot arithmetic: --slots/--slot-status scan the LIVE machine for non-task
    // subagent processes (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots). Tests
    // pin QUAY_TELEMETRY_SUBAGENTS=0 so exact occupied/slots_free assertions never depend on what
    // else happens to be running during the suite; the subagent-counting tests override it.
    env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: process.env.QUAY_TELEMETRY_SUBAGENTS ?? "0" },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runCliEnv(tmpRoot, env, ...args) {
  const res = spawnSync("node", ["--experimental-strip-types", CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function readEventsJsonl(root, runId) {
  const file = path.join(root, ".workflow-events", `${runId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Read an arbitrary `.workflow-events/<filename>.jsonl` log (e.g. the reconcile-invocation log). */
function readEventsJsonlRaw(root, filename) {
  const file = path.join(root, ".workflow-events", filename);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function md5(str) {
  return createHash("md5").update(str).digest("hex");
}

function gitCmd(tmpRoot, ...args) {
  const res = spawnSync("git", ["-C", tmpRoot, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function importCli() {
  return import(CLI);
}

async function importSchema() {
  return import(SCHEMA);
}

// ── Governance self-skip (AC6 @test-group governance) ─────────────────────────────────────────────
// In a DEFAULT (product,engine) run this file reports `skipped`, not absent (ADR-019 decision #1
// precedent). It runs in full when invoked explicitly (QUAY_TEST_GROUPS unset) or with
// `--group governance`. The fast-mode telemetry is the metering/measurement layer — governance,
// not engine.
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

// ── AC2: --task-start ────────────────────────────────────────────────────────────────────────────────

test("AC2 — --task-start writes a schema-valid start event and prints a runId", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const schema = await importSchema();
    const res = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    assert.equal(res.status, 0, `CLI should exit 0, got ${res.status}\nstderr: ${res.stderr}`);
    const runId = res.stdout.trim();
    assert.match(runId, /^fm-/, `printed runId should start with "fm-", got "${runId}"`);
    assert.ok(!runId.includes("\n"), `runId should be a single line, got "${runId}"`);

    const events = readEventsJsonl(tmp, runId);
    assert.equal(events.length, 1, "exactly one start event should be written");

    const ev = events[0];
    assert.equal(ev.stage, "Fast", `stage should be "Fast", got "${ev.stage}"`);
    assert.equal(ev.eventKind, "start", `eventKind should be "start", got "${ev.eventKind}"`);
    assert.equal(ev.taskId, "gap-test-1");
    assert.equal(ev.outcome, null, "start event outcome should be null");
    assert.equal(typeof ev.timing.startedAtMs, "number", "startedAtMs should be set");
    assert.equal(ev.timing.endedAtMs, null, "start event should not set endedAtMs");

    const v = schema.validateEvent(ev);
    assert.equal(v.ok, true, `start event must pass A1a validateEvent: ${JSON.stringify(v)}`);
  } finally {
    cleanup(tmp);
  }
});

// ── AC3: --task-end ──────────────────────────────────────────────────────────────────────────────────

test("AC3 — --task-end writes a schema-valid end event carrying the outcome", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const schema = await importSchema();
    const start = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    assert.equal(start.status, 0, start.stderr);
    const runId = start.stdout.trim();

    const end = runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0, `--task-end should exit 0, got ${end.status}\nstderr: ${end.stderr}`);

    const events = readEventsJsonl(tmp, runId);
    assert.equal(events.length, 2, "start + end = 2 events");
    const ev = events[1];
    assert.equal(ev.stage, "Fast");
    assert.equal(ev.eventKind, "end", `eventKind should be "end", got "${ev.eventKind}"`);
    assert.equal(ev.outcome, "done", `outcome should be "done", got "${ev.outcome}"`);
    assert.equal(typeof ev.timing.endedAtMs, "number", "endedAtMs should be set");
    assert.equal(ev.runId, runId);

    const v = schema.validateEvent(ev);
    assert.equal(v.ok, true, `end event must pass A1a validateEvent: ${JSON.stringify(v)}`);
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — --task-end rejects an outcome outside VALID_OUTCOMES (fail-closed)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const start = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = start.stdout.trim();
    const res = runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "bogus");
    assert.notEqual(res.status, 0, "invalid outcome must fail closed");
    assert.match(res.stderr, /outcome|bogus/, `stderr should explain the invalid outcome: ${res.stderr}`);
  } finally {
    cleanup(tmp);
  }
});

// ── DEFER OUTCOME (gap-over90-clock-measures-queue-time-not-work-time): a bracket closed on a
// touches-overlap defer must leave inProgress (so OVER90's clock never counts the queue segment),
// route to `deferred[]` (never `tasks[]`, never throughput), and be re-`--task-start`able as a
// FRESH bracket (so OVER90 measures from work start, not task-start). ──────────────────────────────

test("OVER90-DEFER — --task-end --outcome deferred is accepted and the pair routes to deferred[], not tasks[]", async () => {
  const cli = await importCli();
  const runId = cli.generateRunId("gap-defer-1");
  const startEvent = cli.buildStartEvent({ taskId: "gap-defer-1", runId, recordedAtMs: 1_000_000 });
  const endEvent = cli.buildEndEvent({ taskId: "gap-defer-1", runId, outcome: "deferred", recordedAtMs: 1_060_000 });
  const report = cli.aggregate([startEvent, endEvent]);
  assert.equal(report.inProgress.length, 0, "a defer-close must leave inProgress (no OVER90 on the queue segment)");
  assert.equal(report.tasks.length, 0, "a defer-close is NOT a completed task — must never land in tasks[]/throughput");
  assert.equal(report.deferred.length, 1, "the defer-close pair surfaces in deferred[]");
  assert.equal(report.deferred[0].taskId, "gap-defer-1");
  assert.equal(report.deferred[0].outcome, "deferred");
  assert.equal(report.deferred[0].startedAtMs, 1_000_000, "deferred entry carries the bracket-open instant");
});

test("OVER90-DEFER — a defer-close does not extend the throughput window bounds (deferred[] is excluded like reconciled[])", async () => {
  const cli = await importCli();
  // Two events: a deferred close at t=1000..1060 (a queue segment) and a REAL completed task at t=5000..6000.
  const dRun = cli.generateRunId("gap-defer-2");
  const deferStart = cli.buildStartEvent({ taskId: "gap-defer-2", runId: dRun, recordedAtMs: 1_000_000 });
  const deferEnd = cli.buildEndEvent({ taskId: "gap-defer-2", runId: dRun, outcome: "deferred", recordedAtMs: 1_060_000 });
  const rRun = cli.generateRunId("gap-real-2");
  const realStart = cli.buildStartEvent({ taskId: "gap-real-2", runId: rRun, recordedAtMs: 5_000_000 });
  const realEnd = cli.buildEndEvent({ taskId: "gap-real-2", runId: rRun, outcome: "done", recordedAtMs: 5_600_000 });
  const report = cli.aggregate([deferStart, deferEnd, realStart, realEnd], { nowMs: 6_000_000 });
  assert.equal(report.tasks.length, 1, "only the real completed task is in tasks[]");
  assert.equal(report.deferred.length, 1, "the defer-close is in deferred[]");
  // Window start must be the REAL task's start (5_000_000), NOT the deferred segment's 1_000_000.
  assert.equal(new Date(report.windowStart).getTime(), 5_000_000, "deferred segment must not pull the window earlier");
});

test("OVER90-DEFER — a fresh --task-start after a defer-close opens a NEW bracket (OVER90 measures from work start)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    // t=0: --task-start opens a bracket (pre-defer).
    const start1 = runCli(tmp, "--task-start", "--taskId", "gap-defer-3");
    const runId1 = start1.stdout.trim();
    // t=0: defer detected → close the bracket with outcome deferred.
    const defer = runCli(tmp, "--task-end", "--taskId", "gap-defer-3", "--runId", runId1, "--outcome", "deferred");
    assert.equal(defer.status, 0, defer.stderr);
    // t=80min later: work actually starts → fresh --task-start (new runId).
    const start2 = runCli(tmp, "--task-start", "--taskId", "gap-defer-3");
    const runId2 = start2.stdout.trim();
    assert.notEqual(runId2, runId1, "a fresh --task-start must open a NEW bracket/runId");

    const rep = runCli(tmp, "--report", "--json");
    const r = JSON.parse(rep.stdout);
    assert.equal(r.inProgress.length, 1, "only the FRESH work bracket is inProgress");
    assert.equal(r.inProgress[0].runId, runId2, "the inProgress bracket is the fresh work one");
    assert.equal(r.deferred.length, 1, "the pre-defer bracket is accounted in deferred[]");
    assert.equal(r.tasks.length, 0, "the defer-close never counts as a completed task");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4: start/end pair yields a computable wall-clock ───────────────────────────────────────────────

test("AC4 — a start/end pair yields a computable wall-clock (deterministic unit)", async () => {
  const cli = await importCli();
  const runId = cli.generateRunId("gap-test-1");
  const startEvent = cli.buildStartEvent({ taskId: "gap-test-1", runId, recordedAtMs: 1_000_000 });
  const endEvent = cli.buildEndEvent({
    taskId: "gap-test-1",
    runId,
    outcome: "done",
    recordedAtMs: 1_060_000,
  });
  const report = cli.aggregate([startEvent, endEvent]);
  assert.equal(report.tasks.length, 1);
  assert.equal(report.tasks[0].taskId, "gap-test-1");
  assert.equal(report.tasks[0].minutes, 1, "60s = 1 minute");
  assert.equal(report.tasks[0].outcome, "done");
});

// ── AC5: --report --json roll-up shape ───────────────────────────────────────────────────────────────

test("AC5 — --report --json emits {tasks, meanMinutes, medianMinutes, tasksPerHour}", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const start = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = start.stdout.trim();
    const end = runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0, end.stderr);

    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, `--report should exit 0, got ${rep.status}\nstderr: ${rep.stderr}`);

    let out;
    assert.doesNotThrow(() => { out = JSON.parse(rep.stdout); }, `--report --json must print JSON, got: ${rep.stdout.slice(0, 200)}`);
    assert.ok("tasks" in out, "report must carry tasks");
    assert.ok("meanMinutes" in out, "report must carry meanMinutes");
    assert.ok("medianMinutes" in out, "report must carry medianMinutes");
    assert.ok("tasksPerHour" in out, "report must carry tasksPerHour");
    assert.ok("serialEquivalentPerHour" in out, "report must carry the renamed serial-equivalent field");
    assert.ok("windowStart" in out && "windowEnd" in out && "windowHours" in out, "report must carry the window fields (AC3)");
    // HALT-DENOMINATOR FIX (gap-tasksperhour-counts-halted-time-as-slow-work, AC2): the report must
    // always carry the halt fields; with no halt log they are 0 / [] (byte-identical pre-fix values).
    assert.ok("haltedHours" in out, "report must carry haltedHours");
    assert.ok("halted" in out, "report must carry halted[]");
    assert.equal(out.haltedHours, 0, "no halt log ⇒ haltedHours = 0");
    assert.deepEqual(out.halted, [], "no halt log ⇒ halted[] = []");

    assert.equal(out.tasks.length, 1, `expected 1 completed task, got ${JSON.stringify(out.tasks)}`);
    const t = out.tasks[0];
    assert.ok("taskId" in t && "minutes" in t && "outcome" in t, `task entry shape: ${JSON.stringify(t)}`);
    assert.equal(t.taskId, "gap-test-1");
    assert.equal(typeof t.minutes, "number");
    assert.ok(t.minutes > 0, `wall-clock should be positive, got ${t.minutes}`);
    assert.equal(t.outcome, "done");
  } finally {
    cleanup(tmp);
  }
});

test("AC5 — mean/median/tasksPerHour computed over multiple tasks", async () => {
  const tmp = makeTmpWorkspace();
  try {
    for (const [taskId, outcome] of [["a", "done"], ["b", "done"], ["c", "needs-human"]]) {
      const s = runCli(tmp, "--task-start", "--taskId", taskId);
      assert.equal(s.status, 0, s.stderr);
      const runId = s.stdout.trim();
      const e = runCli(tmp, "--task-end", "--taskId", taskId, "--runId", runId, "--outcome", outcome);
      assert.equal(e.status, 0, e.stderr);
    }
    const rep = runCli(tmp, "--report", "--json");
    const out = JSON.parse(rep.stdout);
    assert.equal(out.tasks.length, 3);
    assert.equal(out.meanMinutes, out.tasks.reduce((sum, t) => sum + t.minutes, 0) / 3);
    assert.equal(typeof out.medianMinutes, "number");
    assert.ok(out.medianMinutes >= 0);
    assert.ok(out.tasksPerHour > 0, `tasksPerHour should be positive, got ${out.tasksPerHour}`);
    assert.ok(Number.isFinite(out.tasksPerHour));
  } finally {
    cleanup(tmp);
  }
});

// ── AC10: orphaned end events ────────────────────────────────────────────────────────────────────────

test("AC10 — an end event with no matching start is reported as orphaned, never dropped", async () => {
  const tmp = makeTmpWorkspace();
  try {
    // Only an end event — no start ever emitted.
    const end = runCli(tmp, "--task-end", "--taskId", "orphan-task", "--runId", "fm-orphan-1", "--outcome", "abandoned");
    assert.equal(end.status, 0, end.stderr);

    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);

    const orphaned = (out.orphaned ?? []).filter((o) => o.runId === "fm-orphan-1");
    assert.equal(orphaned.length, 1, `orphaned end event must surface in report: ${JSON.stringify(out.orphaned)}`);
    assert.equal(orphaned[0].taskId, "orphan-task");
    assert.equal(orphaned[0].outcome, "abandoned");

    // It must NOT appear in the completed-tasks roll-up (no wall-clock is computable).
    assert.equal(out.tasks.some((t) => t.taskId === "orphan-task"), false, "orphaned must not be in tasks");
  } finally {
    cleanup(tmp);
  }
});

test("AC10 — a start with no end is surfaced as in-progress, not dropped", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const start = runCli(tmp, "--task-start", "--taskId", "open-task");
    assert.equal(start.status, 0, start.stderr);
    const runId = start.stdout.trim();

    const rep = runCli(tmp, "--report", "--json");
    const out = JSON.parse(rep.stdout);
    const inProg = (out.inProgress ?? []).filter((o) => o.runId === runId);
    assert.equal(inProg.length, 1, `start-without-end must surface as in-progress: ${JSON.stringify(out.inProgress)}`);
    assert.equal(inProg[0].taskId, "open-task");
  } finally {
    cleanup(tmp);
  }
});

// ── AC1/AC2/AC3/AC4: --report pure-read, --snapshot explicit persist ─────────────────────────────────
// gap-telemetry-report-writes-and-deadlocks-readiness: --report used to rewrite the TRACKED aggregate
// file on every call, so any 60s observation poll kept the tree dirty and restart-readiness-check.sh's
// "working tree clean" hard check could never pass. --report must be pure-read; persisting is the
// explicit --snapshot subcommand.

test("AC1 — --report is pure-read: never creates the aggregate; never changes its md5", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");

    // Before any --snapshot, --report must NOT create the aggregate file.
    const rep1 = runCli(tmp, "--report");
    assert.equal(rep1.status, 0, rep1.stderr);
    const date = new Date().toISOString().slice(0, 10);
    const aggFile = path.join(tmp, "milestones", "fast-mode-telemetry", `${date}.json`);
    assert.ok(!fs.existsSync(aggFile), "--report must not create the aggregate file (pure read)");

    // Persist once via --snapshot, capture md5, then hammer --report: md5 must stay put.
    const snap = runCli(tmp, "--snapshot");
    assert.equal(snap.status, 0, snap.stderr);
    assert.ok(fs.existsSync(aggFile), "--snapshot must create the aggregate file");
    const before = md5(fs.readFileSync(aggFile, "utf8"));
    for (let i = 0; i < 5; i++) {
      const r = runCli(tmp, "--report");
      assert.equal(r.status, 0, r.stderr);
    }
    const after = md5(fs.readFileSync(aggFile, "utf8"));
    assert.equal(after, before, "--report must not change the aggregate file's md5 (pure read)");
  } finally {
    cleanup(tmp);
  }
});

test("AC2 — --snapshot is the explicit persist: it writes the aggregate under milestones/fast-mode-telemetry/", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");

    const snap = runCli(tmp, "--snapshot");
    assert.equal(snap.status, 0, snap.stderr);
    assert.match(snap.stdout, /aggregate snapshot written/, "--snapshot human output must report the written file");

    const date = new Date().toISOString().slice(0, 10);
    const aggFile = path.join(tmp, "milestones", "fast-mode-telemetry", `${date}.json`);
    assert.ok(fs.existsSync(aggFile), `aggregate file should exist at ${aggFile}`);
    const agg = JSON.parse(fs.readFileSync(aggFile, "utf8"));
    assert.equal(agg.tasks.length, 1);
    assert.equal(agg.tasks[0].taskId, "gap-test-1");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — 20 consecutive --report calls leave git status --porcelain empty", async () => {
  const tmp = makeTmpWorkspace();
  try {
    // A real git repo so the "working tree stays clean" claim is meaningful. Mirror the real
    // repo: .workflow-events/ is gitignored, the aggregate is tracked.
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");

    const s = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");
    const snap = runCli(tmp, "--snapshot");
    assert.equal(snap.status, 0, snap.stderr);

    const add = gitCmd(tmp, "add", "-A");
    assert.equal(add.status, 0, add.stderr);
    const commit = gitCmd(tmp, "commit", "-m", "seed aggregate");
    assert.equal(commit.status, 0, commit.stderr);

    for (let i = 0; i < 20; i++) {
      const r = runCli(tmp, "--report");
      assert.equal(r.status, 0, r.stderr);
    }

    const status = gitCmd(tmp, "status", "--porcelain");
    assert.equal(status.stdout.trim(), "", `git status must be clean after 20 --report calls, got: ${JSON.stringify(status.stdout)}`);
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — --snapshot --json stdout is byte-identical to the aggregate file; same-moment --report data matches", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");

    const snap = runCli(tmp, "--snapshot", "--json");
    assert.equal(snap.status, 0, snap.stderr);

    const date = new Date().toISOString().slice(0, 10);
    const aggFile = path.join(tmp, "milestones", "fast-mode-telemetry", `${date}.json`);
    const fileContent = fs.readFileSync(aggFile, "utf8");
    assert.equal(snap.stdout, fileContent, "--snapshot --json stdout must equal the file it wrote (byte-identical, no divergence)");

    // Same-moment --report must carry the same DATA-bearing fields (the two paths cannot fork).
    // tasksPerHour/windowStart/windowEnd/windowHours are deliberately EXCLUDED here: the CLI always
    // passes nowMs = Date.now(), so EVERY report is a LIVE window whose end tracks the invocation
    // instant (windowEnd = max(latest endedAtMs, nowMs)); two calls a few ms apart therefore differ
    // in these fields by design — that is the live-window semantics, not a fork. The invariant
    // across the two paths is the event-derived data above; the window fields are checked for sanity
    // below rather than exact equality.
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const repObj = JSON.parse(rep.stdout);
    const fileObj = JSON.parse(fileContent);
    for (const key of ["tasks", "orphaned", "inProgress", "meanMinutes", "medianMinutes", "serialEquivalentPerHour"]) {
      assert.deepEqual(repObj[key], fileObj[key], `--report and --snapshot must agree on "${key}"`);
    }
    // The window fields are live (nowMs differs per call) — assert they are present and sane in the
    // snapshot object rather than exact across the two invocations.
    for (const obj of [repObj, fileObj]) {
      assert.ok(typeof obj.windowHours === "number" && obj.windowHours > 0, `windowHours must be positive, got ${obj.windowHours}`);
      assert.ok(!Number.isNaN(Date.parse(obj.windowStart)) && !Number.isNaN(Date.parse(obj.windowEnd)), "windowStart/End must be ISO");
      assert.ok(Date.parse(obj.windowEnd) >= Date.parse(obj.windowStart), "windowEnd must not precede windowStart");
    }
  } finally {
    cleanup(tmp);
  }
});

// ── AC7: .workflow-events stays gitignored ───────────────────────────────────────────────────────────

test("AC7 — .workflow-events/ is gitignored (raw events never tracked)", () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^\s*\.workflow-events\//m, ".gitignore must contain .workflow-events/");
});

// ── AC8: zero new event schema ───────────────────────────────────────────────────────────────────────

test("AC8 — the module imports A1a's schema; defines no second format", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert.match(src, /workflow-event-schema\.mjs/, "module must import the A1a schema module");
  assert.doesNotMatch(src, /export\s+const\s+VALID_STAGES\b/, "must not redefine VALID_STAGES");
  assert.doesNotMatch(src, /export\s+const\s+VALID_OUTCOMES\b/, "must not redefine VALID_OUTCOMES");
  assert.doesNotMatch(src, /export\s+const\s+SCHEMA_VERSION\b/, "must not redefine SCHEMA_VERSION");
  assert.doesNotMatch(src, /export\s+const\s+REQUIRED_FIELDS\b/, "must not redefine REQUIRED_FIELDS");
});

test("AC8 — the schema additively admits the fast-mode stage and abandoned outcome", async () => {
  const schema = await importSchema();
  assert.ok(schema.VALID_STAGES.includes("Fast"), `VALID_STAGES must include "Fast": ${schema.VALID_STAGES.join(",")}`);
  assert.ok(schema.VALID_OUTCOMES.includes("abandoned"), `VALID_OUTCOMES must include "abandoned": ${schema.VALID_OUTCOMES.join(",")}`);
});

// ── AC9: decision recorded; SCHEMA_VERSION unchanged ─────────────────────────────────────────────────

test("AC9 — stage-vocabulary decision recorded in the module header", () => {
  const src = fs.readFileSync(CLI, "utf8");
  // The decision must name the two options (extend additively vs map) and pin SCHEMA_VERSION.
  assert.match(src, /additive/i, "header must record the additive-growth decision");
  assert.match(src, /SCHEMA_VERSION/, "header must reference SCHEMA_VERSION");
  assert.match(src, /VALID_STAGES/, "header must reference VALID_STAGES");
});

test("AC9 — SCHEMA_VERSION stays \"1\" (pure additive change)", async () => {
  const schema = await importSchema();
  assert.equal(schema.SCHEMA_VERSION, "1");
});

// ── Adversarial-review regression tests (round 1) ────────────────────────────────────────────────────

test("DEFECT-1 — --task-end rejects a path-traversal --runId (fail-closed)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--task-end", "--taskId", "pwn", "--runId", "../../escape", "--outcome", "done");
    assert.notEqual(res.status, 0, "path-traversal runId must fail closed");
    assert.match(res.stderr, /filename-safe|runId/, `stderr should explain: ${res.stderr}`);
    // The escaped write would land one level above tmp (i.e. inside os.tmpdir()).
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), "escape.jsonl")), "no escaped file outside the workspace");
  } finally {
    cleanup(tmp);
  }
});

test("DEFECT-1 — writeEvent rejects an unsafe runId at the persistence choke point", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    const ev = cli.buildEndEvent({ taskId: "x", runId: "../escape", outcome: "done" });
    assert.throws(() => cli.writeEvent(ev, tmp), /filename-safe/);
  } finally {
    cleanup(tmp);
  }
});

test("DEFECT-2 — --since applied at pair level: a straddling pair stays completed, not orphaned", async () => {
  const cli = await importCli();
  const runId = cli.generateRunId("straddle");
  const start = cli.buildStartEvent({ taskId: "straddle", runId, recordedAtMs: 1_000_000 });
  const end = cli.buildEndEvent({ taskId: "straddle", runId, outcome: "done", recordedAtMs: 1_060_000 });

  const r = cli.aggregate([start, end], { sinceMs: 1_030_000 });
  assert.equal(r.tasks.length, 1, "straddling pair must stay completed");
  assert.equal(r.tasks[0].taskId, "straddle");
  assert.equal(r.orphaned.length, 0, "must not be mislabelled orphaned");

  // Window strictly after both events → nothing.
  const r2 = cli.aggregate([start, end], { sinceMs: 2_000_000 });
  assert.equal(r2.tasks.length, 0);
  assert.equal(r2.orphaned.length, 0);
});

test("DEFECT-3 — negative wall-clock is clamped to 0, never surfaced negative", async () => {
  const cli = await importCli();
  const runId = cli.generateRunId("skew");
  const start = cli.buildStartEvent({ taskId: "skew", runId, recordedAtMs: 1_060_000 });
  const end = cli.buildEndEvent({ taskId: "skew", runId, outcome: "done", recordedAtMs: 1_000_000 });
  const r = cli.aggregate([start, end]);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].minutes, 0, "negative wall-clock clamped to 0");
  assert.ok(r.meanMinutes >= 0 && r.medianMinutes >= 0 && r.tasksPerHour >= 0, "roll-up must not go negative");
});

test("DEFECT-4 — a start-like Fast event without eventKind still pairs (not orphaned)", async () => {
  const cli = await importCli();
  const schema = await importSchema();

  const runId = cli.generateRunId("nokind");
  const start = cli.buildStartEvent({ taskId: "nokind", runId, recordedAtMs: 1_000_000 });
  delete start.eventKind; // extra fields are optional per A1a — timing markers carry the role
  const end = cli.buildEndEvent({ taskId: "nokind", runId, outcome: "done", recordedAtMs: 1_060_000 });
  assert.equal(schema.validateEvent(start).ok, true, "eventKind-less start must remain schema-valid");

  const r = cli.aggregate([start, end]);
  assert.equal(r.tasks.length, 1, "must pair despite missing eventKind");
  assert.equal(r.orphaned.length, 0, "must not be orphaned");

  // A lone eventKind-less start is in-progress, not orphaned.
  const runId2 = cli.generateRunId("nokind2");
  const start2 = cli.buildStartEvent({ taskId: "nokind2", runId: runId2, recordedAtMs: 1_000_000 });
  delete start2.eventKind;
  const r2 = cli.aggregate([start2]);
  assert.equal(r2.inProgress.length, 1);
  assert.equal(r2.orphaned.length, 0);
});

// ── gap-tasksperhour-measures-mean-duration-not-throughput (AC1–AC6) ────────────────────────────────
// The old tasksPerHour = 60/mean measured per-task SPEED and penalized concurrency (two 60-min tasks
// finishing in the same wall-clock hour reported 1.0, not the real 2.0). The fix makes it
// count / wall-clock-window-hours (throughput) and renames the old quantity serialEquivalentPerHour.
// AC4/AC6 are fixture-based: the "real data" is today's actual fast-mode event stream (extracted from
// the real .workflow-events/ on 2026-08-03), pinned deterministically instead of depending on the
// ephemeral gitignored store.

/** Real task pairs from 2026-08-03's event stream (taskId, startMs, endMs, outcome). */
const REAL_PAIRS = [
  { taskId: "gap-test-suite-has-no-layer-grouping", start: 1785666586000, end: 1785670656957, outcome: "needs-human" },
  { taskId: "gap-select-preflight-json-real-store-too-slow", start: 1785673841100, end: 1785676256517, outcome: "done" },
  { taskId: "gap-symlink-mirror-invocation-test-contract-mismatch", start: 1785673841406, end: 1785676256790, outcome: "done" },
  { taskId: "gap-dod-clause13-14-enforced-but-undocumented", start: 1785673841720, end: 1785676257094, outcome: "done" },
  { taskId: "gap-tests-spawn-cli-from-ts-source", start: 1785676937141, end: 1785678283130, outcome: "done" },
  { taskId: "gap-tests-use-cli-where-module-import-suffices", start: 1785678301022, end: 1785680368443, outcome: "done" },
  { taskId: "gap-suite-cost-model-is-wrong-optimizations-buy-nothing", start: 1785685475176, end: 1785689806550, outcome: "done" },
  { taskId: "gap-telemetry-report-writes-and-deadlocks-readiness", start: 1785690646988, end: 1785692040224, outcome: "done" },
  { taskId: "DIR-112", start: 1785692650198, end: 1785693276313, outcome: "done" },
  { taskId: "DIR-124-A5", start: 1785693852294, end: 1785693858145, outcome: "done" },
  { taskId: "DIR-124-A2", start: 1785693890544, end: 1785697483048, outcome: "done" },
  { taskId: "gap-sync-vendor-drift-mislabelled-as-task-schema", start: 1785698309188, end: 1785703480220, outcome: "needs-human" },
  { taskId: "gap-test-sh-flags-only-form-silently-runs-a-different-suite", start: 1785703705899, end: 1785706276278, outcome: "done" },
  { taskId: "gap-suite-concurrency-4-vs-8-measurement", start: 1785706293561, end: 1785710871270, outcome: "done" },
  { taskId: "gap-sync-vendor-drift-mislabelled-as-task-schema", start: 1785711272123, end: 1785714872254, outcome: "done" },
  { taskId: "gap-relation-sync-suite-red-isolation-green", start: 1785715527301, end: 1785718454265, outcome: "done" },
  { taskId: "gap-no-explicit-blocked-signal-from-inner-layer", start: 1785715628932, end: 1785719008293, outcome: "done" },
  { taskId: "gap-no-test-framework-policy-for-new-tests", start: 1785715629445, end: 1785719008575, outcome: "done" },
];

/** Point-in-time artifacts the outer loop's "排除 gap-test-* 测试产物" rule excluded from throughput. */
const TEST_ARTIFACTS = new Set(["gap-test-suite-has-no-layer-grouping", "DIR-124-A5"]);

const REAL_SINCE = Date.parse("2026-08-02T17:43:24Z"); // the unattended-operation window start (AC4/AC6)
const MEASURE_0025 = Date.parse("2026-08-03T00:25:00Z"); // when AC4's 0.90/1.14 regression was recorded
const BATCH_END = Date.parse("2026-08-03T01:03:28.575Z"); // the 01:03:28Z concurrent-pair completion

/**
 * Build start+end events for a list of {taskId, start, end?, outcome?} entries. Unique runIds per
 * entry (index-based) so duplicate taskIds (e.g. gap-sync-vendor-drift appearing twice) pair apart.
 * An entry with no `end` is an in-progress start event.
 */
function buildFixtureEvents(cli, entries) {
  return entries.flatMap((t, i) => {
    const runId = `fixture-${i}-${String(t.taskId).replace(/[^A-Za-z0-9._-]/g, "-")}`;
    const startEv = cli.buildStartEvent({ taskId: t.taskId, runId, recordedAtMs: t.start });
    if (t.end == null) return [startEv];
    return [startEv, cli.buildEndEvent({ taskId: t.taskId, runId, outcome: t.outcome ?? "done", recordedAtMs: t.end })];
  });
}

test("AC1 — tasksPerHour = count/windowHours (throughput), not 60/mean — two parallel 60-min tasks → 2.0", async () => {
  const cli = await importCli();
  const events = buildFixtureEvents(cli, [
    { taskId: "p1", start: 0, end: 3_600_000, outcome: "done" },
    { taskId: "p2", start: 0, end: 3_600_000, outcome: "done" },
  ]);
  const r = cli.aggregate(events, { nowMs: 3_600_000 });
  assert.equal(r.tasks.length, 2);
  assert.equal(r.windowHours, 1, "two tasks completing inside the same 1-hour window");
  assert.ok(Math.abs(r.tasksPerHour - 2) < 0.001, `throughput must be 2 tasks/hour, got ${r.tasksPerHour}`);
  assert.equal(r.serialEquivalentPerHour, 1, "the old 60/mean (serial-equivalent) still reports 1 for two parallel 60-min tasks");
  assert.notEqual(r.tasksPerHour, r.serialEquivalentPerHour, "throughput and serial-equivalent diverge under concurrency");
});

test("AC2 — windowStart = --since when given, else the earliest startedAtMs", async () => {
  const cli = await importCli();
  const events = buildFixtureEvents(cli, [
    { taskId: "a", start: 5_000, end: 6_000 },
    { taskId: "b", start: 10_000, end: 11_000 },
  ]);
  const withSince = cli.aggregate(events, { sinceMs: 7_000, nowMs: 12_000 });
  assert.equal(withSince.windowStart, new Date(7_000).toISOString(), "--since must be the window start");
  assert.equal(withSince.tasks.length, 1, "the pre-since pair must be excluded");
  const noSince = cli.aggregate(events, { nowMs: 12_000 });
  assert.equal(noSince.windowStart, new Date(5_000).toISOString(), "earliest startedAtMs must be the window start when no --since");
});

test("AC3 — --report --json carries windowStart/windowEnd/windowHours", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-test-w");
    assert.equal(s.status, 0, s.stderr);
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-test-w", "--runId", runId, "--outcome", "done");
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);
    assert.ok("windowStart" in out && "windowEnd" in out && "windowHours" in out, "report must carry window fields");
    assert.equal(typeof out.windowHours, "number");
    assert.ok(!Number.isNaN(Date.parse(out.windowStart)), `windowStart must be ISO, got ${out.windowStart}`);
    assert.ok(!Number.isNaN(Date.parse(out.windowEnd)), `windowEnd must be ISO, got ${out.windowEnd}`);
    assert.ok(out.windowHours >= 0, `windowHours must be non-negative, got ${out.windowHours}`);
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — real-data regression: unattended window ≈0.90 and full period ≈1.14 (old code reported 1.33 for both)", async () => {
  const cli = await importCli();
  // Unattended window (--since 17:43:24Z) as it stood at 00:25Z: 6 real completions, the window
  // still LIVE (the 01:03:28Z concurrent batch is in-progress), measured at 00:25Z → 6/6.69h ≈ 0.90.
  const unattendedPairs = REAL_PAIRS.filter((p) => p.end >= REAL_SINCE && p.end <= MEASURE_0025 && !TEST_ARTIFACTS.has(p.taskId));
  assert.equal(unattendedPairs.length, 6, "fixture sanity: 6 real unattended-window completions by 00:25Z");
  const unattendedLive = [
    ...unattendedPairs,
    { taskId: "gap-relation-sync-suite-red-isolation-green", start: 1785715527301, outcome: "done" },
    { taskId: "gap-no-explicit-blocked-signal-from-inner-layer", start: 1785715628932, outcome: "done" },
    { taskId: "gap-no-test-framework-policy-for-new-tests", start: 1785715629445, outcome: "done" },
  ];
  const r1 = cli.aggregate(buildFixtureEvents(cli, unattendedLive), { sinceMs: REAL_SINCE, nowMs: MEASURE_0025 });
  assert.ok(Math.abs(r1.tasksPerHour - 0.90) < 0.02, `unattended-window throughput ≈0.90, got ${r1.tasksPerHour.toFixed(3)}`);

  // Full period as it stood at 00:25Z: 13 real completions (excluding the 2 test artifacts), a CLOSED
  // window ending at the latest endedAtMs → 13/11.40h ≈ 1.14. This is a HISTORICAL computation:
  // aggregate() is called with nowMs omitted (windowEnd = latest endedAtMs). The live CLI never
  // produces this exact value — it passes nowMs = Date.now() so its window extends to the current
  // instant; the historical 1.14 is what the outer loop recorded at the 00:25Z measurement moment.
  const fullPairs = REAL_PAIRS.filter((p) => p.end <= MEASURE_0025 && !TEST_ARTIFACTS.has(p.taskId));
  assert.equal(fullPairs.length, 13, "fixture sanity: 13 real full-period completions by 00:25Z");
  const r2 = cli.aggregate(buildFixtureEvents(cli, fullPairs), {});
  assert.ok(Math.abs(r2.tasksPerHour - 1.14) < 0.02, `full-period throughput ≈1.14, got ${r2.tasksPerHour.toFixed(3)}`);
  // The full-period window start is the earliest startedAtMs; the window end is the latest endedAtMs.
  assert.equal(r2.windowStart, new Date(1785673841100).toISOString());
  assert.equal(r2.windowEnd, new Date(1785714872254).toISOString());
});

test("AC5 — the old metric is renamed serialEquivalentPerHour, annotated unrelated to concurrency, never the ambiguous name", async () => {
  const cli = await importCli();
  const src = fs.readFileSync(CLI, "utf8");
  assert.match(src, /serialEquivalentPerHour/, "module must emit the renamed serial-equivalent field");
  assert.match(src, /unrelated to concurrency/i, "annotation must state the serial-equivalent is unrelated to concurrency");
  assert.doesNotMatch(src, /const tasksPerHour = totalMinutes > 0 \? \(count \* 60\) \/ totalMinutes/, "tasksPerHour must no longer be 60/mean");
  // Two parallel 60-min tasks: throughput 2.0 vs serial-equivalent 1.0 — they must diverge.
  const events = buildFixtureEvents(cli, [
    { taskId: "p1", start: 0, end: 3_600_000 },
    { taskId: "p2", start: 0, end: 3_600_000 },
  ]);
  const r = cli.aggregate(events, { nowMs: 3_600_000 });
  assert.equal("serialEquivalentPerHour" in r, true, "report must carry serialEquivalentPerHour");
  assert.equal(r.serialEquivalentPerHour, 1, "60/mean for two 60-min tasks = 1");
  assert.ok(r.tasksPerHour !== r.serialEquivalentPerHour, "throughput and serial-equivalent must not be conflated");
});

test("AC6 — concurrency regression: the 01:03:28Z parallel completions RAISE throughput while the OLD serial-equivalent FALLS", async () => {
  const cli = await importCli();
  const beforeBatch = BATCH_END - 3_600_000; // 00:03:28.575Z — before the concurrent pair completed
  const completedBeforeAll = REAL_PAIRS.filter((p) => p.end <= beforeBatch);
  const completedBeforeNoArt = completedBeforeAll.filter((p) => !TEST_ARTIFACTS.has(p.taskId));
  const batch = [
    { taskId: "gap-relation-sync-suite-red-isolation-green", start: 1785715527301, end: 1785718454265, outcome: "done" },
    { taskId: "gap-no-explicit-blocked-signal-from-inner-layer", start: 1785715628932, end: 1785719008293, outcome: "done" },
    { taskId: "gap-no-test-framework-policy-for-new-tests", start: 1785715629445, end: 1785719008575, outcome: "done" },
  ];
  const batchInProgress = batch.map(({ taskId, start }) => ({ taskId, start, outcome: "done" }));

  // Population note (REFUTE round-1 NIT): the THROUGHPUT half uses the artifact-EXCLUDED set
  // (6→9 in-window completions) — matching the outer loop's documented "排除 gap-test-* 测试产物"
  // throughput column (0.95→1.22); the SERIAL-EQUIVALENT half uses the artifact-INCLUDED set
  // (15→18 completions) — matching the old CLI's raw output (1.33→1.29). The direction is robust
  // under either population (serial over the no-artifact set also falls: 1.281→1.247).
  // BEFORE: 15 completed (all tasks incl. artifacts) + the 3 batch tasks still in-progress.
  const beforeTph = cli.aggregate(buildFixtureEvents(cli, [...completedBeforeNoArt, ...batchInProgress]), { sinceMs: REAL_SINCE, nowMs: beforeBatch });
  const beforeSerial = cli.aggregate(buildFixtureEvents(cli, [...completedBeforeAll, ...batchInProgress]), { nowMs: beforeBatch });

  // AFTER: all 18 completed (the pair finished at the same 01:03:28Z instant).
  const afterTph = cli.aggregate(buildFixtureEvents(cli, [...completedBeforeNoArt, ...batch]), { sinceMs: REAL_SINCE, nowMs: BATCH_END });
  const afterSerial = cli.aggregate(buildFixtureEvents(cli, [...completedBeforeAll, ...batch]), { nowMs: BATCH_END });

  // Real throughput over the unattended window RISES 0.95 → 1.22 — concurrency is not penalized.
  assert.ok(Math.abs(beforeTph.tasksPerHour - 0.95) < 0.03, `before-batch throughput ≈0.95, got ${beforeTph.tasksPerHour.toFixed(3)}`);
  assert.ok(Math.abs(afterTph.tasksPerHour - 1.22) < 0.03, `after-batch throughput ≈1.22, got ${afterTph.tasksPerHour.toFixed(3)}`);
  assert.ok(afterTph.tasksPerHour > beforeTph.tasksPerHour, "the same concurrent completions must RAISE throughput");

  // The OLD serial-equivalent metric FALLS 1.33 → 1.29 — the reverse signal (the defect this fixes).
  assert.ok(Math.abs(beforeSerial.serialEquivalentPerHour - 1.33) < 0.02, `before serial-equivalent ≈1.33, got ${beforeSerial.serialEquivalentPerHour.toFixed(3)}`);
  assert.ok(Math.abs(afterSerial.serialEquivalentPerHour - 1.29) < 0.02, `after serial-equivalent ≈1.29, got ${afterSerial.serialEquivalentPerHour.toFixed(3)}`);
  assert.ok(afterSerial.serialEquivalentPerHour < beforeSerial.serialEquivalentPerHour, "the old metric must FALL when concurrency rises");
});

// ── Byte-identity ────────────────────────────────────────────────────────────────────────────────────

test("Byte-identity — experiments and plugin mirrors are byte-identical", () => {
  const plug = fs.readFileSync(CLI, "utf8");
  const exp = fs.readFileSync(CLI_MIRROR, "utf8");
  assert.equal(exp, plug, "fast-mode-telemetry.ts mirrors must be byte-identical");
});

test("Byte-identity — workflow-event-schema mirrors still byte-identical", () => {
  const plug = fs.readFileSync(SCHEMA, "utf8");
  const exp = fs.readFileSync(path.join(EXP_SCRIPTS, "workflow-event-schema.mjs"), "utf8");
  assert.equal(exp, plug, "workflow-event-schema.mjs mirrors must stay byte-identical");
});

// ── Reconcile (gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards) ──
// A crash kills the executor and `--task-end` never comes — the record sits in `inProgress` forever
// (phantom), and the only signal that eventually fires about it (OVER90) is indistinguishable from a
// genuinely slow task. `--reconcile` closes an in-flight record ONLY when the executor is OBSERVABLY
// gone (branch merged / worktree gone / process gone — never wall-clock age), and never closes a
// record whose executor is still present (AC3 negative control). The ACs are pinned below.

test("AC6 — this file declares // @test-group governance (metering/measurement layer)", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /\/\/ @test-group governance/, "must declare @test-group governance");
});

test("RECONCILE — a branch-merged phantom is closed with an observable reason; a live executor is kept (AC2/AC3/AC4)", async () => {
  const cli = await importCli();
  const old = Date.now() - 91 * 60_000; // 91 min — OVER90 territory, but age alone must never decide
  const inProgress = [
    { taskId: "phantom-merged", runId: "fm-phantom-1", startedAtMs: old },
    { taskId: "phantom-worktree-gone", runId: "fm-phantom-2", startedAtMs: Date.now() - 5 * 60_000 },
    { taskId: "live", runId: "fm-live-1", startedAtMs: old }, // AC4: old but executor alive → kept
  ];
  const { closed, kept } = cli.reconcileInFlight(inProgress, {
    executorGone: (rec) => {
      if (rec.taskId === "phantom-merged") return { gone: true, reason: "branch-merged" };
      if (rec.taskId === "phantom-worktree-gone") return { gone: true, reason: "worktree-gone-and-no-process" };
      return { gone: false, reason: "process-alive" };
    },
    firstKnownCommitMs: () => null,
  });
  const closedMerged = closed.find((c) => c.taskId === "phantom-merged");
  const closedWt = closed.find((c) => c.taskId === "phantom-worktree-gone");
  assert.ok(closedMerged, `branch-merged phantom must be closed: ${JSON.stringify(closed)}`);
  assert.equal(closedMerged.reconcileReason, "branch-merged");
  assert.equal(closedMerged.outcome, "abandoned");
  assert.ok(closedWt, "worktree-gone phantom must be closed");
  assert.equal(closedWt.reconcileReason, "worktree-gone-and-no-process");
  // AC4: the 91-minute-old record whose executor is alive is NOT closed.
  assert.equal(closed.some((c) => c.taskId === "live"), false, "a live executor must never be closed, regardless of age");
  const keptLive = kept.find((k) => k.taskId === "live");
  assert.ok(keptLive, "live record must be kept");
  assert.equal(keptLive.keepReason, "process-alive");
});

test("RECONCILE — without an executor probe, records are kept (fail-closed; never close without evidence)", async () => {
  const cli = await importCli();
  const { closed, kept } = cli.reconcileInFlight([{ taskId: "x", runId: "fm-x-1", startedAtMs: 1 }], {});
  assert.equal(closed.length, 0, "no evidence ⇒ nothing closed");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].keepReason, "no-executor-probe");
});

test("RECONCILE — a backfilled start (later than the task's first known commit) is marked startedAtMs-unreliable (AC7)", async () => {
  const cli = await importCli();
  const firstCommit = Date.parse("2026-08-04T04:00:00Z");
  const { closed, kept } = cli.reconcileInFlight(
    [
      { taskId: "backfilled", runId: "fm-b1", startedAtMs: firstCommit + 3_600_000 }, // after → unreliable
      { taskId: "honest", runId: "fm-h1", startedAtMs: firstCommit - 3_600_000 }, // before → reliable
    ],
    { executorGone: () => ({ gone: true, reason: "branch-merged" }), firstKnownCommitMs: () => firstCommit },
  );
  const b = closed.find((c) => c.taskId === "backfilled");
  const h = closed.find((c) => c.taskId === "honest");
  assert.ok(b && h, "both must be closed in this fixture");
  assert.equal(b.startedAtMsUnreliable, true, "start after first known commit ⇒ unreliable");
  assert.equal(h.startedAtMsUnreliable, false, "start before first known commit ⇒ reliable");
  assert.equal(kept.length, 0);
});

test("RECONCILE — a reconcile-closed pair routes to reconciled[], never tasks[] (throughput stays clean)", async () => {
  const cli = await importCli();
  const runId = cli.generateRunId("phantom");
  const start = cli.buildStartEvent({ taskId: "phantom", runId, recordedAtMs: 1_000_000 });
  const end = cli.buildEndEvent({
    taskId: "phantom", runId, outcome: "abandoned", reconcileReason: "branch-merged", recordedAtMs: 1_100_000,
  });
  const r = cli.aggregate([start, end], { nowMs: 1_100_000 });
  assert.equal(r.reconciled.length, 1, "reconcile-closed pair must surface in reconciled[]");
  assert.equal(r.reconciled[0].reconcileReason, "branch-merged");
  assert.equal(r.tasks.length, 0, "a reconcile-closed phantom must never count as a completed task");
  assert.equal(r.inProgress.length, 0, "a reconcile-closed record leaves inProgress (OVER90 no longer fires)");
  assert.equal(r.tasksPerHour, 0, "phantom must not contribute to throughput");
});

test("RECONCILE — a startedAtMs-unreliable completed pair is excluded from the throughput numerator AND denominator (AC7)", async () => {
  const cli = await importCli();
  const firstCommit = 1_000_000;
  const uRunId = cli.generateRunId("backfilled");
  const uStart = cli.buildStartEvent({ taskId: "backfilled", runId: uRunId, recordedAtMs: firstCommit + 60_000 });
  const uEnd = cli.buildEndEvent({ taskId: "backfilled", runId: uRunId, outcome: "done", recordedAtMs: firstCommit + 120_000 });
  const hRunId = cli.generateRunId("honest");
  const hStart = cli.buildStartEvent({ taskId: "honest", runId: hRunId, recordedAtMs: firstCommit - 60_000 });
  const hEnd = cli.buildEndEvent({ taskId: "honest", runId: hRunId, outcome: "done", recordedAtMs: firstCommit + 60_000 });
  const r = cli.aggregate([uStart, uEnd, hStart, hEnd], {
    nowMs: firstCommit + 120_000,
    firstKnownCommitMsByTask: () => firstCommit,
  });
  assert.equal(r.tasks.length, 1, "only the reliable pair counts as a completed task (numerator exclusion)");
  assert.equal(r.tasks[0].taskId, "honest");
  assert.equal(r.unreliable.length, 1, "the backfilled pair surfaces in unreliable[]");
  assert.equal(r.unreliable[0].taskId, "backfilled");
  assert.equal(r.unreliable[0].startedAtMsUnreliable, true);
  // Denominator exclusion: the unreliable start must not pull windowStart earlier.
  assert.equal(r.windowStart, new Date(firstCommit - 60_000).toISOString(), "unreliable start must not pull the window earlier");
});

test("AC5 — OVER90 no longer fires for a reconcile-closed record; still fires for a genuine slow task", async () => {
  const cli = await importCli();
  const { detectTaskOver90m } = await import(path.join(PLUGIN_SCRIPTS, "inner-blocked-signal.ts"));
  const tmp = makeTmpWorkspace();
  try {
    const old = Date.now() - 91 * 60_000;
    // Phantom only, closed by reconcile: OVER90 must be silent.
    const pRun = cli.generateRunId("phantom-slow");
    cli.writeEvent(cli.buildStartEvent({ taskId: "phantom-slow", runId: pRun, recordedAtMs: old }), tmp);
    cli.writeEvent(cli.buildEndEvent({
      taskId: "phantom-slow", runId: pRun, outcome: "abandoned", reconcileReason: "branch-merged", recordedAtMs: Date.now(),
    }), tmp);
    const afterClose = await detectTaskOver90m(tmp);
    assert.equal(afterClose, null, `OVER90 must NOT fire for a reconcile-closed record: ${JSON.stringify(afterClose)}`);

    // A genuine slow task (same 91-min age, executor still present → no reconcile end): OVER90 fires.
    const gRun = cli.generateRunId("genuine-slow");
    cli.writeEvent(cli.buildStartEvent({ taskId: "genuine-slow", runId: gRun, recordedAtMs: old }), tmp);
    const withGenuine = await detectTaskOver90m(tmp);
    assert.ok(withGenuine && withGenuine.taskId === "genuine-slow", `OVER90 must fire for a genuine slow task: ${JSON.stringify(withGenuine)}`);
  } finally {
    cleanup(tmp);
  }
});

test("RECONCILE CLI — real git: a merged-branch phantom closes, an open-worktree task stays (AC2/AC3)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "phantom-task.md"), "---\nid: phantom-task\n---\n", "utf8");
    fs.writeFileSync(path.join(tmp, "tasks", "live-task.md"), "---\nid: live-task\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed tasks").status, 0);
    // phantom-task: branch created and MERGED into master (its work landed ⇒ executor done).
    assert.equal(gitCmd(tmp, "checkout", "-b", "task/phantom-task").status, 0);
    fs.appendFileSync(path.join(tmp, "tasks", "phantom-task.md"), "work\n");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "phantom work landed").status, 0);
    assert.equal(gitCmd(tmp, "checkout", "master").status, 0);
    assert.equal(gitCmd(tmp, "merge", "--no-ff", "task/phantom-task", "-m", "Merge branch 'task/phantom-task'").status, 0);
    // live-task: branch checked out in an OPEN worktree (executor mid-flight ⇒ keep).
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/live-task", path.join(tmp, "wt-live")).status, 0);

    const ps = runCli(tmp, "--task-start", "--taskId", "phantom-task");
    assert.equal(ps.status, 0, ps.stderr);
    const ls = runCli(tmp, "--task-start", "--taskId", "live-task");
    assert.equal(ls.status, 0, ls.stderr);

    const rec = runCli(tmp, "--reconcile", "--json");
    assert.equal(rec.status, 0, rec.stderr);
    const out = JSON.parse(rec.stdout);
    const closedP = (out.closed ?? []).find((c) => c.taskId === "phantom-task");
    const keptL = (out.kept ?? []).find((k) => k.taskId === "live-task");
    assert.ok(closedP, `phantom must be closed by observable branch-merged: ${JSON.stringify(out.closed)}`);
    assert.equal(closedP.reconcileReason, "branch-merged");
    assert.ok(keptL, `live must be kept by observable open-worktree: ${JSON.stringify(out.kept)}`);
    assert.equal(keptL.keepReason, "worktree-present");
    // AC7 annotation on real git: phantom-task's --task-start was written AFTER its work merged
    // (a backfill in this fixture) → unreliable; live-task is freshly dispatched with no work
    // commits yet → NOT unreliable (a fresh dispatch must never be over-flagged).
    assert.equal(closedP.startedAtMsUnreliable, true, "a start written after the work merged is unreliable");
    assert.equal(keptL.startedAtMsUnreliable, false, "a freshly-dispatched task with no work commits is NOT unreliable");

    // After reconcile: phantom left inProgress (into reconciled[], not tasks[]), live still in.
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const repObj = JSON.parse(rep.stdout);
    assert.equal(repObj.inProgress.length, 1, `only live stays in-progress: ${JSON.stringify(repObj.inProgress)}`);
    assert.equal(repObj.inProgress[0].taskId, "live-task");
    assert.equal(repObj.reconciled.length, 1, "phantom surfaces in reconciled[], not tasks[]");
    assert.equal(repObj.reconciled[0].reconcileReason, "branch-merged");
    assert.equal(repObj.reconciled[0].startedAtMsUnreliable, true, "the report marks the reconciled phantom's start unreliable");
    assert.equal(repObj.tasks.length, 0, "no phantom in the completed-tasks roll-up");
  } finally {
    cleanup(tmp);
  }
});

test("RECONCILE — firstKnownCommitMs resolves to the task's WORK start (branch or merge), never its creation (AC7 reference)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  const commit = (args, env = {}) => spawnSync("git", ["-C", tmp, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "wk.md"), "---\nid: wk\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    // Pin the creation commit date so a fallback-to-creation would be detectable.
    assert.equal(commit(["commit", "-m", "create wk.md"], { GIT_AUTHOR_DATE: "2026-08-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-08-01T00:00:00Z" }).status, 0);

    // Freshly dispatched: branch at HEAD with no own commits → no work reference → null.
    assert.equal(gitCmd(tmp, "checkout", "-b", "task/wk-fresh").status, 0);
    assert.equal(gitCmd(tmp, "checkout", "master").status, 0);
    assert.equal(cli.firstKnownCommitMs(tmp, "wk-fresh"), null, "fresh branch with no work commits ⇒ no reference (not unreliable)");

    // In-flight with work: one task-specific commit at a pinned date → that commit is the reference.
    const workDate = "2026-08-02T12:00:00Z";
    const workMs = Date.parse(workDate);
    assert.equal(gitCmd(tmp, "checkout", "-b", "task/wk-work").status, 0);
    fs.appendFileSync(path.join(tmp, "tasks", "wk.md"), "work\n");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(commit(["commit", "-m", "wk work"], { GIT_AUTHOR_DATE: workDate, GIT_COMMITTER_DATE: workDate }).status, 0);
    assert.equal(cli.firstKnownCommitMs(tmp, "wk-work"), workMs, "reference = the task's first work commit");
    assert.equal(gitCmd(tmp, "checkout", "master").status, 0);

    // Merged: branch merged into master → reference = the merge commit time (work already known done).
    assert.equal(gitCmd(tmp, "merge", "--no-ff", "task/wk-work", "-m", `Merge branch 'task/wk-work'`).status, 0);
    const mergeMs = cli.firstKnownCommitMs(tmp, "wk-work");
    assert.ok(mergeMs != null && mergeMs >= workMs, `merged reference should be the merge time (>= work start), got ${mergeMs}`);
  } finally {
    cleanup(tmp);
  }
});

test("RECONCILE — processAlive detects a live process by runId (AC3 real-process criterion)", async () => {
  const cli = await importCli();
  const runId = `fm-proc-${Date.now()}`;
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", runId], { detached: true, stdio: "ignore" });
  child.unref();
  try {
    let alive = false;
    for (let i = 0; i < 50 && !alive; i++) {
      alive = cli.processAlive(runId);
      if (!alive) await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(alive, true, `processAlive must find the runId in /proc: ${runId}`);
  } finally {
    try { process.kill(child.pid, "SIGKILL"); } catch (_) { /* already gone */ }
  }
});

// ── Subagent-transcript liveness (gap-reconcile-processalive-blind-spot-brief-phase-false-close) ────
// `processAlive(runId)` is blind to a brief-phase impl subagent: the Agent-tool dispatch's process
// cmdline carries no runId, and the worktree is not forked yet. The old four-level probe fell through
// to `worktree-gone-and-no-process` and false-closed a LIVE bracket. The fix adds a subagent-transcript
// liveness signal: a transcript at `<session>/subagents/agent-*.jsonl` written within the recency
// window whose content names the task ⇒ KEEP, not false-close.

test("SUBAGENT-LIVENESS — subagentTranscriptAlive finds a recent transcript naming the task (PURE, injected projectsDir)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    const root = "/home/yale/work/quay";
    const proj = path.join(tmp, "projects");
    const sess = path.join(proj, cli.claudeProjectsSlug(root), "sess-1", "subagents");
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(
      path.join(sess, "agent-abc123.jsonl"),
      '{"type":"user","message":{"content":"执行任务 gap-x（任务文件 /home/yale/work/quay/tasks/gap-x.md）。git worktree add /home/yale/work/quay-worktrees/gap-x"}}',
      "utf8",
    );
    assert.equal(cli.subagentTranscriptAlive(root, "gap-x", { projectsDir: proj }), true, "a recent transcript naming the task ⇒ alive");
    assert.equal(cli.subagentTranscriptAlive(root, "gap-other", { projectsDir: proj }), false, "a different taskId is not matched");
    // Aged out: the same transcript read from beyond the recency window ⇒ false (no permanent keep).
    assert.equal(
      cli.subagentTranscriptAlive(root, "gap-x", { projectsDir: proj, nowMs: Date.now() + cli.TRANSCRIPT_LIVENESS_WINDOW_MS + 60_000 }),
      false,
      "a stale transcript outside the window ⇒ not alive",
    );
    // Missing projects dir ⇒ false (fail-closed, never a positive signal from an unavailable source).
    assert.equal(cli.subagentTranscriptAlive(root, "gap-x", { projectsDir: path.join(tmp, "nope") }), false);
  } finally {
    cleanup(tmp);
  }
});

test("SUBAGENT-LIVENESS — claudeProjectsSlug maps a root path to Claude Code's project-dir slug", async () => {
  const cli = await importCli();
  assert.equal(cli.claudeProjectsSlug("/home/yale/work/quay"), "-home-yale-work-quay");
});

test("SUBAGENT-LIVENESS CLI — brief-phase bracket (live transcript, no worktree) is KEPT by --reconcile; closed_brackets_reflect_processes stays true (AC1/AC2/AC3)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  const tmpHome = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "brief-task.md"), "---\nid: brief-task\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);

    // Open a brief-phase bracket: --task-start, NO worktree, NO task branch (the defect shape).
    const start = runCli(tmp, "--task-start", "--taskId", "brief-task");
    assert.equal(start.status, 0, start.stderr);

    // A live impl subagent transcript naming brief-task, written just now, under a temp HOME so the
    // probe (os.homedir → $HOME) scans only this corpus.
    const sess = path.join(tmpHome, ".claude", "projects", cli.claudeProjectsSlug(tmp), "sess-brief", "subagents");
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(
      path.join(sess, "agent-brief123.jsonl"),
      '{"type":"user","message":{"content":"执行任务 brief-task（任务文件 ' + path.join(tmp, "tasks", "brief-task.md") +
        '）。git -C ' + tmp + ' worktree add ' + path.join(path.dirname(tmp), "quay-worktrees", "brief-task") + ' -b task/brief-task develop"}}',
      "utf8",
    );

    const env = { HOME: tmpHome, QUAY_TELEMETRY_SUBAGENTS: "0" };

    // AC1/AC2 negative control: --reconcile KEEPS the brief-phase bracket (no false-close).
    const rec = runCliEnv(tmp, env, "--reconcile", "--json");
    assert.equal(rec.status, 0, rec.stderr);
    const out = JSON.parse(rec.stdout);
    const keptB = (out.kept ?? []).find((k) => k.taskId === "brief-task");
    assert.ok(keptB, `brief-phase bracket must be KEPT: ${JSON.stringify(out)}`);
    assert.equal(keptB.keepReason, "subagent-transcript-alive");
    assert.equal((out.closed ?? []).length, 0, "nothing closed — the live subagent keeps the bracket open");

    // AC3: the slot view reports the bracket as real in-flight, no closed-but-live residual.
    const slot = runCliEnv(tmp, env, "--slot-status", "--cap", "5", "--json");
    assert.equal(slot.status, 0, slot.stderr);
    const s = JSON.parse(slot.stdout);
    assert.equal(s.real_in_flight, 1, "the brief-phase bracket is real in-flight (kept), not stale");
    assert.equal(s.stale_brackets, 0);
    assert.equal(s.closed_but_live_agents.length, 0, "no closed-but-live residual");
    assert.equal(s.closed_brackets_reflect_processes, true, "invariant restored (no false-close ⇒ no closed-but-live)");

    // Negative control: remove the transcript (executor now observably gone) ⇒ --reconcile closes.
    fs.rmSync(path.join(sess, "agent-brief123.jsonl"));
    const rec2 = runCliEnv(tmp, env, "--reconcile", "--json");
    assert.equal(rec2.status, 0, rec2.stderr);
    const out2 = JSON.parse(rec2.stdout);
    const closedB = (out2.closed ?? []).find((c) => c.taskId === "brief-task");
    assert.ok(closedB, `with the transcript gone the bracket closes: ${JSON.stringify(out2)}`);
    assert.equal(closedB.reconcileReason, "worktree-gone-and-no-process");
  } finally {
    cleanup(tmp);
    cleanup(tmpHome);
  }
});

// ── Slot status (gap-telemetry-brackets-vs-subagents-no-slot-visibility) ────────────────────────────

test("SLOT-STATUS — 5 stale brackets + 1 real agent ⇒ real_in_flight 1, slots_free 2 (AC5 regression shape)", async () => {
  const cli = await importCli();
  const inProgress = [
    ...["a", "b", "c", "d", "e"].map((t, i) => ({
      taskId: `stale-${t}`, runId: `fm-stale-${t}-${i}`, startedAtMs: 1000 + i,
    })),
    { taskId: "real-task", runId: "fm-real-1", startedAtMs: 9000 },
  ];
  // Injected deterministic probe: stale-* executor observably gone; real-task worktree present.
  const executorGone = (rec) => rec.taskId.startsWith("stale-")
    ? { gone: true, reason: "worktree-gone-and-no-process" }
    : { gone: false, reason: "worktree-present" };
  const s = cli.analyzeSlotStatus(inProgress, { cap: 3, executorGone });
  assert.equal(s.in_progress_total, 6, "raw bracket count = 5 stale + 1 real");
  assert.equal(s.stale_brackets, 5, "5 brackets have an observably-gone executor");
  assert.equal(s.real_in_flight, 1, "only the worktree-present agent is real in-flight");
  assert.equal(s.slots_free, 2, "cap 3 − real 1 ⇒ 2 slots idle (not 'full' on raw 6, not 'empty')");
  assert.equal(s.slot_state, "free");
  assert.equal(s.brackets_reflect_subagents, false, "raw brackets (6) ≠ real subagents (1) ⇒ invariant false");
  assert.equal(s.closed.length, 5);
  assert.equal(s.kept.length, 1);
  assert.equal(s.kept[0].taskId, "real-task");
});

test("SLOT-STATUS — real_in_flight > cap is a detectable violation (AC3 criterion not vacuous)", async () => {
  const cli = await importCli();
  // 4 live agents, cap 3 — a genuine over-dispatch a vacuous check would let pass.
  const inProgress = [1, 2, 3, 4].map((i) => ({
    taskId: `live-${i}`, runId: `fm-live-${i}-1`, startedAtMs: i,
  }));
  const executorGone = () => ({ gone: false, reason: "worktree-present" });
  const s = cli.analyzeSlotStatus(inProgress, { cap: 3, executorGone });
  assert.equal(s.real_in_flight, 4);
  assert.equal(s.slots_free, 0);
  assert.equal(s.slot_state, "full");
  assert.equal(s.stale_brackets, 0);
  assert.equal(s.brackets_reflect_subagents, true, "all 4 brackets are real — but 4 > cap 3 is the violation");
  // The criterion the self-check uses: real_in_flight ≤ cap. 4 > 3 ⇒ violation caught.
  assert.ok(s.real_in_flight > s.cap, "the slot-status exposes real_in_flight so real_in_flight <= cap is checkable");
});

test("SLOT-STATUS — 0 brackets ⇒ real_in_flight 0, slots_free cap (empty is visible, not 'full')", async () => {
  const cli = await importCli();
  const s = cli.analyzeSlotStatus([], { cap: 3, executorGone: () => ({ gone: false, reason: "n/a" }) });
  assert.equal(s.in_progress_total, 0);
  assert.equal(s.stale_brackets, 0);
  assert.equal(s.real_in_flight, 0);
  assert.equal(s.slots_free, 3);
  assert.equal(s.slot_state, "free");
  assert.equal(s.brackets_reflect_subagents, true, "empty store trivially consistent");
});

test("SLOT-STATUS CLI — real git: merged-branch phantom counts stale, open-worktree agent real; pure-read (AC2/AC5)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "stale-task.md"), "---\nid: stale-task\n---\n", "utf8");
    fs.writeFileSync(path.join(tmp, "tasks", "live-task.md"), "---\nid: live-task\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed tasks").status, 0);
    // stale-task: branch created and MERGED into master ⇒ executor observably done (would close).
    assert.equal(gitCmd(tmp, "checkout", "-b", "task/stale-task").status, 0);
    fs.appendFileSync(path.join(tmp, "tasks", "stale-task.md"), "work\n");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "stale work landed").status, 0);
    assert.equal(gitCmd(tmp, "checkout", "master").status, 0);
    assert.equal(gitCmd(tmp, "merge", "--no-ff", "task/stale-task", "-m", "Merge branch 'task/stale-task'").status, 0);
    // live-task: branch checked out in an OPEN worktree ⇒ executor mid-flight (would keep).
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/live-task", path.join(tmp, "wt-live")).status, 0);

    const ps = runCli(tmp, "--task-start", "--taskId", "stale-task");
    assert.equal(ps.status, 0, ps.stderr);
    const ls = runCli(tmp, "--task-start", "--taskId", "live-task");
    assert.equal(ls.status, 0, ls.stderr);
    // snapshot the .workflow-events/ dir contents BEFORE the slot-status read.
    const before = fs.readdirSync(path.join(tmp, ".workflow-events")).sort();

    const slot = runCli(tmp, "--slot-status", "--cap", "3", "--json");
    assert.equal(slot.status, 0, slot.stderr);
    const out = JSON.parse(slot.stdout);
    assert.equal(out.in_progress_total, 2, "raw brackets = 2 (stale + live)");
    assert.equal(out.stale_brackets, 1, "merged-branch phantom is stale");
    assert.equal(out.real_in_flight, 1, "open-worktree agent is real");
    assert.equal(out.slots_free, 2, "cap 3 − real 1 ⇒ 2 slots idle");
    assert.equal(out.brackets_reflect_subagents, false, "2 raw brackets ≠ 1 real subagent");

    // PURE READ: --slot-status must NOT write a reconcile end event (only --reconcile does).
    const after = fs.readdirSync(path.join(tmp, ".workflow-events")).sort();
    assert.deepEqual(after, before, "--slot-status is pure-read: no event file appears/vanishes");
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    assert.equal(JSON.parse(rep.stdout).inProgress.length, 2, "stale bracket still in inProgress (slot-status did not close it)");
  } finally {
    cleanup(tmp);
  }
});

test("SLOT-STATUS — human output names the stale/reconcile hint when the invariant fails (AC2 readability)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    // 2 starts, no git ⇒ both executors observably gone (bare workspace) ⇒ both stale.
    const a = runCli(tmp, "--task-start", "--taskId", "ghost-a");
    assert.equal(a.status, 0, a.stderr);
    const b = runCli(tmp, "--task-start", "--taskId", "ghost-b");
    assert.equal(b.status, 0, b.stderr);
    const slot = runCli(tmp, "--slot-status", "--cap", "3");
    assert.equal(slot.status, 0, slot.stderr);
    assert.match(slot.stdout, /real in-flight.*: 0/);
    assert.match(slot.stdout, /stale brackets.*: 2/, "both bare-workspace brackets report stale");
    assert.match(slot.stdout, /slots free: 3/);
    assert.match(slot.stdout, /--reconcile/, "human output points at the reconcile action when brackets ≠ subagents");
  } finally {
    cleanup(tmp);
  }
});

test("SLOT-STATUS — closed bracket + live executor is NOT a free slot (reverse direction, AC2/AC3)", async () => {
  const cli = await importCli();
  // 1 OPEN bracket (real in-flight) + 2 CLOSED brackets: one whose executor is STILL present
  // (the defect shape — bracket closed, agent alive) and one whose executor is gone.
  const inProgress = [{ taskId: "running-a", runId: "fm-running-a-1", startedAtMs: 1000 }];
  const completed = [
    { taskId: "ghost-live", runId: "fm-ghost-live-1" }, // bracket closed, but executor present
    { taskId: "ghost-done", runId: "fm-ghost-done-1" }, // bracket closed, executor gone
  ];
  const executorGone = () => ({ gone: false, reason: "worktree-present" });
  const executorPresent = (rec) =>
    rec.taskId === "ghost-live"
      ? { present: true, reason: "worktree-present" }
      : { present: false, reason: "no-present-signal" };
  const s = cli.analyzeSlotStatus(inProgress, { cap: 3, executorGone, completed, executorPresent });
  assert.equal(s.in_progress_total, 1, "1 raw open bracket");
  assert.equal(s.real_in_flight, 1, "open-bracket executor still present");
  assert.equal(s.closed_but_live_agents.length, 1, "the closed-bracket-but-live agent is detected");
  assert.equal(s.closed_but_live_agents[0].taskId, "ghost-live");
  assert.equal(s.closed_but_live_agents[0].reason, "worktree-present");
  assert.equal(s.occupied_slots, 2, "1 real + 1 closed-but-live = 2 occupied");
  assert.equal(s.slots_free, 1, "cap 3 − occupied 2 ⇒ 1 slot free (NOT 2 — the closed-but-live slot must not read free)");
  assert.equal(s.slot_state, "free");
  assert.equal(s.closed_brackets_reflect_processes, false, "a closed bracket whose executor is present violates the reverse invariant");
});

test("SLOT-STATUS — closed-but-live agents can push the slot view to FULL (AC3 negative control)", async () => {
  const cli = await importCli();
  // cap 2, 1 real in-flight + 1 closed-but-live ⇒ 0 free — a new dispatch must NOT be recommended.
  const inProgress = [{ taskId: "running-a", runId: "fm-running-a-1", startedAtMs: 1000 }];
  const completed = [{ taskId: "ghost-live", runId: "fm-ghost-live-1" }];
  const s = cli.analyzeSlotStatus(inProgress, {
    cap: 2,
    executorGone: () => ({ gone: false, reason: "worktree-present" }),
    completed,
    executorPresent: () => ({ present: true, reason: "worktree-present" }),
  });
  assert.equal(s.real_in_flight, 1);
  assert.equal(s.closed_but_live_agents.length, 1);
  assert.equal(s.occupied_slots, 2);
  assert.equal(s.slots_free, 0);
  assert.equal(s.slot_state, "full", "a closed-bracket-but-live agent consumes the last free slot");
});

test("SLOT-STATUS — no completed records ⇒ reverse dimension is a no-op (byte-compatible forward view)", async () => {
  const cli = await importCli();
  const s = cli.analyzeSlotStatus(
    [{ taskId: "running-a", runId: "fm-running-a-1", startedAtMs: 1000 }],
    { cap: 3, executorGone: () => ({ gone: false, reason: "worktree-present" }) },
  );
  assert.equal(s.closed_but_live_agents.length, 0, "absent completed array contributes nothing");
  assert.equal(s.occupied_slots, 1, "occupied = real in-flight only");
  assert.equal(s.slots_free, 2);
  assert.equal(s.closed_brackets_reflect_processes, true, "no closed-but-live ⇒ invariant holds");
});

test("SLOT-STATUS CLI — real git: closed bracket + OPEN worktree reads as occupied, not free (AC2/AC3)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "closed-live.md"), "---\nid: closed-live\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);
    // CLOSED bracket (start + end pair) whose branch is STILL checked out in an open worktree —
    // the defect shape: bracket closed, agent (dispatch environment) still present.
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/closed-live", path.join(tmp, "wt-closed-live")).status, 0);
    const runId = cli.generateRunId("closed-live");
    cli.writeEvent(cli.buildStartEvent({ taskId: "closed-live", runId }), tmp);
    cli.writeEvent(cli.buildEndEvent({ taskId: "closed-live", runId, outcome: "done" }), tmp);

    const slots = runCli(tmp, "--slots", "--cap", "1", "--json");
    assert.equal(slots.status, 0, slots.stderr);
    const out = JSON.parse(slots.stdout);
    assert.equal(out.bracketsInFlight, 0, "the bracket is CLOSED — not in inProgress");
    assert.equal(out.realInFlight, 0, "no open brackets");
    assert.equal(out.closedButLive.length, 1, "the closed-bracket agent is mechanically detected as still present");
    assert.equal(out.closedButLive[0].taskId, "closed-live");
    assert.equal(out.occupiedSlots, 1, "a closed bracket does NOT free the slot while the worktree is open");
    assert.equal(out.slotsRemaining, 0, "cap 1 − occupied 1 ⇒ 0 slots remaining — a new dispatch must not land here");

    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const repObj = JSON.parse(rep.stdout);
    assert.equal(repObj.inProgress.length, 0, "closed bracket not in inProgress");
    assert.equal(repObj.closedButLive.length, 1, "--report surfaces the closed-but-live agent");
    assert.equal(repObj.occupiedSlots, 1);
  } finally {
    cleanup(tmp);
  }
});

test("SLOT-STATUS CLI — real git: closed bracket + worktree REMOVED reads as genuinely free (clean case)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "closed-clean.md"), "---\nid: closed-clean\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);
    // Closed bracket whose executor is OBSERVABLY gone — no branch, no worktree (fully cleaned up).
    const runId = cli.generateRunId("closed-clean");
    cli.writeEvent(cli.buildStartEvent({ taskId: "closed-clean", runId }), tmp);
    cli.writeEvent(cli.buildEndEvent({ taskId: "closed-clean", runId, outcome: "done" }), tmp);

    const slots = runCli(tmp, "--slots", "--cap", "1", "--json");
    assert.equal(slots.status, 0, slots.stderr);
    const out = JSON.parse(slots.stdout);
    assert.equal(out.bracketsInFlight, 0);
    assert.equal(out.closedButLive.length, 0, "executor observably gone ⇒ NOT closed-but-live");
    assert.equal(out.occupiedSlots, 0);
    assert.equal(out.slotsRemaining, 1, "the fully-gone closed bracket leaves its slot genuinely free");
  } finally {
    cleanup(tmp);
  }
});

// ── Fast slot view (QUAY_TELEMETRY_FAST_SLOTS=1) — accounting-emit's occupancy.in_flight source ─────
// (task gap-ac39-accounting-emit-layer, AC3: occupancy.in_flight 三层统一). The full --slots
// aggregation is heavy in a large workspace (~30s: per-task git history + closed-but-live reverse
// scan); the fast view skips both annotations — they are irrelevant to realConcurrency, the number
// accounting-emit's autoOccupancy reads. Contract: realInFlight/realConcurrency are IDENTICAL to the
// full path; closedButLive is empty by design (the reverse-dimension scan is the expensive part).

test("FAST-SLOTS — QUAY_TELEMETRY_FAST_SLOTS=1 reports the same realInFlight/realConcurrency as the full --slots view", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "closed-live.md"), "---\nid: closed-live\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);
    // CLOSED bracket whose branch is STILL checked out in an open worktree — the reverse-dimension
    // defect shape the FULL path detects as closedButLive; the fast path deliberately skips it.
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/closed-live", path.join(tmp, "wt-closed-live")).status, 0);
    const runId = cli.generateRunId("closed-live");
    cli.writeEvent(cli.buildStartEvent({ taskId: "closed-live", runId }), tmp);
    cli.writeEvent(cli.buildEndEvent({ taskId: "closed-live", runId, outcome: "done" }), tmp);

    // Deterministic slot arithmetic for BOTH paths (the full path's runCli default-pins subagents to
    // 0, but this test's exact occupiedSlots assertion must hold even when the ambient env sets
    // QUAY_TELEMETRY_SUBAGENTS — so pin 0 explicitly for both full and fast). The fast path also
    // scans the live machine for non-task subagents
    // (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots), so the pin is what makes
    // the fast-vs-full comparison non-flaky under a concurrent suite.
    const full = JSON.parse(
      runCliEnv(tmp, { QUAY_TELEMETRY_SUBAGENTS: "0" }, "--slots", "--cap", "1", "--json").stdout,
    );
    assert.equal(full.closedButLive.length, 1, "full path detects the closed-but-live agent");
    assert.equal(full.occupiedSlots, 1);

    const fast = JSON.parse(
      runCliEnv(tmp, { QUAY_TELEMETRY_FAST_SLOTS: "1", QUAY_TELEMETRY_SUBAGENTS: "0" }, "--slots", "--cap", "1", "--json").stdout,
    );
    // Core in-flight numbers IDENTICAL — the value accounting-emit's autoOccupancy reads.
    assert.equal(fast.realInFlight, full.realInFlight, "fast realInFlight matches full");
    assert.equal(fast.realConcurrency, full.realConcurrency, "fast realConcurrency matches full");
    assert.equal(fast.bracketsInFlight, full.bracketsInFlight, "fast bracketsInFlight matches full");
    assert.equal(fast.reconcileCompliant, full.reconcileCompliant, "fast reconcileCompliant matches full");
    // The reverse-dimension scan is deliberately skipped — closedButLive empty, occupiedSlots = realConcurrency.
    assert.deepEqual(fast.closedButLive, [], "fast path does not run the closed-but-live reverse scan");
    assert.equal(fast.occupiedSlots, fast.realConcurrency, "fast occupiedSlots = realConcurrency");
  } finally {
    cleanup(tmp);
  }
});

// ── Non-task subagents in-flight (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots) ──
// The UNDER-REPORT direction: an investigation-type subagent (general-purpose / Explore / Plan) has
// NO --task-start bracket, so the bracket-based real_in_flight read 0 while the subagent burned CPU —
// `--slots` reported 0/3 empty slots and the inner state self-check ① judged 3 free slots (real
// concurrency was 4, not 3). The fix counts non-task subagent PROCESSES separately; real concurrency =
// real_in_flight + subagents_in_flight is what the self-check ① must read.

test("SLOT-STATUS — a non-task subagent (no bracket) is counted toward real concurrency (AC1 under-report fix)", async () => {
  const cli = await importCli();
  // Empty bracket store + 1 non-task subagent process (investigation, no --task-start bracket).
  const s = cli.analyzeSlotStatus([], {
    cap: 3,
    executorGone: () => ({ gone: false, reason: "worktree-present" }),
    subagentsInFlight: 1,
  });
  assert.equal(s.real_in_flight, 0, "no brackets ⇒ 0 bracket-based real in-flight");
  assert.equal(s.subagents_in_flight, 1, "the non-task subagent is counted separately");
  assert.equal(s.real_concurrency, 1, "real concurrency = brackets + non-task subagents — NO LONGER 0/3");
  assert.equal(s.occupied_slots, 1, "a non-task subagent occupies a slot");
  assert.equal(s.slots_free, 2, "cap 3 − 1 occupied ⇒ 2 slots free (NOT 3 — a bare subagent must not read as an empty slot)");
});

test("SLOT-STATUS — real task in flight + non-task subagent SUM, never double-count (AC3 negative control)", async () => {
  const cli = await importCli();
  const s = cli.analyzeSlotStatus(
    [{ taskId: "task-a", runId: "fm-task-a-1", startedAtMs: 1000 }],
    { cap: 3, executorGone: () => ({ gone: false, reason: "worktree-present" }), subagentsInFlight: 1 },
  );
  assert.equal(s.real_in_flight, 1, "bracket-based real in-flight unchanged");
  assert.equal(s.subagents_in_flight, 1);
  assert.equal(s.real_concurrency, 2, "real concurrency = bracket(1) + subagent(1) = 2 (each occupies its own slot)");
  assert.equal(s.occupied_slots, 2);
  assert.equal(s.slots_free, 1, "cap 3 − 2 ⇒ 1 free — a real task and a subagent share the budget");
});

test("SLOT-STATUS — zero in-flight (no brackets, no subagents) still reports 0 (AC3 negative control)", async () => {
  const cli = await importCli();
  const s = cli.analyzeSlotStatus([], {
    cap: 3,
    executorGone: () => ({ gone: false, reason: "worktree-present" }),
    subagentsInFlight: 0,
  });
  assert.equal(s.real_concurrency, 0);
  assert.equal(s.occupied_slots, 0);
  assert.equal(s.slots_free, 3);
  assert.equal(s.slot_state, "free");
});

test("countNonTaskSubagents — Contract pgrep pattern; excludes pgrep/bash -c wrappers and the telemetry CLI's own process", async () => {
  const cli = await importCli();
  assert.equal(cli.countNonTaskSubagents([]), 0);
  assert.equal(cli.countNonTaskSubagents(["node general-purpose run"]), 1);
  assert.equal(cli.countNonTaskSubagents(["node Explore agent", "node Plan agent"]), 2);
  assert.equal(
    cli.countNonTaskSubagents([
      "node general-purpose run",
      "pgrep -af general-purpose", // the Contract's grep -v pgrep leg
      "bash -c node general-purpose", // the Contract's grep -v "bash -c" leg
      "node --experimental-strip-types fast-mode-telemetry.ts --slots", // the meter must not count itself
    ]),
    1,
    "pgrep/bash -c wrappers and the telemetry CLI's own process must not count",
  );
  // Case-sensitive Contract pattern: a lowercase "plan" in a path must NOT match.
  assert.equal(cli.countNonTaskSubagents(["node scripts/plan-workflow.ts"]), 0);
});

test("SLOT-STATUS CLI — an in-flight non-task subagent reports realInFlight + subagentsInFlight ≥ 1 (AC1 shape, no more 0/3)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const slots = runCliEnv(tmp, { QUAY_TELEMETRY_SUBAGENTS: "2" }, "--slots", "--cap", "3", "--json");
    assert.equal(slots.status, 0, slots.stderr);
    const out = JSON.parse(slots.stdout);
    assert.equal(out.realInFlight, 0, "empty bracket store ⇒ 0 bracket-based in-flight");
    assert.equal(out.subagentsInFlight, 2, "the 2 non-task subagent processes are reported");
    assert.ok(out.realInFlight + out.subagentsInFlight >= 1, "bare subagents must NOT read as 0/3 empty slots");
    assert.equal(out.realConcurrency, 2, "real concurrency = brackets + non-task subagents");
    assert.equal(out.occupiedSlots, 2, "subagents occupy slots");
    assert.equal(out.slotsRemaining, 1, "cap 3 − occupied 2 ⇒ 1 remaining, NOT 3");
  } finally {
    cleanup(tmp);
  }
});

test("SLOT-STATUS CLI — --slot-status carries subagents_in_flight / real_concurrency (slot-status surface)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const slots = runCliEnv(tmp, { QUAY_TELEMETRY_SUBAGENTS: "1" }, "--slot-status", "--cap", "3", "--json");
    assert.equal(slots.status, 0, slots.stderr);
    const out = JSON.parse(slots.stdout);
    assert.equal(out.subagents_in_flight, 1);
    assert.equal(out.real_concurrency, 1);
    assert.equal(out.occupied_slots, 1);
    assert.equal(out.slots_free, 2);
  } finally {
    cleanup(tmp);
  }
});

// ── Reconcile compliance (gap-reconcile-step-skipped-no-compliance-product, C17) ─────────────────────
// The A13 rule "stale_brackets > 0 ⇒ run --reconcile" previously had no record-observable product
// separating 守 from 不守 — a tick observing stale_brackets > 0 and skipping --reconcile left no
// trace (04:01 incident: realConcurrency=8 residual occupancy written, --reconcile never run).
// `--reconcile` now records each invocation timestamp; --slot-status reconcile_compliant /
// --slots reconcileCompliant compare stale > 0 against the last invocation within the window.

test("RECONCILE-COMPLIANCE — stale>0 and no reconcile invocation ⇒ false (the 04:01 shape)", async () => {
  const cli = await importCli();
  const inProgress = [
    { taskId: "ghost-a", runId: "fm-ghost-a-1", startedAtMs: 1000 },
    { taskId: "ghost-b", runId: "fm-ghost-b-1", startedAtMs: 2000 },
  ];
  const executorGone = () => ({ gone: true, reason: "worktree-gone-and-no-process" });
  const s = cli.analyzeSlotStatus(inProgress, { cap: 3, executorGone, lastReconcileAtMs: null });
  assert.equal(s.stale_brackets, 2, "both ghosts are stale");
  assert.equal(s.reconcile_compliant, false, "stale exists and no --reconcile was EVER recorded ⇒ non-compliant");
  assert.equal(s.reconcile_compliant_reason, "stale-but-no-reconcile-invocation");
  assert.equal(s.last_reconcile_at_ms, null);
});

test("RECONCILE-COMPLIANCE — stale>0 but reconcile invoked within the window ⇒ true", async () => {
  const cli = await importCli();
  const inProgress = [{ taskId: "ghost-a", runId: "fm-ghost-a-1", startedAtMs: 1000 }];
  const executorGone = () => ({ gone: true, reason: "worktree-gone-and-no-process" });
  const now = 10_000;
  const s = cli.analyzeSlotStatus(inProgress, {
    cap: 3,
    executorGone,
    lastReconcileAtMs: now - cli.RECONCILE_COMPLIANCE_WINDOW_MS / 2,
    nowMs: now,
  });
  assert.equal(s.stale_brackets, 1, "stale still exists (a NEW phantom after the reconcile)");
  assert.equal(s.reconcile_compliant, true, "the actor ran --reconcile in the same/adjacent round ⇒ compliant");
  assert.equal(s.reconcile_compliant_reason, "reconcile-invoked-recently");
});

test("RECONCILE-COMPLIANCE — stale>0 and last reconcile OLDER than the window ⇒ false (freshness)", async () => {
  const cli = await importCli();
  const inProgress = [{ taskId: "ghost-a", runId: "fm-ghost-a-1", startedAtMs: 1000 }];
  const executorGone = () => ({ gone: true, reason: "worktree-gone-and-no-process" });
  const now = 10_000;
  const s = cli.analyzeSlotStatus(inProgress, {
    cap: 3,
    executorGone,
    lastReconcileAtMs: now - cli.RECONCILE_COMPLIANCE_WINDOW_MS - 1,
    nowMs: now,
  });
  assert.equal(s.reconcile_compliant, false, "stale exists but the last --reconcile is beyond the adjacent-round window");
  assert.equal(s.reconcile_compliant_reason, "stale-and-last-reconcile-stale");
});

test("RECONCILE-COMPLIANCE — stale=0 ⇒ compliant regardless of the reconcile log (nothing to reconcile)", async () => {
  const cli = await importCli();
  const executorGone = () => ({ gone: false, reason: "worktree-present" });
  const noReconcile = cli.analyzeSlotStatus([], { cap: 3, executorGone, lastReconcileAtMs: null });
  assert.equal(noReconcile.stale_brackets, 0);
  assert.equal(noReconcile.reconcile_compliant, true);
  assert.equal(noReconcile.reconcile_compliant_reason, "no-stale-brackets");
  // Even with a reconcile log present, stale=0 is trivially compliant.
  const withReconcile = cli.analyzeSlotStatus([], { cap: 3, executorGone, lastReconcileAtMs: 1000, nowMs: 1_000_000 });
  assert.equal(withReconcile.reconcile_compliant, true);
});

test("RECONCILE-COMPLIANCE — computeReconcileCompliance window boundary (exactly AT the window ⇒ still adjacent)", async () => {
  const cli = await importCli();
  const now = 10_000;
  // atMs exactly one window ago ⇒ difference == WINDOW ⇒ compliant (≤).
  const boundary = cli.computeReconcileCompliance(1, now - cli.RECONCILE_COMPLIANCE_WINDOW_MS, now);
  assert.equal(boundary.compliant, true, "at the window edge still counts as adjacent");
  assert.equal(boundary.reason, "reconcile-invoked-recently");
  const over = cli.computeReconcileCompliance(1, now - cli.RECONCILE_COMPLIANCE_WINDOW_MS - 1, now);
  assert.equal(over.compliant, false);
  assert.equal(over.reason, "stale-and-last-reconcile-stale");
});

test("RECONCILE-COMPLIANCE CLI — --reconcile records an invocation; --slot-status flips to compliant; --slot-status itself stays pure-read", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "ghost-task.md"), "---\nid: ghost-task\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);
    // ghost-task: branch merged ⇒ executor observably done ⇒ stale.
    assert.equal(gitCmd(tmp, "checkout", "-b", "task/ghost-task").status, 0);
    fs.appendFileSync(path.join(tmp, "tasks", "ghost-task.md"), "work\n");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "ghost work landed").status, 0);
    assert.equal(gitCmd(tmp, "checkout", "master").status, 0);
    assert.equal(gitCmd(tmp, "merge", "--no-ff", "task/ghost-task", "-m", "Merge branch 'task/ghost-task'").status, 0);
    const start = runCli(tmp, "--task-start", "--taskId", "ghost-task");
    assert.equal(start.status, 0, start.stderr);

    // Before --reconcile: stale>0, no invocation recorded ⇒ non-compliant, AND the log file does not exist.
    const pre = runCli(tmp, "--slot-status", "--cap", "5", "--json");
    assert.equal(pre.status, 0, pre.stderr);
    const preObj = JSON.parse(pre.stdout);
    assert.equal(preObj.stale_brackets, 1);
    assert.equal(preObj.reconcile_compliant, false);
    assert.equal(preObj.reconcile_compliant_reason, "stale-but-no-reconcile-invocation");
    assert.equal(
      fs.existsSync(path.join(tmp, ".workflow-events", cli.RECONCILE_LOG_FILENAME)),
      false,
      "--slot-status is pure-read: a reconcile-compliance read must NOT write the invocation log",
    );

    // --reconcile closes the phantom AND records the invocation timestamp.
    const rec = runCli(tmp, "--reconcile", "--json");
    assert.equal(rec.status, 0, rec.stderr);
    const invocations = readEventsJsonlRaw(tmp, cli.RECONCILE_LOG_FILENAME);
    assert.equal(invocations.length, 1, "exactly one invocation recorded");
    assert.equal(invocations[0].type, "reconcile");
    assert.equal(invocations[0].event, "invoke");
    assert.ok(typeof invocations[0].atMs === "number" && Number.isFinite(invocations[0].atMs), "invocation carries a numeric timestamp");

    // After: the phantom left inProgress (stale=0) ⇒ compliant trivially, and last_reconcile_at_ms set.
    const post = runCli(tmp, "--slot-status", "--cap", "5", "--json");
    assert.equal(post.status, 0, post.stderr);
    const postObj = JSON.parse(post.stdout);
    assert.equal(postObj.stale_brackets, 0);
    assert.equal(postObj.reconcile_compliant, true);
    assert.equal(postObj.last_reconcile_at_ms, invocations[0].atMs);

    // The invocation log must NOT pollute the task pairing: --report inProgress/tasks stay clean.
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const repObj = JSON.parse(rep.stdout);
    assert.equal(repObj.inProgress.length, 0, "ghost reconciled out of inProgress");
    assert.equal(repObj.tasks.length, 0, "reconciled phantom must not enter completed tasks");
    assert.equal(repObj.reconciled.length, 1, "phantom surfaces in reconciled[]");
  } finally {
    cleanup(tmp);
  }
});

test("RECONCILE-COMPLIANCE CLI — --reconcile with NOTHING stale still records an invocation (zero-close record)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "live-task.md"), "---\nid: live-task\n---\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);
    // live-task: branch checked out in an OPEN worktree ⇒ reconcile KEEPS it (zero closes).
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/live-task", path.join(tmp, "wt-live")).status, 0);
    const start = runCli(tmp, "--task-start", "--taskId", "live-task");
    assert.equal(start.status, 0, start.stderr);

    const pre = runCli(tmp, "--slot-status", "--cap", "5", "--json");
    const preObj = JSON.parse(pre.stdout);
    assert.equal(preObj.stale_brackets, 0, "open-worktree executor is real in-flight, not stale");

    const rec = runCli(tmp, "--reconcile", "--json");
    assert.equal(rec.status, 0, rec.stderr);
    const recObj = JSON.parse(rec.stdout);
    assert.equal(recObj.closed.length, 0, "nothing stale ⇒ zero closes");
    assert.equal(recObj.kept.length, 1, "the open-worktree task is kept");

    const invocations = readEventsJsonlRaw(tmp, cli.RECONCILE_LOG_FILENAME);
    assert.equal(invocations.length, 1, "a zero-close --reconcile still records its invocation");
    assert.equal(invocations[0].event, "invoke");

    const post = runCli(tmp, "--slot-status", "--cap", "5", "--json");
    const postObj = JSON.parse(post.stdout);
    assert.equal(postObj.stale_brackets, 0);
    assert.equal(postObj.reconcile_compliant, true, "nothing stale ⇒ compliant, and the invocation is now on record");
    assert.equal(postObj.last_reconcile_at_ms, invocations[0].atMs);
  } finally {
    cleanup(tmp);
  }
});

// ── Worktree leaks (gap-worktree-leak-after-fan-in-occupies-slot-permanently) ──
// A fan-in merges a task's branch back into the merge target but the worktree is never removed —
// `worktreeExists`/worktree-present then reads that leak as an ALIVE executor forever, so occupied
// climbs monotonically until someone removes the worktree. The leak detector flags open
// quay-worktrees whose `task/<id>` branch is already merged; the compliance verdict (AC4) fails
// exactly when `occupied > cap` AND leaks exist.

test("WORKTREE-LEAK — detectWorktreeLeaks flags merged quay-worktree task branches only (PURE)", async () => {
  const cli = await importCli();
  const root = "/home/yale/work/quay";
  const worktrees = [
    { path: "/home/yale/work/quay-worktrees/task-merged", branch: "refs/heads/task/task-merged" },
    { path: "/home/yale/work/quay-worktrees/task-unmerged", branch: "refs/heads/task/task-unmerged" },
    { path: "/home/yale/work/quay", branch: "refs/heads/integration" }, // main checkout — never a leak
    { path: "/tmp/fan-in-test", branch: "refs/heads/task/tmp-task" }, // non-quay-worktrees fixture
    { path: "/home/yale/work/quay-worktrees/feat-x", branch: "refs/heads/feat/feat-x" }, // non-task branch
  ];
  const isQuayWorktree = (p) => cli.isQuayWorktreePath(p, root);
  const leaks = cli.detectWorktreeLeaks(worktrees, {
    isMerged: (id) => id === "task-merged",
    isQuayWorktree,
  });
  assert.deepEqual(
    leaks.map((l) => l.taskId),
    ["task-merged"],
    "only the merged quay-worktree task branch leaks; main checkout, /tmp fixture, feat branch, unmerged excluded",
  );
  assert.equal(leaks[0].path, "/home/yale/work/quay-worktrees/task-merged");
  assert.equal(leaks[0].branch, "refs/heads/task/task-merged");
});

test("WORKTREE-LEAK — no isMerged probe ⇒ no leak flagged (fail-closed without evidence)", async () => {
  const cli = await importCli();
  const leaks = cli.detectWorktreeLeaks(
    [{ path: "/home/yale/work/quay-worktrees/task-a", branch: "refs/heads/task/task-a" }],
    { isQuayWorktree: () => true },
  );
  assert.deepEqual(leaks, [], "without a merged probe the detector must not fabricate leaks");
});

test("WORKTREE-LEAK — taskIdFromBranch accepts both ref forms and rejects non-task branches", async () => {
  const cli = await importCli();
  assert.equal(cli.taskIdFromBranch("refs/heads/task/abc"), "abc");
  assert.equal(cli.taskIdFromBranch("task/def"), "def");
  assert.equal(cli.taskIdFromBranch("refs/heads/integration"), null);
  assert.equal(cli.taskIdFromBranch("feat/x"), null);
  assert.equal(cli.taskIdFromBranch(null), null);
});

test("WORKTREE-LEAK — isQuayWorktreePath excludes the main checkout and non-convention paths", async () => {
  const cli = await importCli();
  const root = "/home/yale/work/quay";
  assert.equal(cli.isQuayWorktreePath("/home/yale/work/quay-worktrees/foo", root), true);
  assert.equal(cli.isQuayWorktreePath("/home/yale/work/quay", root), false, "main checkout is not a task worktree");
  assert.equal(cli.isQuayWorktreePath("/tmp/foo", root), false, "test fixtures outside quay-worktrees/ never occupy a slot");
  assert.equal(cli.isQuayWorktreePath("/home/yale/work/other/quay-worktrees/foo", root), false, "sibling project's worktrees are not this repo's slots");
  assert.equal(cli.isQuayWorktreePath(null, root), false);
});

test("WORKTREE-LEAK — occupied>cap AND leaks ⇒ NON-COMPLIANT; leaks alone or over-cap alone stay compliant (AC4)", async () => {
  const cli = await importCli();
  const inProgress = [{ taskId: "live-1", runId: "fm-live-1-1", startedAtMs: 1 }];
  const executorGone = () => ({ gone: false, reason: "worktree-present" });
  const leaks = [{ taskId: "merged-a", path: "/home/yale/work/quay-worktrees/merged-a", branch: "task/merged-a" }];

  // The AC4 shape: occupied (1) > cap (0) AND a leak present ⇒ NON-COMPLIANT.
  const s1 = cli.analyzeSlotStatus(inProgress, { cap: 0, executorGone, worktreeLeaks: leaks });
  assert.equal(s1.occupied_slots > s1.cap, true, "occupied exceeds cap");
  assert.equal(s1.worktree_leaks_count, 1, "a merged-worktree leak is present");
  assert.equal(s1.worktree_leak_compliant, false, "occupied>cap AND leaks ⇒ the round is NON-COMPLIANT");

  // Leaks alone (occupied ≤ cap) do NOT fail the round.
  const s2 = cli.analyzeSlotStatus(inProgress, { cap: 3, executorGone, worktreeLeaks: leaks });
  assert.equal(s2.worktree_leaks_count, 1);
  assert.equal(s2.worktree_leak_compliant, true, "leaks alone must not fail a round that has free slots");

  // Over-cap alone (no leaks) is a DIFFERENT violation — not the worktree-leak verdict.
  const s3 = cli.analyzeSlotStatus(inProgress, { cap: 0, executorGone, worktreeLeaks: [] });
  assert.equal(s3.occupied_slots > s3.cap, true);
  assert.equal(s3.worktree_leaks_count, 0);
  assert.equal(s3.worktree_leak_compliant, true, "over-cap with no leaks is not a worktree-leak compliance failure");

  // Default (no worktreeLeaks arg) — no leaks, compliant, byte-compatible forward shape.
  const s4 = cli.analyzeSlotStatus(inProgress, { cap: 0, executorGone });
  assert.equal(s4.worktree_leaks_count, 0);
  assert.equal(s4.worktree_leak_compliant, true);
  assert.equal(s4.worktree_leaks.length, 0);
});

test("WORKTREE-LEAK CLI — real git: merged worktree reads as a leak; removal clears it and frees the slot (AC2/AC4)", async () => {
  const tmp = makeTmpWorkspace();
  // quay-worktrees sibling dir follows the fast-mode worktree path convention.
  const wtRoot = path.join(path.dirname(tmp), "quay-worktrees");
  try {
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "tasks", "seed.md"), "---\nid: seed\n---\n", "utf8");
    gitCmd(tmp, "init", "-q", "-b", "master");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "seed tasks").status, 0);
    fs.mkdirSync(wtRoot, { recursive: true });
    // task/leak-a: branch checked out in a quay-worktree, work committed, merged into master,
    // worktree NEVER removed ⇒ the leak shape.
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/leak-a", path.join(wtRoot, "leak-a"), "master").status, 0);
    fs.appendFileSync(path.join(wtRoot, "leak-a", "tasks", "seed.md"), "work\n");
    const wtGit = (args) => gitCmd(path.join(wtRoot, "leak-a"), ...args);
    assert.equal(wtGit(["add", "-A"]).status, 0);
    assert.equal(wtGit(["commit", "-m", "leak-a work"]).status, 0);
    assert.equal(gitCmd(tmp, "merge", "--no-ff", "task/leak-a", "-m", "merge: fan-in leak-a").status, 0);

    // The task has an OPEN telemetry bracket — its worktree-present executor makes it real in-flight.
    assert.equal(runCli(tmp, "--task-start", "--taskId", "leak-a").status, 0);

    const before = runCli(tmp, "--slot-status", "--cap", "1", "--json");
    assert.equal(before.status, 0, before.stderr);
    const b = JSON.parse(before.stdout);
    assert.deepEqual(b.worktree_leaks.map((l) => l.taskId), ["leak-a"], "the merged-but-present worktree is reported as a leak");
    assert.equal(b.real_in_flight, 1, "the leaked worktree reads as an alive executor");
    assert.equal(b.occupied_slots, 1, "occupied = the leaked worktree's bracket");
    assert.equal(b.worktree_leak_compliant, true, "occupied 1 is NOT > cap 1, so the AC4 over-cap shape is not yet met — leaks alone don't fail");
    assert.equal(b.slots_free, 0, "cap 1 − occupied 1 ⇒ full");

    // AC4's over-cap AND leak shape: cap 0.
    const over = runCli(tmp, "--slot-status", "--cap", "0", "--json");
    const ov = JSON.parse(over.stdout);
    assert.equal(ov.worktree_leaks_count, 1);
    assert.equal(ov.occupied_slots > ov.cap, true, "occupied exceeds cap 0");
    assert.equal(ov.worktree_leak_compliant, false, "occupied>cap AND a merged-worktree leak ⇒ NON-COMPLIANT");

    // Pure read: --slot-status must not remove the worktree or write reconcile events.
    assert.equal(fs.existsSync(path.join(wtRoot, "leak-a")), true, "slot-status is pure-read: it never removes a worktree");

    // AC2: the fix is `git worktree remove` (safe — branch merged, only the working copy is deleted).
    assert.equal(gitCmd(tmp, "worktree", "remove", path.join(wtRoot, "leak-a")).status, 0);

    const after = runCli(tmp, "--slot-status", "--cap", "5", "--json");
    assert.equal(after.status, 0, after.stderr);
    const a = JSON.parse(after.stdout);
    assert.equal(a.worktree_leaks_count, 0, "after removal the leak is gone");
    assert.equal(a.real_in_flight, 0, "the removed worktree no longer reads as an alive executor (branch merged ⇒ gone)");
    assert.equal(a.worktree_leak_compliant, true, "no leaks ⇒ compliant");
    assert.ok(a.slots_free > 0, "the slot the leak held is freed");
  } finally {
    cleanup(tmp);
    try { fs.rmSync(wtRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

} // ── end governance self-skip (AC6) ──

// ── FAN-IN RUNID BRIDGE (gap-task-telemetry-6-percent-join) ──────────────────────────────────────────
// The 6% join-rate defect: git fan-in commits and telemetry records barely intersected. The bridge:
// a fan-in commit subject carries the telemetry runId at a fixed position — "merge: fan-in task/<id>
// (runId: fm-...)" — and the telemetry reads it back (extractRunIdFromCommitSubject) and traces a
// taskId → its fan-in commit (findFanInCommitSha). --task-end records the sha (AC3 traceability).

test("FAN-IN BRIDGE — extractRunIdFromCommitSubject parses the runId by POSITION (and rejects absent/malformed)", async () => {
  const cli = await importCli();
  assert.equal(
    cli.extractRunIdFromCommitSubject("merge: fan-in task/gap-x (runId: fm-gap-x-1750-abc123)"),
    "fm-gap-x-1750-abc123",
    "the runId in the fixed (runId: …) group is extracted",
  );
  assert.equal(
    cli.extractRunIdFromCommitSubject("merge: fan-in task/gap-x (runId:fm-gap-x-1750-abc123)"),
    "fm-gap-x-1750-abc123",
    "no space after the colon is tolerated (position-based, whitespace-insensitive)",
  );
  assert.equal(cli.extractRunIdFromCommitSubject("merge: fan-in task/gap-x"), null, "no runId group ⇒ null");
  assert.equal(cli.extractRunIdFromCommitSubject("Merge branch 'task/gap-x'"), null, "auto merge subject has no runId ⇒ null");
  assert.equal(cli.extractRunIdFromCommitSubject(null), null, "null subject ⇒ null");
  assert.equal(cli.extractRunIdFromCommitSubject(""), null, "empty subject ⇒ null");
});

test("FAN-IN BRIDGE — findFanInCommitSha traces a taskId to its fan-in merge commit (AC3)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, "base.txt"), "base\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    gitCmd(tmp, "add", "-A");
    gitCmd(tmp, "commit", "-q", "-m", "base");
    gitCmd(tmp, "checkout", "-q", "-b", "task/gap-bridge");
    fs.writeFileSync(path.join(tmp, "work.txt"), "work\n", "utf8");
    gitCmd(tmp, "add", "-A");
    gitCmd(tmp, "commit", "-q", "-m", "work");
    gitCmd(tmp, "checkout", "-q", "master");
    const merged = gitCmd(tmp, "merge", "--no-ff", "task/gap-bridge", "-m", "merge: fan-in task/gap-bridge (runId: fm-gap-bridge-1750-abc)");
    assert.equal(merged.status, 0, merged.stderr);
    const expected = gitCmd(tmp, "rev-parse", "HEAD").stdout.trim();

    const sha = cli.findFanInCommitSha(tmp, "gap-bridge");
    assert.equal(sha, expected, "the task's fan-in merge commit is traced");
    assert.equal(cli.findFanInCommitSha(tmp, "gap-never-landed"), null, "a task never fan-in'd ⇒ null");
  } finally {
    cleanup(tmp);
  }
});

test("FAN-IN BRIDGE — --task-end auto-records the fan-in commit sha when the task's branch was merged (AC3)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    fs.writeFileSync(path.join(tmp, "base.txt"), "base\n", "utf8");
    gitCmd(tmp, "init", "-q");
    gitCmd(tmp, "config", "user.email", "test@example.com");
    gitCmd(tmp, "config", "user.name", "test");
    gitCmd(tmp, "add", "-A");
    gitCmd(tmp, "commit", "-q", "-m", "base");
    gitCmd(tmp, "checkout", "-q", "-b", "task/gap-end-rec");
    fs.writeFileSync(path.join(tmp, "work.txt"), "work\n", "utf8");
    gitCmd(tmp, "add", "-A");
    gitCmd(tmp, "commit", "-q", "-m", "work");
    gitCmd(tmp, "checkout", "-q", "master");
    gitCmd(tmp, "merge", "--no-ff", "task/gap-end-rec", "-m", "merge: fan-in task/gap-end-rec (runId: fm-gap-end-rec-1-x)");
    const fanSha = gitCmd(tmp, "rev-parse", "HEAD").stdout.trim();

    const start = runCli(tmp, "--task-start", "--taskId", "gap-end-rec");
    assert.equal(start.status, 0, start.stderr);
    const runId = start.stdout.trim();
    const end = runCli(tmp, "--task-end", "--taskId", "gap-end-rec", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0, end.stderr);

    const events = readEventsJsonl(tmp, runId);
    const endEv = events[events.length - 1];
    assert.equal(endEv.eventKind, "end");
    assert.equal(endEv.fanInCommitSha, fanSha, "the end event records the fan-in commit sha automatically");
    assert.equal(endEv.runId, runId);
  } finally {
    cleanup(tmp);
  }
});

test("FAN-IN BRIDGE — --task-end --fanInCommit <sha> overrides the auto-lookup; a non-git root records null", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const start = runCli(tmp, "--task-start", "--taskId", "gap-override");
    assert.equal(start.status, 0, start.stderr);
    const runId = start.stdout.trim();
    const end = runCli(tmp, "--task-end", "--taskId", "gap-override", "--runId", runId, "--outcome", "done", "--fanInCommit", "deadbeef1234");
    assert.equal(end.status, 0, end.stderr);
    let ev = readEventsJsonl(tmp, runId);
    assert.equal(ev[ev.length - 1].fanInCommitSha, "deadbeef1234", "explicit --fanInCommit wins");

    // No git repo → auto-lookup is null (never a wrong sha).
    const start2 = runCli(tmp, "--task-start", "--taskId", "gap-no-git");
    const runId2 = start2.stdout.trim();
    const end2 = runCli(tmp, "--task-end", "--taskId", "gap-no-git", "--runId", runId2, "--outcome", "abandoned");
    assert.equal(end2.status, 0, end2.stderr);
    const evs = readEventsJsonl(tmp, runId2);
    assert.equal(evs[evs.length - 1].fanInCommitSha, null, "no git ⇒ fanInCommitSha null (fail-soft, never a wrong sha)");
  } finally {
    cleanup(tmp);
  }
});
