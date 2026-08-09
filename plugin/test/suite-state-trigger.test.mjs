// @test-group governance
// suite-state-trigger.test.mjs — tasks/gap-red-window-has-no-automatic-executor.
//
// The EXECUTOR layer of the (a) red-window block (gap-full-suite-belongs-to-outer-background-above-3-min).
// ROUND 2 (2026-08-05) proved the red-window rules "exist but are not effective": the suite went
// state=red and sat unhandled ~30 min because BOTH branches (RED → stop-dispatch + triage;
// GREEN/RUNNING → optimistic proceed) only ran when the 20-min cron or a human drove them.
// This task adds an AUTOMATIC suite-state trigger: state changes (state=red / state=running) turn
// into actions (notify outer / drive inner dispatch), without a new scheduling source.
//
// Coverage map (task ACs):
//   AC1 — RED auto-trigger: state flips to red => SUITE-RED event immediately (Monitor push, NOT
//         waiting for the next cron) + stop-dispatch signal confirmed in place (state=red IS the
//         signal). Fixture + outer-doc wiring.
//   AC1b — cold-start-into-red (outer /clear'd, suite already red) still fires SUITE-RED — the exact
//         "red and nobody handling it" shape of the ROUND 2 incident.
//   AC2 — the trigger is the EXECUTOR of existing logic, introduces NO new decisions (no triage /
//         dispatch logic lives in the trigger; the doc says it is "不是新决策者").
//   AC3 — RUNNING optimistic dispatch exerciser: state=running => SUITE-RUNNING => outer drives inner
//         to dispatch per §4 when the pool has dispatchable (no waiting for the round).
//   AC4 — no new scheduling source: the trigger is Monitor-style event monitoring (no CronCreate /
//         ScheduleWakeup / /loop), cadence stays the outer cron.
//   Contract invoke — `full-suite-runner.ts --fail-fast-check` proves the chain end-to-end:
//         failure suite => state=red => SUITE-RED event => stopSignal in place.
//   Negative control (Contract control) — a green suite produces NO SUITE-RED.
//   AC6 — node:test + // @test-group governance (this file).
//
// Run:
//   scripts/test.sh plugin/test/suite-state-trigger.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectSuiteEvent,
  detectCrashedRunner,
  runOnce,
  writeSuiteState,
  readSuiteEvents,
  shouldStopDispatch,
  routeRed,
  RUNNING_STALE_MS,
} from "../scripts/suite-state-trigger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TRIGGER = path.join(REPO_ROOT, "plugin/scripts/suite-state-trigger.ts");
const RUNNER = path.join(REPO_ROOT, "plugin/scripts/full-suite-runner.ts");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const INNER_TICK = path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sst-root-"));
}

function state(over) {
  return {
    state: "running",
    runner: "outer",
    startedAt: "2026-08-05T06:00:00.000Z",
    finishedAt: null,
    durationMs: null,
    laneCount: 8,
    // AC6 (gap-full-suite-state-red-no-failure-detail-static-check-invisible): every real runner
    // state carries `pid` (the runner process). A LIVE pid means the watchdog must NOT treat this
    // running state as crashed — the fixtures default to the live test-process pid so the existing
    // running-state tests stay green while the new watchdog code path is exercised.
    pid: process.pid,
    ...over,
  };
}

/** A PID that is definitely not alive (the crash-watchdog's dead-runner fixture). */
function deadPid() {
  for (let p = 4000000; p > 1000; p -= 1) {
    try {
      process.kill(p, 0);
    } catch (e) {
      if (e.code === "ESRCH") return p;
    }
  }
  throw new Error("could not find a dead pid to test the crash-watchdog");
}

// ── AC1: RED auto-trigger ───────────────────────────────────────────────────────

test("AC1 — state flips to red => SUITE-RED event, recorded, stopSignal in place (fixture)", () => {
  const root = tmpRoot();
  try {
    // suite goes running → red (early-RED: finishedAt still null — the (a) block AC2 design)
    writeSuiteState(root, state({ state: "running" }));
    const first = runOnce(root);
    assert.equal(first.status, "running");
    assert.deepEqual(first.events.map((e) => e.event), ["SUITE-RUNNING"], "running fires SUITE-RUNNING");

    writeSuiteState(root, state({ state: "red", finishedAt: null }));
    const second = runOnce(root);
    assert.equal(second.status, "red");
    assert.equal(second.stopSignal, true, "state=red IS the stop-dispatch signal (AC1b)");
    const redEv = second.events.find((e) => e.event === "SUITE-RED");
    assert.ok(redEv, "SUITE-RED event emitted on the red flip");
    assert.equal(redEv.early, true, "early-RED (finishedAt null) is marked early");
    assert.equal(redEv.stopSignal, true, "event payload confirms the stop-dispatch signal in place");

    // durable append-only log (measure hook: SUITE-RED.at is the red_to_triage_ms start)
    const log = readSuiteEvents(root);
    assert.deepEqual(
      log.map((e) => e.event),
      ["SUITE-RUNNING", "SUITE-RED"],
      "events.jsonl records both transitions",
    );
    assert.ok(log[1].at, "SUITE-RED.at is the red-transition timestamp");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — the outer tick doc wires SUITE-RED => immediately start RED handling, NOT waiting for the next cron", () => {
  const outer = read(OUTER_TICK);
  assert.ok(outer.includes("suite-state-trigger.ts"), "doc names the trigger script");
  assert.ok(outer.includes("SUITE-RED"), "doc names the SUITE-RED event");
  assert.ok(outer.includes("不等下一次 cron") || outer.includes("不等 cron"), "RED handling starts on state-change, not the cron window");
  assert.ok(outer.includes("红窗分诊"), "doc routes SUITE-RED to the existing red-window triage");
  assert.ok(outer.includes("stop-dispatch 信号"), "doc names the stop-dispatch signal (state=red)");
});

test("AC1 unit — detectSuiteEvent is a pure transition detector", () => {
  assert.equal(detectSuiteEvent("running", "red"), "SUITE-RED");
  assert.equal(detectSuiteEvent("green", "red"), "SUITE-RED");
  assert.equal(detectSuiteEvent("green", "running"), "SUITE-RUNNING");
  assert.equal(detectSuiteEvent("red", "running"), "SUITE-RUNNING");
  assert.equal(detectSuiteEvent("running", "green"), "SUITE-GREEN");
  assert.equal(detectSuiteEvent("red", "green"), "SUITE-GREEN");
  assert.equal(detectSuiteEvent("red", "red"), null, "no transition on same state");
  assert.equal(detectSuiteEvent(null, "red"), "SUITE-RED", "first-seen red is a transition");
});

test("AC1b — cold-start-into-red still fires SUITE-RED (the ROUND 2 'red and nobody handling it' shape)", () => {
  const root = tmpRoot();
  try {
    // no memo (fresh outer session after /clear); suite already red
    writeSuiteState(root, state({ state: "red", finishedAt: null }));
    const res = runOnce(root);
    assert.equal(res.status, "red");
    assert.equal(res.stopSignal, true);
    const redEv = res.events.find((e) => e.event === "SUITE-RED");
    assert.ok(redEv, "cold-start-into-red triggers SUITE-RED immediately, no cron wait");
    assert.equal(readSuiteEvents(root).some((e) => e.event === "SUITE-RED"), true, "recorded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2: the trigger is the executor of existing logic, not a new decision-maker ──

test("AC2 — the trigger introduces NO new decisions: no triage/dispatch logic lives in it", () => {
  const src = read(TRIGGER);
  // Triage/dispatch are the OUTER's/inner's existing flows (orchestrator step 1b 红窗分诊 / inner §4).
  // The trigger must not contain the DECISIONS themselves — only the state→event translation.
  for (const decisionTerm of ["git bisect", "回滚", "--task-start", "dispatchable_disjoint", "checkTouchesPair"]) {
    assert.ok(!src.includes(decisionTerm), `trigger must not contain decision logic: ${decisionTerm}`);
  }
  // The doc explicitly states the trigger is an executor, not a new decision-maker / scheduler.
  const outer = read(OUTER_TICK);
  assert.ok(outer.includes("不是新决策"), "doc: trigger is not a new decision-maker");
  assert.ok(outer.includes("触发者是执行者"), "doc: trigger is the executor");
  assert.ok(outer.includes("红窗分诊"), "doc: triage stays the existing red-window triage");
});

// ── AC3: RUNNING optimistic dispatch exerciser ──────────────────────────────────

test("AC3 — state=running => SUITE-RUNNING; the doc wires it to drive inner dispatch (optimistic exerciser)", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "green", finishedAt: "2026-08-05T06:10:00.000Z" }));
    runOnce(root); // first-seen green: calm baseline, no event
    writeSuiteState(root, state({ state: "running" }));
    const res = runOnce(root);
    const runEv = res.events.find((e) => e.event === "SUITE-RUNNING");
    assert.ok(runEv, "SUITE-RUNNING emitted when a new suite starts (running)");
    assert.equal(runEv.stopSignal, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const outer = read(OUTER_TICK);
  assert.ok(outer.includes("SUITE-RUNNING"), "doc names the SUITE-RUNNING event");
  assert.ok(outer.includes("RUNNING 乐观派发执行者"), "doc has the optimistic-dispatch exerciser section");
  assert.ok(outer.includes("驱动 inner 照常派发"), "doc drives inner to dispatch normally (no waiting-for-round)");
  assert.ok(outer.includes("不待轮"), "doc says dispatch without waiting for the round");
});

// ── AC4: no new scheduling source ───────────────────────────────────────────────

test("AC4 — the trigger is Monitor-style event monitoring: no new scheduling source", () => {
  const src = read(TRIGGER);
  for (const scheduler of ["CronCreate", "ScheduleWakeup", "/loop"]) {
    assert.ok(!src.includes(scheduler), `trigger must not create a new scheduling source: ${scheduler}`);
  }
  const outer = read(OUTER_TICK);
  assert.ok(outer.includes("不是新调度源"), "doc: cadence stays unique (outer cron), trigger is not a scheduler");
  assert.ok(outer.includes("节奏仍唯一"), "doc: the outer cron remains the only cadence");
});

// ── AC5 (gap-full-suite-runner-concurrency-default-and-gate): failed vs aborted reason axis ─────────

test("AC5 — shouldStopDispatch distinguishes failed vs aborted vs infra-error (only failed/missing stops)", () => {
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "red+failed stops dispatch");
  assert.equal(shouldStopDispatch({ state: "red" }), true, "legacy red (no reason) stops dispatch — fail-closed");
  assert.equal(shouldStopDispatch({ state: "red", reason: "aborted" }), false, "red+aborted does NOT stop dispatch");
  assert.equal(shouldStopDispatch({ state: "red", reason: "infra-error" }), false, "red+infra-error does NOT stop dispatch (no code-failure conclusion)");
  assert.equal(shouldStopDispatch({ state: "green" }), false, "green never stops");
  assert.equal(shouldStopDispatch({ state: "running" }), false, "running never stops");
  assert.equal(shouldStopDispatch(null), false, "absent state file never stops (outer hasn't run round 1)");
});

test("AC2 — routeRed routes by reason: failed/legacy→red-window-triage, aborted/infra-error→resource-gate, non-red→proceed", () => {
  assert.equal(routeRed({ state: "red", reason: "failed" }), "red-window-triage", "red+failed stops + triage");
  assert.equal(routeRed({ state: "red" }), "red-window-triage", "legacy red fails closed to red-window-triage");
  assert.equal(routeRed({ state: "red", reason: "aborted" }), "resource-gate", "red+aborted → resource-gate, NOT code-risk stop");
  assert.equal(routeRed({ state: "red", reason: "infra-error" }), "resource-gate", "red+infra-error → resource-gate (environment, not code)");
  assert.equal(routeRed({ state: "green" }), "proceed", "green proceeds");
  assert.equal(routeRed({ state: "running" }), "proceed", "running proceeds");
  assert.equal(routeRed(null), "proceed", "absent state file proceeds");
});

test("AC5 — runOnce reports stopSignal=false for red+aborted and true for red+failed", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "red", reason: "aborted", finishedAt: "2026-08-05T06:10:00.000Z" }));
    const aborted = runOnce(root);
    assert.equal(aborted.stopSignal, false, "aborted-red → no stop-dispatch signal (AC5 negative control)");
    const abortedEv = aborted.events.find((e) => e.event === "SUITE-RED");
    assert.ok(abortedEv, "SUITE-RED still fires on aborted-red (the flip is recorded)");
    assert.equal(abortedEv.stopSignal, false, "the aborted SUITE-RED event confirms stopSignal=false");

    // A FRESH root for the failed form — the memo on `root` already advanced to red above, so a
    // second red there is a same-state no-transition.
    const root2 = tmpRoot();
    try {
      writeSuiteState(root2, state({ state: "red", reason: "failed", finishedAt: null }));
      const failed = runOnce(root2);
      assert.equal(failed.stopSignal, true, "failed-red → stop-dispatch signal in place (AC5)");
      const failedEv = failed.events.find((e) => e.event === "SUITE-RED");
      assert.ok(failedEv, "SUITE-RED fires on failed-red");
      assert.equal(failedEv.stopSignal, true, "the failed SUITE-RED event confirms the signal");
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 — both loop docs carry the failed vs aborted stop-dispatch ruling (reason axis)", () => {
  const inner = read(INNER_TICK);
  const outer = read(OUTER_TICK);
  // Inner step-3 stop condition: red + reason=failed (or missing) stops; red + aborted does NOT.
  assert.match(inner, /aborted/, "inner doc names the aborted reason");
  assert.match(inner, /不触发/, "inner doc: aborted does not trigger stop-dispatch");
  assert.match(inner, /failed/, "inner doc names failed as the stop reason");
  // Outer red-window: the stop-dispatch signal is red + failed (aborted is handled as record+re-run).
  assert.match(outer, /aborted/, "outer doc names the aborted reason");
  assert.match(outer, /reason/, "outer doc carries the reason axis");
});

// ── Contract invoke: --fail-fast-check proves the RED chain end-to-end ──────────

function runCli(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, out, err }));
  });
}

test("Contract invoke — `full-suite-runner.ts --fail-fast-check` proves: failure suite => red => SUITE-RED => stopSignal", async () => {
  const { code, out } = await runCli(RUNNER, ["--fail-fast-check"]);
  assert.equal(code, 0, `--fail-fast-check exits 0 when the chain works; got ${code}\n${out}`);
  assert.match(out, /fail-fast-check OK/, "verification line present");
  assert.match(out, /stopSignal=true/, "stop-dispatch signal confirmed in place");
  assert.match(out, /SUITE-RED/, "SUITE-RED event recorded");
});

test("Contract control (negative) — a green suite produces NO SUITE-RED", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "green", finishedAt: "2026-08-05T06:10:00.000Z" }));
    const res = runOnce(root);
    assert.deepEqual(res.events, [], "first-seen green: calm baseline, no event");
    assert.equal(res.stopSignal, false, "green is not a stop-dispatch signal");
    // steady-state green (no transition) stays silent
    writeSuiteState(root, state({ state: "green", finishedAt: "2026-08-05T06:20:00.000Z" }));
    const again = runOnce(root);
    assert.deepEqual(again.events, [], "green → green: no event");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC6 — this file declares node:test and // @test-group governance", () => {
  const src = read(new URL(import.meta.url));
  assert.ok(src.includes('import { test } from "node:test"'), "uses node:test");
  assert.match(src, /^\/\/ @test-group governance/m, "declares @test-group governance");
});

// ── AC6: crash-watchdog (gap-full-suite-state-red-no-failure-detail-static-check-invisible) ─────────
// A `running` state whose RUNNER is dead (SIGKILL / uncaught crash — the proposal-convergence
// deadlock shape: state stuck at running mtime=23:16, never a terminal state) must not stay `running`
// forever: runOnce must write a terminal reason=crashed state so consumers can tell "running" from
// "dead" on the STATE FILE itself.

test("AC6 unit — detectCrashedRunner: a running state with a DEAD pid is crashed; a LIVE pid is genuinely running", () => {
  const iso = new Date().toISOString();
  // live pid ⇒ genuinely running (never crashed by the watchdog, regardless of age)
  assert.equal(
    detectCrashedRunner({ state: "running", pid: process.pid, startedAt: "2020-01-01T00:00:00.000Z" }),
    null,
    "a live-pid running state is genuinely in progress (AC6 negative control)",
  );
  // dead pid ⇒ terminal crashed red
  const crashed = detectCrashedRunner({ state: "running", pid: deadPid(), startedAt: iso });
  assert.ok(crashed, "a dead-pid running state is detected as crashed (AC6)");
  assert.equal(crashed.state, "red");
  assert.equal(crashed.reason, "crashed");
  assert.equal(typeof crashed.finishedAt, "number", "crashed terminal state has epoch finishedAt");
  assert.equal(typeof crashed.durationMs, "number", "crashed terminal state has durationMs");
  // non-running states are never crashed
  assert.equal(detectCrashedRunner({ state: "green" }), null, "green is not crashed");
  assert.equal(detectCrashedRunner({ state: "red", reason: "failed" }), null, "red is not crashed");
  assert.equal(detectCrashedRunner(null), null, "absent state is not crashed");
});

test("AC6 unit — detectCrashedRunner: a legacy running state (no pid) falls back to a stale-AGE threshold", () => {
  const now = Date.now();
  // fresh legacy running state (no pid, < RUNNING_STALE_MS old) ⇒ fail-open toward running
  assert.equal(
    detectCrashedRunner(
      { state: "running", startedAt: new Date(now - RUNNING_STALE_MS / 2).toISOString() },
      now,
    ),
    null,
    "a fresh legacy running state is treated as in-progress (no pid yet — fail-open)",
  );
  // stale legacy running state (> RUNNING_STALE_MS old) ⇒ crashed (the pre-fix leftover shape)
  const stale = detectCrashedRunner(
    { state: "running", startedAt: new Date(now - RUNNING_STALE_MS - 1000).toISOString() },
    now,
  );
  assert.ok(stale, "a stale legacy running state is detected as crashed");
  assert.equal(stale.reason, "crashed");
  // a legacy state with an unparseable startedAt is also treated as in-progress (fail-open)
  assert.equal(detectCrashedRunner({ state: "running", startedAt: "not-a-date" }, now), null);
});

test("AC6 — runOnce crash-watchdog: a dead-runner running state becomes red reason=crashed on the STATE FILE + fires SUITE-RED (no stop signal)", () => {
  const root = tmpRoot();
  try {
    // The proposal-convergence shape: state=running, runner dead, no terminal write ever.
    writeSuiteState(root, state({ state: "running", pid: deadPid() }));
    const res = runOnce(root);
    assert.equal(res.status, "red", "runOnce reports the crashed state as red");
    assert.equal(res.stopSignal, false, "crashed has no correctness conclusion ⇒ no code-risk stop (same as aborted)");
    const redEv = res.events.find((e) => e.event === "SUITE-RED");
    assert.ok(redEv, "the running→crashed death is recorded as a SUITE-RED event");
    assert.equal(redEv.state?.reason, "crashed", "the SUITE-RED event carries reason=crashed (consumer can re-launch)");
    assert.equal(redEv.stopSignal, false, "the crashed SUITE-RED event confirms no stop-dispatch");
    // The STATE FILE itself was rewritten to the terminal crashed state — consumers reading the file
    // directly (inner stop-condition / suite-state-trigger / outer tick) see the death, not running.
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, ".quay", "full-suite-state.json"), "utf8"));
    assert.equal(onDisk.state, "red", "the state FILE is terminal red, not running (AC6 — '跑着' vs '死了' distinguishable)");
    assert.equal(onDisk.reason, "crashed", "the state FILE carries reason=crashed");
    // steady state: a second runOnce over the now-crashed state emits no new transition
    const again = runOnce(root);
    assert.equal(again.status, "red");
    assert.deepEqual(again.events, [], "crashed → crashed is a same-state no-transition");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC6 negative control — runOnce does NOT crash a genuinely-running state (live pid): stays running, no SUITE-RED", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "running", pid: process.pid }));
    const res = runOnce(root);
    assert.equal(res.status, "running", "a live-runner running state stays running (AC6 negative control)");
    assert.equal(res.stopSignal, false);
    assert.ok(!res.events.some((e) => e.event === "SUITE-RED"), "no false SUITE-RED for a genuinely-running suite");
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, ".quay", "full-suite-state.json"), "utf8"));
    assert.equal(onDisk.state, "running", "the state FILE is untouched (still running)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC6 — routeRed/shouldStopDispatch route crashed like aborted (no code-risk stop); crashed stays distinct from failed/aborted", () => {
  assert.equal(routeRed({ state: "red", reason: "crashed" }), "resource-gate", "crashed → resource-gate (NOT a code-failure conclusion)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "crashed" }), false, "crashed does NOT stop dispatch");
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "failed still stops (unchanged)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "static-check" }), true, "static-check still stops (unchanged)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "aborted" }), false, "aborted does NOT stop (unchanged)");
});
