// @test-group governance
// worker-driver.test.mjs — SPEC-worker-driven-inner-2026-08-16 §5 阶段 1（AC115）: the mechanical
// worker driver spawns a single claude -p worker for one task and records the exit code + structured
// outcome. AC1 在飞 = 驱动子进程数（直接量，非代理量）; AC2 worker 退出码 + outcome 字段齐全（SPEC §4③
// {task, selector 理由, worker exit code, 墙钟, 终态, 失败原因}）; AC3（能取假）杀 worker ⇒ 驱动察觉并记录,
// 不静默丢任务。The worker command is injectable (--worker-cmd) so the tests never spawn a real claude
// — they drive `node -e process.exit(…)` and `sleep`, exactly the AC3 kill seam.
//
// Run: scripts/test.sh plugin/test/worker-driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

import {
  computeOutcome,
  appendOutcomeToFile,
  splitArgs,
  defaultWorkerArgv,
  resolveRun,
  signalExitCode,
  WORKER_OUTCOME_REL,
  FINAL_STATES,
} from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(__dirname, "..", "scripts", "worker-driver.ts");

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `worker-driver-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

function runDriver(root, args) {
  return execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args,
  ], { encoding: "utf8" });
}

function readOutcomeLines(root) {
  const file = path.join(root, WORKER_OUTCOME_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── pure functions ─────────────────────────────────────────────────────────────────────────────────

test("computeOutcome — SPEC §4③ field completeness: every §4③ field is present for a completed worker", () => {
  const o = computeOutcome({
    task: "gap-x", selectorReason: "why", exitCode: 0, signal: null,
    startedAtMs: 1000, endedAtMs: 2500, workerPid: 42, runId: "fm-r",
  });
  // SPEC §4③: {task, selector 理由, worker exit code, 墙钟, 终态, 失败原因}.
  assert.equal(o.task, "gap-x");
  assert.equal(o.selector_reason, "why");
  assert.equal(o.exit_code, 0);
  assert.equal(o.wall_clock_ms, 1500);
  assert.equal(o.final_state, "completed");
  assert.equal(o.failure_reason, null);
  // direct quantity (AC1) + provenance fields.
  assert.equal(o.in_flight_count, 1);
  assert.equal(o.worker_pid, 42);
  assert.ok(o.started_at && o.ended_at && o.run_id && o.ts, "timestamps/run_id present");
  // every §4③ key is present (not undefined) — the AC2 "字段齐全" check.
  for (const key of ["task", "selector_reason", "exit_code", "wall_clock_ms", "final_state", "failure_reason"]) {
    assert.ok(key in o, `field ${key} present`);
  }
  assert.ok(FINAL_STATES.includes(o.final_state));
});

test("computeOutcome — non-zero exit ⇒ failed; signal ⇒ killed (AC3 终态/失败原因)", () => {
  const failed = computeOutcome({ task: "g", selectorReason: "r", exitCode: 7, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x" });
  assert.equal(failed.final_state, "failed");
  assert.equal(failed.exit_code, 7);
  assert.equal(failed.failure_reason, "worker exited with code 7");

  const killed = computeOutcome({ task: "g", selectorReason: "r", exitCode: null, signal: "SIGKILL", startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x" });
  assert.equal(killed.final_state, "killed");
  assert.equal(killed.exit_code, null);
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(killed.failure_reason, "worker killed by SIGKILL");

  const spawnFailed = computeOutcome({ task: "g", selectorReason: "r", exitCode: null, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: null, runId: "x", spawnError: "ENOENT" });
  assert.equal(spawnFailed.final_state, "spawn-failed");
  assert.equal(spawnFailed.failure_reason, "ENOENT");
});

test("resolveRun / splitArgs / defaultWorkerArgv / signalExitCode — pure helpers", () => {
  assert.deepEqual(splitArgs("node -e process.exit(7)"), ["node", "-e", "process.exit(7)"]);
  assert.deepEqual(splitArgs("  sleep 100  "), ["sleep", "100"]);
  assert.equal(defaultWorkerArgv("gap-x", "/r")[0], "claude");
  assert.equal(defaultWorkerArgv("gap-x", "/r")[1], "-p");
  assert.equal(signalExitCode("SIGKILL"), 9);
  assert.equal(signalExitCode("SIGTERM"), 15);
  const noTask = resolveRun({ task: undefined, reason: undefined, workerCmd: undefined, root: "/r", runId: undefined, nowMs: 1 });
  assert.ok(noTask.error, "no --task ⇒ error (phase 1 has no selector)");
  const ok = resolveRun({ task: " gap-x ", reason: "  why  ", workerCmd: "node -e process.exit(0)", root: "/r", runId: "run", nowMs: 1 });
  assert.equal(ok.taskId, "gap-x");
  assert.equal(ok.selectorReason, "why");
  assert.deepEqual(ok.workerArgv, ["node", "-e", "process.exit(0)"]);
  assert.equal(ok.run, "run");
});

// ── AC2: end-to-end worker exit code + outcome 落盘 ────────────────────────────────────────────────

test("AC2 — worker exit 0 ⇒ driver exits 0 and records a completed outcome with all §4③ fields", (t) => {
  const root = makeRoot("ok");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = runDriver(root, ["--task", "gap-a", "--reason", "explicit", "--worker-cmd", "node -e process.exit(0)", "--json"]);
  const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines[0].event, "worker-spawned");
  assert.equal(lines[0].in_flight_count, 1, "AC1: in-flight = the driver's own spawned child count (direct)");
  assert.ok(Number.isInteger(lines[0].worker_pid), "worker_pid is the driver's child pid");
  const done = lines.find((l) => l.event === "worker-done");
  assert.equal(done.exit_code, 0);
  assert.equal(done.final_state, "completed");
  assert.equal(done.failure_reason, null);
  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "exactly one outcome record");
  for (const key of ["task", "selector_reason", "exit_code", "wall_clock_ms", "final_state", "failure_reason"]) {
    assert.ok(key in records[0], `outcome field ${key} present (AC2 字段齐全)`);
  }
  assert.equal(records[0].selector_reason, "explicit");
});

test("AC2 — worker exit 7 ⇒ driver exits 7 and records a failed outcome (failure_reason non-null)", (t) => {
  const root = makeRoot("fail");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-b", "--reason", "explicit", "--worker-cmd", "node -e process.exit(7)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 7, "the driver propagates the worker's non-zero exit code");
  const records = readOutcomeLines(root);
  assert.equal(records[0].exit_code, 7);
  assert.equal(records[0].final_state, "failed");
  assert.equal(records[0].failure_reason, "worker exited with code 7");
});

// ── AC3 (能取假): kill worker ⇒ driver notices and records, no silent loss ────────────────────────

test("AC3 — kill the worker ⇒ driver records final_state=killed + signal, does NOT silently drop the task", async (t) => {
  const root = makeRoot("kill");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pidFile = path.join(root, "worker.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--task", "gap-z", "--reason", "kill-test", "--worker-cmd", "sleep 100", "--pid-file", pidFile,
  ], { stdio: ["ignore", "pipe", "ignore"] });

  // Wait for the driver to write the worker pid (its own child pid — the AC1 direct quantity).
  let workerPid = null;
  for (let i = 0; i < 100 && workerPid === null; i++) {
    if (fs.existsSync(pidFile)) workerPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    else await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(workerPid, "the driver wrote the worker pid to --pid-file");
  assert.ok(Number.isInteger(workerPid), "worker pid is the driver's own child pid");

  // Kill the worker (SIGKILL). The driver must notice via the 'close' event and record it.
  process.kill(workerPid, "SIGKILL");
  const exitCode = await new Promise((resolve) => {
    driver.on("close", (c) => resolve(c));
  });
  assert.notEqual(exitCode, 0, "a killed worker is a non-zero driver exit (128+SIGKILL=137)");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "the killed worker still produces EXACTLY ONE outcome record (no silent loss)");
  const rec = records[0];
  assert.equal(rec.task, "gap-z");
  assert.equal(rec.final_state, "killed", "AC3: the driver noticed the kill");
  assert.equal(rec.signal, "SIGKILL", "the signal is recorded");
  assert.equal(rec.exit_code, null, "killed ⇒ exit_code null (the signal carries the fact)");
  assert.equal(rec.failure_reason, "worker killed by SIGKILL");
  assert.ok(rec.wall_clock_ms >= 0, "wall clock recorded");
});

test("AC2 — spawn-failed worker command ⇒ driver records spawn-failed, not silent (never a lost task)", (t) => {
  const root = makeRoot("spawnfail");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-c", "--worker-cmd", "definitely-no-such-binary-xyz"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2, "spawn-failed ⇒ driver exit 2");
  const records = readOutcomeLines(root);
  assert.equal(records[0].final_state, "spawn-failed");
  assert.ok(records[0].failure_reason, "spawn failure reason recorded");
  assert.equal(records[0].exit_code, null);
});
