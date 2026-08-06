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
  runOnce,
  writeSuiteState,
  readSuiteEvents,
  shouldStopDispatch,
  routeRed,
  classifyFailureLine,
  extractFailingFiles,
  deriveFailureLocation,
  failureIntersectsTouches,
  shouldStopDispatchForFailure,
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
    ...over,
  };
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

// ── AC1/AC2/AC3/AC5 (gap-red-window-dispatch-stop-should-be-shared-gate-conditional) ───────────────
// The red-window RED handling is conditioned by failure SCOPE: dispatch stops ONLY when the failure
// lands in the shared gate (run_static_checks — every scoped run pays it) or in a specific test file
// that intersects the new task's touch-set; a specific-test-file failure UNRELATED to the touches
// does NOT stop dispatch (the new task's worktree runs its own scoped tests on an independent
// master-branch copy). fan-in hold stays BLANKET on red+failed (AC1 — the real protection).

function writeLog(root, content) {
  const dir = path.join(root, ".quay");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "full-suite.log"), content, "utf8");
}

test("AC2 — classifyFailureLine: shared-gate vs test-file vs unknown", () => {
  assert.deepEqual(classifyFailureLine("== task-contract-check check =="), { scope: "shared-gate" });
  assert.deepEqual(classifyFailureLine("run_static_checks: violation"), { scope: "shared-gate" });
  assert.deepEqual(classifyFailureLine("❯ plugin/test/foo.test.mjs (3 tests | 1 failed)"), {
    scope: "test-file",
    files: ["plugin/test/foo.test.mjs"],
  });
  assert.deepEqual(classifyFailureLine("not ok 1 - the thing broke"), { scope: "test-file" });
  assert.deepEqual(classifyFailureLine("# cancelled 1"), { scope: "test-file" });
  assert.deepEqual(classifyFailureLine("ok 1 - the thing works"), { scope: "unknown" });
});

test("AC2 — extractFailingFiles: node:test TAP (Subtest-scoped not ok) + vitest (❯ file failed)", () => {
  const log = [
    "# Subtest: plugin/test/alpha.test.mjs",
    "    # Subtest: one",
    "    ok 1 - one",
    "    not ok 2 - two",
    "    not ok 3 - three",
    "# Subtest: plugin/test/beta.test.mjs",
    "ok 1 - beta",
    "❯ plugin/test/gamma.test.mjs (2 tests | 1 failed)",
  ].join("\n");
  const files = extractFailingFiles(log);
  assert.ok(files.includes("plugin/test/alpha.test.mjs"), "TAP not ok resolves the enclosing Subtest file");
  assert.ok(files.includes("plugin/test/gamma.test.mjs"), "vitest failing-file line names the file");
  assert.ok(!files.includes("plugin/test/beta.test.mjs"), "a passing file is not a failing file");
});

test("AC2/AC3 — deriveFailureLocation: shared-gate vs test-file vs absent", () => {
  // shared gate: static-check phase reached, NO test failure line (set -e aborts before the test phase)
  const sharedGate = [
    "== split-or-commit whole-store check ... ==",
    "== task-contract-check ... ==",
    "task-contract-check: violation in tasks/foo.md: 1 new violation",
  ].join("\n");
  assert.deepEqual(deriveFailureLocation(sharedGate), { scope: "shared-gate" });

  // specific test-file: a test failure line IS present (the file names itself)
  const testFile = [
    "== split-or-commit whole-store check ... ==",
    "# Subtest: plugin/test/foo.test.mjs",
    "not ok 1 - assertion failed",
  ].join("\n");
  assert.deepEqual(deriveFailureLocation(testFile), {
    scope: "test-file",
    files: ["plugin/test/foo.test.mjs"],
  });

  // absent log => null (fail-closed toward stopping in the dispatch decision)
  assert.equal(deriveFailureLocation(null), null);
  assert.equal(deriveFailureLocation(undefined), null);
  assert.equal(deriveFailureLocation(""), null);
});

test("AC2 — failureIntersectsTouches: equal, directory-prefix, unrelated", () => {
  assert.equal(failureIntersectsTouches("plugin/loop/fast-mode-loop-tick.md", ["plugin/loop/fast-mode-loop-tick.md"]), true, "exact match");
  assert.equal(failureIntersectsTouches("plugin/test/foo.test.mjs", ["plugin/test/"]), true, "file under a directory touch");
  assert.equal(failureIntersectsTouches("plugin/test/foo.test.mjs", ["plugin/loop/fast-mode-loop-tick.md"]), false, "unrelated file");
  assert.equal(failureIntersectsTouches("./plugin/test/foo.test.mjs", ["plugin/test/"]), true, "leading ./ normalized");
});

test("AC2 — shouldStopDispatchForFailure two-way fixture: shared-gate stops; unrelated specific-test continues; related stops", () => {
  const touches = ["plugin/scripts/suite-state-trigger.ts", "plugin/test/"];
  // shared gate (run_static_checks — every scoped run pays it) ⇒ STOP regardless of touches
  assert.equal(shouldStopDispatchForFailure({ scope: "shared-gate" }, touches), true, "shared-gate failure stops dispatch (AC2)");
  // specific test-file UNRELATED to the touches ⇒ CONTINUE (the worktree runs its own scoped tests)
  assert.equal(
    shouldStopDispatchForFailure({ scope: "test-file", files: ["plugin/loop/capability-catalog.sh"] }, touches),
    false,
    "unrelated specific-test failure continues dispatch (AC2)",
  );
  // specific test-file RELATED to the touches (under the touched dir / exact match) ⇒ STOP
  assert.equal(
    shouldStopDispatchForFailure({ scope: "test-file", files: ["plugin/test/foo.test.mjs"] }, touches),
    true,
    "failing file under a touched dir stops dispatch (AC2)",
  );
  assert.equal(
    shouldStopDispatchForFailure({ scope: "test-file", files: ["plugin/scripts/suite-state-trigger.ts"] }, touches),
    true,
    "exact-match touched path stops dispatch (AC2)",
  );
  // unknown / absent failure info ⇒ fail-closed STOP (the conservative blanket default)
  assert.equal(shouldStopDispatchForFailure({ scope: "unknown" }, touches), true, "unknown scope fails closed to stop");
  assert.equal(shouldStopDispatchForFailure(null, touches), true, "absent failure info fails closed to stop");
});

test("AC2/AC3 — SUITE-RED event carries the failure location; the dispatch decision conditions on it", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "running" }));
    runOnce(root);
    // a specific-test-file failure unrelated to a new task's touches
    writeLog(root, "# Subtest: plugin/test/capability-catalog.test.mjs\nnot ok 1 - catalog drifted\n");
    writeSuiteState(root, state({ state: "red", reason: "failed", finishedAt: null }));
    const res = runOnce(root);
    assert.equal(res.stopSignal, true, "red+failed is the blanket RED-failure signal (AC1 fan-in hold)");
    assert.equal(res.failure.scope, "test-file", "failure scope derived from the early-RED failure line (AC3)");
    assert.deepEqual(res.failure.files, ["plugin/test/capability-catalog.test.mjs"], "failing file carried");
    const redEv = res.events.find((e) => e.event === "SUITE-RED");
    assert.ok(redEv, "SUITE-RED emitted");
    assert.equal(redEv.failure.scope, "test-file", "event payload carries the failure scope");
    // the DISPATCH decision for a task whose touches do NOT include that file ⇒ CONTINUE
    assert.equal(
      shouldStopDispatchForFailure(redEv.failure, ["plugin/loop/fast-mode-loop-tick.md"]),
      false,
      "unrelated specific-test failure continues dispatch (AC2)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — a shared-gate (run_static_checks) failure ⇒ SUITE-RED carries scope=shared-gate ⇒ dispatch stops for every task", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "running" }));
    runOnce(root);
    writeLog(root, "== task-contract-check ... ==\ntask-contract-check: violation in tasks/foo.md: 1 new violation\n");
    writeSuiteState(root, state({ state: "red", reason: "failed", finishedAt: null }));
    const res = runOnce(root);
    assert.equal(res.failure.scope, "shared-gate", "shared-gate failure scope derived");
    assert.equal(
      shouldStopDispatchForFailure(res.failure, ["plugin/loop/fast-mode-loop-tick.md"]),
      true,
      "shared-gate failure stops dispatch regardless of touches (AC2)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — RED failed ⇒ fan-in ALWAYS held (blanket); only the DISPATCH stop is conditioned", () => {
  // shouldStopDispatch (the RED-failure signal) stays blanket on red+failed (AC1 / AC5 reason axis)
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true);
  assert.equal(shouldStopDispatch({ state: "red" }), true);
  assert.equal(shouldStopDispatch({ state: "red", reason: "aborted" }), false);
  // The docs state the split: 一律暂缓 fan-in + 派发按作用域条件化
  const inner = read(INNER_TICK);
  assert.match(inner, /一律暂缓/, "inner: fan-in hold is always on red failed (AC1)");
  assert.match(inner, /条件化/, "inner: dispatch stop is conditioned by failure scope (AC2)");
});

test("AC2/AC3 — both loop docs carry the CONDITIONAL red-window rule (shared gate vs specific test)", () => {
  const inner = read(INNER_TICK);
  const outer = read(OUTER_TICK);
  // Contract invoke — the inner doc names 共享闸门 / 具体测试 / 暂缓 fan-in
  assert.match(inner, /共享闸门/, "inner names the shared gate");
  assert.match(inner, /具体测试/, "inner names the specific-test case");
  assert.match(inner, /暂缓 fan-in/, "inner: fan-in hold stays explicit (AC1)");
  assert.match(inner, /派发继续/, "inner: dispatch continues on unrelated specific-test failure");
  // Contract measure — the red-window handling docs name run_static_checks as the shared gate (≥1)
  assert.match(inner, /run_static_checks/, "inner names run_static_checks as the shared gate");
  assert.match(outer, /run_static_checks/, "outer names run_static_checks as the shared gate");
  assert.match(outer, /派发继续/, "outer: dispatch continues on unrelated specific-test failure");
});

test("AC5 — the two-way scope fixture is a node:test governance test", () => {
  const src = read(new URL(import.meta.url));
  assert.ok(src.includes('import { test } from "node:test"'), "uses node:test");
  assert.match(src, /^\/\/ @test-group governance/m, "declares @test-group governance");
  // The AC2 two-way fixture actually exercises both directions (shared-gate ⇒ stop; unrelated ⇒ continue)
  assert.equal(shouldStopDispatchForFailure({ scope: "shared-gate" }, []), true, "shared-gate ⇒ stop");
  assert.equal(shouldStopDispatchForFailure({ scope: "test-file", files: ["plugin/other/x.test.mjs"] }, []), false, "unrelated specific-test ⇒ continue");
});
