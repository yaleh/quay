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
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectSuiteEvent,
  detectCrashedRunner,
  runOnce,
  writeSuiteState,
  readSuiteState,
  readSuiteEvents,
  shouldStopDispatch,
  routeRed,
  RUNNING_STALE_MS,
  shouldAutoRetrigger,
  retriggerRunnerArgs,
  DEFAULT_RETRIGGER_IDLE_MS,
  // gap-b3-tick-coupled-misses-between-tick-merges — event-driven round-start triggers
  shouldStartIdleGreen,
  shouldStartOnMergeLanding,
  readGitVerificationState,
  resolveIdleGreenMs,
  DEFAULT_IDLE_GREEN_MS,
  // gap-suite-state-trigger-retriggers-while-runner-alive — runner-liveness before retrigger
  isRunnerInFlight,
  spawnRetriggerRun,
  // gap-suite-start-verifies-target-commit — verifiedCommit 起跑闸 (AC1 验非目标 / AC5 同树)
  readVerifiedCommit,
  verifiedTreeContainsCommit,
  readLastGreenCommit,
  checkVerificationStartGates,
  resolveVerifyTarget,
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

function runCli(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
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

test("AC6 unit — detectCrashedRunner: a NO-PID running state is NEVER judged crashed on age (fail-open, even when stale)", () => {
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
  // STALE legacy running state (> RUNNING_STALE_MS old) ⇒ STILL not crashed: without a pid we cannot
  // confirm the runner is dead, so the watchdog fails open toward "running" regardless of age
  // (gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test — the pre-fix stale-AGE
  // fallback misjudged red-window-shared-gate AC3's no-pid old-startedAt fixture as a dead runner).
  const stale = detectCrashedRunner(
    { state: "running", startedAt: new Date(now - RUNNING_STALE_MS - 1000).toISOString() },
    now,
  );
  assert.equal(stale, null, "a stale no-pid legacy running state is NOT crashed (fail-open, no age heuristic)");
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

// ── auto-retrigger (gap-suite-empty-wait-no-auto-retrigger AC2/AC3/AC4) ─────────────────────────────
// The full-suite EMPTY-WAIT hole (measured 2026-08-10: red-window span 13.23h/56%, empty wait
// 6.48h/49%, ~2h hole 19:13→21:06): after a suite terminal state (red/green), nothing mechanically
// starts the next round — the loop idles until the outer's manual tick. These tests pin the
// auto-retrigger DECISION (pure) + the AC4 race-safety surfaces. The real spawn is exercised only via
// the runner's gate path (test c) — never a live full-suite run (that is the outer's job).

test("AC2 — a terminal state idle >= N fires retrigger (short-N injection); fresh / running / early-red / absent do NOT", () => {
  const now = Date.now();
  // idle-exceeded ⇒ fire — GREEN terminal (AC2: green round ends, no new round starts)
  assert.equal(
    shouldAutoRetrigger({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) }, null, 1000, now).retrigger,
    true,
    "green terminal idle >= N fires",
  );
  // AC3 — a RED terminal takes the SAME path (red→idle hole detection: red round ends, no running)
  assert.equal(
    shouldAutoRetrigger({ state: "red", reason: "failed", finishedAt: Math.floor((now - 2000) / 1000) }, null, 1000, now).retrigger,
    true,
    "red terminal idle >= N fires (AC3 — red→idle hole)",
  );
  // fresh terminal (< N) ⇒ no fire
  assert.equal(
    shouldAutoRetrigger({ state: "green", finishedAt: Math.floor(now / 1000) }, null, 1000, now).retrigger,
    false,
    "fresh terminal (< N) does not fire",
  );
  // AC4 no-double-start — a `running` state (a round — manual OR auto — is in flight) never fires
  assert.equal(shouldAutoRetrigger({ state: "running" }, null, 1000, now).retrigger, false, "running never fires");
  // early-red (finishedAt null — the runner is STILL in flight) never fires
  assert.equal(shouldAutoRetrigger({ state: "red", finishedAt: null }, null, 1000, now).retrigger, false, "early-red does not fire");
  // absent state file (outer hasn't run round 1) never fires
  assert.equal(shouldAutoRetrigger(null, null, 1000, now).retrigger, false, "absent state never fires");
  // the default threshold is the Contract band (10 min)
  assert.equal(DEFAULT_RETRIGGER_IDLE_MS, 10 * 60 * 1000, "default N = 10 min (empty_wait_after_terminal <= 10)");
});

test("AC4 — no retrigger storm: an immediately-repeated observation of the same idle terminal is throttled", () => {
  const root = tmpRoot();
  try {
    const now = Date.now();
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) }));
    const first = runOnce(root, { idleMs: 1000 });
    assert.equal(first.retrigger, true, "first observation of the idle terminal fires the retrigger decision");
    const second = runOnce(root, { idleMs: 1000 });
    assert.equal(second.retrigger, false, "an immediate repeat is throttled (one retrigger per idle window)");
    // after the throttle window EXPIRES, the same idle terminal fires again (a WAIT'd attempt retries)
    assert.equal(
      shouldAutoRetrigger(
        { state: "green", finishedAt: Math.floor((now - 5000) / 1000) },
        now - 60_000, // last retrigger attempt 60s ago > 1s idle window
        1000,
        now,
      ).retrigger,
      true,
      "once the throttle window expires, the idle terminal fires again",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — a running state between terminal and re-check prevents the retrigger (runOnce integration)", () => {
  const root = tmpRoot();
  try {
    const now = Date.now();
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) }));
    runOnce(root, { idleMs: 1000 }); // decision: retrigger (but the SPAWN re-checks the state file)
    // A manual/outer start lands before the spawn re-check: state is now running ⇒ the spawn bails.
    writeSuiteState(root, state({ state: "running" }));
    const res = runOnce(root, { idleMs: 1000 });
    assert.equal(res.retrigger, false, "a running state (round in flight) suppresses the retrigger decision");
    assert.equal(res.status, "running", "the observed status is running");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — the retrigger reuses the runner's resource gate: WAIT blocks the retrigger (state untouched, suite never spawns)", async () => {
  const root = tmpRoot();
  try {
    const now = Date.now();
    const terminal = state({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) });
    writeSuiteState(root, terminal);
    // The args a retrigger spawn passes — the SAME surface the outer's manual start uses. A fake
    // --command is spliced so that even IF the gate unexpectedly GOed, no real suite would run.
    const args = [...retriggerRunnerArgs(root, terminal), "--command", 'echo "fake suite — must not run on WAIT"'];
    assert.ok(args.includes("--root"), "the retrigger passes the watched root (the tested checkout)");
    assert.ok(args.includes("--lane-count"), "the retrigger preserves the last round's laneCount");
    const { code } = await runCli(RUNNER, args, {
      QUAY_TEST_SKIP_RESOURCE_GATE: "0", // force the REAL gate path, with seams (same as full-suite-runner AC3)
      QUAY_TEST_SKIP_SYSTEMD_RUN: "1",
      RESOURCE_GATE_TEST_CPU_AVG10: "84.77", // WAIT (cpu stalled)
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    });
    assert.notEqual(code, 0, "WAIT ⇒ the runner exits non-zero (did not start the suite)");
    const s = readSuiteState(root);
    assert.ok(s, "the state file still exists");
    assert.equal(s.state, "green", "state stays terminal (untouched) on WAIT — the retrigger does not start into a busy machine");
    assert.equal(s.finishedAt, terminal.finishedAt, "the terminal state is byte-untouched (same round)");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "full-suite.log")), "the suite was NEVER spawned on WAIT");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-b3-tick-coupled-misses-between-tick-merges: event-driven round START ────────────────────────
// The B3 start condition was a tick-polling side effect — a merge landing between ticks was missed
// (r271 04:38 → 51 min idle, develop..integration 33→38, machine empty, all B3 conditions satisfied).
// The fix: AC2 merge-landing trigger (integration HEAD advances ⇒ start) + AC3 idle-green trigger
// (state=green + develop..integration>0 + sustained idle ⇒ start), both event-driven via this Monitor.

/** A REAL git repo with develop + integration branches, integration ahead by `ahead` commits. */
function gitRoot(ahead = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sst-git-"));
  execSync("git init -q -b develop", { cwd: root, stdio: "ignore" });
  execSync("git config user.email sst@example.com", { cwd: root, stdio: "ignore" });
  execSync("git config user.name sst", { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.txt"), "base\n", "utf8");
  execSync("git add a.txt && git commit -q -m base", { cwd: root, stdio: "ignore" });
  const developHead = execSync("git rev-parse develop", { cwd: root, encoding: "utf8" }).trim();
  execSync("git branch integration", { cwd: root, stdio: "ignore" });
  execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
  for (let i = 1; i <= ahead; i++) {
    fs.writeFileSync(path.join(root, "a.txt"), `base + ${i}\n`, "utf8");
    execSync("git add a.txt && git commit -q -m merge", { cwd: root, stdio: "ignore" });
  }
  const integrationHead = execSync("git rev-parse integration", { cwd: root, encoding: "utf8" }).trim();
  execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
  return { root, developHead, integrationHead, ahead };
}

/** Create a new commit on the CURRENT branch of `root`; returns its full sha. */
function commit(root, msg, content = "x\n") {
  fs.writeFileSync(path.join(root, "a.txt"), content, "utf8");
  execSync("git add -A && git commit -q -m " + JSON.stringify(msg), { cwd: root, stdio: "ignore" });
  return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
}

/** Append a verification-round.jsonl record to `<root>/.quay/` (test seam for readLastGreenCommit). */
function writeRound(root, rec) {
  const file = path.join(root, ".quay", "verification-round.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
}

// ── AC2: merge 落地触发 (merge landing trigger) ─────────────────────────────────────────────────────

test("AC2 — shouldStartOnMergeLanding is pure: a head ADVANCE with pending + non-running fires; no advance / running / no-pending do not", () => {
  const now = Date.now();
  const green = state({ state: "green", finishedAt: Math.floor((now - 60_000) / 1000) });
  const headA = "a".repeat(40);
  const headB = "b".repeat(40);
  // a NEW merge landed (head advanced past the memo's last-seen tip) + pending + not running ⇒ fire
  assert.equal(
    shouldStartOnMergeLanding(headA, headB, 1, green).fire,
    true,
    "head advance + pending + green (not running) fires the merge-landing trigger",
  );
  // no baseline (first observation) ⇒ no fire — a baseline is established, not a landing to react to
  assert.equal(shouldStartOnMergeLanding(null, headB, 1, green).fire, false, "no prev head ⇒ baseline, no fire");
  // head UNCHANGED ⇒ no new merge ⇒ no fire
  assert.equal(shouldStartOnMergeLanding(headA, headA, 1, green).fire, false, "stable head ⇒ no new merge");
  // state=running ⇒ a round is in flight ⇒ no fire (AC2: state != running required)
  assert.equal(
    shouldStartOnMergeLanding(headA, headB, 1, state({ state: "running" })).fire,
    false,
    "running state ⇒ no merge-landing (a round is in flight)",
  );
  // pending==0 ⇒ no unverified commits ⇒ no fire (AC4 no_pending_no_trigger)
  assert.equal(shouldStartOnMergeLanding(headA, headB, 0, green).fire, false, "no pending ⇒ no fire (AC4)");
});

test("AC2 — runOnce emits SUITE-MERGE-PENDING + mergePending flag when a new integration merge lands (real git fixture)", () => {
  const { root, integrationHead } = gitRoot(1);
  try {
    const now = Date.now();
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor((now - 60_000) / 1000) }));
    // First observation: establishes the lastIntegrationHead baseline (no fire on a pre-existing tip).
    const first = runOnce(root, { idleGreenMs: 10_000_000 });
    assert.equal(first.mergePending, false, "first observation establishes the baseline, does not fire");
    assert.equal(first.events.some((e) => e.event === "SUITE-MERGE-PENDING"), false, "no event on baseline");

    // Advance integration with a NEW merge while state stays green.
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "a.txt"), "base + 1 + 2\n", "utf8");
    execSync("git add a.txt && git commit -q -m merge2", { cwd: root, stdio: "ignore" });
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    const second = runOnce(root, { idleGreenMs: 10_000_000 });
    assert.equal(second.mergePending, true, "a NEW integration merge while green fires the merge-landing trigger");
    const ev = second.events.find((e) => e.event === "SUITE-MERGE-PENDING");
    assert.ok(ev, "SUITE-MERGE-PENDING event recorded");
    assert.match(ev.integrationHead ?? "", /^[0-9a-f]{40}$/, "event carries the integration tip sha");
    assert.notEqual(ev.integrationHead, integrationHead, "the tip is the NEW post-merge head, not the baseline");
    assert.ok(ev.pendingCount >= 1, "event carries the pending count (develop..integration >= 1)");
    assert.ok(readSuiteEvents(root).some((e) => e.event === "SUITE-MERGE-PENDING"), "event persisted to the events log");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — runOnce does NOT fire merge-landing when state=running even if a merge landed (a round is in flight)", () => {
  const { root } = gitRoot(1);
  try {
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor(Date.now() / 1000) }));
    runOnce(root, { idleGreenMs: 10_000_000 }); // baseline
    // Now a merge lands WHILE a round is running.
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "a.txt"), "base + 1 + 3\n", "utf8");
    execSync("git add a.txt && git commit -q -m merge3", { cwd: root, stdio: "ignore" });
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    writeSuiteState(root, state({ state: "running" }));
    const res = runOnce(root, { idleGreenMs: 10_000_000 });
    assert.equal(res.mergePending, false, "running state suppresses the merge-landing trigger");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3: idle-green 触发 (idle-green with unverified commits) ──────────────────────────────────────

test("AC3 — shouldStartIdleGreen is pure: green + pending>0 + idle>=N fires; green-no-pending / not-green / fresh do not", () => {
  const now = Date.now();
  const idleGreenMs = 1000;
  // green + pending + idle exceeded ⇒ fire
  assert.equal(
    shouldStartIdleGreen(
      { state: "green", finishedAt: Math.floor((now - 2000) / 1000) },
      { integrationHead: "h".repeat(40), pendingCount: 2 },
      idleGreenMs,
      null,
      now,
    ).fire,
    true,
    "green + pending>0 + idle >= N fires the idle-green trigger",
  );
  // AC4 negative: pending==0 ⇒ no fire (无未验证提交不误起)
  assert.equal(
    shouldStartIdleGreen(
      { state: "green", finishedAt: Math.floor((now - 2000) / 1000) },
      { integrationHead: "h".repeat(40), pendingCount: 0 },
      idleGreenMs,
      null,
      now,
    ).fire,
    false,
    "green with NO pending commits never fires (AC4 no_pending_no_trigger)",
  );
  // not-green (running / red) ⇒ no fire
  assert.equal(
    shouldStartIdleGreen(
      { state: "running" },
      { integrationHead: "h".repeat(40), pendingCount: 2 },
      idleGreenMs,
      null,
      now,
    ).fire,
    false,
    "running is not idle-green",
  );
  // fresh terminal (< N) ⇒ no fire
  assert.equal(
    shouldStartIdleGreen(
      { state: "green", finishedAt: Math.floor(now / 1000) },
      { integrationHead: "h".repeat(40), pendingCount: 2 },
      idleGreenMs,
      null,
      now,
    ).fire,
    false,
    "fresh terminal (< N) does not fire idle-green",
  );
  // throttled: a repeat within the idle window is suppressed (one attempt per idle window)
  assert.equal(
    shouldStartIdleGreen(
      { state: "green", finishedAt: Math.floor((now - 2000) / 1000) },
      { integrationHead: "h".repeat(40), pendingCount: 2 },
      idleGreenMs,
      now - 100, // last idle-green attempt < idleMs ago
      now,
    ).fire,
    false,
    "a repeat within the idle window is throttled (no storm)",
  );
  // no-git ⇒ no fire (pendingCount null = cannot see unverified work)
  assert.equal(
    shouldStartIdleGreen(
      { state: "green", finishedAt: Math.floor((now - 2000) / 1000) },
      { integrationHead: null, pendingCount: null },
      idleGreenMs,
      null,
      now,
    ).fire,
    false,
    "no git facts ⇒ no idle-green trigger",
  );
});

test("AC3 — runOnce emits SUITE-IDLE-GREEN + idleGreen flag when state=green with unverified commits + sustained idle (real git fixture)", () => {
  const { root } = gitRoot(2);
  try {
    const now = Date.now();
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) }));
    const res = runOnce(root, { idleGreenMs: 1000 });
    assert.equal(res.idleGreen, true, "green + develop..integration>0 + idle>=N fires the idle-green trigger");
    const ev = res.events.find((e) => e.event === "SUITE-IDLE-GREEN");
    assert.ok(ev, "SUITE-IDLE-GREEN event recorded");
    assert.ok(ev.pendingCount >= 1, "event carries the pending count (develop..integration >= 1)");
    assert.ok(readSuiteEvents(root).some((e) => e.event === "SUITE-IDLE-GREEN"), "event persisted to the events log");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — runOnce does NOT fire idle-green when pending==0 (AC4 no_pending_no_trigger)", () => {
  const { root } = gitRoot(0); // integration == develop — NO unverified commits
  try {
    const now = Date.now();
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) }));
    const res = runOnce(root, { idleGreenMs: 1000 });
    assert.equal(res.idleGreen, false, "green with NO unverified commits never fires idle-green");
    assert.equal(res.events.some((e) => e.event === "SUITE-IDLE-GREEN"), false, "no SUITE-IDLE-GREEN event");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — idle-green is event-driven, not a tick side effect: resolveIdleGreenMs honors CLI/env and defaults to 2 min", () => {
  assert.equal(DEFAULT_IDLE_GREEN_MS, 2 * 60 * 1000, "default idle-green threshold = 2 min (持续 idle)");
  assert.equal(resolveIdleGreenMs(["--idle-green-min", "0.5"]), 30_000, "CLI --idle-green-min converts minutes to ms");
  // env seam wins over default, CLI wins over env
  process.env.QUAY_SUITE_IDLE_GREEN_MS = "1234";
  try {
    assert.equal(resolveIdleGreenMs([]), 1234, "env seam QUAY_SUITE_IDLE_GREEN_MS overrides the default");
    assert.equal(resolveIdleGreenMs(["--idle-green-min", "0.5"]), 30_000, "CLI wins over env");
  } finally {
    delete process.env.QUAY_SUITE_IDLE_GREEN_MS;
  }
});

// ── Contract measure: `suite-state-trigger.ts --json` surfaces the idle-green event ─────────────────

test("Contract measure — `suite-state-trigger.ts --json` emits SUITE-IDLE-GREEN for a green + pending + idle fixture", async () => {
  const { root } = gitRoot(2);
  try {
    const now = Date.now();
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor((now - 2000) / 1000) }));
    const { code, out } = await runCli(TRIGGER, ["--root", root, "--json", "--idle-green-min", "0.001"], {
      QUAY_SUITE_IDLE_GREEN_MS: "1",
    });
    assert.equal(code, 0, `--json exits 0; got ${code}`);
    const parsed = JSON.parse(out);
    assert.equal(parsed.idleGreen, true, "JSON reports the idle-green trigger fired");
    assert.ok(
      parsed.events.some((e) => e.event === "SUITE-IDLE-GREEN"),
      "JSON event array carries SUITE-IDLE-GREEN (the Contract measure band)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — readGitVerificationState reads integration head + develop..integration from a real git repo", () => {
  const { root, integrationHead } = gitRoot(3);
  try {
    const git = readGitVerificationState(root);
    assert.equal(git.integrationHead, integrationHead, "integration head resolved");
    assert.ok(git.pendingCount >= 1, "develop..integration count resolved (unverified commits present)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-suite-state-trigger-retriggers-while-runner-alive ─────────────────────────────────────────
// A merge landing on a state=red whose RUNNER is STILL ALIVE (early-RED: finishedAt null + live pid)
// must NOT start a second runner — the double-suite accident (2×8 lanes racing + the new runner
// truncating the shared log the old runner's fd sits past + the new runner's terminal write being
// generation-guarded away). state=red does NOT mean "round over": the runner flips red on the FIRST
// failure but keeps collecting its full failure set (KILL_ON_RED=off).
//
//   AC1 — check state.pid liveness BEFORE retriggering; alive ⇒ NO RETRIGGER (SUITE-MERGE-PENDING +
//         waitRunner marker emitted instead)
//   AC2 — runner DEAD (pid absent/dead or finishedAt set) ⇒ behavior unchanged (retrigger as normal)
//   AC3 — negative control — state=running (live runner) ⇒ any merge does NOT retrigger (unchanged)

test("gap-suite AC1/AC2/AC3 — isRunnerInFlight is pure: a LIVE runner on an early-red is in flight; dead / terminal / no-pid are not", () => {
  // (a) runner ALIVE + state=red + finishedAt null ⇒ IN FLIGHT (the double-suite shape — must NOT retrigger)
  assert.equal(
    isRunnerInFlight({ state: "red", reason: "failed", finishedAt: null, pid: process.pid }),
    true,
    "early-red with a LIVE runner is in flight (AC1 — suppress the retrigger)",
  );
  // (b) runner DEAD + state=red + finishedAt null ⇒ NOT in flight — the round is effectively over
  assert.equal(
    isRunnerInFlight({ state: "red", reason: "failed", finishedAt: null, pid: deadPid() }),
    false,
    "early-red with a DEAD runner is not in flight (AC2 — retrigger as normal)",
  );
  // (b2) finishedAt set (terminal) trumps pid liveness even with a LIVE pid ⇒ round over
  assert.equal(
    isRunnerInFlight({ state: "red", reason: "failed", finishedAt: 123456, pid: process.pid }),
    false,
    "a terminal red (finishedAt set) is NOT in flight even with a live pid (AC2 — finishedAt criterion)",
  );
  // (c) state=running + live pid + finishedAt null ⇒ in flight (the running-state family — never retrigger)
  assert.equal(
    isRunnerInFlight({ state: "running", finishedAt: null, pid: process.pid }),
    true,
    "running + live runner is in flight",
  );
  // edge cases — fail-open toward NOT in flight (preserves legacy behavior for pid-less states)
  assert.equal(isRunnerInFlight({ state: "red", reason: "failed", finishedAt: null }), false, "no pid ⇒ not in flight");
  assert.equal(isRunnerInFlight({ state: "red", reason: "failed", finishedAt: null, pid: 0 }), false, "pid 0 ⇒ not in flight");
  assert.equal(isRunnerInFlight({ state: "green", finishedAt: 123, pid: process.pid }), false, "green terminal ⇒ not in flight");
  assert.equal(isRunnerInFlight(null), false, "absent state ⇒ not in flight");
});

test("gap-suite AC1 — runOnce on a merge landing over an early-red with a LIVE runner emits SUITE-MERGE-PENDING + waitRunner (no double-suite)", () => {
  const { root } = gitRoot(1);
  try {
    // early-red: the runner flipped red on the first failure but is STILL COLLECTING (finishedAt null,
    // live pid = the test process). A merge lands in this window — the exact accident shape.
    writeSuiteState(root, state({ state: "red", reason: "failed", finishedAt: null, pid: process.pid }));
    const first = runOnce(root, { idleGreenMs: 10_000_000 });
    assert.equal(first.mergePending, false, "first observation establishes the baseline, does not fire");
    assert.equal(first.waitRunner, false, "baseline has no wait-runner");

    // Advance integration with a NEW merge while state stays early-red + runner alive.
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "a.txt"), "base + 1 + 2\n", "utf8");
    execSync("git add a.txt && git commit -q -m merge2", { cwd: root, stdio: "ignore" });
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    const second = runOnce(root, { idleGreenMs: 10_000_000 });
    assert.equal(second.mergePending, true, "a NEW merge on early-red still emits the merge-landing trigger (the merge DID land)");
    assert.equal(second.waitRunner, true, "runner alive + early-red ⇒ wait-runner: do NOT start a second runner (AC1)");
    const ev = second.events.find((e) => e.event === "SUITE-MERGE-PENDING");
    assert.ok(ev, "SUITE-MERGE-PENDING event recorded");
    assert.equal(ev.waitRunner, true, "the event carries the waitRunner marker (round deferred, not started)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gap-suite AC2 — runOnce on a merge landing over an early-red with a DEAD runner emits SUITE-MERGE-PENDING WITHOUT waitRunner (retrigger as normal)", () => {
  const { root } = gitRoot(1);
  try {
    // early-red but the runner is DEAD (killed mid-run — no terminal write): the round is effectively
    // over, so a merge landing SHOULD retrigger as normal (AC2 — behavior unchanged).
    writeSuiteState(root, state({ state: "red", reason: "failed", finishedAt: null, pid: deadPid() }));
    runOnce(root, { idleGreenMs: 10_000_000 }); // baseline

    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "a.txt"), "base + 1 + 3\n", "utf8");
    execSync("git add a.txt && git commit -q -m merge3", { cwd: root, stdio: "ignore" });
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    const res = runOnce(root, { idleGreenMs: 10_000_000 });
    assert.equal(res.mergePending, true, "a NEW merge on early-red fires the merge-landing trigger");
    assert.equal(res.waitRunner, false, "runner dead ⇒ NOT wait-runner — retrigger as normal (AC2)");
    const ev = res.events.find((e) => e.event === "SUITE-MERGE-PENDING");
    assert.ok(ev, "SUITE-MERGE-PENDING event recorded");
    assert.equal(ev.waitRunner, false, "event carries no waitRunner marker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gap-suite AC1 — spawnRetriggerRun REFUSES to launch a second runner while the runner is alive (early-red → SUITE-RETRIGGER-WAIT-RUNNER)", () => {
  const root = tmpRoot();
  try {
    // The exact double-suite shape: state=red early (finishedAt null) with a LIVE runner pid.
    writeSuiteState(root, state({ state: "red", reason: "failed", finishedAt: null, pid: process.pid }));
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      spawnRetriggerRun(root);
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some((l) => l.includes("SUITE-RETRIGGER-WAIT-RUNNER")), "wait-runner signal logged (no launch)");
    assert.ok(!logs.some((l) => l.startsWith("SUITE-RETRIGGER ")), "NO real SUITE-RETRIGGER launch happened");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "full-suite-retrigger.log")), "no retrigger log — the runner was never spawned");
    // the state file is untouched (still early-red — the next round waits for THIS runner to finish)
    const s = readSuiteState(root);
    assert.equal(s.state, "red");
    assert.equal(s.finishedAt, null);
    assert.equal(s.pid, process.pid, "the live runner pid is preserved");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-suite-start-verifies-target-commit: verifiedCommit 起跑闸 (AC1 验非目标 / AC5 同树) ──────────
// The defect: verifiedCommit is written by the runner but never READ/comparED against "the fix commit
// this round intends to verify" — round 53 started on verifiedCommit=3b2854b6 BEFORE the type fix
// c19e70a1 landed, so it verified the PRE-FIX tree (red was expected, 550s wasted). Two half-gates,
// the SAME field: AC1 blocks verifying a tree that does NOT contain the target fix; AC5 blocks
// re-verifying the SAME tree as the last green round (round 61→62 400s duplicate).

test("AC1 — verifiedTreeContainsCommit is the shared ancestor predicate (round-53 class: a LATER fix is NOT in the verified tree)", () => {
  const { root } = gitRoot(0); // develop == integration == base, HEAD on develop
  try {
    const base = execSync("git rev-parse develop", { cwd: root, encoding: "utf8" }).trim();
    // A LATER fix commit (a descendant of base) — the round-53 shape: verified tree = base, fix = c19e70a1-class.
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    const fix = commit(root, "type fix", "fix\n");
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    // round-53: `git merge-base --is-ancestor c19e70a1 3b2854b6` → NO ⇒ the verified tree does NOT contain the fix
    assert.equal(verifiedTreeContainsCommit(fix, base, root), false, "a later fix is NOT an ancestor of the verified pre-fix tree (验非目标)");
    assert.equal(verifiedTreeContainsCommit(base, base, root), true, "the verified tree contains itself");
    assert.equal(verifiedTreeContainsCommit(base, fix, root), true, "the fix tree CONTAINS the pre-fix base (ancestor)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — verifiedTreeContainsCommit fails CLOSED on a non-git root / unresolvable commit (cannot confirm containment)", () => {
  const root = tmpRoot(); // not a git repo
  try {
    assert.equal(verifiedTreeContainsCommit("a".repeat(40), "b".repeat(40), root), false, "non-git root ⇒ cannot confirm ⇒ false");
    assert.equal(verifiedTreeContainsCommit("a".repeat(40), undefined, root), false, "missing verified ⇒ false");
    assert.equal(verifiedTreeContainsCommit("", "b".repeat(40), root), false, "missing expected ⇒ false");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — the round-53 historical judgment is IN-PLACE, no annotation: verifiedTreeContainsCommit(c19e70a1-class, round53.commit, root) → false", () => {
  const { root } = gitRoot(0);
  try {
    const base = execSync("git rev-parse develop", { cwd: root, encoding: "utf8" }).trim();
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    const fix = commit(root, "the type fix", "fix\n");
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    // Two historical round records (the 真实样本 shape): round 52/53 verified pre-fix trees.
    // A reader asks the SAME predicate per round — NO annotation on the jsonl (注记会漂).
    const round53 = { round: 53, state: "red", commit: base }; // verifiedCommit=3b2854b6-class
    const round61 = { round: 61, state: "green", commit: fix }; // the fix IS in this tree
    assert.equal(verifiedTreeContainsCommit(fix, round53.commit, root), false, "round-53 red does NOT answer 'did the fix work' ⇒ 验非目标");
    assert.equal(verifiedTreeContainsCommit(fix, round61.commit, root), true, "a round whose tree contains the fix DOES answer it");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — checkVerificationStartGates blocks (验非目标) when the to-be-verified tree does NOT contain the explicit target", () => {
  const { root } = gitRoot(0);
  try {
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    const fix = commit(root, "the target fix", "fix\n");
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    // HEAD on develop = base (pre-fix). The target fix landed AFTER — NOT in the tree ⇒ block.
    const gates = checkVerificationStartGates(root, { verifyTarget: fix });
    assert.equal(gates.verifyingNonTarget, true, "target not in the tree ⇒ 验非目标");
    assert.equal(gates.blocks, true, "start is blocked");
    assert.equal(gates.reason, "verify-target", "reason names the AC1 gate");
    // A tree that DOES contain the target passes.
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    const ok = checkVerificationStartGates(root, { verifyTarget: fix });
    assert.equal(ok.blocks, false, "a tree containing the target is NOT blocked");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — default target = integration HEAD: a worktree full-suite on an OLDER tree is blocked (验非目标)", () => {
  const { root } = gitRoot(0);
  try {
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    const fix = commit(root, "new integration commit", "fix\n"); // integration head ADVANCES past develop
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" }); // tested tree = old develop HEAD
    // No explicit target ⇒ the gate defaults to integrationHead (fix). The tested develop tree does
    // NOT contain fix ⇒ the round would verify a tree OLDER than the integration tip ⇒ 验非目标.
    const gates = checkVerificationStartGates(root);
    assert.equal(gates.targetCommit, fix, "default target = integration head");
    assert.equal(gates.verifyingNonTarget, true, "tested tree older than the integration tip is 验非目标");
    assert.equal(gates.blocks, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 — readLastGreenCommit scans verification-round.jsonl BACKWARDS for the last GREEN round's commit", () => {
  const root = tmpRoot();
  try {
    assert.equal(readLastGreenCommit(root), null, "no rounds file ⇒ null");
    // newest-first: a red round with a NEWER commit, then a green round with an OLDER commit.
    writeRound(root, { round: 2, state: "red", commit: "b".repeat(40) });
    writeRound(root, { round: 1, state: "green", commit: "a".repeat(40) });
    assert.equal(readLastGreenCommit(root), "a".repeat(40), "the last GREEN round's commit is returned (red skipped)");
    // a green round with NO commit (legacy/hermetic) is skipped; earlier green still found
    writeRound(root, { round: 3, state: "green" });
    assert.equal(readLastGreenCommit(root), "a".repeat(40), "a commit-less green round is tolerated (skipped)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 — checkVerificationStartGates blocks (同树重复) when the to-be-verified tree EQUALS the last green round's tree", () => {
  const { root } = gitRoot(0);
  try {
    const base = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    // The last green round verified `base`; the tree has NOT changed (HEAD still = base) ⇒ same tree.
    writeRound(root, { round: 61, state: "green", commit: base });
    const gates = checkVerificationStartGates(root);
    assert.equal(gates.sameTreeAsLastGreen, true, "to-be-verified tree == last green tree (round 61→62 shape)");
    assert.equal(gates.blocks, true, "start is blocked");
    assert.equal(gates.reason, "same-tree", "reason names the AC5 gate");
    // A NEW commit on the tree ⇒ not the same tree ⇒ no AC5 block.
    const fix = commit(root, "new work", "y\n");
    const after = checkVerificationStartGates(root);
    assert.equal(after.sameTreeAsLastGreen, false, "the tree changed ⇒ not the same-tree repeat");
    assert.equal(after.blocks, false, "a changed tree is NOT blocked by AC5");
    void fix;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 — spawnRetriggerRun SUPPRESSES the same-tree duplicate (SUITE-SKIP-SAME-TREE, no spawn) — round 61→62 shape", () => {
  const { root } = gitRoot(0);
  try {
    const base = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    // A green terminal state + the last green round on the SAME tree → idle-green would fire, AC5 skips.
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor(Date.now() / 1000) }));
    writeRound(root, { round: 61, state: "green", commit: base });
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      spawnRetriggerRun(root);
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some((l) => l.startsWith("SUITE-SKIP-SAME-TREE")), "SUITE-SKIP-SAME-TREE logged (AC5 annotation)");
    assert.ok(!logs.some((l) => l.startsWith("SUITE-RETRIGGER ")), "NO round was launched");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "full-suite-retrigger.log")), "no retrigger log — the runner was never spawned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — spawnRetriggerRun SUPPRESSES a round whose tree does NOT contain the target fix (SUITE-SKIP-NON-TARGET, no spawn) — round-53 class", () => {
  const { root } = gitRoot(0);
  try {
    execSync("git checkout -q integration", { cwd: root, stdio: "ignore" });
    const fix = commit(root, "the target type fix", "fix\n"); // lands AFTER the tested tree was cut
    execSync("git checkout -q develop", { cwd: root, stdio: "ignore" });
    writeSuiteState(root, state({ state: "green", finishedAt: Math.floor(Date.now() / 1000) }));
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      spawnRetriggerRun(root, { verifyTarget: fix });
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some((l) => l.startsWith("SUITE-SKIP-NON-TARGET")), "SUITE-SKIP-NON-TARGET logged (AC2: 明确标注验非目标)");
    assert.ok(!logs.some((l) => l.startsWith("SUITE-RETRIGGER ")), "NO round was launched (拒绝起跑 — 不做无意义 550s 轮)");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "full-suite-retrigger.log")), "no retrigger log — the runner was never spawned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1/AC5 — a NORMAL round start (changed tree, contains target) is NOT blocked by the gates", () => {
  const { root } = gitRoot(0);
  try {
    const base = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    writeRound(root, { round: 61, state: "green", commit: base }); // last green on base
    // A NEW commit lands (the tree changes) and IS the target ⇒ both gates pass.
    const fix = commit(root, "new verified work", "y\n");
    const gates = checkVerificationStartGates(root, { verifyTarget: fix });
    assert.equal(gates.blocks, false, "a changed tree containing the target is startable");
    assert.equal(gates.reason, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveVerifyTarget — --verify-target CLI wins over QUAY_SUITE_VERIFY_TARGET env, then null default", () => {
  const target = "c19e70a1".padEnd(40, "0");
  assert.equal(resolveVerifyTarget(["--verify-target", target]), target, "CLI --verify-target resolves");
  assert.equal(resolveVerifyTarget([], { verifyTarget: target }), target, "opts seam resolves");
  process.env.QUAY_SUITE_VERIFY_TARGET = target;
  try {
    assert.equal(resolveVerifyTarget([]), target, "env QUAY_SUITE_VERIFY_TARGET resolves when no CLI/opts");
  } finally {
    delete process.env.QUAY_SUITE_VERIFY_TARGET;
  }
  assert.equal(resolveVerifyTarget([]), null, "no target ⇒ null (caller defaults to integration head / no gate)");
});
