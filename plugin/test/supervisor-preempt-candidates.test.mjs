// @test-group governance
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族")
// supervisor-preempt-candidates.test.mjs — the supervisor base layer's TIMEOUT PREEMPTION
// criterion + action (tasks/gap-supervisor-step-4-preemption, 落地次序 step ④).
//
// This test pins the step-4 deliverables:
//   Contract measure — `bash plugin/scripts/supervisor-preempt.sh --list-preemptible` stdout 计数:
//     the first stdout line is `preemptible: <count>`; the band test asserts count=1 for a single
//     >90min no-progress task (AC2 deterministic listing).
//   AC1 — the criterion reads ONLY queryable facts: telemetry duration + task status frontmatter +
//     reconcile/landed probe. It never parses task content (no Proposal/Plan/AC access).
//   AC2 — deterministic timeout preemption (negative control): a simulated >90min no-progress task
//     with a live subprocess tree is listed (count=1) and preempt-task kills the tree + closes the
//     bracket + records a ledger event.
//   AC3 — positive control: an actively-progressing task (fresh bracket / non-in-progress status) is
//     NOT preemptible; preemption is rejected and nothing is killed.
//   AC4 — boundary: preemption kills ONLY the target task's process group (runId-matched); a decoy
//     process in another group is untouched (no cross-project/cross-container kill).
//   AC5 — zero new invention: the criterion reuses fast-mode-telemetry's aggregate/reconcile/
//     buildEndEvent/writeEvent and inner-blocked-signal's taskStatusAllowsOver90m/makeOver90ExecutorGone.
//
// @load-sensitive wall-clock: the preempt ACTION tests spawn real detached processes and wait on
// their exit — real-process timing, isolation-safe (detached ⇒ own process group ⇒ the group-kill
// never reaches the test runner).
//
// Run: scripts/test.sh plugin/test/supervisor-preempt-candidates.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "supervisor-preempt.sh");
const CANDIDATES = path.resolve(__dirname, "..", "scripts", "supervisor-preempt-candidates.ts");
const TELEMETRY = path.resolve(__dirname, "..", "scripts", "fast-mode-telemetry.ts");

if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preempt-cand-root-"));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".workflow-events/\n.quay/\n", "utf8");
  return root;
}

function writeTaskFile(root, taskId, status) {
  fs.writeFileSync(
    path.join(root, "tasks", `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: ${status}\n---\n**type:** execution\n## Touches\n- code/${taskId}.ts (new)\n`,
    "utf8",
  );
}

/**
 * Write a schema-valid telemetry start bracket backdated `minutesAgo` minutes for a task. Returns
 * the runId (which the preempt action uses to resolve the executor's process group).
 */
async function writeBackdatedStart(root, taskId, minutesAgo) {
  const telemetry = await import(TELEMETRY);
  const runId = telemetry.generateRunId(taskId);
  const ev = telemetry.buildStartEvent({
    taskId,
    runId,
    executionCwd: root,
    baseCommit: null,
    recordedAtMs: Date.now() - minutesAgo * 60 * 1000,
  });
  telemetry.writeEvent(ev, root);
  return runId;
}

function runList(root) {
  return spawnSync("bash", [SCRIPT, "--list-preemptible", "--root", root], { encoding: "utf8" });
}

function runPreemptTask(root, taskId) {
  return spawnSync("bash", [SCRIPT, "preempt-task", taskId, "--root", root], { encoding: "utf8" });
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The test runner's own process group id (via /proc/self/stat) — for the boundary assertion. */
function myPgrp() {
  const stat = fs.readFileSync("/proc/self/stat", "utf8");
  const close = stat.lastIndexOf(")");
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  return Number(fields[2]); // after comm: state(0), ppid(1), pgrp(2)
}

function waitForExit(pid, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      if (!alive) { clearInterval(t); resolve(true); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(t); resolve(false); }
    }, 25);
  });
}

/**
 * Spawn a DETACHED fake executor whose cmdline carries the runId needle (its own process group, so
 * a group-kill can never reach the test runner). Returns the child pid.
 */
function spawnFakeExecutor(runId) {
  const child = spawn("node", ["-e", "setInterval(()=>{},1000)", String(runId)], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child.pid;
}

function readLedger(root) {
  const p = path.join(root, ".quay", "supervisor-preempt-ledger.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── AC1/Contract: criterion reads queryable facts only — list-preemptible ─────────────────────────

test("AC1/Contract measure: empty telemetry store ⇒ preemptible: 0 (PURE READ, exit 0)", () => {
  const root = makeRoot();
  try {
    const r = runList(root);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^preemptible: 0$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1/AC2 band: a single >90min no-progress task (status in-progress) is deterministically listed (count=1)", async () => {
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-preempt-a", "in-progress");
    await writeBackdatedStart(root, "gap-preempt-a", 95);
    const r = runList(root);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^preemptible: 1$/m, "band: 超时且无推进的任务可被确定性列出");
    assert.match(r.stdout, /gap-preempt-a/);
    assert.match(r.stdout, /95\.0 min/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 positive control: a FRESH (<90min) in-progress task is NOT preemptible", async () => {
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-fresh", "in-progress");
    await writeBackdatedStart(root, "gap-fresh", 20); // well under the budget
    const r = runList(root);
    assert.match(r.stdout, /^preemptible: 0$/m, "actively-progressing (fresh) task is not listed");
    assert.doesNotMatch(r.stdout, /gap-fresh/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 positive control: a status=ready task with a >90m stale bracket is NOT preemptible (gap-over-90m shape)", async () => {
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-ready-stale", "ready");
    await writeBackdatedStart(root, "gap-ready-stale", 91);
    const r = runList(root);
    assert.match(r.stdout, /^preemptible: 0$/m, "status=ready + old bracket ⇒ not preemptible");
    assert.doesNotMatch(r.stdout, /gap-ready-stale/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 (pure): a LANDED task (merge evidence) is excluded — injected executorGone probe", async () => {
  const mod = await import(CANDIDATES);
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-landed", "in-progress");
    await writeBackdatedStart(root, "gap-landed", 91);
    // Inject the probe verdict that makeOver90ExecutorGone would return for a merged branch.
    const executorGone = () => ({ gone: true, reason: "branch-merged" });
    const { preemptible, count } = await mod.listPreemptible(root, { executorGone });
    assert.equal(count, 0);
    assert.equal(preemptible.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2/AC4: deterministic timeout preemption — kill tree + close bracket + ledger ────────────────

test("AC2 negative control: preempt-task kills the live subprocess tree, closes the bracket, records a ledger event", async () => {
  const root = makeRoot();
  const runId = await writeBackdatedStart(root, "gap-preempt-live", 95);
  writeTaskFile(root, "gap-preempt-live", "in-progress");
  const fakePid = spawnFakeExecutor(runId);
  try {
    assert.ok(pidAlive(fakePid), "fake executor is alive before preemption");
    assert.ok(runList(root).stdout.match(/^preemptible: 1$/m), "listed as preemptible before the action");

    const r = runPreemptTask(root, "gap-preempt-live");
    assert.equal(r.status, 0, `preempt-task exit 0 (stderr: ${r.stderr})`);
    assert.match(r.stdout, /preempted gap-preempt-live/);

    // 1) subprocess tree killed
    const gone = await waitForExit(fakePid);
    assert.ok(gone, "the preempted subprocess tree is killed");
    // 2) bracket closed → no longer preemptible
    const after = runList(root);
    assert.match(after.stdout, /^preemptible: 0$/m, "bracket closed ⇒ task leaves the preemptible set");
    // 3) ledger event recorded (pure append)
    const ledger = readLedger(root);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].taskId, "gap-preempt-live");
    assert.equal(ledger[0].runId, runId);
    assert.equal(ledger[0].outcome, "abandoned");
    assert.equal(ledger[0].reconcileReason, "preempted");
    assert.ok(ledger[0].killedPids.includes(fakePid), "the killed pid is recorded in the ledger");
  } finally {
    try { process.kill(fakePid, "SIGKILL"); } catch { /* already dead */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: preempt-task closes the bracket and records the ledger even when the executor is already gone (recovery)", async () => {
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-preempt-phantom", "in-progress");
    await writeBackdatedStart(root, "gap-preempt-phantom", 95); // no live process
    const r = runPreemptTask(root, "gap-preempt-phantom");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /preempted gap-preempt-phantom/);
    const after = runList(root);
    assert.match(after.stdout, /^preemptible: 0$/m, "bracket closed even with no process to kill");
    const ledger = readLedger(root);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].taskId, "gap-preempt-phantom");
    assert.equal(ledger[0].killedPids.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 positive control: preemption of an actively-progressing (fresh) task is REJECTED — nothing killed", async () => {
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-active", "in-progress");
    await writeBackdatedStart(root, "gap-active", 10); // fresh, under budget
    const fakePid = spawnFakeExecutor(await import(TELEMETRY).then((m) => m.generateRunId("gap-active")));
    try {
      const r = runPreemptTask(root, "gap-active");
      assert.equal(r.status, 1, "preemption of a fresh task is rejected (exit 1)");
      assert.match(r.stdout, /NOT preemptible/);
      assert.ok(pidAlive(fakePid), "the actively-progressing task's process is NOT killed");
      const ledger = readLedger(root);
      assert.equal(ledger.length, 0, "no ledger event recorded for a rejected preemption");
    } finally {
      try { process.kill(fakePid, "SIGKILL"); } catch { /* already dead */ }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 boundary: preemption kills ONLY the target task's process group — a decoy in another group survives", async () => {
  const root = makeRoot();
  const targetRunId = await writeBackdatedStart(root, "gap-target", 95);
  writeTaskFile(root, "gap-target", "in-progress");
  // Decoy: a live process from ANOTHER task/session (different runId, different process group).
  const decoyRunId = await import(TELEMETRY).then((m) => m.generateRunId("gap-other-project"));
  const decoyPid = spawnFakeExecutor(decoyRunId);
  const targetPid = spawnFakeExecutor(targetRunId);
  try {
    assert.ok(pidAlive(targetPid) && pidAlive(decoyPid));
    const r = runPreemptTask(root, "gap-target");
    assert.equal(r.status, 0);
    const targetGone = await waitForExit(targetPid);
    assert.ok(targetGone, "the target task's subprocess tree is killed");
    assert.ok(pidAlive(decoyPid), "the decoy (other task/session) is NOT killed — no cross-project kill");
    const ledger = readLedger(root);
    assert.equal(ledger[0].killedPids.length >= 1, true);
    assert.ok(!ledger[0].killedPids.includes(decoyPid), "decoy pid never appears in the killed set");
  } finally {
    try { process.kill(targetPid, "SIGKILL"); } catch { /* already dead */ }
    try { process.kill(decoyPid, "SIGKILL"); } catch { /* already dead */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5: reuse — the kill is process-group-scoped, mirroring tmux kill-session (never kill-server) ─

test("AC5: the action is process-group-scoped (target's own group), never a blanket signal", async () => {
  const mod = await import(CANDIDATES);
  const root = makeRoot();
  try {
    writeTaskFile(root, "gap-scope", "in-progress");
    const runId = await writeBackdatedStart(root, "gap-scope", 95);
    const pids = mod.findExecutorPids(runId);
    // With no matching process the resolution is empty (queryable fact: process not present).
    assert.ok(Array.isArray(pids));
    // A spawned fake executor's pgid must equal its pid (own session/group) — the group-kill target.
    const fakePid = spawnFakeExecutor(runId);
    try {
      const found = mod.findExecutorPids(runId);
      assert.ok(found.some((p) => p.pid === fakePid), "findExecutorPids resolves the runId-matched pid");
      const entry = found.find((p) => p.pid === fakePid);
      assert.equal(entry.pgid, fakePid, "a detached fake executor is its own process-group leader");
      assert.notEqual(entry.pgid, myPgrp(), "the target group is NOT the test runner's group (boundary)");
    } finally {
      try { process.kill(fakePid, "SIGKILL"); } catch { /* already dead */ }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("preempt-task --dry-run does not kill, does not write, does not record", async () => {
  const root = makeRoot();
  const runId = await writeBackdatedStart(root, "gap-dry", 95);
  writeTaskFile(root, "gap-dry", "in-progress");
  const fakePid = spawnFakeExecutor(runId);
  try {
    const r = spawnSync("bash", [SCRIPT, "preempt-task", "gap-dry", "--root", root, "--dry-run"], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[dry-run\] would preempt gap-dry/);
    assert.ok(pidAlive(fakePid), "dry-run does not kill");
    assert.equal(readLedger(root).length, 0, "dry-run does not record a ledger event");
    const after = runList(root);
    assert.match(after.stdout, /^preemptible: 1$/m, "bracket still open after dry-run");
  } finally {
    try { process.kill(fakePid, "SIGKILL"); } catch { /* already dead */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

}
