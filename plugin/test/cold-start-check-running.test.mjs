// @test-group governance
// cold-start-check-running.test.mjs — cold-start 已停转分支：六键测「装没装好」不测「在不在转」
// (tasks/gap-cold-start-six-keys-measure-installed-not-running, AC1-AC4).
//
// The seven-key observable-consequences checklist measures "was the instrument laid down" (L1);
// NONE answers "is the loop actually RUNNING right now" (L2 continuous health). A re-run of a
// cold-start whose loop has since stopped reported "complete" while sitting idle (measured 2026-08-06:
// archguard 11:40 cold-start → 8.5h autonomous → #102 stopped at completion point, six keys
// five-true-one-false). The fix: cold-start calls the L2 dead-loop criterion
// (`dead-loop-check.sh --check-running`) FIRST to distinguish installed-and-RUNNING from
// installed-but-STOPPED, and when stopped reports an EXECUTABLE next step (restart / human-needed /
// backlog-empty) — never "complete".
//
// AC1 — cold-start distinguishes installed+running vs installed+stopped by calling dead-loop-check.
// AC2 — when stopped it gives an executable next step (restart / human-needed / backlog-empty), not
//       "complete".
// AC3 — the three stopped states (queue-empty / waiting-human / never-started) no longer all report
//       "complete"; they produce DIFFERENT verdicts.
// AC4 — the branch reuses the L2 criterion (dead-loop-check.sh) and cross-annotates
//       tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md.
//
// Run:
//   scripts/test.sh plugin/test/cold-start-check-running.test.mjs
//   node --test plugin/test/cold-start-check-running.test.mjs

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
const SKILL = path.join(REPO_ROOT, "plugin", "skills", "cold-start", "SKILL.md");
const L2_TASK = path.join(
  REPO_ROOT,
  "tasks",
  "gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md",
);

// ── hermetic project factory ────────────────────────────────────────────────────────────────────────

// makeProject({ commitAgeSec, started, taskStatuses, transcriptDir }) →
//   { root, runCheckRunning, cleanup }
//   commitAgeSec: 0 = commit NOW (running); > 0 = backdate the commit by that many seconds (dead);
//     "none" = no git repo at all.
//   started: true = write cold-start's started markers (.quay/loop-driver.jsonl +
//     .workflow-events/ task-start record) so the loop is "started before but stopped now".
//   taskStatuses: array of statuses to write as tasks/T-N.md (e.g. ['done'], ['needs-human'],
//     ['ready']).
function makeProject({ commitAgeSec, started = false, taskStatuses = [] }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cold-start-check-"));
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

  if (started) {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "loop-driver.jsonl"),
      '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}\n');
    fs.mkdirSync(path.join(root, ".workflow-events"), { recursive: true });
    fs.writeFileSync(path.join(root, ".workflow-events", "events.jsonl"),
      '{"type":"task-start","taskId":"T-1","timestamp":"2026-08-06T00:00:00Z"}\n');
  }

  if (taskStatuses.length > 0) {
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
    taskStatuses.forEach((s, i) => {
      fs.writeFileSync(path.join(root, "tasks", `T-${i + 1}.md`), `---\nid: T-${i + 1}\nstatus: ${s}\n---\n`);
    });
  }

  const runCheckRunning = () =>
    spawnSync("bash", [HELPER, "--check-running", "--root", root, "--transcript-dir", transcriptDir], {
      encoding: "utf8",
    });
  const cleanup = () => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  return { root, runCheckRunning, cleanup };
}

function parseFields(stdout) {
  const out = {};
  for (const line of stdout.split("\n")) {
    const m = /^([a-z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ── AC1: the skill distinguishes installed+running from installed+stopped via dead-loop-check ───────

test("AC1 — the cold-start skill has a 已停转 branch that calls dead-loop-check --check-running first", () => {
  const src = fs.readFileSync(SKILL, "utf8");
  assert.match(src, /dead-loop-check\.sh/, "the skill must reference the dead-loop criterion script");
  assert.match(src, /--check-running/, "the skill must instruct the --check-running invocation");
  assert.match(src, /cold_start_state/, "the skill must consume the cold_start_state verdict");
  assert.match(src, /已停转/, "the skill must name the installed-but-stopped branch (已停转)");
  // Contract invoke surface: the SKILL.md must carry the stopped/dead-loop vocabulary.
  for (const word of ["dead-loop", "stopped", "已停"]) {
    assert.ok(src.includes(word), `the skill must name "${word}" in the stopped branch`);
  }
});

test("AC1 — a never-started project is detected as stopped (not 'complete') by --check-running", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, started: false, taskStatuses: [] });
  try {
    const res = p.runCheckRunning();
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "never-started");
    assert.equal(f.next_step, "restart");
    // The Contract measure surface: 'stopped' appears in the stopped verdict output.
    assert.match(res.stdout, /stopped/);
  } finally { p.cleanup(); }
});

test("AC1 — a genuinely running project (recent commit) is reported running, not stopped", () => {
  const p = makeProject({ commitAgeSec: 0, started: false, taskStatuses: [] });
  try {
    const res = p.runCheckRunning();
    assert.equal(res.status, 0, res.stderr);
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "running");
    assert.equal(f.next_step, "none");
    assert.equal(f.stopped_reason, undefined,
      "a running loop must not emit stopped_reason (keeps the Contract grep 'stopped' clean at 0)");
    assert.ok(!/stopped/.test(res.stdout),
      "a running loop's output must not contain the word 'stopped' at all");
  } finally { p.cleanup(); }
});

// ── AC2: executable next step when stopped, never "complete" ────────────────────────────────────────

test("AC2 — queue-empty (backlog bottom) gives next_step=backlog-empty, not 'complete'", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, started: true, taskStatuses: ["done"] });
  try {
    const res = p.runCheckRunning();
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "queue-empty");
    assert.equal(f.next_step, "backlog-empty");
    assert.ok(!/complete|已完成/.test(res.stdout), "a stopped loop must NOT be reported complete");
  } finally { p.cleanup(); }
});

test("AC2 — waiting-human (needs-human tasks) gives next_step=human-needed, not 'complete'", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, started: true, taskStatuses: ["needs-human"] });
  try {
    const res = p.runCheckRunning();
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "waiting-human");
    assert.equal(f.next_step, "human-needed");
    assert.ok(!/complete|已完成/.test(res.stdout), "a stopped loop must NOT be reported complete");
  } finally { p.cleanup(); }
});

test("AC2 — started-but-no-drive with work available gives next_step=restart (driver died)", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, started: true, taskStatuses: ["ready"] });
  try {
    const res = p.runCheckRunning();
    const f = parseFields(res.stdout);
    assert.equal(f.cold_start_state, "stopped");
    assert.equal(f.stopped_reason, "unknown");
    assert.equal(f.next_step, "restart");
  } finally { p.cleanup(); }
});

// ── AC3: the three stopped states are distinguishable (no longer all 'complete') ─────────────────────

test("AC3 — never-started / queue-empty / waiting-human produce three DIFFERENT verdicts", () => {
  const p1 = makeProject({ commitAgeSec: 29 * 3600, started: false, taskStatuses: [] });
  const p2 = makeProject({ commitAgeSec: 29 * 3600, started: true, taskStatuses: ["done"] });
  const p3 = makeProject({ commitAgeSec: 29 * 3600, started: true, taskStatuses: ["needs-human"] });
  try {
    const f1 = parseFields(p1.runCheckRunning().stdout);
    const f2 = parseFields(p2.runCheckRunning().stdout);
    const f3 = parseFields(p3.runCheckRunning().stdout);
    assert.equal(f1.stopped_reason, "never-started");
    assert.equal(f2.stopped_reason, "queue-empty");
    assert.equal(f3.stopped_reason, "waiting-human");
    // All three are stopped — none may be mistaken for "complete".
    for (const f of [f1, f2, f3]) assert.equal(f.cold_start_state, "stopped");
    // The executable next steps differ (AC2): restart / backlog-empty / human-needed.
    assert.notEqual(f1.next_step, f2.next_step);
    assert.notEqual(f2.next_step, f3.next_step);
    assert.notEqual(f1.next_step, f3.next_step);
    assert.deepEqual(new Set([f1.next_step, f2.next_step, f3.next_step]),
      new Set(["restart", "backlog-empty", "human-needed"]));
  } finally {
    p1.cleanup(); p2.cleanup(); p3.cleanup();
  }
});

// ── Contract measure ────────────────────────────────────────────────────────────────────────────────

test("contract measure — --check-running output for a stopped project yields stopped_detected >= 1", () => {
  const p = makeProject({ commitAgeSec: 29 * 3600, started: true, taskStatuses: ["done"] });
  try {
    // The ## Contract measure greps for 'stopped\|dead-loop\|已停' and requires >= 1.
    const res = spawnSync("bash", ["-c",
      `bash "${HELPER}" --check-running --root "${p.root}" 2>&1 | grep -c 'stopped\\|dead-loop\\|已停'`],
      { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    const count = Number.parseInt(res.stdout.trim(), 10);
    assert.ok(count >= 1, `stopped_detected must be >= 1 for a stopped loop, got ${count}`);
  } finally { p.cleanup(); }
});

// ── AC4: cross-annotation with the L2 dead-loop criterion task ──────────────────────────────────────

test("AC4 — the L2 dead-loop criterion task cross-annotates this cold-start consumer", () => {
  const src = fs.readFileSync(L2_TASK, "utf8");
  assert.match(src, /gap-cold-start-six-keys-measure-installed-not-running/,
    "the L2 criterion task must cross-annotate the cold-start consumer (AC4)");
  assert.match(src, /--check-running/,
    "the L2 criterion task must name the --check-running consumer mode");
  assert.match(src, /cold-start/, "the L2 criterion task must name the cold-start consumer");
});
