// @test-group engine
// dead-loop-check.test.mjs — L2 持续健康判据：循环在转（不只是装了）
// (tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed, AC1-AC4, AC6).
//
// The criterion (Contract band): loop_alive = alive iff the target project's outer/inner transcript
// has a NEW user message OR its git repo has a NEW commit within the last N minutes; both absent =
// dead-loop. It is INDEPENDENT of backlog emptiness (invariant liveness_independent_of_backlog = 1):
//   queue-empty + drive/commit = healthy idle (alive)
//   queue-full  + no drive/commit = nobody driving (dead)
//
// AC1 dead-loop criterion — a project with neither a recent transcript user message nor a recent
//   git commit is judged dead (positive control).
// AC2 queue-empty vs nobody-driving — an EMPTY queue with a recent commit is judged ALIVE
//   (negative control: empty backlog is not dead); a NON-EMPTY queue with no drive/commit is judged
//   DEAD (nobody driving, not queue-empty).
// AC3 (SPEC §5 L2 instance) — the helper is the mechanism; the cross-annotation lives in
//   orchestration/SPEC-complete-delivery-surface-2026-08-05.md §5 (level two: loop turning).
// AC4 real use — the meta-cc/archguard 29h-zero-progress state is reproduced hermetically (old
//   transcript user msg + old commit => dead); the real-world invoke output is pasted in the task
//   body (meta-cc dead / archguard alive, 2026-08-05).
// AC5 AC10 accounting — recorded in the task body (manager pre-friction +1); not asserted here.
// AC6 this file uses node:test and declares `// @test-group engine`.
//
// Run:
//   scripts/test.sh plugin/test/dead-loop-check.test.mjs
//   node --test plugin/test/dead-loop-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(REPO_ROOT, "plugin", "scripts", "dead-loop-check.sh");
const WINDOW_MIN = 30; // default window the helper uses when --window is absent

// ── hermetic project factory ────────────────────────────────────────────────────────────────────────

// ISO timestamp `ageSec` seconds before now (Claude Code transcript `"timestamp":"…"` shape).
function isoAgo(ageSec) {
  return new Date(Date.now() - ageSec * 1000).toISOString();
}

// makeProject({ commitAgeSec, userMsgAgeSec, withTasks, withDriver, withTelemetry }) →
//   { root, transcriptDir, run, cleanup }
//   commitAgeSec: "none" = no git repo at all; 0 = create a commit now (fresh); number > 0 =
//     backdate the commit's committer date by that many seconds.
//   userMsgAgeSec: "none" = no transcript dir/file; number = latest user message is that many
//     seconds old (0 = now).
//   withTasks: true = create a non-empty tasks/ backlog (to prove queue-emptiness is NOT the signal).
//   withDriver: true = write .quay/loop-driver.jsonl (cold-start step 5 driver registration) —
//     the start evidence that distinguishes a real running loop from a fresh cold-start session.
//   withTelemetry: true = write .workflow-events/*.jsonl with a task-start record (inner dispatch
//     telemetry) — the alternative start evidence.
function makeProject({ commitAgeSec, userMsgAgeSec, withTasks = false, withDriver = false, withTelemetry = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dead-loop-"));
  const root = path.join(tmp, "proj");
  const transcriptDir = path.join(tmp, "transcripts");
  fs.mkdirSync(root, { recursive: true });

  if (commitAgeSec !== "none") {
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    spawnSync("git", ["init", "-q", "-b", "master", root]);
    spawnSync("git", ["-C", root, "add", "-A"]);
    if (typeof commitAgeSec === "number" && commitAgeSec > 0) {
      const d = new Date(Date.now() - commitAgeSec * 1000).toISOString();
      spawnSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], {
        env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d },
      });
    } else {
      spawnSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"]);
    }
  }

  if (userMsgAgeSec !== "none") {
    fs.mkdirSync(transcriptDir, { recursive: true });
    const ts = isoAgo(userMsgAgeSec);
    const line = `{"type":"user","timestamp":"${ts}","message":{"role":"user","content":[{"type":"text","text":"drive"}]}}`;
    fs.writeFileSync(path.join(transcriptDir, "session.jsonl"), line + "\n");
  }

  if (withTasks) {
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, "tasks", "T-1.md"), "---\nid: T-1\n---\nbacklog entry");
  }

  if (withDriver) {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "loop-driver.jsonl"),
      '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}\n');
  }
  if (withTelemetry) {
    fs.mkdirSync(path.join(root, ".workflow-events"), { recursive: true });
    fs.writeFileSync(path.join(root, ".workflow-events", "events.jsonl"),
      '{"type":"task-start","taskId":"T-1","timestamp":"2026-08-12T00:00:00Z"}\n');
  }

  const run = (args = []) =>
    spawnSync("bash", [HELPER, "--root", root, "--transcript-dir", transcriptDir, ...args], {
      encoding: "utf8",
    });
  const cleanup = () => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  return { root, transcriptDir, run, cleanup };
}

function parseFields(stdout) {
  const out = {};
  for (const line of stdout.split("\n")) {
    const m = /^([a-z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ── AC1: dead-loop criterion ────────────────────────────────────────────────────────────────────────

test("AC1 positive: no recent transcript user msg AND no recent commit => dead", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 29 * 3600 });
  try {
    const res = p.run();
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.loop_alive, "dead");
    assert.equal(f.has_transcript_user_msg, "0");
    assert.equal(f.has_git_commit, "0");
    assert.equal(f.liveness_independent_of_backlog, "1");
  } finally { p.cleanup(); }
});

test("AC1 band: recent git commit alone => alive", () => {
  const p = makeProject({ commitAgeSec: 0, userMsgAgeSec: "none" });
  try {
    const res = p.run();
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.loop_alive, "alive");
    assert.equal(f.has_git_commit, "1");
    assert.equal(f.has_transcript_user_msg, "0");
  } finally { p.cleanup(); }
});

test("AC1 band: recent transcript user msg alone => alive (even with an old commit)", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 60 });
  try {
    const res = p.run();
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.loop_alive, "alive");
    assert.equal(f.has_transcript_user_msg, "1");
    assert.equal(f.has_git_commit, "0");
  } finally { p.cleanup(); }
});

// ── AC2: queue-empty vs nobody-driving are distinguishable ──────────────────────────────────────────

test("AC2 negative: EMPTY queue + recent drive/commit => alive (empty backlog is NOT dead)", () => {
  // No tasks dir at all (queue empty) but a fresh commit: a healthy idle loop, not a dead one.
  const p = makeProject({ commitAgeSec: 0, userMsgAgeSec: "none", withTasks: false });
  try {
    const res = p.run();
    const f = parseFields(res.stdout);
    assert.equal(f.loop_alive, "alive", "an empty queue with a fresh commit is healthy idle, not dead");
    assert.equal(f.liveness_independent_of_backlog, "1");
  } finally { p.cleanup(); }
});

test("AC2: NON-EMPTY queue + no drive/commit => dead (nobody driving, not queue-empty)", () => {
  // Full backlog (withTasks=true) but no recent drive and no recent commit: the two states that
  // used to be indistinguishable — queue-empty vs nobody-driving — are now separated.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 29 * 3600, withTasks: true });
  try {
    const res = p.run();
    const f = parseFields(res.stdout);
    assert.equal(f.loop_alive, "dead");
    assert.equal(f.has_git_commit, "0");
    assert.equal(f.has_transcript_user_msg, "0");
    assert.equal(f.liveness_independent_of_backlog, "1");
  } finally { p.cleanup(); }
});

// ── --check-running mode: transcript activity alone is NOT the loop running ─────────────────────────
// (gap-dead-loop-check-fresh-coldstart-false-running) — a fresh cold-start's outer session writes its
// OWN transcript while running step 1-9, so loop_alive=alive (transcript activity) must be corroborated
// by start evidence (.quay/loop-driver.jsonl or .workflow-events task-start) before reporting running:
//   alive + start evidence ⇒ running；alive + none ⇒ stopped/never-started.

test("check-running: fresh transcript + NO start evidence => stopped/never-started (was: running)", () => {
  // Core negative control: cold-start session activity looks alive, but without driver/telemetry the
  // loop has never started. This was the false positive (running) before the fix.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 0 });
  try {
    const res = p.run(["--check-running"]);
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "never-started");
    assert.equal(f.next_step, "restart");
  } finally { p.cleanup(); }
});

test("check-running: fresh commit + NO start evidence => stopped/never-started (was: running)", () => {
  // Same false-positive class via the git-commit signal: a freshly-set-up project commits, but that
  // commit is setup, not a running loop. Without driver/telemetry it has never started.
  const p = makeProject({ commitAgeSec: 0, userMsgAgeSec: "none" });
  try {
    const res = p.run(["--check-running"]);
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "never-started");
    assert.equal(f.next_step, "restart");
  } finally { p.cleanup(); }
});

test("check-running: fresh transcript + .quay/loop-driver.jsonl => running", () => {
  // Driver registration (cold-start step 5) is start evidence: a real loop has started.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 0, withDriver: true });
  try {
    const res = p.run(["--check-running"]);
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "running");
    assert.equal(f.next_step, "none");
    assert.equal(f.stopped_reason, undefined,
      "a running loop must not emit stopped_reason (keeps the Contract grep 'stopped' clean at 0)");
  } finally { p.cleanup(); }
});

test("check-running: fresh transcript + .workflow-events task-start (no driver) => running", () => {
  // Inner-dispatch telemetry is the alternative start evidence, even without the driver registration.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 0, withTelemetry: true });
  try {
    const res = p.run(["--check-running"]);
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "running");
    assert.equal(f.next_step, "none");
  } finally { p.cleanup(); }
});

test("check-running: NO fresh transcript/commit + NO start evidence => stopped/never-started (dead path)", () => {
  // The stopped branch keeps its behavior: dead (no liveness) + never started => never-started.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 29 * 3600 });
  try {
    const res = p.run(["--check-running"]);
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "never-started");
    assert.equal(f.next_step, "restart");
  } finally { p.cleanup(); }
});

test("check-running: started-but-stopped (driver exists, stale, empty backlog) => queue-empty", () => {
  // Regresses the extracted dl_has_start reuse in the stopped branch: has_start still routes
  // started-but-stopped projects to queue-empty (not never-started) when the backlog is empty.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 29 * 3600, withDriver: true, withTasks: false });
  try {
    const res = p.run(["--check-running"]);
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "queue-empty");
    assert.equal(f.next_step, "backlog-empty");
  } finally { p.cleanup(); }
});

// ── window parameterization + contract shape ────────────────────────────────────────────────────────

test("AC1 --window is honored: a 20-min-old user msg is alive@30 but dead@10", () => {
  // Backdated commit (29h) + a 20-min-old user message: only the transcript signal can be in-window.
  const p = makeProject({ commitAgeSec: 29 * 3600, userMsgAgeSec: 20 * 60 });
  try {
    const wide = parseFields(p.run(["--window", "30"]).stdout);
    assert.equal(wide.loop_alive, "alive");
    assert.equal(wide.window_minutes, "30");
    const narrow = parseFields(p.run(["--window", "10"]).stdout);
    assert.equal(narrow.loop_alive, "dead");
    assert.equal(narrow.window_minutes, "10");
  } finally { p.cleanup(); }
});

test("contract measure: loop_alive field is always present and one of alive|dead", () => {
  const p = makeProject({ commitAgeSec: 0, userMsgAgeSec: "none" });
  try {
    const res = p.run();
    const f = parseFields(res.stdout);
    assert.match(f.loop_alive, /^(alive|dead)$/);
    assert.equal(f.has_transcript_user_msg, "0");
    assert.equal(f.has_git_commit, "1");
    assert.equal(f.liveness_independent_of_backlog, "1");
  } finally { p.cleanup(); }
});

test("contract invoke: the check source names transcript / 提交 / N 分钟 (grep surface)", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /transcript/);
  assert.match(src, /提交/);
  assert.match(src, /N 分钟/);
});
