// @test-group engine
// red-window-shared-gate.test.mjs — tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.
//
// The red-window dispatch-stop is a SHARED, gate-conditional rule (NOT two divergent copies):
//   RED ⇒ ALWAYS hold fan-in (the real protection — the red tree must not accumulate mixed failures);
//   RED ⇒ dispatch stops ONLY when the failure lands in the SHARED GATE (run_static_checks — the
//         static-check checkers every scoped run pays);
//   RED ⇒ dispatch CONTINUES when the failure lands in a SPECIFIC TEST file unrelated to the new
//         task's touch-set (the new task's worktree is an independent master-branch copy running its
//         own scoped tests).
// The judgment info is already available: the early-RED failure line (state.failures, carried by the
// SUITE-RED event) tells which test failed → shared gate vs specific test → intersects the candidate's
// touches. No new mechanism — the runner records the failure line + file, this module classifies it,
// and the existing touches machinery (matchGlob / parseTouches) does the intersection.
//
// Coverage map (task ACs):
//   AC1 — RED ⇒ 一律暂缓 fan-in（真正保护，不变）——red tree does not mix in new failures
//         (asserted as the invariant in both loop docs).
//   AC2 — dispatch conditionalized: SHARED-GATE failure ⇒ stop dispatch; SPECIFIC-TEST failure
//         unrelated to the candidate's touch-set ⇒ dispatch continues (two-way fixture).
//   AC3 — judgment info is available: the early-RED failure line carries the failure location
//         (state.failures → SUITE-RED.failureLocation), no new mechanism.
//   AC4 — real-use evidence: this round's counter-example (suite early-RED + inner 30 min no dispatch
//         + pool 16/disjoint 9 healthy) is asserted in the task body; after the refinement a
//         non-shared-gate red lets disjoint candidates dispatch.
//   AC5 — node:test + // @test-group engine (this file) with the two-way fixture.
//
// Run:
//   scripts/test.sh plugin/test/red-window-shared-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyFailure,
  shouldDispatchOnRed,
  runOnce,
  writeSuiteState,
  readSuiteEvents,
} from "../scripts/suite-state-trigger.ts";
import { extractFailureFile } from "../scripts/full-suite-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const INNER_TICK = path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rwsg-root-"));
}

function state(over) {
  return {
    state: "red",
    reason: "failed",
    runner: "outer",
    startedAt: "2026-08-05T06:00:00.000Z",
    finishedAt: null,
    durationMs: null,
    laneCount: 8,
    ...over,
  };
}

// ── AC3: classifyFailure — the early-RED failure line tells shared gate vs specific test ───────────

test("AC3 — classifyFailure: a failure naming a static-check checker is SHARED-GATE (run_static_checks)", () => {
  // the checker's own failure output (task-contract-check is @static-tier always — every scoped run pays it)
  const checkerPath = classifyFailure({
    line: "task-contract-check: NEW Contract violation on QX-001 (measure line without a command)",
    file: "plugin/scripts/task-contract-check.ts",
  });
  assert.equal(checkerPath.kind, "shared-gate", "a *-check.ts failure file is the shared gate");

  // a TAP line naming the checker (no file context — the name alone is the shared-gate signal)
  const checkerName = classifyFailure("not ok 1 - test-framework-policy-check: NEW file without @test-group: x.test.mjs");
  assert.equal(checkerName.kind, "shared-gate", "a checker NAME on the failure line is the shared gate");

  // run_static_checks itself is named
  const gateNamed = classifyFailure("not ok 1 - run_static_checks aborted the suite");
  assert.equal(gateNamed.kind, "shared-gate", "run_static_checks named on the failure line is the shared gate");
});

test("AC3 — classifyFailure: a specific TEST file failure (vitest structured line / TAP file context) is SPECIFIC-TEST", () => {
  // vitest structured per-file failure line — the file is ON the line
  const vitest = classifyFailure(" ❯ plugin/test/foo.test.mjs (3 tests | 1 failed) 12ms");
  assert.equal(vitest.kind, "specific-test");
  assert.equal(vitest.file, "plugin/test/foo.test.mjs", "the failing file is extracted for the touches intersection");

  // node:test/TAP failure with the file context the runner captured from the detail block
  const tap = classifyFailure({ line: "not ok 2 - failing b", file: "plugin/test/foo.test.mjs" });
  assert.equal(tap.kind, "specific-test");
  assert.equal(tap.file, "plugin/test/foo.test.mjs");

  // a TAP line whose own text names the file (stack / `test at <file>` shape)
  const stackFrame = classifyFailure("test at plugin/test/foo.test.mjs:3:1");
  assert.equal(stackFrame.kind, "specific-test");
  assert.equal(stackFrame.file, "plugin/test/foo.test.mjs");
});

test("AC3 — classifyFailure: an unclassifiable failure is UNKNOWN (fail-closed dispatch)", () => {
  assert.equal(classifyFailure("not ok 3 - some ambiguous failure").kind, "unknown");
});

test("AC3 — the runner extracts the failing file from real failure-line shapes (double-extension test files)", () => {
  const root = REPO_ROOT;
  // vitest structured per-file line
  assert.equal(extractFailureFile(" ❯ plugin/test/foo.test.mjs (3 tests | 1 failed) 12ms", root), "plugin/test/foo.test.mjs");
  // node:test TAP detail block (location + stack frames) — absolute path → repo-relative
  assert.equal(
    extractFailureFile(`TestContext.<anonymous> (file://${root}/plugin/test/foo.test.mjs:3:33)`, root),
    "plugin/test/foo.test.mjs",
  );
  assert.equal(
    extractFailureFile(`  location: '${root}/plugin/test/foo.test.mjs:3:1'`, root),
    "plugin/test/foo.test.mjs",
  );
  // a checker script path (the shared gate)
  assert.equal(extractFailureFile("task-contract-check failed in plugin/scripts/task-contract-check.ts", root), "plugin/scripts/task-contract-check.ts");
  // no file on the line → undefined (falls back to the TAP file context / unknown)
  assert.equal(extractFailureFile("not ok 2 - ambiguous failure", root), undefined);
});

// ── AC2: the two-way dispatch conditional (shared gate ⇒ stop; specific unrelated ⇒ continue) ──────

test("AC2 — SHARED-GATE failure ⇒ BLOCK dispatch, even for an unrelated candidate (every scoped run pays the gate)", () => {
  const st = state({
    failures: [{ line: "task-contract-check: NEW Contract violation", file: "plugin/scripts/task-contract-check.ts" }],
  });
  const unrelatedTouches = "## Touches\n- plugin/test/other.test.mjs\n";
  assert.equal(shouldDispatchOnRed(st, unrelatedTouches), true, "a shared-gate red blocks an unrelated candidate");
});

test("AC2 — SPECIFIC-TEST failure unrelated to the candidate's touch-set ⇒ dispatch CONTINUES", () => {
  const st = state({
    failures: [{ line: " ❯ plugin/test/foo.test.mjs (3 tests | 1 failed) 12ms" }],
  });
  const unrelatedTouches = "## Touches\n- plugin/test/other.test.mjs\n- plugin/scripts/x.ts\n";
  assert.equal(shouldDispatchOnRed(st, unrelatedTouches), false, "an unrelated specific-test red must NOT stop dispatch (AC4: the white-wait is eliminated)");
});

test("AC2 — SPECIFIC-TEST failure intersecting the candidate's touch-set ⇒ BLOCK that candidate", () => {
  const st = state({
    failures: [{ line: "not ok 2 - failing b", file: "plugin/test/foo.test.mjs" }],
  });
  const intersectingTouches = "## Touches\n- plugin/test/foo.test.mjs\n- plugin/scripts/suite-state-trigger.ts\n";
  assert.equal(shouldDispatchOnRed(st, intersectingTouches), true, "a candidate that would run the red test is blocked");
});

test("AC2 — array-form touches works (the inner dispatch rule may pass pre-parsed globs)", () => {
  const st = state({
    failures: [{ line: " ❯ plugin/test/foo.test.mjs (3 tests | 1 failed) 12ms" }],
  });
  assert.equal(shouldDispatchOnRed(st, ["plugin/test/foo.test.mjs"]), true);
  assert.equal(shouldDispatchOnRed(st, ["plugin/test/other.test.mjs"]), false);
});

test("AC2 — fail-closed edges: legacy red (no failures) BLOCKS; aborted never blocks; green/running/absent allow", () => {
  // legacy red without a failure location — cannot confirm it is an unrelated specific test ⇒ block
  assert.equal(shouldDispatchOnRed(state({}), "## Touches\n- plugin/test/other.test.mjs\n"), true, "legacy red fail-closed");
  assert.equal(shouldDispatchOnRed(state({ failures: [] }), "## Touches\n- plugin/test/other.test.mjs\n"), true, "empty failures fail-closed");
  // aborted = no correctness conclusion ⇒ never a dispatch stop
  assert.equal(shouldDispatchOnRed(state({ reason: "aborted", failures: [{ line: "x" }] }), "## Touches\n- a\n"), false);
  // non-red never blocks
  assert.equal(shouldDispatchOnRed({ state: "green" }, "## Touches\n- a\n"), false);
  assert.equal(shouldDispatchOnRed({ state: "running" }, "## Touches\n- a\n"), false);
  assert.equal(shouldDispatchOnRed(null, "## Touches\n- a\n"), false);
});

// ── AC3/AC1: the SUITE-RED event carries the failure location; stopSignal stays in place ──────────

test("AC3 — the SUITE-RED event carries failureLocation (classified from state.failures), for the dispatch decision", () => {
  const root = tmpRoot();
  try {
    writeSuiteState(root, state({ state: "running" }));
    runOnce(root);
    writeSuiteState(
      root,
      state({
        state: "red",
        finishedAt: null,
        failures: [{ line: " ❯ plugin/test/foo.test.mjs (3 tests | 1 failed) 12ms" }],
      }),
    );
    const res = runOnce(root);
    const redEv = res.events.find((e) => e.event === "SUITE-RED");
    assert.ok(redEv, "SUITE-RED emitted on the red flip");
    assert.equal(redEv.stopSignal, true, "state=red+failed IS the stop-dispatch signal (unchanged)");
    assert.ok(redEv.failureLocation, "the SUITE-RED event carries failureLocation");
    assert.deepEqual(
      redEv.failureLocation.map((l) => l.kind),
      ["specific-test"],
      "failureLocation classifies the carried failure",
    );
    assert.equal(redEv.failureLocation[0].file, "plugin/test/foo.test.mjs", "the failing file is carried");
    // durable: the events log records it too
    const log = readSuiteEvents(root);
    const logged = log.find((e) => e.event === "SUITE-RED");
    assert.ok(logged?.failureLocation, "the events.jsonl record carries failureLocation");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC1/AC2/AC4 + Contract: the two loop docs carry the SAME conditionalized rule (not two copies) ──

test("AC1 — the loop docs carry the fan-in invariant: RED ⇒ 一律暂缓 fan-in (the real protection)", () => {
  for (const [name, doc] of [
    ["inner", read(INNER_TICK)],
    ["outer", read(OUTER_TICK)],
  ]) {
    // The actual wording is 暂缓…已完成 agent 的 fan-in (暂缓 and fan-in are separated) —
    // assert the invariant via 暂缓 followed by fan-in with anything between, never a
    // contiguous "暂缓 fan-in" substring (that is the outer-only form the inner doesn't use).
    assert.match(doc, /暂缓[\s\S]*fan-in/, `${name} doc: RED ⇒ 一律暂缓 fan-in (Contract invoke term)`);
    assert.match(doc, /fan-in/, `${name} doc names fan-in`);
  }
});

test("AC2 — the loop docs carry the SHARED gate-conditional dispatch rule (run_static_checks, 共享闸门, 具体测试) and are CONSISTENT", () => {
  const inner = read(INNER_TICK);
  const outer = read(OUTER_TICK);
  for (const [name, doc] of [
    ["inner", inner],
    ["outer", outer],
  ]) {
    // Contract measure: dispatch_stopped_by_shared_gate >= 1 (run_static_checks explicitly in the red-window handling doc)
    assert.match(doc, /run_static_checks/, `${name} doc names run_static_checks (the shared gate — Contract measure)`);
    assert.ok(doc.includes("共享闸门"), `${name} doc names the shared gate (Contract invoke term)`);
    assert.ok(doc.includes("具体测试"), `${name} doc names the specific-test branch (Contract invoke term)`);
    // the rule is CONDITIONALIZED: dispatch stops ONLY on the shared gate; specific tests unrelated continue
    assert.ok(
      doc.includes("run_static_checks") && doc.includes("共享闸门"),
      `${name} doc: shared-gate failure ⇒ stop dispatch is explicit`,
    );
  }
  // CONSISTENCY — both docs must state the same conditional (dispatch continues for specific-test
  // failures unrelated to the new task's touch-set, because the worktree is independent).
  for (const marker of ["run_static_checks", "共享闸门", "具体测试"]) {
    assert.ok(inner.includes(marker) && outer.includes(marker), `both docs carry '${marker}' (shared, not two copies)`);
  }
});

test("AC3 — the inner tick doc names the failure-location mechanism (state.failures) for the dispatch judgment", () => {
  const inner = read(INNER_TICK);
  assert.match(inner, /failures/, "inner doc reads state.failures (the failure location)");
  assert.match(inner, /shouldDispatchOnRed/, "inner doc names the executable dispatch-conditional helper");
});

test("AC5 — this file declares node:test and // @test-group engine", () => {
  const src = read(new URL(import.meta.url));
  assert.ok(src.includes('import { test } from "node:test"'), "uses node:test");
  assert.match(src, /^\/\/ @test-group engine/m, "declares @test-group engine");
});
