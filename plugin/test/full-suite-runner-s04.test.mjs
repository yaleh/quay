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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/8 (10 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { after, assert, fakeSuite, fs, os, path, poll, readState, redPayload, routeRed, runOnce, runRunner, sharedGreenShape, shouldStopDispatch, spawn, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

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


test("AC5 — a child killed by a signal (SIGKILL) writes reason=infra-error (environment), NOT failed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sigkill-"));
  // A SIGKILL'd suite exits with code=null + signal=SIGKILL: the DIRECT test.sh child was torn down
  // mid-run ⇒ an environment problem (reason=infra-error, no correctness conclusion), NOT a code
  // failure. Previously this was labelled aborted; gap-infra-error-false-positive-from-test-internal-
  // kill AC2 re-classifies a signal-killed DIRECT child as infra-error (the EXIT STATUS is the only
  // reliable kill signal — a stream `Killed`/`__ENVFAIL__` marker from a test's internal subprocess
  // is NOT).
  const { f, dir } = fakeSuite('echo "about to die"\nkill -9 $$\necho "unreachable"');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a killed suite");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 20000 });
    assert.ok(s, "signal-killed child is final state=red reason=infra-error");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC5 — a SIGKILL'd node --test reported by bash as exit 137 is reason=infra-error, NOT failed (the 07:08→07:21 shape)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-137-"));
  // gap-suite-cutoff-what-tears-test-process-at-session-topology (confirmed 2026-08-07): in the real
  // full-suite path test.sh runs `node --test` as a CHILD and bash reports a SIGKILL'd child as its
  // OWN exit code 128+N (137 for SIGKILL). The runner's child is `bash -c <test.sh>`, so it sees
  // exit.code=137, exit.signal=null — the pre-fix childKilledBySignal (`exitCode === null`) missed
  // this and mislabelled it reason=failed (a stop-dispatch signal). Reproduce the bash shape:
  //   bash runs a child, the child is SIGKILL'd externally, bash `wait`s it (→137) and exits 137.
  // gap-infra-error-false-positive-from-test-internal-kill AC2: the DIRECT child exiting 128+N
  // (a signal-killed descendant) is an environment problem ⇒ reason=infra-error (the runner's own
  // test.sh child was torn down mid-run), NOT aborted.
  const { f, dir } = fakeSuite(
    'echo "simulating a SIGKILL\'d node --test child"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "code=$?\n" +
      'echo "bash observed child killed, exiting $code"\n' +
      "exit \"$code\"",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on an infra-error suite");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 20000 });
    assert.ok(s, `bash-exits-137 signal-kill is final state=red reason=infra-error (got ${JSON.stringify(readState(root))})`);
    // And the stop-dispatch consumer (runOnce) reports NO stop signal for infra-error-red (AC5 —
    // infra-error, like aborted, does NOT stop dispatch).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "bash-137 infra-error-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC5 — a generic non-zero exit with NO failure/abort marker stays reason=failed (fail-closed catch-all)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-catch-"));
  // The reason-axis boundary: an unmatched non-zero exit could be a real failure no structured line
  // matched. Failing CLOSED (reason=failed) preserves the stop-dispatch signal for that class; only a
  // recognised NO-conclusion shape (abort marker / signal kill / spawn error) is relaxed to aborted.
  const { f, dir } = fakeSuite('echo "something went wrong"\nexit 3');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "an unmatched non-zero exit stays fail-closed failed");
    // gap-suite-red-verdict-carries-empty-failures-payload AC1 — a red verdict must NEVER carry an
    // EMPTY failure payload: the fail-closed catch-all used to write failures=[] (the SUITE-RED
    // event's dispatch rule has no input). Now the runner synthesizes one best-effort entry from the
    // last stream line so the red-window dispatch rule has a failure to classify. The synthesized
    // entry carries no file (the line `something went wrong` has no path), so it rides
    // `unattributed[]` — the payload lives in failures[] OR unattributed[] (AC1/AC2 segmentation).
    assert.ok(redPayload(s).length >= 1, `a red verdict carries a non-empty failure payload (failures[] or unattributed[]); got ${JSON.stringify(s)}`);
    assert.ok(redPayload(s)[0].line, "the synthesized failure carries a line (the last stream output)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC3 — a red suite's full-suite.log ends with a `# fail` summary line (gap-suite-red-verdict-carries-empty-failures-payload)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-logsump-"));
  // The observed defect: full-suite.log ran 9251 lines with ZERO `# fail`/`# pass` summary lines,
  // ending mid-assertion. The runner now appends its OWN TAP-form summary after the verdict so the
  // log is always mechanically queryable for a fail count — even when the child was killed mid-assert.
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    // The runner's own summary line carries the red verdict as a fail count (TAP form so
    // `grep -cE '^# (tests|pass|fail|cancelled)'` finds it).
    assert.match(log, /^# fail [1-9]\d*$/m, `log has a '# fail N' summary line; got:\n${log}`);
    assert.match(log, /^# suite red failed$/m, "log summary names the red verdict");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC1/AC3 e2e — a GREEN suite's full-suite.log ends with a `# fail 0` summary (summary is verdict-accurate)", async () => {
  // gap-shape-assert-share-round: shares ONE runner round with the state-shape / generation-guard /
  // pid shape tests (4 spawns → 1). The green log summary is written on the shared green run.
  const { log } = await sharedGreenShape();
  assert.match(log, /^# fail 0$/m, `a green run logs '# fail 0'; got:\n${log}`);
  assert.match(log, /^# suite green$/m, "green summary names the green verdict");
});


test("AC1 — a passing vitest-style suite logging a bare-X console line stays GREEN (no false early-red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1x-"));
  // archguard TASK-67 shape: a PASSING negative-control test logs `✖ Diagram test failed` to
  // console.error; the vitest summary is 0 failed / exit 0. The old bare-✖ FAILURE_PATTERN turned
  // this GREEN suite red. With structured matching it must stay green (AC1).
  const { f, dir } = fakeSuite(
    'echo "✖ Diagram test failed" >&2\n' +
      'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.equal(s.state, "green", "bare ✖ console noise must NOT flip state to red (AC1)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
