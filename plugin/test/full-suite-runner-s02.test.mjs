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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/8 (10 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, RUNNER, after, assert, extractStaticCheckDetail, fakeSuite, fs, isAbortLine, isFailureLine, isStaticCheckFailureLine, os, path, poll, read, readState, releaseGate, runCli, runOnce, runRunner, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("AC2 — lightweight controls (--fail-fast-check) skip the in-flight check", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inflight-skip-"));
  const statePathFile = path.join(root, ".quay", "full-suite-state.json");
  fs.mkdirSync(path.dirname(statePathFile), { recursive: true });
  fs.writeFileSync(statePathFile, JSON.stringify({ state: "running", pid: process.pid, finishedAt: null, runId: "existing-run" }, null, 2));
  try {
    const { code } = await runCli(RUNNER, ["--fail-fast-check", "--root", root, "--state-dir", path.join(root, ".quay")]);
    // --fail-fast-check runs its own hermetic sub-suite and exits 0 when the chain works — it must
    // NOT be blocked by the in-flight check.
    assert.equal(code, 0, "--fail-fast-check must skip the in-flight check");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("AC5 — a signal-killed run writes state=red reason=aborted, which must NOT trigger stop-dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac5-"));
  // Flake fix (fan-in reland 2026-08-05): the external `child.kill("SIGTERM")` was delivered to the
  // runner only intermittently in the node --test harness (state stayed "running" after exit ~30-70%
  // of runs). Instead, the fake suite SIGNALS THE RUNNER ITSELF — after sleep 1, it walks its own
  // ancestor chain up to the nearest node process (the runner, which spawned the suite AFTER
  // registering its SIGTERM handler, so the handler is guaranteed registered) and SIGTERMs it.
  // Deterministic: the signal comes from inside the runner's own process tree, no external delivery.
  const { f, dir } = fakeSuite(
    'sleep 1\n' +
    'runner_pid=$PPID\n' +
    'while [ -n "$runner_pid" ] && [ "$runner_pid" != "1" ]; do\n' +
    '  # detect the node runner via /proc/<pid>/exe, not `ps -o comm` — node\n' +
    '  # processes report comm=`MainThread` on this machine, so a `node*` match\n' +
    '  # silently misses the runner and the self-signal is never delivered.\n' +
    '  exe=$(readlink "/proc/$runner_pid/exe" 2>/dev/null || true)\n' +
    '  case "$exe" in */node|*/nodejs) kill -TERM "$runner_pid"; break ;; esac\n' +
    '  runner_pid=$(ps -o ppid= -p "$runner_pid" 2>/dev/null | tr -d " ")\n' +
    'done\n' +
    'sleep 5\n' +
    'echo "# fail 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // gap-suite-load-sampler-orphan-process load-hardening: the 10s "running" poll flaked RED under
    // 16-way contention (runner node bootstrap > 10s ⇒ `poll timeout after 10000ms`), the same
    // bootstrap-race shape the AC1/AC2 early-red fixes below widen. Widen both polls so
    // in-flight/aborted are judged on the state file (wall-clock), not on a runner-bootstrap race.
    await poll(() => {
      const s = readState(root);
      return s && s.state === "running" ? s : null;
    }, { timeoutMs: 20000 });
    // The fake suite signals the runner at ~t+1s; the runner exits when the handler runs.
    await waitExit(child);
    // The runner's signal handler writes red+aborted (no correctness conclusion).
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "aborted" ? cur : null;
    }, { timeoutMs: 20000 });
    assert.equal(s.reason, "aborted", "a kill produces reason=aborted, not failed");
    // And the stop-dispatch consumer (runOnce) reports NO stop signal for aborted-red (AC5).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC6 — this task cross-annotates the shared stop-dispatch family (gap-red-window-dispatch-stop-should-be-shared-gate-conditional)", () => {
  const task = read(path.join(REPO_ROOT, "tasks/gap-full-suite-runner-concurrency-default-and-gate.md"));
  assert.match(
    task,
    /gap-red-window-dispatch-stop-should-be-shared-gate-conditional/,
    "this task must cross-annotate the shared-gate stop-dispatch task (AC6)",
  );
  const shared = read(path.join(REPO_ROOT, "tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md"));
  assert.match(
    shared,
    /gap-full-suite-runner-concurrency-default-and-gate/,
    "the shared-gate task must cross-annotate THIS task (AC6)",
  );
});



test("AC1 — while the suite runs, state=running (or early-red) with finishedAt/durationMs null", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  // gap-fake-suite-release-gate-sleep-zero — the fixed 10s in-flight window is a release gate: the
  // suite blocks until the test touches `gate.release` (after observing the in-flight state), zeroing
  // the runner's hard wait. The 20s poll timeout stays (runner node bootstrap under load can exceed
  // seconds — in-flight is judged on the state file, not on a fixed sleep window).
  const gate = releaseGate(root, "inflight");
  const { f, dir } = fakeSuite(`echo "started"\n${gate.wait}\necho "# fail 0"\nexit 0`);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // gap-streaming-red-cascade-amplifies-failures-array AC1 — the assertion is "the round is IN
    // FLIGHT" (state ∈ {running, red}, finishedAt null), NOT "the round is still green" (state ===
    // running). When the runner EARLY-REDS (AC2 — a load-sensitive failure flips the shared state red
    // mid-run), a `state === "running"`-only assertion reads red and fails — the round-130 cascade
    // that amplified failures[] 3×. Both running and red are non-terminal in-flight states with
    // finishedAt null; the round's actual verdict is pinned by the terminal write below.
    const inFlight = await poll(() => {
      const s = readState(root);
      return s && (s.state === "running" || s.state === "red") ? s : null;
    }, { timeoutMs: 20000 });
    assert.equal(inFlight.runner, "outer");
    assert.equal(inFlight.finishedAt, null, "finishedAt null while the round is in flight");
    assert.equal(inFlight.durationMs, null, "durationMs null while the round is in flight");
    fs.writeFileSync(gate.release, "go", "utf8"); // release the suite — the in-flight window is closed
    const { code } = await waitExit(child);
    assert.equal(code, 0);
    assert.equal(readState(root).state, "green");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 — RED is marked on first failure detection, before the run completes (marker-file proof)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  const marker = path.join(root, "post-failure-marker");
  const gate = releaseGate(root, "earlyred");
  const { f, dir } = fakeSuite(`echo "not ok 1 - boom"\n${gate.wait}\necho done > "${marker}"\nexit 1`);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // The failure line is printed immediately; the suite's post-failure step (writing the marker)
    // happens only after the test touches `gate.release`. If state=red is observed BEFORE the marker
    // exists, red was written on detection, not after the run completed (AC2). The 20s poll timeout
    // stays (runner node bootstrap under load can exceed seconds — early-red is judged on the marker,
    // not on a fixed sleep window; gap-fake-suite-release-gate-sleep-zero).
    const redObserved = await poll(() => {
      const s = readState(root);
      return s && s.state === "red" ? s : null;
    }, { timeoutMs: 20000 });
    assert.equal(redObserved.finishedAt, null, "red written while the run is still in progress");
    assert.equal(redObserved.state, "red");
    assert.ok(!fs.existsSync(marker), "red appeared before the suite's post-failure step completed");

    fs.writeFileSync(gate.release, "go", "utf8"); // release — the post-failure step (marker) runs now
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    assert.ok(fs.existsSync(marker), "suite finished its post-failure step after red was marked");

    const final = readState(root);
    assert.equal(final.state, "red");
    assert.ok(final.finishedAt, "final red has finishedAt");
    assert.equal(typeof final.durationMs, "number", "durationMs recorded even on red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC2 unit — the failure markers match STRUCTURED failure lines, never bare glyphs or passing lines", () => {
  for (const line of [
    "not ok 1 - something failed",
    "# fail 2",
    "# cancelled 1",
    "FULL-SUITE-EXIT=1",
    // vitest structured failures (gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red AC1)
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
    " ❯ test/foo.test.ts (3 tests | 1 failed | 2 skipped) 12ms",
    "Test Files  1 failed | 10 passed (11)",
  ]) {
    assert.equal(isFailureLine(line), true, `should flag: ${line}`);
  }
  for (const line of [
    "# tests 2239",
    "# pass 2239",
    "# fail 0",
    "# cancelled 0",
    "FULL-SUITE-EXIT=0",
    "ok 1 - passing test",
    // bare ✖ console noise must NOT flag (AC1 negative control: a passing vitest negative-control
    // test logs `✖ Diagram test failed` — the old /✖/ pattern produced a FALSE early-red)
    "✖ Diagram test failed",
    // vitest passing lines must NOT flag (structured shapes only, not bare glyphs)
    " ✓ test/foo.test.ts (3 tests) 12ms",
    " ❯ test/foo.test.ts (3 tests) 12ms",
    "Test Files  10 passed (11)",
    "   × some individual test name",
  ]) {
    assert.equal(isFailureLine(line), false, `should not flag: ${line}`);
  }
});

// ── gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed: AC2 (reporter glyph forms) ──────
// The round-149 real failure emitted `ℹ fail 1` (info-glyph summary), `✖ <testname> (Nms)`
// (spec-reporter per-test failure) and `__PERFILE__ ... passed=false` (measure-suite-reporter
// per-file failure) — NONE of which the old FAILURE_PATTERNS recognized (it only knew `not ok` /
// `# fail` / `# cancelled` / vitest `❯`), so redDetected stayed false and the red carried
// failures=[] / redAt=null. These pin the fix (AC2): the reporter forms flag; the passing forms
// and the bare-✖ negative control (TASK-67) still do NOT.


test("AC2 unit — FAILURE_PATTERNS recognize the reporter info-glyph + per-file + leak-scan failure forms", () => {
  for (const line of [
    "ℹ fail 1", // measure-suite-reporter / spec-reporter info-glyph summary
    "ℹ cancelled 1", // info-glyph cancelled summary
    "✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0) (3.411515ms)", // spec-reporter per-test failure
    "✖ some test name (12ms)", // short spec-reporter failure line
    "✖ failing tests:", // spec-reporter failure-block header (only emitted when tests failed)
    "__PERFILE__ duration_ms=3580.991183 /home/yale/work/quay/packages/quay/test/verify-delivery-surface.test.mjs passed=false", // per-file failure
    "__PERFILE__ duration_ms=100 packages/quay/test/foo.test.mjs passed=false", // per-file failure, relative path
    "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot)", // candidate C leak-scan residual
  ]) {
    assert.equal(isFailureLine(line), true, `should flag: ${line}`);
  }
  // negative controls — a PASSING run never emits these, and the bare-✖ console-noise guard holds:
  for (const line of [
    "✖ Diagram test failed", // TASK-67 negative control: passing vitest test logging a bare ✖ line
    "ℹ pass 5",
    "ℹ fail 0",
    "ℹ cancelled 0",
    "__PERFILE__ duration_ms=100 /home/yale/work/quay/packages/quay/test/foo.test.mjs passed=true", // passed=true is NOT a failure
    // gap-runner-perfile-pattern-unnchored-self-match-phantom-red AC3: the round-163 phantom-red —
    // a PASSING test whose NAME quotes the `__PERFILE__ ... passed=false` shape (the runner's own
    // e2e name) is `✔`-prefixed, so the ^-anchored + full-shape pattern must NOT flag it:
    "✔ AC2/AC3 e2e — a `__PERFILE__ duration_ms=336 /home/yale/work/quay/plugin/test/foo.test.mjs passed=false` per-file line flips red and carries the failed file in failures[] (336.35913ms)",
    // gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red AC3: the round-167 phantom-red —
    // the same family, `✔`-prefixed passing test NAME quoting the `tmux-leak-scan: FAIL` shape —
    // must NOT flag with the ^-anchored pattern:
    "✔ AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual) (396.686255ms)",
    // ... and the OTHER newly-^ anchored shapes must equally resist a `✔`-prefixed passing NAME
    // quoting them (family #4/#5 prevention — the full-table audit, gap-tmux-leak-scan ... AC4):
    "✔ AC1 e2e — a `❯ test/foo.test.ts (3 tests | 1 failed)` vitest line flips red early (12ms)",
    "✔ AC2 e2e — a `Test Files 1 failed | 10 passed` summary line flips red (3.4ms)",
    "✔ AC3 e2e — a `FULL-SUITE-EXIT=1` marker flips red (2.1ms)",
    "# fail 0",
    "# cancelled 0",
  ]) {
    assert.equal(isFailureLine(line), false, `should not flag: ${line}`);
  }
});

// ── gap-suite-state-has-no-reason-axis-failed-aborted-infra: AC1/AC2/AC3 (reason axis) ─────────────


test("AC5 unit — isAbortLine matches the early-EXIT gate-WAIT shape, never a failure line", () => {
  for (const line of [
    "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO.",
    "resource gate says WAIT",
    "not running the full suite",
    // gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC4: a PRIOR run's single-flight flock
    // blocked this test.sh → 0 test output → NO correctness conclusion → must be aborted, not failed.
    "another full suite holds .git/full-suite.lock — not starting (single-flight lock; waited 600s). Re-run when it finishes.",
    "single-flight lock; waited 600s",
  ]) {
    assert.equal(isAbortLine(line), true, `should flag as abort: ${line}`);
  }
  for (const line of [
    "not ok 1 - boom",
    "# fail 2",
    "# cancelled 1",
    "FULL-SUITE-EXIT=1",
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
  ]) {
    assert.equal(isAbortLine(line), false, `a real failure line is NOT an abort line: ${line}`);
  }
});


// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible: AC1-AC5 ─────────────────────
// When run_static_checks fails (task-contract-check ratchet growth / test-framework-policy /
// test-isolation violations / a ceiling breach), test.sh aborts under `set -e` BEFORE the node --test
// phase: the stream shows the checker's violation output and a non-zero exit, but NONE of the
// FAILURE_PATTERNS. The pre-fix runner labelled this reason=failed with failures=[] empty — the
// 20:48Z readability gap (state=red + reason=failed + failures=[] looks like an interrupted run, the
// real cause only in the log). These tests pin the fix: reason="static-check" + machine-readable
// counts + violations fill failures[].


test("AC2 unit — isStaticCheckFailureLine matches static-check failure markers, never a passing summary or a test-failure line", () => {
  // FAILURE markers (a PASSING run never emits them):
  for (const line of [
    "ratchet ceiling: 6; new since baseline: 6 (tasks/a.md: V1, tasks/b.md: V2)", // the 20:48Z 真因 — K>0 = growth
    "ratchet ceiling: 6; new since baseline: 1",
    "task-contract-check: current violations (11) exceed the ratchet ceiling (6) — the list can only get SHORTER",
    "task-contract-check: DOD-SUITE-LINE BASELINE CEILING BREACH — grandfather list can only get SHORTER",
    "test-framework-policy-check: FAIL: 2 violation(s):",
    "test-isolation-check: FAIL: 3 ratchet violation(s):",
  ]) {
    assert.equal(isStaticCheckFailureLine(line), true, `should flag static-check failure: ${line}`);
  }
  // Passing-run / test-failure lines must NOT flag:
  for (const line of [
    "violations: 0 unique across 0 task(s); info findings ...", // passing summary (N=0)
    "violations: 11 unique across 9 task(s); info findings ...", // violations listed but K=0 below — passing
    "ratchet ceiling: 6; new since baseline: 0; resolved: 0", // K=0 — no growth, passing
    "VIOLATION: tasks/baselined.md — V1: what", // baselined violation on a passing run
    "not ok 1 - boom", // test failure
    "# fail 2",
    "FULL-SUITE-EXIT=1",
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
    "FAIL: some legacy assertion message", // legacy harness console noise
  ]) {
    assert.equal(isStaticCheckFailureLine(line), false, `should NOT flag: ${line}`);
  }
});


test("AC2 unit — extractStaticCheckDetail parses the VIOLATION/summary/ratchet lines into machine-readable fields", () => {
  const v = extractStaticCheckDetail(
    "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line",
  );
  assert.deepEqual(v, {
    violation: {
      file: "tasks/gap-foo.md",
      code: "V1",
      what: "Contract block missing invariant line",
      line: "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line",
    },
  });
  const s = extractStaticCheckDetail("violations: 11 unique across 9 task(s); info findings ...");
  assert.equal(s.violations, 11);
  assert.equal(s.taskCount, 9);
  const r = extractStaticCheckDetail("ratchet ceiling: 6; new since baseline: 6 (tasks/a.md: V1)");
  assert.equal(r.ceiling, 6);
  assert.equal(r.newSinceBaseline, 6);
  assert.equal(extractStaticCheckDetail("not ok 1 - boom"), null);
  assert.equal(extractStaticCheckDetail("# tests 2239"), null);
});
