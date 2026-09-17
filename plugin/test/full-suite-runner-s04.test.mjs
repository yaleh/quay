// @test-group lowconc
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-27 child-spawn (spawns real full-suite-runner.ts + fake-suite child; triage 判 other-task defer 而非 isolate-rerun — gap-full-suite-runner-test-poll-timeout-load-flake)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — every test spawns a
//   real node runner (full-suite-runner.ts) + a real bash fake-suite child; under full-suite concurrency
//   the runner bootstrap + child spawn is start/schedule-delayed and the wall-clock polls flaked
//   (gap-full-suite-runner-test-poll-timeout-load-flake: "poll timeout" under load 11.81 / 16 lanes).
//   The 5s polls were already raised to 20s (gap-suite-load-sampler-orphan-process); this annotation
//   closes the triage half — a failure must be classified load-sensitive (isolate-rerun), not
//   other-task (defer anti-livelock).

// full-suite-runner.test.mjs — runner verdict / state machine / red detection / reason axis / kill-hang / control. Split from gap-suite-file-split-two-longest; harness shared via ./helpers/full-suite-runner-harness.mjs.
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { after, assert, buildStaticCheckFailures, classifyFailure, extractFailClosedChecker, extractNotEvaluatedChecker, fakeSuite, fs, isStaticCheckFailureLine, lastRoundRecord, os, path, readState, routeRed, runOnce, runRunner, shouldStopDispatch, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("AC2/AC3/AC4 — a static-check-red run writes reason=static-check + machine-readable counts; violations fill failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-scre-"));
  // The 2026-08-08 20:48Z shape: task-contract-check ratchet violations — the suite aborts
  // (set -e) before tests, so the stream shows VIOLATION/summary/ratchet lines + exit 1, no TAP.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "VIOLATION: tasks/gap-bar.md — V2: band value out of range"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1, tasks/gap-bar.md: V2); resolved: 0"\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "static-check red is reason=static-check, NOT failed (AC3)");
    assert.ok(s.staticCheck, "machine-readable staticCheck field present (AC2)");
    assert.equal(s.staticCheck.violations, 11, "violation count (AC2)");
    assert.equal(s.staticCheck.taskCount, 9, "task count");
    assert.equal(s.staticCheck.ceiling, 6, "ratchet ceiling (AC2)");
    assert.equal(s.staticCheck.newSinceBaseline, 6, "new-since-baseline (AC2)");
    assert.ok(
      Array.isArray(s.staticCheck.details) && s.staticCheck.details.length === 2,
      "both VIOLATION details captured",
    );
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-foo.md", "detail carries the violated task file");
    assert.ok(s.failures && s.failures.length === 2, "failures[] carries the static-check violation details (AC4 candidate B)");
    assert.equal(s.failures[0].staticCheck, true, "failures entries are marked static-check");
    assert.equal(s.failures[0].file, "tasks/gap-foo.md", "failure file = the violated task file");
    // Consumers can distinguish + route correctly (AC3):
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    assert.equal(routeRed(s), "red-window-triage", "routeRed routes static-check red to red-window-triage (a real failure)");
    const loc = classifyFailure(s.failures[0]);
    assert.equal(loc.kind, "shared-gate", "classifyFailure classifies the static-check failure as shared-gate");
    const res = runOnce(root);
    assert.equal(res.stopSignal, true, "runOnce reports stopSignal for static-check red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 unit — extractFailClosedChecker parses checker-cost-lib's fail-closed machine line; isStaticCheckFailureLine flags it", () => {
  // gap-static-check-red-failures-capture-only-task-contract-shape: the round-84 真因 line
  // (threshold-scope-check fail-closed) did NOT match the old task-contract-shape patterns — this
  // pins that it now flags + parses.
  const fc = extractFailClosedChecker("STATIC_CHECK_FAILED: threshold-scope-check exit=1");
  assert.deepEqual(fc, { name: "threshold-scope-check", exitCode: 1, line: "STATIC_CHECK_FAILED: threshold-scope-check exit=1" });
  assert.equal(isStaticCheckFailureLine("STATIC_CHECK_FAILED: threshold-scope-check exit=1"), true, "the fail-closed machine line IS a static-check failure marker");
  assert.equal(extractFailClosedChecker("checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): threshold-scope-check(exit=1)"), null, "the human summary line is NOT machine-parsed (only the STATIC_CHECK_FAILED: line is)");
  assert.equal(extractFailClosedChecker("not ok 1 - boom"), null);
  assert.equal(extractFailClosedChecker("STATIC_CHECK_FAILED: no-exit-code"), null, "missing exit=<rc> is not a parseable fail-closed checker");
});


test("gap-not-evaluated-checkers-never-persisted AC1 unit — extractNotEvaluatedChecker parses the NOT-EVALUATED machine line; ⛔ it is NOT a static-check failure (an inert guard is NOT a red)", () => {
  // checker-cost-lib emits `STATIC_CHECK_NOT_EVALUATED: <name>` (exit 3 = a THIRD state, NOT a red,
  // NOT a pass) and returns 0 — so the suite continues GREEN. This pins: (a) the parse path, (b) the
  // inert line must NEVER be flagged as a failure (which would turn an inert guard into a red).
  const ne = extractNotEvaluatedChecker("STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check");
  assert.deepEqual(ne, { name: "direct-to-develop-bypass-check", line: "STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check" });
  assert.equal(isStaticCheckFailureLine("STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check"), false, "the inert line is NOT a static-check failure marker (it exits 0 — green)");
  assert.equal(extractNotEvaluatedChecker("STATIC_CHECK_FAILED: threshold-scope-check exit=1"), null, "the fail-closed line is NOT the not-evaluated line");
  assert.equal(extractNotEvaluatedChecker("not ok 1 - boom"), null, "a test failure line is NOT a not-evaluated line");
  assert.equal(extractNotEvaluatedChecker("checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): foo(exit=1)"), null, "the human summary line is NOT machine-parsed");
});


test("gap-not-evaluated-checkers-never-persisted AC1/AC2 — a GREEN run with a NOT-EVALUATED line persists notEvaluatedCheckers (non-empty); a GREEN run WITHOUT it persists an EMPTY ARRAY (⛔ not undefined)", async () => {
  // The defect: an inert checker exits 0 ⇒ the suite is GREEN, and its "读不懂输入" signal was thrown
  // away at the stderr boundary. Now a green terminal state carries notEvaluatedCheckers — the ONLY
  // place the inert guard is visible. AC2 falsifiable side: no such line ⇒ [] (not undefined).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inert-"));
  try {
    // With the line: the state names the inert checker.
    const { f, dir } = fakeSuite(
      'echo "STATIC_CHECK_NOT_EVALUATED: direct-to-develop-bypass-check" >&2\n' +
        'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
    );
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "the inert guard exits 0 ⇒ the suite is GREEN (not red)");
    const s = readState(root);
    assert.equal(s.state, "green", "an inert guard does NOT red the suite");
    assert.ok(Array.isArray(s.notEvaluatedCheckers), "notEvaluatedCheckers is present (an array)");
    assert.deepEqual(s.notEvaluatedCheckers.map((x) => x.name), ["direct-to-develop-bypass-check"], "the inert checker is named by the state");
    fs.rmSync(dir, { recursive: true, force: true });

    // Without the line: the field is an EMPTY ARRAY, not undefined (AC2 — "no inert checker this round"
    // must be distinguishable from "this dimension was never recorded").
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inert2-"));
    const { f: f2, dir: dir2 } = fakeSuite('echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0');
    const child2 = runRunner({ root: root2, command: `bash ${f2}`, laneCount: 8 });
    const { code: code2 } = await waitExit(child2);
    assert.equal(code2, 0, "plain green run exits 0");
    const s2 = readState(root2);
    assert.deepEqual(s2.notEvaluatedCheckers, [], "no NOT-EVALUATED line ⇒ notEvaluatedCheckers is an EMPTY ARRAY, not undefined");
    fs.rmSync(root2, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("AC1/AC2 — buildStaticCheckFailures carries BOTH the VIOLATION details AND the fail-closed checkers, all staticCheck:true; the fail-closed checker (real gate, exit≠0) sorts FIRST so failures[0] is the gate's identity (gap-static-check-red-failures0-misattributed, round181/182)", () => {
  const suite = buildStaticCheckFailures(
    [{ file: "tasks/gap-foo.md", code: "V1", what: "x", line: "VIOLATION: tasks/gap-foo.md — V1: x" }],
    [{ name: "threshold-scope-check", exitCode: 1, line: "STATIC_CHECK_FAILED: threshold-scope-check exit=1" }],
  );
  assert.equal(suite.length, 2, "both the violation detail and the fail-closed checker are recorded");
  // gap-static-check-red-failures0-misattributed — the REAL GATE (exit≠0) must be failures[0], NOT
  // the first VIOLATION line from a non-blocking checker (round181/182 both misled diagnosticians).
  assert.equal(suite[0].line.includes("threshold-scope-check"), true, "the fail-closed checker (real gate) sorts first → failures[0] is the gate's identity");
  assert.equal(suite[0].staticCheck, true, "failures[0] (the real gate) is marked staticCheck:true");
  assert.equal(suite[1].file, "tasks/gap-foo.md", "the VIOLATION entry still carries the violated file, after the real gate");
  assert.ok(suite.every((f) => f.staticCheck === true), "every static-check entry is marked staticCheck:true (shared-gate routing)");
});


test("AC2 能取假·真样本 — round181/182 replay: reason=static-check with a --no-block task-contract VIOLATION line BEFORE the real gate's STATIC_CHECK_FAILED line ⇒ failures[0] = the real gate (direct-to-develop-bypass-check), NOT the contract-line VIOLATION", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-r181-"));
  // The round181/182 shape (gap-static-check-red-failures0-misattributed): task-contract-check runs
  // with --no-block (exit 0 — prints VIOLATION/summary lines, does NOT gate the round) while
  // direct-to-develop-bypass-check is the REAL gate (exit 1, emits checker-cost-lib's
  // STATIC_CHECK_FAILED: <name> exit=<rc> machine line on stderr). The VIOLATION lines appear FIRST
  // in the stream — before the fail-closed line — so the old ordering made failures[0] the
  // non-blocking contract-line and the real gate drowned in failures[] (round181/182 both misled).
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-ac37.md — contract-line: Contract block missing invariant line"\n' +
      'echo "violations: 11 unique across 9 task(s)"\n' +
      'echo "recorded (non-blocking, grow-only ledger): 1 new task-file violation(s)"\n' +
      'echo "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1" >&2\n' +
      'echo "checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): direct-to-develop-bypass-check(exit=1)" >&2\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on the round181/182 static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "reason=static-check (the pre-test static-check gate aborted the round)");
    assert.ok(Array.isArray(s.failures) && s.failures.length >= 2, `failures[] carries both the real gate and the violation: ${JSON.stringify(s.failures)}`);
    // AC1/AC2 — failures[0] MUST be the checker that actually exited ≠0 (the real gate), NOT the
    // first VIOLATION-style line from the non-blocking checker. This is the manager's criterion:
    // a diagnostician reading failures[0] must be sent at the real cause first.
    assert.equal(s.failures[0].line, "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1", "failures[0] = the real gate's identity (direct-to-develop-bypass-check), not a contract-line VIOLATION");
    assert.equal(s.failures[0].staticCheck, true, "failures[0] (the real gate) is marked staticCheck:true (shared-gate routing)");
    assert.equal(s.failures[0].file, undefined, "the real gate entry carries the checker identity in its line, no file (it is a fail-closed checker, not a violated task file)");
    // The machine-readable separation is intact (AC2 of the capture task): failedCheckers names the
    // real gate; details carries the VIOLATION lines.
    assert.equal(s.staticCheck.failedCheckers[0].name, "direct-to-develop-bypass-check", "staticCheck.failedCheckers names the real gate");
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-ac37.md", "staticCheck.details still carries the contract-line VIOLATION (separate from the gate)");
    // Consumers route failures[0] (the real gate) to the shared gate — dispatch stops.
    assert.equal(classifyFailure(s.failures[0]).kind, "shared-gate", "failures[0] (the real gate) classifies shared-gate");
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    // The verification-round record carries the SAME ordering — failures[0] is the real gate there too.
    const round = lastRoundRecord(root);
    assert.ok(round, "verification-round record present");
    assert.equal(round.failures[0].line, "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1", "round-record failures[0] = the real gate (round181/182 replay, AC2)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("gap-static-check-red-failures-capture-only-task-contract-shape — a FAIL-CLOSED checker (round-84 真因) is captured in failures[] + staticCheck.failedCheckers, separated from the violation details", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-fc-"));
  // The round-84 shape: threshold-scope-check fail-closed (checker-cost-lib's machine line on stderr)
  // while task-contract --no-block emits VIOLATION lines + "recorded (non-blocking)" (exit-0 noise).
  // BEFORE this task, failures[] captured ONLY the 25 task-contract VIOLATION entries and the real
  // cause (threshold-scope-check) had ZERO entries — the defect this task fixes.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — contract-line-unknown: Contract block missing invariant line"\n' +
      'echo "recorded (non-blocking, grow-only ledger): 1 new task-file violation(s)"\n' +
      'echo "STATIC_CHECK_FAILED: threshold-scope-check exit=1" >&2\n' +
      'echo "checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): threshold-scope-check(exit=1)" >&2\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on the fail-closed static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "a checker-cost-lib fail-closed red is reason=static-check, NOT failed");
    assert.ok(s.staticCheck, "machine-readable staticCheck field present");
    // AC1 — the fail-closed checker (真因) is in failures[], not just the task-contract VIOLATION shape.
    const fcEntry = Array.isArray(s.failures) ? s.failures.find((x) => x.line.includes("threshold-scope-check")) : undefined;
    assert.ok(fcEntry, `failures[] records the fail-closed checker 真因: ${JSON.stringify(s.failures)}`);
    assert.equal(fcEntry.staticCheck, true, "the fail-closed entry is marked static-check (shared-gate routing)");
    // AC2 — the two facts are separated: failedCheckers (which checker failed) vs details (violation lines).
    assert.ok(
      Array.isArray(s.staticCheck.failedCheckers) && s.staticCheck.failedCheckers.length === 1,
      `staticCheck.failedCheckers carries the fail-closed checker: ${JSON.stringify(s.staticCheck.failedCheckers)}`,
    );
    assert.equal(s.staticCheck.failedCheckers[0].name, "threshold-scope-check", "checker name");
    assert.equal(s.staticCheck.failedCheckers[0].exitCode, 1, "checker exit code");
    assert.ok(
      Array.isArray(s.staticCheck.details) && s.staticCheck.details.length === 1,
      "staticCheck.details still carries the VIOLATION lines (separate from failedCheckers)",
    );
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-foo.md", "the violation detail carries the task file");
    // The fail-closed entry routes to the shared gate (dispatch stops on a static-check red).
    const loc = classifyFailure(fcEntry);
    assert.equal(loc.kind, "shared-gate", "the fail-closed checker entry routes to the shared gate");
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    // AC3 — the verification-round record (the authoritative red round) carries the SAME failures[]
    // with the fail-closed 真因 (round-84 形态: threshold-scope fail-closed appears in the record).
    const round = lastRoundRecord(root);
    assert.ok(
      round && Array.isArray(round.failures) && round.failures.some((x) => x.line.includes("threshold-scope-check")),
      "verification-round failures[] carries the fail-closed checker 真因: " + JSON.stringify(round),
    );
    assert.equal(round.reason, "gate-failed", "round record reason=gate-failed (fail=0 static-check red)");
    assert.equal(round.gate, "static-check", "round record names gate=static-check");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
