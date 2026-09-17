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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/8 (11 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { after, assert, fakeSuite, fs, os, path, poll, readState, redPayload, releaseGate, runCli, runOnce, runRunner, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("AC2 — a vitest structured failure line flips red EARLY, before the run completes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vit-"));
  const marker = path.join(root, "post-failure-marker");
  // A real failing vitest run prints the structured per-file line (`❯ <file> (N tests | M failed)`)
  // BEFORE its summary and exit. Red must be marked on that line, not at exit — the same early-red
  // property node:test/TAP gets from `not ok` (AC2 preserved for vitest projects). The suite blocks on
  // a release gate after the failure line; the test touches it after observing the early red
  // (gap-fake-suite-release-gate-sleep-zero — the fixed 10s marker window is zeroed).
  const gate = releaseGate(root, "earlyred-vitest");
  const { f, dir } = fakeSuite(
    'echo " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms"\n' +
      gate.wait +
      '\necho done > "' +
      marker +
      '"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // The 20s poll timeout stays (runner node bootstrap under load can exceed seconds — early-red is
    // judged on the marker, not on a runner-bootstrap race).
    const redObserved = await poll(() => {
      const s = readState(root);
      return s && s.state === "red" ? s : null;
    }, { timeoutMs: 20000 });
    assert.equal(redObserved.state, "red");
    assert.equal(redObserved.reason, "failed", "a structured vitest failure is a REAL failure (stop-dispatch signal)");
    assert.equal(redObserved.finishedAt, null, "red written while the run is still in progress (AC2 early-red)");
    assert.ok(!fs.existsSync(marker), "red appeared before the suite's post-failure step completed");
    fs.writeFileSync(gate.release, "go", "utf8"); // release — the post-failure step (marker) runs now
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed: AC2/AC3/AC5 e2e ────────────────
// The round-149 defect (state=red reason=failed but failures=[] / redAt=null): the runner's
// FAILURE_PATTERNS missed the reporter's info-glyph / per-file failure forms. Each e2e below
// constructs the real reporter shape and asserts red + a non-empty failures[] (the AC3 "red with
// detail" property) — the measure `failures_nonempty_on_info_red >= 1` band.


test("AC2/AC3 e2e — an `ℹ fail 1` (info-glyph summary) suite flips red with a non-empty failures[] and a non-null redAt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-infofail-"));
  const { f, dir } = fakeSuite('echo "ℹ tests 1"\necho "ℹ pass 0"\necho "ℹ fail 1"\necho "ℹ cancelled 0"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "ℹ fail 1 flips state to red (AC2 — the reporter glyph form is recognized)");
    assert.equal(s.reason, "failed", "ℹ fail 1 is a REAL test failure (stop-dispatch signal)");
    assert.ok(redPayload(s).length >= 1, `the red payload must be non-empty (measure failures_nonempty_on_info_red >= 1); got ${JSON.stringify(s)}`);
    // redAt is carried on the verification-round record (the early-RED detection-latency axis) —
    // the round-149 record had redAt=null; a recognized failure line must timestamp it.
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    const rounds = fs.existsSync(roundFile)
      ? fs.readFileSync(roundFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(rounds.length >= 1, "a verification-round record is appended");
    assert.ok(rounds[rounds.length - 1].redAt, `redAt must have a value (round-149 had null); got ${rounds[rounds.length - 1].redAt}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC2/AC3 ─────────────────────────────────
// The runner previously waited for a HUNG suite child forever (round-164 leaked 20+ min holding the
// single-flight flock). The max-runtime / silence / red-grace guards kill the child TREE and produce
// reason=timeout / reason=hung / a prompt red exit. Tests use the env seams to make the guards fire fast.


test("AC3 e2e — a HANGING suite is killed at the max-runtime seam (reason=timeout, no indefinite leak)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-timeout-"));
  const { f, dir } = fakeSuite('sleep 30'); // hangs far beyond the 800ms seam
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_SUITE_MAX_RUNTIME_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "a max-runtime kill is a red (no correctness conclusion)");
    assert.equal(s.reason, "timeout", `max-runtime kill must be reason=timeout, got ${s.reason}`);
    assert.ok(code !== 0, "runner exits non-zero on a timeout kill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC3 e2e — a SILENT suite is killed at the silence seam (reason=hung)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-hung-"));
  const { f, dir } = fakeSuite('echo "start"; sleep 30'); // one line, then silence far beyond the seam
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_SUITE_SILENCE_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "a silence kill is a red (no correctness conclusion)");
    assert.equal(s.reason, "hung", `silence kill must be reason=hung, got ${s.reason}`);
    assert.ok(code !== 0, "runner exits non-zero on a hung kill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 e2e — a RED suite whose test.sh hangs is killed after the red-grace seam (prompt exit, red conclusion stands)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-killonred-"));
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"; sleep 30'); // red detected, then hangs
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "800", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "the red conclusion stands");
    assert.equal(s.reason, "failed", `a REAL failure (not ok) is never downgraded to timeout/hung: got ${s.reason}`);
    assert.ok(redPayload(s).length >= 1, `the not-ok failure must be recorded; got ${JSON.stringify(s)}`);
    assert.ok(code !== 0, "runner exits non-zero on the red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 e2e — a RED suite STILL PRODUCING OUTPUT is NOT killed on red-grace; it runs to completion (report-all-failures, manager 2026-08-10 15:1x)", async () => {
  // round-95 AC3 principle: phases run EVEN IF a later phase fails. The runner's kill-on-red must
  // only kill a HUNG child (silent for RED_GRACE_MS), not one still emitting results — otherwise a
  // serial/lowconc red (which runs FIRST per test.sh phase order) kills the whole tree before the
  // main phase (281 files, 89%) ever runs. This fake suite reds early, then keeps producing output
  // (simulating main still running) and exits on its own — the runner must NOT escalate the kill.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-stillprod-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - boom"; for i in $(seq 1 30); do echo "line $i - still running"; sleep 0.1; done; exit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "800", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "the red conclusion stands");
    assert.equal(s.reason, "failed", `a real failure is never downgraded to timeout/hung: got ${s.reason}`);
    assert.ok(redPayload(s).length >= 1, `the not-ok failure must be recorded; got ${JSON.stringify(s)}`);
    // The suite ran its full body (all 30 'still running' lines) and exited itself — the runner did
    // NOT kill it at the red-grace seam (a kill would cut the output short).
    assert.ok(code !== 0, "runner exits non-zero on the red");
    // Assert the suite body completed: the last 'still running' line reached the log (not killed mid-way).
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    assert.match(log, /line 30 - still running/, "the suite's final line must appear — NOT killed at red-grace");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC1 e2e — a stream __ENVFAIL__ marker (runCli helper's environment-failure throw) from a TEST's INTERNAL kill does NOT flip the suite — exit 0 ⇒ green (gap-infra-error-false-positive-from-test-internal-kill)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-envfail-"));
  // The fake suite's stderr carries the runCli helper's ENV_FAIL_MARKER throw (killed by SIGKILL) —
  // the exact round-18 false-positive shape: resource-gate.test.mjs kills an INTERNAL child to test
  // the resource gate and prints `__ENVFAIL__ killed by SIGKILL`, while ALL its tests pass (exit 0).
  // The kill classification must come from the DIRECT test.sh child's EXIT STATUS (childKilledBySignal),
  // NOT from stream content — a stream marker a test's internal subprocess printed is not evidence the
  // suite was torn down. exit 0 + no failure line ⇒ state=green (NOT infra-error).
  const { f, dir } = fakeSuite('echo "__ENVFAIL__ killed by SIGKILL: ./bin/quay.js x" >&2; exit 0');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "green", `a passing suite whose only oddity is a test-internal __ENVFAIL__ stream marker must be GREEN, got ${JSON.stringify(s)}`);
    assert.ok(!s.reason, `green state carries no reason, got ${JSON.stringify(s)}`);
    assert.equal(code, 0, "runner exits 0 on the green suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


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
