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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { assert, classifyFailure, fakeSuite, fs, os, path, poll, read, readState, redPayload, runOnce, runRunner, shouldDispatchOnRed, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("AC1 e2e — a `Killed node --test` bash job-status line + green TAP tally + exit 0 ⇒ GREEN, NOT infra-error (the round-18 `suite log shows 1 SIGKILL/Killed marker(s)` shape)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-killedline-"));
  // round 18 (2026-08-12): tests=3977 pass=3977 fail=0 cancelled=0 but the round was mislabelled
  // infra-error because the log carried a SIGKILL/Killed marker. The marker is a TEST's internal
  // subprocess being killed (resource-gate.test.mjs kills a child to test the resource gate) — the
  // DIRECT test.sh child exited 0 with all tests passing. Reproduce the exact shapes: a bash
  // job-status `Killed node --test` line AND a green TAP summary, then exit 0. The runner must mark
  // GREEN (kill detection is the DIRECT child's exit status, never a stream marker).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: line 576: 720326 Killed node --test"\n' +
      'echo "__ENVFAIL__ killed by SIGKILL: ./bin/quay.js x" >&2\n' +
      'echo "# tests 3977"\necho "# pass 3977"\necho "# fail 0"\necho "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "green", `all-pass suite with only Killed/__ENVFAIL__ stream markers must be GREEN, got ${JSON.stringify(s)}`);
    assert.ok(!s.reason, `green state carries no reason, got ${JSON.stringify(s)}`);
    assert.equal(code, 0, "runner exits 0 on the green suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC1/manager-semantic e2e — a FULLY-GREEN test result (pass>0 fail=0 cancelled=0 failures=[]) + a signal-killed DIRECT child (exit 137) ⇒ GREEN, NOT infra-error red (fully-green test result wins over infra-error)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-greenwins-"));
  // Manager semantic (2026-08-12, round-18 shape): when the TEST RESULT is fully green — pass>0,
  // fail=0, cancelled=0, failures=[] — every test that ran passed. An infra-error teardown signal
  // (here the DIRECT child exits 137: a descendant was SIGKILL'd) must NOT turn that into a
  // state=red that blocks the batch-merge freshness gate. The fully-green test result is evidence
  // the TESTS ALL PASSED ⇒ state=green (the reason axis never sees it as red).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: line 576: 720326 Killed node --test"\n' +
      'echo "# tests 3977"\necho "# pass 3977"\necho "# fail 0"\necho "# cancelled 0"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "exit $?",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "green", `a fully-green test result must win over the infra-error teardown signal, got ${JSON.stringify(s)}`);
    assert.ok(!s.reason, `green state carries no reason, got ${JSON.stringify(s)}`);
    assert.equal(code, 0, "runner exits 0 on the green suite (fully-green test result)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 e2e — a REAL signal-killed DIRECT test.sh child torn down MID-RUN (no full green TAP summary) is infra-error red, NOT green (AC2 non-regression)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-realkill-"));
  // AC2 (gap-infra-error-false-positive-from-test-internal-kill): a REAL environment failure — the
  // runner's DIRECT test.sh child killed by a signal (bash exits 128+N) BEFORE producing a full green
  // result — must STILL be infra-error. This fake suite prints a `Killed node --test` line and exits
  // 137 but emits NO full green TAP summary (torn down mid-run): the test result is NOT fully green
  // (tapPass=0), so infra-error is a red, not green. Distinguishes the two directions: a fully-green
  // test result wins (previous test); a mid-run teardown with no green evidence stays infra-error red.
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: line 576: 720326 Killed node --test"\n' +
      'echo "partial output before teardown"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "exit $?",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on the infra-error");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 20000 });
    assert.ok(s, `signal-killed DIRECT child torn down mid-run is final state=red reason=infra-error (got ${JSON.stringify(readState(root))})`);
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "infra-error-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 e2e — MULTIPLE failure lines each push into failures[] (manager 2026-08-10 15:2x: structurally capped at 1 before; now every failure records)", async () => {
  // r240 TAP reported fail=7 but failures[] held only the FIRST failure's name — the push sat inside
  // the !redDetected guard that flips true on line 1. This fake suite emits THREE not-ok lines; all
  // three must be recorded (capped at MAX_RECORDED_FAILURES only for pathological rounds).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-multifail-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - alpha"; echo "not ok 2 - beta"; echo "not ok 3 - gamma"; exit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed");
    assert.ok(redPayload(s).length >= 3, `all 3 failure lines must be recorded; got ${JSON.stringify(s)}`);
    const names = redPayload(s).map((x) => x.line).join(" ");
    assert.match(names, /alpha/, "first failure recorded");
    assert.match(names, /beta/, "second failure recorded (was dropped by the !redDetected cap)");
    assert.match(names, /gamma/, "third failure recorded");
    assert.ok(code !== 0, "runner exits non-zero on the red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 e2e negative control — a SHARED-GATE red and a SPECIFIC-TEST red produce distinguishable failures[] payloads (the dispatch rule can decide)", async () => {
  // gap-suite-red-verdict-carries-empty-failures-payload AC2 — the SUITE-RED failures payload must
  // carry enough WHERE for the inner dispatch rule to distinguish a SHARED-GATE failure (run_static_checks
  // — every scoped run pays it ⇒ stop dispatch) from a SPECIFIC-TEST failure unrelated to a candidate's
  // touch-set (⇒ dispatch continues). Construct BOTH through the real runner and assert the two
  // failures[] payloads classify differently (shared-gate vs specific-test) — the empty-payload defect
  // would make this impossible (failures=[] has no location to classify).
  const runBoth = async (scriptBody) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2neg-"));
    const { f, dir } = fakeSuite(scriptBody);
    try {
      const child = runRunner({ root, command: `bash ${f}` });
      const { code } = await waitExit(child);
      assert.notEqual(code, 0, "the red suite exits non-zero");
      const s = readState(root);
      assert.equal(s.state, "red");
      assert.ok(s.failures && s.failures.length >= 1, `failures[] must be non-empty (payload not empty); got ${JSON.stringify(s.failures)}`);
      return { s, root };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  // shared-gate red: a static-check checker fails (task-contract ratchet growth) — the shared gate
  const shared = await runBoth(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1); resolved: 0"\n' +
      "exit 1",
  );
  // specific-test red: a real test file failure (TAP not ok with a file in the detail block) — the
  // file is repo-relative (absolute paths OUTSIDE the temp root would normalize away, see
  // normalizeFailureFile); the runner captures it from the detail block's `location:` line. The
  // detail line must be ECHOED (a bare `location: ...` line would be treated as a bash command).
  const specific = await runBoth("echo \"not ok 1 - something failed\"\necho \"  location: 'plugin/test/foo.test.mjs:3:1'\"\nexit 1");

  try {
    const sharedLoc = classifyFailure(shared.s.failures[0]);
    const specificLoc = classifyFailure(specific.s.failures[0]);
    assert.equal(sharedLoc.kind, "shared-gate", `the static-check failure classifies shared-gate; got ${JSON.stringify(sharedLoc)}`);
    assert.equal(specificLoc.kind, "specific-test", `the test-file failure classifies specific-test; got ${JSON.stringify(specificLoc)}`);
    // The dispatch rule reads the payloads differently: a shared-gate red blocks an unrelated
    // candidate; a specific-test red unrelated to the candidate's touches does NOT.
    assert.equal(
      shouldDispatchOnRed(shared.s, "## Touches\n- plugin/test/other.test.mjs\n"),
      true,
      "shared-gate red stops dispatch even for an unrelated candidate (every scoped run pays it)",
    );
    assert.equal(
      shouldDispatchOnRed(specific.s, "## Touches\n- plugin/test/other.test.mjs\n"),
      false,
      "a specific-test red unrelated to the candidate's touch-set does NOT stop dispatch (dispatch continues)",
    );
  } finally {
    fs.rmSync(shared.root, { recursive: true, force: true });
    fs.rmSync(specific.root, { recursive: true, force: true });
  }
});


test("AC2/AC3 e2e — a `__PERFILE__ ... passed=false` per-file line flips red and carries the failed file in failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pf-"));
  const { f, dir } = fakeSuite(
    'echo "__PERFILE__ duration_ms=3580.991183 packages/quay/test/verify-delivery-surface.test.mjs passed=false"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "__PERFILE__ passed=false flips state to red (AC2)");
    assert.equal(s.reason, "failed");
    assert.ok(s.failures && s.failures.length >= 1, `failures[] carries the per-file failure (AC3); got ${JSON.stringify(s.failures)}`);
    assert.equal(
      s.failures[0].file,
      "packages/quay/test/verify-delivery-surface.test.mjs",
      "the per-file line's path is the failure's file (AC3 — red with detail, no more failures=[])",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 e2e — a GREEN round archives stderr __OVERHEAD__ phase lines (stderr is teed, not dropped)", async () => {
  // test.sh's _oh_emit writes the fixed-overhead decomposition to STDERR (>&2). The runner must
  // archive those lines into .quay/full-suite.log — the outer's verification round greps that log
  // for `__OVERHEAD__`. This fake suite emits one line to stdout and one to STDERR on a green run;
  // both must land in the archived log (gap-red-round-loses-overhead-phase-decomposition AC2).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-green-"));
  const { f, dir } = fakeSuite(
    'echo "__OVERHEAD__ lock_overhead_ms=42"\n' +
      'echo "__OVERHEAD__ main_phase_ms=650104" >&2\n' +
      'echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `green suite exits 0, got ${code}`);
    assert.equal(readState(root).state, "green");
    const log = read(path.join(root, ".quay", "full-suite.log"));
    assert.match(log, /__OVERHEAD__ lock_overhead_ms=42/, "stdout __OVERHEAD__ line reached the archived log");
    assert.match(
      log,
      /__OVERHEAD__ main_phase_ms=650104/,
      "STDERR __OVERHEAD__ line reached the archived log (stderr is teed, not dropped)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
