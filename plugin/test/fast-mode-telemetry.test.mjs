// @test-group engine
// fast-mode-telemetry.test.mjs — gap-fast-mode-no-telemetry: RED/GREEN tests for the fast-mode
// metering CLI (fast-mode-telemetry.ts, byte-identical mirrors). Covers AC2–AC5 and AC10 (DoD),
// plus the --report write-split regression (gap-telemetry-report-writes-and-deadlocks-readiness):
// AC1 --report is pure-read, AC2 --snapshot is the explicit persist, AC3 20x --report leaves
// git status clean, AC4 --snapshot stdout is byte-identical to the file it wrote.
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
    assert.ok("serialEquivalentPerHour" in out, "report must carry the renamed serial-equivalent field");
    assert.ok("windowStart" in out && "windowEnd" in out && "windowHours" in out, "report must carry the window fields (AC3)");

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
