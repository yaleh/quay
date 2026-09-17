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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { after, assert, fakeSuite, fs, os, path, readState, redPayload, routeRed, runOnce, runRunner, shouldStopDispatch, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("gap-task-file-static-syntax: a --no-block task-file checker round (violations recorded, exit 0) is GREEN, not static-check red", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-noblock-"));
  // The post-fix shape (option ①): task-contract-check runs with --no-block — it prints VIOLATION
  // lines + "recorded (non-blocking)" (the "new since baseline: N" marker is deliberately avoided),
  // exits 0, and the suite proceeds to a green test phase. The round must be GREEN — task-file
  // Contract/AC syntax must not consume a verification opportunity.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "recorded (non-blocking, grow-only ledger): 6 new task-file violation(s) — task-file syntax does NOT block the verification round"\n' +
      'echo "ratchet ceiling: 6; recorded (non-blocking): 6 (tasks/gap-foo.md: V1); resolved: 0"\n' +
      'echo "selected 1 files (groups=product,engine)"\n' +
      'echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 — the round is green; task-file syntax did not block");
    const s = readState(root);
    assert.equal(s.state, "green", `expected green (recorded-not-blocking), got: ${JSON.stringify(s)}`);
    assert.notEqual(s.reason, "static-check", "a recorded-not-blocking round is NOT a static-check red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2b — the static-check phase gate: test-phase output (selected N files) stops static-check patterns firing on test fixtures (round-6 2026-08-09 false-red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pgate-"));
  // The round-6 false-red shape: a passing test (candidate-contracts.test.mjs) prints
  // "ANTI-DRIFT HARD FAIL: N violation(s)" fixture lines DURING its run — after test.sh's
  // "selected N files (groups=…)" test-phase marker, before any "# tests" summary. The static-check
  // patterns must NOT fire on those (the suite is genuinely green), but MUST still fire BEFORE the
  // test phase begins (covered by the AC2/AC3/AC4 test above, whose fake suite has no "selected").
  const { f, dir } = fakeSuite(
    'echo "selected 252 files (groups=product,engine)"\n' +
      'echo "ANTI-DRIFT HARD FAIL: 1 violation(s)"\n' +
      'echo "  cross-build-overlap: builds A & B both touched shared/s.js"\n' +
      'echo "# tests 42"\n' +
      'echo "# pass 42"\n' +
      'echo "# fail 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 (the suite is genuinely green — the ANTI-DRIFT lines are test fixtures)");
    const s = readState(root);
    assert.equal(s.state, "green", "no false static-check red once the test phase has started");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 — both testsSeen summary forms (`# tests N` AND the reporter's `ℹ tests N`) arm the static-check phase gate on their own (round-6 regex root cause)", async () => {
  // Round-6 root cause (gap-static-check-false-positive-testsseen-regex-does-not-match-reporter-format):
  // the testsSeen parser only accepted the TAP `# tests N` form, but measure-suite-reporter emits the
  // info-glyph `ℹ tests N` — so testsSeen stayed 0 and the `testsSeen === 0` static-check guard was
  // INERT, letting STATIC_CHECK_FAILURE_PATTERNS fire on test-fixture output (candidate-contracts'
  // "ANTI-DRIFT HARD FAIL" lines). 42aad5fe accepts both prefixes; the Contract measure is
  // `tests_seen_after_test_phase > 0`. This test proves EACH summary form ALONE (no "selected N files"
  // marker) increments testsSeen ⇒ testPhaseStarted, so an ANTI-DRIFT fixture line printed after the
  // summary no longer false-triggers static-check red and the suite stays green.
  for (const summary of ['echo "# tests 5"', 'echo "ℹ tests 5"']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-glyph-"));
    const { f, dir } = fakeSuite(
      summary +
        '\necho "ANTI-DRIFT HARD FAIL: 1 violation(s)"\n' +
        'echo "  cross-build-overlap: builds A & B both touched shared/s.js"\n' +
        'echo "# pass 5"\n' +
        'echo "# fail 0"\n' +
        "exit 0",
    );
    try {
      const child = runRunner({ root, command: `bash ${f}` });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 (genuinely green) for summary form: ${summary.trim()}`);
      const s = readState(root);
      assert.equal(
        s.state,
        "green",
        `summary form ${summary.trim()} ⇒ testsSeen>0 ⇒ phase gate armed ⇒ ANTI-DRIFT fixture line does NOT false-red (AC2/AC3/AC4)`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});


test("AC5 — a real test failure dominates a static-check marker: reason stays failed, failures[] carries the test failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sc-dom-"));
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: something"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6"\n' +
      'echo "not ok 1 - boom"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "a real test failure is reason=failed, never downgraded to static-check (AC5)");
    assert.ok(redPayload(s).length >= 1, "the red payload carries failures");
    assert.equal(redPayload(s)[0].staticCheck, undefined, "the payload carries the REAL test failure (not a static-check entry)");
    assert.ok(s.staticCheck, "the staticCheck field is still recorded alongside (both facts present)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



test("AC3 — routeRed/shouldStopDispatch distinguish static-check red (stops) from aborted/infra-error red (does not stop)", () => {
  assert.equal(routeRed({ state: "red", reason: "static-check" }), "red-window-triage", "static-check red → red-window-triage");
  assert.equal(shouldStopDispatch({ state: "red", reason: "static-check" }), true, "static-check red stops dispatch");
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "test-failure red stops dispatch (unchanged, AC5)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "aborted" }), false, "aborted red does NOT stop (unchanged)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "infra-error" }), false, "infra-error red does NOT stop (unchanged)");
});


test("AC1/AC3 — an early-EXIT red (test.sh internal resource-gate WAIT fail-closed) is reason=aborted, NOT failed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-abort-"));
  // The concrete shape from today's FALSE-RED incidents: test.sh's INTERNAL resource-gate fail-closed
  // prints `resource gate says WAIT — not running the full suite ...` to stderr and exits 1 in ~6s
  // WITHOUT running a single test. The runner must classify this as reason=aborted (NO correctness
  // conclusion), never reason=failed — a failed label would stop dispatch on code risk with zero
  // evidence (the coincidence gap the task exists to close).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "gate-WAIT early-exit is red (not green)");
    assert.equal(s.reason, "aborted", "early gate-WAIT exit is reason=aborted, NOT failed (AC1/AC3)");
    assert.ok(s.finishedAt, "final aborted-red has finishedAt");
    assert.equal(typeof s.durationMs, "number", "durationMs recorded even on the aborted run");
    // The stop-dispatch consumer must NOT stop on this aborted-red (AC2: aborted routes to the
    // resource-gate, NOT to code-risk stop).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC5 — a REAL failure after an abort marker is NOT downgraded: reason stays failed (failure conclusion stands)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-dom-"));
  // Defensive: even if an abort marker appears first, a later real failure line is the stronger
  // conclusion — redDetected must dominate abortDetected (AC5: the failure conclusion stands).
  const { f, dir } = fakeSuite('echo "resource gate says WAIT" >&2\necho "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "a real failure after an abort marker stays failed, never downgraded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
