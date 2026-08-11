// @test-group engine
// closure-lag-check.test.mjs — tasks/gap-closure-pass-has-no-lag-signal.
// The outer's async closure pass ("1b. 异步收尾例程") flips implemented ready-tasks to done. It had
// NO lag signal: a "forced, every-tick" step could silently stop for hours and nothing would report
// it (observed 2026-08-09: 8.5h no outer:close, not-yet-flipped 42/51 = 82% — AC23 only checks the
// tick heartbeat, not the forced steps INSIDE the tick). This test pins the mechanical signal:
// plugin/scripts/closure-lag-check.sh.
//
// Coverage map (task ACs + Contract):
//   AC2 — closure-lag signal: not-yet-flipped > threshold ⇒ exit 1 + CLOSURE-LAG-WARN;
//         closure-pass overdue (trace older than --timeout, or trace MISSING with pending work) ⇒
//         exit 1 + WARN. Negative control: normal (below threshold + fresh trace) ⇒ exit 0 silent.
//   AC3 — execution verifiable: `--record --flipped <N>` writes .quay/closure-pass-last-run.json
//         with a timestamp (ranAt) + flip count (flipped); a consumer (the measure mode) reads it.
//   Contract measure — the exit code IS the signal (`bash plugin/scripts/closure-lag-check.sh`):
//         0 silent, 1 reported, 2 usage/environment error.
//   Contract invariant closure_pass_leaves_trace — every closure-pass execution writes the trace.
//   --json is measure-only and NEVER mutates (same contract as sync-lag-check --json).
//
// Fixtures are self-contained temp workspaces (tasks/ dir + .quay/); nothing in the real checkout
// is mutated (R3 test-isolation). `// @test-group engine` — an operational outer-loop mechanism.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CHECK = join(repoRoot, "plugin", "scripts", "closure-lag-check.sh");
const TELEMETRY = join(repoRoot, "plugin", "scripts", "fast-mode-telemetry.ts");

function run(args, opts = {}) {
  const res = spawnSync("bash", [CHECK, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeWorkspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `closure-lag-${prefix}-`));
  mkdirSync(join(dir, "tasks"), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// A ready task with ALL ACs checked → ready-pool-check's notYetFlipped fires via the AC-checkbox
// signal (allAcsChecked), no git history needed (the temp workspace is not a git repo — the
// git-history index fails closed to empty, so workLanded is false; the AC path is deterministic).
function writeNotYetFlippedTask(root, id, acBoxes = 2) {
  const acLines = Array.from({ length: acBoxes }, (_, i) => `- [x] an AC item ${i} that is long enough`);
  const body = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    "status: ready",
    "labels: []",
    "parent: null",
    "children: []",
    "extra: {}",
    "---",
    "",
    "**type:** execution",
    "",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "",
    "## Acceptance Criteria",
    ...acLines,
    "",
    "## Definition of Done",
    "standard DoD",
    "",
  ].join("\n");
  writeFileSync(join(root, "tasks", `${id}.md`), body, "utf8");
}

function writeTrace(root, { ranAt, flipped = 0 }) {
  mkdirSync(join(root, ".quay"), { recursive: true });
  writeFileSync(
    join(root, ".quay", "closure-pass-last-run.json"),
    JSON.stringify({ ranAt, flipped, at: new Date(ranAt * 1000).toISOString() }) + "\n",
    "utf8",
  );
}

const nowEpoch = Math.floor(Date.now() / 1000);

// ── AC2: backlog over threshold ⇒ signal ──────────────────────────────────────────────────────────

test("AC2 — not-yet-flipped backlog over --threshold ⇒ exit 1 + CLOSURE-LAG-WARN", () => {
  const w = makeWorkspace("ac2a");
  try {
    writeNotYetFlippedTask(w, "GAP-A");
    writeNotYetFlippedTask(w, "GAP-B");
    const r = run(["--root", w, "--threshold", "1"]);
    assert.equal(r.status, 1, `backlog signal must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CLOSURE-LAG-WARN/);
    assert.match(r.stdout, /not-yet-flipped=2 > threshold=1/);
  } finally { cleanup(w); }
});

// ── AC2: closure-pass overdue (trace stale) ⇒ signal ─────────────────────────────────────────────

test("AC2 — closure-pass overdue (trace older than --timeout) ⇒ exit 1 + CLOSURE-LAG-WARN", () => {
  const w = makeWorkspace("ac2b");
  try {
    writeTrace(w, { ranAt: nowEpoch - 5000, flipped: 1 });
    const r = run(["--root", w, "--timeout", "1"]);
    assert.equal(r.status, 1, `overdue signal must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CLOSURE-LAG-WARN/);
    assert.match(r.stdout, /closure-pass-overdue/);
  } finally { cleanup(w); }
});

// ── AC2: trace missing with pending work ⇒ signal (the 8.5h-silent defect class) ──────────────────

test("AC2 — trace MISSING with pending closure work ⇒ exit 1 (closure-pass never ran)", () => {
  const w = makeWorkspace("ac2c");
  try {
    writeNotYetFlippedTask(w, "GAP-C");
    const r = run(["--root", w]);
    assert.equal(r.status, 1, `missing-trace-with-work must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CLOSURE-LAG-WARN/);
    assert.match(r.stdout, /closure-pass-never-ran/);
  } finally { cleanup(w); }
});

// ── Negative control: normal ⇒ silent (exit 0, no WARN) ──────────────────────────────────────────

test("negative control — below threshold + fresh trace ⇒ exit 0, silent", () => {
  const w = makeWorkspace("ctrl");
  try {
    writeNotYetFlippedTask(w, "GAP-D");
    writeTrace(w, { ranAt: nowEpoch - 5, flipped: 1 });
    const r = run(["--root", w, "--threshold", "30"]);
    assert.equal(r.status, 0, `normal state must exit 0:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /CLOSURE-LAG-WARN/, "normal state must be silent");
    assert.match(r.stdout, /ok/);
  } finally { cleanup(w); }
});

// ── Negative control: trace missing but NO pending work ⇒ silent ─────────────────────────────────

test("negative control — trace missing with ZERO pending work ⇒ exit 0, silent", () => {
  const w = makeWorkspace("ctrl2");
  try {
    const r = run(["--root", w, "--threshold", "1"]);
    assert.equal(r.status, 0, `no-work no-trace must exit 0:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /CLOSURE-LAG-WARN/);
  } finally { cleanup(w); }
});

// ── AC3: --record writes the trace; a consumer then sees a fresh pass ─────────────────────────────

test("AC3 — --record --flipped N writes timestamp + flip count; measure reads it fresh", () => {
  const w = makeWorkspace("ac3");
  try {
    writeNotYetFlippedTask(w, "GAP-E");
    const rec = run(["--root", w, "--record", "--flipped", "3"]);
    assert.equal(rec.status, 0, `--record must exit 0:\n${rec.stdout}${rec.stderr}`);
    assert.match(rec.stdout, /recorded closure-pass trace/);

    const tracePath = join(w, ".quay", "closure-pass-last-run.json");
    const parsed = JSON.parse(readFileSync(tracePath, "utf8"));
    assert.ok(typeof parsed.ranAt === "number" && Number.isInteger(parsed.ranAt), "ranAt is an epoch timestamp");
    assert.equal(parsed.flipped, 3, "flip count recorded");
    assert.ok(Math.abs(parsed.ranAt - nowEpoch) < 60, "trace timestamp is fresh");

    // A consumer (measure mode) now sees a FRESH pass even with pending work below the threshold.
    const fresh = run(["--root", w, "--threshold", "1"]);
    assert.equal(fresh.status, 0, `fresh trace + below-threshold must exit 0:\n${fresh.stdout}${fresh.stderr}`);
    assert.doesNotMatch(fresh.stdout, /CLOSURE-LAG-WARN/);
  } finally { cleanup(w); }
});

// ── Contract measure: --json reports the signal shape and NEVER mutates ───────────────────────────

test("--json reports the signal shape and never writes a trace", () => {
  const w = makeWorkspace("json");
  try {
    writeNotYetFlippedTask(w, "GAP-F");
    writeNotYetFlippedTask(w, "GAP-G");
    const fire = run(["--root", w, "--threshold", "1", "--json"]);
    assert.equal(fire.status, 1, `firing --json must exit 1:\n${fire.stdout}${fire.stderr}`);
    const j = JSON.parse(fire.stdout);
    assert.equal(j.not_yet_flipped, 2);
    assert.equal(j.backlog_over_threshold, true);
    assert.equal(j.closure_pass_last_run, null);
    assert.equal(j.signal, true);
    // --json never mutates: no trace file is created.
    const tracePath = join(w, ".quay", "closure-pass-last-run.json");
    assert.equal(existsSync(tracePath), false, "--json must not create the trace");

    // Normal state: --json exits 0 with signal=false.
    writeTrace(w, { ranAt: nowEpoch - 5, flipped: 1 });
    const ok = run(["--root", w, "--threshold", "30", "--json"]);
    assert.equal(ok.status, 0, `normal --json must exit 0:\n${ok.stdout}${ok.stderr}`);
    const j2 = JSON.parse(ok.stdout);
    assert.equal(j2.signal, false);
    assert.equal(j2.closure_pass_last_run, nowEpoch - 5);
    assert.equal(j2.last_flipped, 1);
  } finally { cleanup(w); }
});

// ── Usage / environment errors exit 2 ─────────────────────────────────────────────────────────────

test("usage/environment errors exit 2 (no --flipped, unknown arg, not a workspace)", () => {
  const w = makeWorkspace("err");
  try {
    const noFlipped = run(["--root", w, "--record"]);
    assert.equal(noFlipped.status, 2, "--record without --flipped must exit 2");
    assert.match(noFlipped.stderr, /--flipped/);

    const badArg = run(["--root", w, "--bogus"]);
    assert.equal(badArg.status, 2, "unknown argument must exit 2");
    assert.match(badArg.stderr, /unknown argument/);

    const notAWorkspace = join(w, "empty");
    mkdirSync(notAWorkspace, { recursive: true });
    const noTasks = run(["--root", notAWorkspace]);
    assert.equal(noTasks.status, 2, "not-a-workspace (no tasks/) must exit 2");
    assert.match(noTasks.stderr, /not a workspace/);
  } finally { cleanup(w); }
});

// ── Bracket closure (gap-needs-human-routing-does-not-close-bracket) ──────────────────────────────
// The closure-pass ALSO owns the telemetry bracket closure for TERMINAL tasks. Two terminal routings
// (needs-human, completion→done) must close the `--task-start` bracket in the same round — the
// "unified bracket-close point" (`--close-task`) and the outer mechanical safety net
// (`--close-terminal`). AC1 — terminal task brackets close in the same round; AC2 — negative control
// (construct needs-human routing + completion path ⇒ both brackets close, no OVER90 residue); AC3 —
// the outer closing routine checks terminal-task brackets mechanically (script, not human).

/** Write one task file with an explicit status. */
function writeTask(root, id, status, acChecked = true) {
  const ac = acChecked ? "- [x] an AC item 0 that is long enough" : "- [ ] an AC item 0 that is long enough";
  const body = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels: []",
    "parent: null",
    "children: []",
    "extra: {}",
    "---",
    "",
    "**type:** execution",
    "",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "",
    "## Acceptance Criteria",
    ac,
    "",
    "## Definition of Done",
    "standard DoD",
    "",
  ].join("\n");
  writeFileSync(join(root, "tasks", `${id}.md`), body, "utf8");
}

/** Open a `--task-start` bracket; returns the printed runId. */
function startBracket(root, taskId) {
  const res = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", TELEMETRY, "--task-start", "--taskId", taskId, "--root", root],
    { encoding: "utf8" },
  );
  assert.equal(res.status, 0, `--task-start must succeed:\n${res.stdout}${res.stderr}`);
  return res.stdout.trim();
}

/** Parse the telemetry report for one workspace. */
function telemetryReport(root) {
  const res = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", TELEMETRY, "--report", "--json", "--root", root],
    { encoding: "utf8" },
  );
  return JSON.parse(res.stdout);
}

// ── AC2 (needs-human routing path): --close-task closes the bracket with outcome needs-human ──────

test("AC2 needs-human — --close-task closes an open bracket with outcome needs-human (same round)", () => {
  const w = makeWorkspace("ct-nh");
  try {
    const runId = startBracket(w, "GAP-NH");
    writeTask(w, "GAP-NH", "needs-human");
    const r = run(["--root", w, "--close-task", "--taskId", "GAP-NH", "--outcome", "needs-human"]);
    assert.equal(r.status, 0, `--close-task must exit 0:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /closed GAP-NH/);
    assert.match(r.stdout, /outcome needs-human/);

    // Bracket left inProgress in the same round; the end event PAIRED with the start (tasks[], not orphaned).
    const rep = telemetryReport(w);
    assert.equal(rep.inProgress.length, 0, "bracket must leave inProgress in the same round");
    assert.ok(rep.tasks.some((t) => t.taskId === "GAP-NH" && t.outcome === "needs-human"), "paired end event in tasks[]");
    assert.equal(rep.orphaned.length, 0, "no orphaned end event (runId was matched)");
  } finally { cleanup(w); }
});

// ── AC2 (completion path): --close-task closes the bracket with outcome done ─────────────────────

test("AC2 completion — --close-task closes an open bracket with outcome done (same round)", () => {
  const w = makeWorkspace("ct-done");
  try {
    const runId = startBracket(w, "GAP-DONE");
    writeTask(w, "GAP-DONE", "done");
    const r = run(["--root", w, "--close-task", "--taskId", "GAP-DONE", "--outcome", "done"]);
    assert.equal(r.status, 0, `--close-task must exit 0:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /closed GAP-DONE/);
    assert.match(r.stdout, /outcome done/);

    const rep = telemetryReport(w);
    assert.equal(rep.inProgress.length, 0, "bracket must leave inProgress in the same round");
    assert.ok(rep.tasks.some((t) => t.taskId === "GAP-DONE" && t.outcome === "done"), "paired end event in tasks[]");
  } finally { cleanup(w); }
});

// ── AC2 negative control: --close-task is idempotent (no open bracket ⇒ exit 0, no write) ─────────

test("AC2 negative control — --close-task with no open bracket exits 0 and writes nothing (idempotent)", () => {
  const w = makeWorkspace("ct-idem");
  try {
    const runId = startBracket(w, "GAP-X");
    writeTask(w, "GAP-X", "done");
    assert.equal(run(["--root", w, "--close-task", "--taskId", "GAP-X", "--outcome", "done"]).status, 0);
    // Second call: bracket already closed — idempotent, exit 0, no orphan created.
    const second = run(["--root", w, "--close-task", "--taskId", "GAP-X", "--outcome", "done"]);
    assert.equal(second.status, 0, "idempotent re-close must exit 0");
    assert.match(second.stdout, /no open bracket/);

    // A task that never had a bracket: also exit 0, nothing written.
    const never = run(["--root", w, "--close-task", "--taskId", "GAP-NEVER", "--outcome", "done"]);
    assert.equal(never.status, 0, "no-bracket close must exit 0");
    assert.match(never.stdout, /no open bracket/);
  } finally { cleanup(w); }
});

// ── AC2 negative control: invalid --close-task usage exits 2 ─────────────────────────────────────

test("AC2 negative control — --close-task usage errors exit 2 (missing --taskId / bad --outcome)", () => {
  const w = makeWorkspace("ct-err");
  try {
    const noId = run(["--root", w, "--close-task", "--outcome", "done"]);
    assert.equal(noId.status, 2, "missing --taskId must exit 2");
    assert.match(noId.stderr, /--taskId/);

    const badOutcome = run(["--root", w, "--close-task", "--taskId", "GAP-X", "--outcome", "bogus"]);
    assert.equal(badOutcome.status, 2, "bad --outcome must exit 2");
    assert.match(badOutcome.stderr, /--outcome/);
  } finally { cleanup(w); }
});

// ── AC3: --close-terminal scans inProgress and closes terminal-task brackets (needs-human/done/done-ready) ──

test("AC3 — --close-terminal closes needs-human + done + done-ready brackets; leaves non-terminal open", () => {
  const w = makeWorkspace("ct-scan");
  try {
    // Four open brackets: needs-human, done, done-ready (ready + AC checked), and non-terminal todo.
    startBracket(w, "GAP-NH");
    writeTask(w, "GAP-NH", "needs-human");
    startBracket(w, "GAP-DONE");
    writeTask(w, "GAP-DONE", "done");
    startBracket(w, "GAP-DR");
    writeTask(w, "GAP-DR", "ready", true); // done-ready: work landed + AC all checked, status still ready
    startBracket(w, "GAP-TODO");
    writeTask(w, "GAP-TODO", "todo", false); // NOT terminal — must stay open

    const r = run(["--root", w, "--close-terminal"]);
    assert.equal(r.status, 0, `--close-terminal must exit 0:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /closed GAP-NH .*outcome needs-human/);
    assert.match(r.stdout, /closed GAP-DONE .*outcome done/);
    assert.match(r.stdout, /closed GAP-DR .*outcome done/);
    assert.match(r.stdout, /closed 3 terminal-task bracket\(s\)/);

    const rep = telemetryReport(w);
    assert.equal(rep.inProgress.length, 1, "only the non-terminal todo bracket remains inProgress");
    assert.equal(rep.inProgress[0].taskId, "GAP-TODO", "todo bracket must NOT be closed");
    assert.ok(rep.tasks.some((t) => t.taskId === "GAP-NH" && t.outcome === "needs-human"));
    assert.ok(rep.tasks.some((t) => t.taskId === "GAP-DONE" && t.outcome === "done"));
    assert.ok(rep.tasks.some((t) => t.taskId === "GAP-DR" && t.outcome === "done"));
    assert.equal(rep.orphaned.length, 0, "all closures were paired with real starts");
  } finally { cleanup(w); }
});

// ── AC3: --close-terminal --dry-run reports WITHOUT writing ───────────────────────────────────────

test("AC3 — --close-terminal --dry-run reports what would close but writes nothing", () => {
  const w = makeWorkspace("ct-dry");
  try {
    startBracket(w, "GAP-NH");
    writeTask(w, "GAP-NH", "needs-human");

    const dry = run(["--root", w, "--close-terminal", "--dry-run", "--json"]);
    assert.equal(dry.status, 0, `dry-run must exit 0:\n${dry.stdout}${dry.stderr}`);
    const plan = JSON.parse(dry.stdout);
    assert.equal(plan.scanned, 1);
    assert.equal(plan.closed.length, 1);
    assert.equal(plan.closed[0].taskId, "GAP-NH");
    assert.equal(plan.closed[0].outcome, "needs-human");
    assert.equal(plan.closed[0].dryRun, true, "dry-run entries are marked");

    // Nothing was written: the bracket is still inProgress.
    const rep = telemetryReport(w);
    assert.equal(rep.inProgress.length, 1, "dry-run must not close the bracket");
    assert.equal(rep.inProgress[0].taskId, "GAP-NH");
  } finally { cleanup(w); }
});

// ── AC3: --close-terminal --json emits the machine-readable shape ────────────────────────────────

test("AC3 — --close-terminal --json emits the machine-readable shape after real closures", () => {
  const w = makeWorkspace("ct-json");
  try {
    startBracket(w, "GAP-DONE");
    writeTask(w, "GAP-DONE", "done");
    const res = run(["--root", w, "--close-terminal", "--json"]);
    assert.equal(res.status, 0, `--close-terminal --json must exit 0:\n${res.stdout}${res.stderr}`);
    const j = JSON.parse(res.stdout);
    assert.equal(j.scanned, 1);
    assert.equal(j.closed.length, 1);
    assert.equal(j.closed[0].taskId, "GAP-DONE");
    assert.equal(j.closed[0].outcome, "done");
    assert.equal(j.skipped.length, 0);

    // Re-run: nothing left to close.
    const again = run(["--root", w, "--close-terminal", "--json"]);
    const j2 = JSON.parse(again.stdout);
    assert.equal(j2.scanned, 0);
    assert.equal(j2.closed.length, 0);
  } finally { cleanup(w); }
});
