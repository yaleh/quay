// fast-mode-telemetry.test.mjs — gap-fast-mode-no-telemetry: RED/GREEN tests for the fast-mode
// metering CLI (fast-mode-telemetry.ts, byte-identical mirrors). Covers AC2–AC5 and AC10 (DoD).
//
// Run:
//   scripts/test.sh plugin/test/fast-mode-telemetry.test.mjs
//   node --test plugin/test/fast-mode-telemetry.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

async function importCli() {
  return import(CLI);
}

async function importSchema() {
  return import(SCHEMA);
}

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

// ── AC6: committed aggregate ─────────────────────────────────────────────────────────────────────────

test("AC6 — --report writes the committed aggregate under milestones/fast-mode-telemetry/", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const s = runCli(tmp, "--task-start", "--taskId", "gap-test-1");
    const runId = s.stdout.trim();
    runCli(tmp, "--task-end", "--taskId", "gap-test-1", "--runId", runId, "--outcome", "done");

    const rep = runCli(tmp, "--report");
    assert.equal(rep.status, 0, rep.stderr);

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
