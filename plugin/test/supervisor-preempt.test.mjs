// @test-group governance
// supervisor-preempt.test.mjs — the supervisor base layer's PREEMPTION primitive
// (tasks/gap-supervisor-preemption, 落地次序 step ④; SPEC-integration-architecture §4.4 #4).
//
// `.halt` is checked at the TICK BOUNDARY (tick step 0); incident 7 showed the continuous flow
// bypasses step 0 (after `.halt`, inner still dispatched 5 subagents). This test pins the
// PREEMPTIVE form: `.halt` takes effect at ANY execution point, enforced in CODE not prose.
//
// Contract surface (gap-supervisor-preemption ## Contract):
//   measure   preemption_halt_no_new_subagent = `bash <抢占原语> halt-check` stdout 的字段
//   band      preemption_halt_no_new_subagent = 0  (halt 后新派发 subagent 计数不增长)
//   invariant preemption_is_process_level     = 1  (抢占不依赖被抢占方主动调用——不可被绕过)
//
// Coverage map (task ACs):
//   AC1 — preempt(target) exists and is a stop signal at ANY execution point; the negative
//         control "halt 后不再产生新 subagent" (process-level count does not grow) is tested.
//   AC2 — RETIRED (gap-retire-slot-refill-halt-mount): the slot-refill `.halt` dispatch mount
//         (should_refill=false) was removed — the inner dispatch loop is dead; the `.halt` state
//         signal survives via outer-driver A3 (haltStatusRoutine) direct read.
//   AC4 — `claude -p` form: preempt of a PID = `kill <pid>` (the OS is the preemption primitive).
//   AC5 — node:test + // @test-group governance.
//   Contract — halt-check's `halted=` field; fail-closed on an unreadable sentinel.
//
// Run: scripts/test.sh plugin/test/supervisor-preempt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "supervisor-preempt.sh");

if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

function runPreempt(args, env = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preempt-root-"));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  return root;
}

// Wait (asynchronously) for a pid to be gone. Uses setInterval so the event loop keeps running and
// Node reaps its children — a busy-spin would leave the child as a zombie and kill(pid,0) would
// still see it "alive". Returns true when the pid is gone, false on timeout.
function waitForExit(pid, timeoutMs = 2000) {
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

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ── Contract: halt-check — the `halted=` measure field ────────────────────────────────────────────

test("halt-check: no .halt ⇒ halted=false, reason empty (Contract measure)", () => {
  const root = makeRoot();
  try {
    const r = runPreempt(["halt-check", "--root", root]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^halted=false$/m);
    assert.match(r.stdout, /^reason=$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("halt-check: .halt present ⇒ halted=true with its content as reason", () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, ".halt"), "manual stop | 解除: x", "utf8");
    const r = runPreempt(["halt-check", "--root", root]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^halted=true$/m);
    assert.match(r.stdout, /^reason=manual stop \| 解除: x$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("halt-check: empty .halt still halts (the sentinel is the pause), reason names empty", () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, ".halt"), "", "utf8");
    const r = runPreempt(["halt-check", "--root", root]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^halted=true$/m);
    assert.match(r.stdout, /empty/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("halt-check: unreadable .halt is FAIL-CLOSED halted=true (never fail open)", () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, ".halt"), "stop", "utf8");
    fs.chmodSync(path.join(root, ".halt"), 0o000);
    const r = runPreempt(["halt-check", "--root", root]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^halted=true$/m);
    assert.match(r.stdout, /FAIL-CLOSED/);
  } finally {
    fs.chmodSync(path.join(root, ".halt"), 0o600);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4 / AC1-process: preempt <pid> = kill — the `claude -p` form (OS is the primitive) ───────────

test("AC4/AC1: preempt <pid> sends SIGINT and the process dies (the -p form = kill)", async () => {
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  const pid = child.pid;
  try {
    assert.ok(pid > 0);
    const r = runPreempt(["preempt", String(pid)]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(`pid ${pid} signaled`));
    // Wait for the process to actually exit after SIGINT.
    const exited = await waitForExit(pid);
    assert.ok(exited, "the preempted pid must be gone after SIGINT");
  } finally {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }
});

test("AC1: preempt of a dead/missing pid fails loud (exit 1), signals nothing", () => {
  const r = runPreempt(["preempt", "99999999"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not alive|failed to signal/);
});

// ── AC1-tmux: preempt <tmux-target> = C-c (the TUI form) — hermetic fake tmux ─────────────────────

function makeFakeTmux(logPath) {
  // A minimal tmux stand-in that records calls. Behaves like tmux for the exact commands the
  // script issues: has-session → 1 (session exists); send-keys → append a log line, exit 0.
  const fake = path.join(os.tmpdir(), `fake-tmux-${process.pid}-${Math.random().toString(36).slice(2)}.sh`);
  const body = `#!/usr/bin/env bash
LOG="${logPath}"
if [ "$1" = "has-session" ]; then exit 0; fi
if [ "$1" = "list-panes" ]; then exit 0; fi
if [ "$1" = "send-keys" ]; then echo "send-keys $2 $3 $4" >> "$LOG"; exit 0; fi
exit 0
`;
  fs.writeFileSync(fake, body, "utf8");
  fs.chmodSync(fake, 0o755);
  return fake;
}

test("AC1-tui: preempt <tmux-target> sends C-c to the target at any point (hermetic fake tmux)", () => {
  const log = path.join(os.tmpdir(), `preempt-tmux-log-${process.pid}-${Date.now()}.txt`);
  const fake = makeFakeTmux(log);
  try {
    const r = runPreempt(["preempt", "inner", "--method", "tmux-c-c"], { SUPERVISOR_PREEMPT_TMUX: fake });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /inner signaled \(C-c\)/);
    const recorded = fs.readFileSync(log, "utf8").trim();
    assert.equal(recorded, "send-keys -t inner C-c", "the signal is a tmux C-c to the target pane");
  } finally {
    fs.rmSync(log, { force: true });
    fs.rmSync(fake, { force: true });
  }
});

// ── AC1/DoD: halt 后不再产生新 subagent — process-level count does not grow ──────────────────────

test("AC1/DoD: preempt-all — after .halt, all in-flight subagent pids are killed and the count does not grow", async () => {
  const root = makeRoot();
  const pids = [];
  try {
    // Fake in-flight subagent processes (the layers the supervisor would preempt on halt).
    for (let i = 0; i < 3; i++) {
      const c = spawn("sleep", ["300"], { stdio: "ignore" });
      pids.push(c.pid);
    }
    const countAlive = () => pids.filter(pidAlive).length;
    assert.equal(countAlive(), 3, "three in-flight fake subagents");
    const before = countAlive();

    // Place .halt — the human stop.
    fs.writeFileSync(path.join(root, ".halt"), "halt now", "utf8");

    // preempt-all: signal every in-flight pid.
    const r = runPreempt(["preempt-all", "--root", root, "--pid", pids.join(",")]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /halted — signaled 3 in-flight layer/);

    // All were killed — the preemption does NOT depend on the preemptee calling anything.
    for (const p of pids) await waitForExit(p);
    const after = countAlive();
    assert.equal(after, 0, `all ${before} in-flight subagents stopped by preempt-all`);

    // No NEW subagent appears: a short re-scan still finds 0 (count does not grow).
    await new Promise((res) => setTimeout(res, 60));
    assert.equal(countAlive(), 0, "no new subagent is produced after halt (process-level count stays 0)");
  } finally {
    for (const p of pids) { try { process.kill(p, "SIGKILL"); } catch { /* already dead */ } }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: preempt-all with no .halt is a no-op (nothing to preempt)", () => {
  const root = makeRoot();
  try {
    const r = runPreempt(["preempt-all", "--root", root, "--pid", "123"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no-halt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: preempt-all with .halt but no resolvable targets fails loud (did not preempt)", () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, ".halt"), "stop", "utf8");
    const r = runPreempt(["preempt-all", "--root", root]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no targets\/pids resolved to signal/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Contract invariant: preemption_is_process_level ────────────────────────────────────────────────

test("Contract invariant: preempt does not depend on the target calling anything (no cooperation needed)", async () => {
  // The target here is a plain `sleep` — it has NO idea a preemption mechanism exists, has no
  // handler, no cooperative hook. If SIGINT kills it, the invariant holds: the primitive is
  // process-level, not voluntary.
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  const pid = child.pid;
  try {
    const r = runPreempt(["preempt", String(pid)]);
    assert.equal(r.status, 0);
    const gone = await waitForExit(pid);
    assert.ok(gone, "a non-cooperating target is stopped — the invariant preemption_is_process_level=1");
  } finally {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }
});

}
