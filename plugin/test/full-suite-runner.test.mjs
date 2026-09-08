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
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isFailureLine,
  isAbortLine,
  isStaticCheckFailureLine,
  extractStaticCheckDetail,
  extractFailClosedChecker,
  extractNotEvaluatedChecker,
  buildStaticCheckFailures,
  isGitWorktree,
  readStateRunId,
  writeStateGuarded,
  segmentFailures,
  isStateAssertingTestFile,
  buildSystemdRunArgv,
  DEFAULT_SYSTEMD_RUN_LIMITS,
  parseSystemdRunLimits,
  systemdRunAvailable,
  parseSystemdConsumedLine,
  parseSystemdTimespanToSeconds,
  parseSystemdBytesToMb,
  readScopeConsumedLoad,
  parseCpuStatUsageUsec,
  parsePressureSomeTotal,
  resolveCgroupV2Dir,
  readPhaseCounters,
  PhaseDifferentialAccounting,
  snapshotAssertionSurface,
  detectAssertionSurfaceEdits,
  concurrentSuiteSlots,
  hostParallelism,
  countRunnerProcesses,
  effectiveParallelism,
  concurrentPhaseCount,
  countHeldSuiteLocks,
  defaultLaneCount,
  yieldedSuiteSlotCount,
  spliceConcurrency,
  stripConcurrencyFlags,
} from "../scripts/full-suite-runner.ts";
import { runOnce, classifyFailure, routeRed, shouldStopDispatch, shouldDispatchOnRed } from "../scripts/suite-state-trigger.ts";

import {
  REPO_ROOT,
  RUNNER,
  SUITE_SLOT_LIB,
  OUTER_TICK,
  INNER_TICK,
  CLOSURE_TASK,
  CLOSURE_DECOMP_TASK_ID,
  read,
  statePath,
  readState,
  redPayload,
  lastRoundRecord,
  fakeSuite,
  releaseGate,
  runRunner,
  waitExit,
  poll,
  GREEN_SUITE,
} from "./helpers/full-suite-runner-harness.mjs";

/**
 * A fake `<root>/scripts/test.sh` that records its args to `argsLog` and prints a green TAP summary.
 * Used to observe the runner's spliced --test-concurrency (the real test.sh's static checks / dist
 * build are irrelevant to the runner's splice).
 */
function fakeTestShRecordingArgs(root) {
  const argsLog = path.join(root, "args.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "$*" > '${argsLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  return { argsLog };
}

// ── gap-shape-assert-share-round: shared GREEN shape round (Tier-2 wall-clock) ────────────────
// Four GREEN-suite tests below each used to pay a FULL runner spawn to assert a SINGLE field of the
// same terminal green round (the exact suite-state shape / the green full-suite.log summary / the
// generation-guard read-back / the runner PID). They now share ONE runner round: a lazily-cached
// promise runs the runner once and exposes the state + log + child to every consumer. The
// assertions are unchanged (AC2: no test is deleted for time) — only the spawn is shared
// (AC1: 4 runRunner spawns → 1).
let _sharedGreenShapePromise = null;
async function sharedGreenShape() {
  if (!_sharedGreenShapePromise) {
    _sharedGreenShapePromise = (async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-shared-green-"));
      const { f, dir } = fakeSuite(GREEN_SUITE);
      const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
      const { code } = await waitExit(child);
      assert.equal(code, 0, "shared green run exits 0");
      return {
        root,
        dir,
        child,
        s: readState(root),
        log: fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8"),
      };
    })();
  }
  return _sharedGreenShapePromise;
}

// Clean up the shared round's temp root + fake-suite dir once, after all tests (the shared round
// may never have run if a `--test-name-pattern` filtered out every consumer — guard on the promise).
after(async () => {
  if (_sharedGreenShapePromise) {
    try {
      const g = await _sharedGreenShapePromise;
      fs.rmSync(g.root, { recursive: true, force: true });
      fs.rmSync(g.dir, { recursive: true, force: true });
    } catch {
      // the shared run failed; its temp dirs are best-effort
    }
  }
});

test("negative control — waitExit resolves bounded when the child ALREADY exited before the listener is mounted (exit event is NOT replayed)", async () => {
  // The load race (gap-full-suite-runner-test-waitExit-load-race): under load 15-25 a spawned child
  // can exit during an `await` gap BEFORE waitExit mounts its 'exit' listener. Node child_process
  // does not replay the 'exit' event to a late listener ⇒ the promise would hang forever. This
  // negative control reproduces exactly that ordering: the child exits AND its exit event fires
  // (exitCode is populated) before waitExit is called; waitExit must return bounded, not hang.
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await poll(() => child.exitCode !== null || child.signalCode !== null, { timeoutMs: 20000 });
  const start = Date.now();
  const { code, signal } = await waitExit(child);
  const elapsed = Date.now() - start;
  assert.equal(code, 0, "resolves with the cached exit code even though the event already fired");
  assert.equal(signal, null);
  assert.ok(elapsed < 5000, `bounded return, not a hang (took ${elapsed}ms)`);
});

test("AC1 — a green run writes the exact suite-state shape to .quay/full-suite-state.json", async () => {
  // gap-shape-assert-share-round: shares ONE runner round with the green-log / generation-guard /
  // pid shape tests below (4 spawns → 1) — it asserts only the state SHAPE, not a distinct verdict,
  // so the shared green round satisfies it identically.
  const { s } = await sharedGreenShape();
  assert.ok(s, "state file written");
  assert.deepEqual(
    Object.keys(s).sort(),
    [
      "durationMs",
      "finishedAt",
      "laneCount",
      "notEvaluatedCheckers",
      "pid",
      "runId",
      "runner",
      "scope",
      "startedAt",
      "state",
    ],
    "exact suite-state shape (AC1 + gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1 scope + gap-full-suite-state-race-last-write-wins-no-generation-guard runId + gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 pid + gap-not-evaluated-checkers-never-persisted notEvaluatedCheckers)",
  );
  assert.equal(s.state, "green");
  assert.equal(s.runner, "outer");
  assert.equal(s.laneCount, 8);
  assert.ok(s.runId && typeof s.runId === "string", "every state write carries a runId generation token");
  assert.ok(!Number.isNaN(Date.parse(s.startedAt)), "startedAt is ISO");
  // gap-batch-merge-gate-reads-stale-green: finishedAt is EPOCH SECONDS (the batch-merge freshness
  // gate's Contract measure `int(time.time() - finishedAt)` needs epoch, not ISO).
  assert.equal(typeof s.finishedAt, "number", "finishedAt is epoch seconds (suite_freshness measure)");
  assert.ok(s.finishedAt > 0, "finishedAt epoch seconds is positive");
  assert.equal(typeof s.durationMs, "number", "durationMs is the AC5 measurement hook");
  assert.ok(s.durationMs >= 0);
});

test("AC1 — an explicit --runner inner is recorded in BOTH the state and the verification-round (gap-runner-field-hardcoded-outer-not-measurement)", async () => {
  // The pre-fix code had NO --runner flag ⇒ `runner` was structurally pinned to "outer" (硬规则 4:
  // a field that can only ever take one value is not a measurement). Now an explicit --runner is
  // honored everywhere `base.runner` flows (state write + verification-round write share the value).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runner-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, runner: "inner" });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);

    const s = readState(root);
    assert.ok(s, "state file written");
    assert.equal(s.runner, "inner", "the state write records the explicit --runner inner");
    // The verification-round row carries the SAME runner (both reads of base.runner).
    const vr = lastRoundRecord(root);
    assert.ok(vr, "a verification-round row was appended");
    assert.equal(vr.runner, "inner", "the verification-round row records the same runner");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-verification-round-static-fail-no-record AC3 — --buckets <task-id> records taskId on the verification-round row", async () => {
  // A bucket-mode run (--buckets <task-id>) verifies ONE task's bucket subset, so the round row must
  // carry WHICH task it verified — the 31 historical static-check rows carried no taskId ⇒ unattributable
  // (a reader had to hand-dig the log to know what the red was about).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-bucket-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, buckets: "gap-test-bucket-task" });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vr = lastRoundRecord(root);
    assert.ok(vr, "a verification-round row was appended");
    assert.equal(vr.taskId, "gap-test-bucket-task", "the bucket-mode row carries taskId (AC3)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-perfile-cpu-cost-collection AC3 — the runner's verification-round perFile[] carries cpuMs (writer 之一)", async () => {
  // The writer path: a suite that emits __PERFILE__ lines WITH `cpu_ms=` lands perFile records whose
  // `cpuMs` is parsed (via the shared parsePerFileLines); a legacy line without `cpu_ms` leaves the
  // field ABSENT (never a fabricated 0). This is the full-suite-runner.ts half of the two-writer
  // contract (the pre-verified-round-record.ts half lives in its own test file).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-perfile-cpu-"));
  const { f, dir } = fakeSuite(
    'echo "__PERFILE__ duration_ms=123.456 /repo/a.test.mjs passed=true end_ms=1724000000123 cpu_ms=45.6"\n' +
      'echo "__PERFILE__ duration_ms=9 /repo/b.test.mjs passed=true"\n' +
      'echo "# tests 2"\necho "# pass 2"\necho "# fail 0"\necho "# cancelled 0"\nexit 0'
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec && Array.isArray(rec.perFile), "perFile[] present on the round row");
    const a = rec.perFile.find((r) => r.file.endsWith("a.test.mjs"));
    const b = rec.perFile.find((r) => r.file.endsWith("b.test.mjs"));
    assert.equal(a.cpuMs, 45.6, "cpu_ms is parsed into cpuMs on the runner's writer path");
    assert.equal(b.cpuMs, undefined, "legacy __PERFILE__ line → cpuMs absent (缺键 ≠ 0)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — an invalid --runner value fails closed (nothing written), not a silent fallback (gap-runner-field-hardcoded-outer-not-measurement)", async () => {
  // 硬规则 3b: an unreadable/unparseable input must NOT return a value identical to a valid one —
  // a garbage --runner must exit non-zero before any state write, never silently record "outer".
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runner-bad-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, runner: "not-a-layer" });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "invalid --runner exits 1 (usage error)");
    assert.equal(readState(root), null, "no state file is written on a --runner usage error");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — resource gate WAIT ⇒ the runner does NOT start and leaves the state file untouched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  // A prior GREEN suite verdict that MUST survive a WAIT byte-untouched (AC3: state stays running/green).
  const prior = {
    state: "green",
    runner: "outer",
    startedAt: "2026-08-05T06:00:00.000Z",
    finishedAt: "2026-08-05T06:05:00.000Z",
    durationMs: 300000,
    laneCount: 1,
  };
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(prior, null, 2) + "\n", "utf8");
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0", // force the REAL gate path, with seams
        RESOURCE_GATE_TEST_CPU_AVG10: "84.77", // WAIT (cpu stalled)
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        // Determinism for the OVERLOAD-WINDOW load seam (same convention as resource-gate.test.mjs
        // runGate): the real /proc/loadavg on a busy host under the full suite's own 4-lane load
        // would nondeterministically flip the new load_wait verdict and make this WAIT test
        // attributable to load instead of CPU. Pin the load LOW so the WAIT verdict is exactly the
        // CPU stall the test title names. gap-r274-flake-ac3-go-load-seam-unpinned.
        RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "WAIT ⇒ the runner exits non-zero (did not run)");
    const s = readState(root);
    assert.equal(s.state, "green", "state stays green (untouched) on WAIT");
    assert.equal(s.durationMs, 300000, "the prior state object is byte-untouched");
    assert.ok(!fs.existsSync(argsLog), "the suite was NEVER spawned on WAIT");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — resource gate GO ⇒ the runner starts (state=running then green)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3go-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "10", // GO (cpu calm)
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        // Determinism for the OVERLOAD-WINDOW load seam (same convention as resource-gate.test.mjs
        // runGate): the real /proc/loadavg on a busy host under the full suite's own 4-lane load
        // would nondeterministically flip the new load_wait verdict and make this GO test WAIT
        // (round r274 flake: the suite's own load pushed loadavg >= nproc×2, the gate returned WAIT,
        // the runner exited 1, assert.equal(code, 0) failed). Pin the load LOW so GO is a real GO.
        RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "GO ⇒ the runner runs and exits 0 on green");
    assert.equal(readState(root).state, "green");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned on GO");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — runner REFUSES to start when another runner is in flight (state=running + live pid) — round 131/132 storm fix", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inflight-"));
  // A live pid: this test process itself (process.kill(pid,0) succeeds for our own pid).
  const statePathFile = path.join(root, ".quay", "full-suite-state.json");
  fs.mkdirSync(path.dirname(statePathFile), { recursive: true });
  fs.writeFileSync(statePathFile, JSON.stringify({ state: "running", pid: process.pid, finishedAt: null, runId: "existing-run" }, null, 2));
  try {
    const res = await runCli(RUNNER, ["--root", root, "--state-dir", path.join(root, ".quay")]);
    assert.notEqual(res.code, 0, "runner must refuse to start when a live runner is in flight");
    assert.match(res.err, /another runner is already in flight/, `refusal message must name the in-flight runner:\n${res.err}`);
    assert.ok(!fs.existsSync(path.join(root, ".quay", "fake-test.log")), "must NOT spawn the suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — runner STARTS when state is terminal (green) even with a pid — no in-flight false positive", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inflight-terminal-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  const statePathFile = path.join(root, ".quay", "full-suite-state.json");
  fs.mkdirSync(path.dirname(statePathFile), { recursive: true });
  // terminal green: finishedAt set. The pid is stale/dead — but finishedAt != null means the round
  // is OVER regardless of pid, so isRunnerInFlight returns false.
  fs.writeFileSync(statePathFile, JSON.stringify({ state: "green", pid: 999999999, finishedAt: Date.now(), runId: "old-run" }, null, 2));
  try {
    const child = runRunner({ root });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "terminal state ⇒ the runner starts normally");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned on a terminal state");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test("AC2/AC3 e2e — a RED/killed round's archived log still carries stderr __OVERHEAD__ phase lines (red round OVERHEAD non-zero)", async () => {
  // gap-red-round-loses-overhead-phase-decomposition: kill-on-red truncates the main phase BEFORE
  // test.sh's full 9-segment emit, so a red round historically archived ZERO __OVERHEAD__ lines.
  // With the partial fallback, test.sh emits the COMPLETED segments (serial/lowconc) with partial=1
  // to stderr BEFORE the kill; the runner must archive those lines even though the round is red and
  // the child is killed. This fake suite writes the partial-phase lines to stderr, reds early, then
  // goes silent so the runner's red-grace kill fires — the __OVERHEAD__ count must be non-zero.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-red-"));
  const { f, dir } = fakeSuite(
    'echo "__OVERHEAD__ lock_overhead_ms=42 partial=1"\n' +
      'echo "__OVERHEAD__ serial_phase_ms=639986 partial=1" >&2\n' +
      'echo "__OVERHEAD__ lowconc_phase_ms=271616 partial=1" >&2\n' +
      'echo "not ok 1 - boom"\n' +
      "sleep 5\n",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "300", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "runner exits non-zero on the red");
    const s = readState(root);
    assert.equal(s.state, "red", "the failure flipped red");
    const log = read(path.join(root, ".quay", "full-suite.log"));
    // The red round's phase decomposition is present DESPITE the kill — the whole point of AC2/AC3.
    assert.match(log, /__OVERHEAD__ lock_overhead_ms=42 partial=1/, "stderr partial line reached the archived log");
    assert.match(log, /__OVERHEAD__ serial_phase_ms=639986 partial=1/, "completed serial phase present on the red round");
    assert.match(log, /__OVERHEAD__ lowconc_phase_ms=271616 partial=1/, "completed lowconc phase present on the red round");
    assert.ok((log.match(/__OVERHEAD__/g) || []).length >= 3, "the red round's __OVERHEAD__ count is non-zero");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-leak-"));
  // Candidate C merge semantics: the suite-tail leak scan reports a residual to the stream
  // (unconditional, no `&&` short-circuit in test.sh); the runner must recognize that FAIL line
  // as a REAL failure (not swallow it into the failures=[] catch-all).
  const { f, dir } = fakeSuite(
    'echo "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot; prefixes: skv-|session-liveness-|ol-tok-|enter-repro-):" >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "tmux-leak-scan FAIL flips state to red (candidate C — leak is a real residual)");
    assert.equal(s.reason, "failed");
    assert.ok(redPayload(s).length >= 1, `the red payload carries the leak-scan residual (AC5); got ${JSON.stringify(s)}`);
    assert.match(redPayload(s)[0].line, /tmux-leak-scan: FAIL/, "the leak-scan FAIL line is the recorded failure");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC3 — the inner stop-condition reads the outer suite-state; the inner doc has ZERO scripts/test.sh self-run literal", () => {
  const inner = read(INNER_TICK);
  // Inner reads the suite-state file and its `state` field (running/green => proceed, red => stop).
  assert.ok(inner.includes(".quay/full-suite-state.json"), "inner doc reads .quay/full-suite-state.json");
  assert.ok(inner.includes("`state`"), "inner doc reads the `state` field");
  assert.ok(inner.includes("running"), "inner doc handles running");
  assert.ok(inner.includes("green"), "inner doc handles green");
  assert.ok(inner.includes("red"), "inner doc handles red");
  // DoD grep: inner side has NO full-suite self-run literal.
  assert.ok(
    !inner.includes("scripts/test.sh"),
    "inner doc has NO scripts/test.sh literal (inner 零全量套件自跑 — DoD grep proof)",
  );
});

test("AC4 — the red-window ruling is explicit in the loop docs: RED => stop dispatch + hold fan-in", () => {
  const outer = read(OUTER_TICK);
  const inner = read(INNER_TICK);
  // The red state IS the stop-dispatch signal (outer writes it via the runner; inner reads it).
  assert.ok(outer.includes("stop-dispatch 信号"), "outer doc names the stop-dispatch signal (AC4)");
  assert.ok(outer.includes("红窗分诊"), "outer doc has the red-window triage section (AC4)");
  // GREEN/RUNNING => optimistic merge/dispatch (the point of eliminating the sync point).
  assert.ok(inner.includes("RUNNING 不等套件"), "inner doc proceeds on RUNNING (optimistic, AC4)");
  // RED => stop new dispatch AND hold completed-agent fan-in.
  assert.ok(
    inner.includes("暂缓已完成 agent 的 fan-in"),
    "inner doc holds fan-in on red (AC4) — only stopping dispatch lets a red tree keep accumulating",
  );
});

test("AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs", () => {
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(doc.includes("3 分钟"), `${name} doc has the 3-minute threshold`);
    assert.ok(doc.includes("durationMs"), `${name} doc names durationMs as the measurement hook`);
  }
});

test("AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync task and loop docs", () => {
  const closure = read(CLOSURE_TASK);
  assert.ok(
    closure.includes("gap-full-suite-belongs-to-outer-background-above-3-min"),
    "closure-sync task names the (a) suite block (cross-annotation)",
  );
  assert.ok(
    closure.includes(CLOSURE_DECOMP_TASK_ID),
    "closure-sync task names the (c) AC/evidence block",
  );
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(
      doc.includes(CLOSURE_DECOMP_TASK_ID),
      `${name} loop doc references the (c) closure-decomposition task id (AC7)`,
    );
  }
});

// ── Contract invoke (gap-full-suite-runner-marks-test-sh-gate-wait-as-failed) ──────────
// --wait-check is the ABORT-side twin of --fail-fast-check: it proves the gate-WAIT ⇒ aborted ⇒
// NO-stop-dispatch chain end-to-end via a runnable CLI control (the Contract's `measure` surface).

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

test("AC1 Contract invoke — `full-suite-runner.ts --wait-check` proves: test.sh gate-WAIT => red reason=aborted => NO stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--wait-check"]);
  assert.equal(code, 0, `--wait-check exits 0 when the ABORT chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /wait-check OK/, "verification line present");
  assert.match(out, /reason=aborted/, "gate-WAIT is reason=aborted (no correctness conclusion)");
  assert.match(out, /stopSignal=false/, "aborted-red must NOT stop dispatch (AC1)");
  assert.match(out, /SUITE-RED/, "SUITE-RED event still recorded (red noticed, routed by reason)");
});

// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible Contract invoke ───────────────
// --static-check-check is the STATIC-CHECK-side twin of --fail-fast-check (test-failure chain) and
// --wait-check (abort chain): it proves the 20:48Z shape (task-contract-check ratchet violations ⇒
// the suite aborts before tests with violations=N / ceiling=C / newSinceBaseline=K in the log) now
// lands in the state file as machine-readable fields consumers read WITHOUT hand-digging the log.

test("AC2 Contract invoke — `full-suite-runner.ts --static-check-check` proves: static-check violations => red reason=static-check => machine-readable counts + failures[] => stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--static-check-check"]);
  assert.equal(code, 0, `--static-check-check exits 0 when the static-check chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /static-check-check OK/, "verification line present");
  assert.match(out, /reason=static-check/, "reason is static-check (AC3, distinguishable from failed)");
  assert.match(out, /violations=11/, "violation count recorded (AC2)");
  assert.match(out, /ceiling=6/, "ceiling recorded (AC2)");
  assert.match(out, /newSinceBaseline=6/, "new-since-baseline recorded (AC2)");
  assert.match(out, /failures=2/, "failures[] carries the two violation details (AC4 candidate B)");
  assert.match(out, /stopSignal=true/, "static-check red stops dispatch (shared-gate failure)");
});


// ── gap-worktree-scoped-runs-consume-resources-but-produce-no-signal: AC1 scope + AC2 priority ──────

test("AC1 unit — isGitWorktree distinguishes the main repo (false) from a linked worktree (true)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wtrepo-u-"));
  const worktree = path.join(os.tmpdir(), `fsr-wt-u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    assert.equal(isGitWorktree(repo), false, "the primary checkout is NOT a worktree");
    assert.equal(isGitWorktree(path.join(repo, "does-not-exist")), false, "a non-git dir is NOT a worktree");
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });
    assert.equal(isGitWorktree(worktree), true, "a linked worktree IS a worktree");
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("AC1 — a real git-worktree run writes scope=worktree to its OWN .quay/full-suite-state.json (the observable signal)", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wtrepo-"));
  const worktree = path.join(os.tmpdir(), `fsr-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });

    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green in a worktree, got ${code}`);
    const s = readState(worktree);
    assert.ok(s, "the worktree's own state file is written (AC1 signal — waiters can read it)");
    assert.equal(s.scope, "worktree", "scope tags the worktree-origin suite (deferrable, not the main signal)");
    assert.equal(s.state, "green");
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — for a MAIN-scope root the runner passes --main-repo-priority: the gate lets the main-repo suite proceed over worktree load (cpu=70 would normally WAIT)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2p-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // cpu=70 is above the base limit (60) ⇒ WAIT normally. caller_scope=main + worktree_node_tests=6
    // ⇒ the AC2 priority override fires ONLY IF the runner passed --main-repo-priority (it does for a
    // non-worktree root). If the flag were absent the gate would WAIT and the suite would never spawn.
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "70",
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
        RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `AC2 priority: main-repo suite proceeds over worktree load; got ${code}`);
    assert.equal(readState(root).state, "green");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned (priority override let it through)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 negative control — a WORKTREE-scope caller is NOT let through the WAIT even when the runner passes the flag (worktree full-suite is deferrable)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2n-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // Same seams but caller_scope=worktree ⇒ the override requires caller_scope=main ⇒ WAIT stands.
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "70",
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_CALLER_SCOPE: "worktree",
        RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "worktree-scope caller stays WAIT (deferrable — no priority override)");
    assert.ok(!fs.existsSync(argsLog), "the suite was NOT spawned (worktree full-suite yields to the machine)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


// ── GENERATION GUARD (gap-full-suite-state-race-last-write-wins-no-generation-guard) ───────────────
// writeState() was last-write-wins with NO generation check: if two runners overlap briefly (even a
// superseded runner still finishing its cleanup), the older runner's red terminal state could land
// AFTER the newer runner's running write and silently clobber it — the 2026-08-06 06:27 v5 / 06:28 v6
// double-launch incident (stale red from the prior runner overwrote the current running state). The
// fix: every state write carries a per-run `runId`; the initial `running` write ESTABLISHES the
// generation, every later write is GUARDED and dropped if a different run now owns the file. These
// tests construct the race (AC1), prove the read side can distinguish the current round (AC2), and
// prove a single runner's normal writes are unaffected (AC4, negative control).

test("AC1 unit — the generation guard rejects a stale runner's write (stale runId ≠ current runId)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-guard-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  const mk = (state, runId, extra = {}) => ({
    state,
    runId,
    runner: "outer",
    startedAt: iso(),
    finishedAt: null,
    durationMs: null,
    laneCount: 4,
    scope: "main",
    ...extra,
  });
  try {
    // Runner A establishes the generation (its running write).
    fs.writeFileSync(file, JSON.stringify(mk("running", "run-A"), null, 2) + "\n", "utf8");
    // Runner B takes over (its running write is the NEW generation).
    fs.writeFileSync(file, JSON.stringify(mk("running", "run-B"), null, 2) + "\n", "utf8");
    // A's stale terminal write is REFUSED — it must not clobber B's current state.
    writeStateGuarded(file, { ...mk("red", "run-A", { reason: "failed" }) });
    let cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "running", "stale red did NOT overwrite the current running state (AC1)");
    assert.equal(cur.runId, "run-B", "the state still belongs to B's generation");
    // B's own terminal write SUCCEEDS — its generation is still current.
    writeStateGuarded(file, { ...mk("green", "run-B", { finishedAt: iso(), durationMs: 1 }) });
    cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "green", "the current runner's write lands");
    assert.equal(cur.runId, "run-B");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — real two-runner race: a stale runner finishing red does NOT overwrite the newer runner's green", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-race-"));
  const staleStarted = path.join(root, "stale-started");
  // Runner A is the one that will be SUPERSEDED: it runs a slow suite that turns red at the end.
  // gap-fake-suite-release-gate-sleep-zero — A's fixed 3s in-flight window is a release gate: A blocks
  // after touching `staleStarted` until the test releases it (after B has taken over), zeroing the
  // runner's hard wait while keeping A "in flight" during B's takeover.
  const gate = releaseGate(root, "stale");
  const { f: staleF, dir: staleDir } = fakeSuite(
    `touch "${staleStarted}"; ${gate.wait}; echo "not ok 1 - stale red (superseded runner)"; exit 1`,
  );
  // Runner B is the CURRENT runner: a fast green suite.
  const { f: freshF, dir: freshDir } = fakeSuite(GREEN_SUITE);
  try {
    // A starts first and establishes the generation.
    const childA = runRunner({ root, command: `bash ${staleF}`, laneCount: 4 });
    await poll(() => fs.existsSync(staleStarted), { timeoutMs: 8000 });
    await poll(() => readState(root)?.state === "running", { timeoutMs: 8000 });
    const runIdA = readState(root).runId;
    assert.ok(runIdA, "runner A's running state carries a runId");

    // B starts LATER and takes over (its running write is the new generation).
    const childB = runRunner({ root, command: `bash ${freshF}`, laneCount: 4 });
    const { code: codeB } = await waitExit(childB);
    assert.equal(codeB, 0, "the fresh runner exits 0 (green)");
    const afterB = readState(root);
    assert.equal(afterB.state, "green", "B's green is the current state");
    assert.ok(afterB.runId && afterB.runId !== runIdA, "B is a NEW generation (different runId)");
    const runIdB = afterB.runId;

    // A finishes RED — its stale red write must be dropped by the guard. Release A's suite now that B
    // has established its generation (A was held in flight the whole time).
    fs.writeFileSync(gate.release, "go", "utf8");
    const { code: codeA } = await waitExit(childA);
    assert.equal(codeA, 1, "the stale runner exits 1 (its suite was red)");

    const finalState = readState(root);
    assert.equal(finalState.state, "green", "the stale red did NOT overwrite the newer runner's green (AC1 two-runner race)");
    assert.equal(finalState.runId, runIdB, "the state still belongs to B's generation");
    assert.notEqual(finalState.runId, runIdA, "A's stale runId is gone from the state");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staleDir, { recursive: true, force: true });
    fs.rmSync(freshDir, { recursive: true, force: true });
  }
});

test("AC2 — the read side can tell 'is this red/green the current round' by its runId", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  const mk = (state, runId, extra = {}) => ({
    state,
    runId,
    runner: "outer",
    startedAt: iso(),
    finishedAt: null,
    durationMs: null,
    laneCount: 4,
    scope: "main",
    ...extra,
  });
  try {
    // The CURRENT round is round-B (the newest runner established it).
    fs.writeFileSync(file, JSON.stringify(mk("running", "round-B"), null, 2) + "\n", "utf8");
    // A stale runner (round-A) attempts its red — the guard drops it.
    writeStateGuarded(file, { ...mk("red", "round-A", { reason: "failed" }) });
    // A reader can verify the state on disk is CURRENT: its runId == the round it is waiting on.
    const waitingOnRound = "round-B"; // what the dispatch site observed at round start
    assert.equal(
      readStateRunId(file),
      waitingOnRound,
      "the state on disk carries the CURRENT round's runId — a reader can distinguish current vs stale (AC2)",
    );
    assert.notEqual(readStateRunId(file), "round-A", "the stale round's write never landed");
    // The current round's own terminal write still lands and reads back as the current round.
    writeStateGuarded(file, { ...mk("green", "round-B", { finishedAt: iso(), durationMs: 1 }) });
    assert.equal(readStateRunId(file), "round-B");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).state, "green");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — negative control: a single runner's normal writes are unaffected by the guard", async () => {
  // gap-shape-assert-share-round: shares ONE runner round with the state-shape / green-log / pid
  // shape tests (4 spawns → 1). It asserts only the read-side generation-guard consistency, so the
  // shared green round satisfies it identically.
  const { root, s } = await sharedGreenShape();
  assert.equal(s.state, "green", "single-runner terminal write lands normally (AC4)");
  const runId = s.runId;
  assert.ok(runId, "runId present on the single-runner state");
  // read-side consistency: the state's runId matches the current round (nothing was rejected)
  assert.equal(readStateRunId(statePath(root)), runId, "read-side sees the same single generation");
});

test("AC4 — a write over a legacy state (no runId on disk) is NOT blocked (fail-open, no conflict)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4l-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  try {
    // legacy state written before the generation guard existed: no runId field.
    fs.writeFileSync(
      file,
      JSON.stringify(
        { state: "green", runner: "outer", startedAt: iso(), finishedAt: iso(), durationMs: 1, laneCount: 8, scope: "main" },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    // A new run's terminal write is not blocked — a legacy file has no generation to protect.
    writeStateGuarded(file, {
      state: "red",
      reason: "failed",
      runId: "run-1",
      runner: "outer",
      startedAt: iso(),
      finishedAt: iso(),
      durationMs: 1,
      laneCount: 4,
      scope: "main",
    });
    const cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "red", "a run writing over a legacy state is not blocked (fail-open, AC4)");
    assert.equal(cur.runId, "run-1", "the new run's generation is established");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── AC6: runner-died terminal state (gap-full-suite-state-red-no-failure-detail-static-check-invisible) ──

test("AC6 — every state write carries the runner PID (the crash-watchdog's liveness anchor)", async () => {
  // gap-shape-assert-share-round: shares ONE runner round with the state-shape / green-log /
  // generation-guard shape tests (4 spawns → 1). It asserts only the pid field (and pid === the
  // shared round's runner child), so the shared green round satisfies it identically.
  const { s, child } = await sharedGreenShape();
  assert.equal(s.state, "green");
  assert.equal(typeof s.pid, "number", "the state carries the runner PID (AC6)");
  assert.ok(Number.isInteger(s.pid) && s.pid > 0, "pid is a positive integer");
  assert.equal(s.pid, child.pid, "pid is the RUNNER process's pid — the watchdog's liveness anchor");
});

test("AC6 — a runner that dies mid-run from an uncaughtException writes state=red reason=crashed (never stuck at running)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-crash-"));
  // The fake suite BLOCKS (sleep 3) so the child CANNOT close before the crash seam fires — a fast
  // suite would let the runner reach its green verdict and remove the crash handlers first (the
  // flake: under load the child's close raced the 30ms seam and the runner exited 0/green).
  const { f, dir } = fakeSuite('echo "running"; sleep 3; exit 0');
  try {
    // QUAY_TEST_CRASH_AFTER_RUNNING is a hermetic test seam: it throws an uncaught exception ~30ms
    // after the `running` write, exercising the AC6 in-process crash-terminal path deterministically.
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      env: { QUAY_TEST_CRASH_AFTER_RUNNING: "1" },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "a crashed runner exits 1");
    const s = readState(root);
    assert.equal(s.state, "red", "the runner died -> the state is terminal red, NOT running (AC6)");
    assert.equal(s.reason, "crashed", "the terminal reason is crashed (AC6) — distinguishable from aborted/failed");
    assert.equal(typeof s.pid, "number", "the crashed state still carries the runner pid");
    assert.ok(s.finishedAt !== null && s.finishedAt !== undefined, "crashed state has a finishedAt (terminal, not early)");
    assert.equal(typeof s.durationMs, "number", "crashed state has a durationMs");
  } finally {
    // gap-full-suite-runner-crash-test-rmSync-enotempty-flaky — the runner spawns a DETACHED
    // suite-load-sampler that writes <root>/.quay/suite-load-<runId>.jsonl.pid at startup and is never
    // reaped on the crash path (process.exit). Under load the sampler's delayed .pid write lands
    // DURING this teardown rmSync — it mkdirs `.quay` back into `root` after rmSync already rmdir'd it,
    // so `rmdir(root)` fails ENOTEMPTY. (A detached child's cwd does NOT block rmdir; the cause is the
    // .pid write, not the orphan suite child — leftover evidence: /tmp/fsr-crash-* each hold exactly
    // one suite-load-*.jsonl.pid.) maxRetries/retryDelay re-list and delete the recreated `.quay` + .pid;
    // the sampler exits on its first state check (state=red), so the .pid write is one-shot.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});


test("gap-test-detail-load-timeseries — the runner spawns a load sampler that writes a per-run timeseries and stops when the suite ends", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-"));
  // gap-fake-suite-release-gate-sleep-zero — the fixed 1.5s sampler window is a release gate: the
  // suite blocks until the test has observed the sampler's first sample, then the test releases it.
  const gate = releaseGate(root, "loadsampler");
  const { f, dir } = fakeSuite(
    gate.wait +
      '\n' +
      'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  const loadDir = path.join(root, ".quay");
  const loadFiles = () => {
    try {
      return fs.readdirSync(loadDir).filter((n) => n.startsWith("suite-load-") && n.endsWith(".jsonl"));
    } catch {
      return [];
    }
  };
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2, env: { QUAY_SUITE_LOAD_SAMPLER_INTERVAL: "0.2" } });

    // Wait (bounded) for the sampler to write its first sample while the run is in flight.
    let name = null;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const files = loadFiles();
      if (files.length > 0) {
        name = files[0];
        lines = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean);
        if (lines.length >= 1) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(name, "the sampler wrote .quay/suite-load-<runId>.jsonl during the run");
    assert.ok(lines.length >= 1, `the timeseries has >=1 sample (got ${lines.length})`);

    for (const line of lines) {
      const o = JSON.parse(line);
      assert.equal(typeof o.t, "number", "every sample carries a numeric timestamp");
      assert.ok("loadavg" in o, "every sample carries loadavg");
      assert.ok("cpu_stall" in o, "every sample carries cpu_stall");
      assert.ok("mem_avail" in o, "every sample carries mem_avail");
    }

    // The file is keyed by the runner's runId (read from the state the runner wrote).
    const s = readState(root);
    assert.ok(s && typeof s.runId === "string" && s.runId, "state carries the run's runId");
    assert.equal(name, `suite-load-${s.runId}.jsonl`, "timeseries file name = suite-load-<runId>.jsonl");

    // Suite ends → the runner writes a terminal state → the detached sampler stops (never resident).
    fs.writeFileSync(gate.release, "go", "utf8"); // release — the sampler has already logged its first sample
    await waitExit(child);
    const pidFile = path.join(loadDir, `${name}.pid`);
    assert.ok(fs.existsSync(pidFile), "sampler wrote its pid sidecar");
    const samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    assert.ok(Number.isInteger(samplerPid) && samplerPid > 0, "pid sidecar holds a real pid");

    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try {
        process.kill(samplerPid, 0);
      } catch {
        gone = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after the suite ended (never a resident idle process)");

    // The timeseries stops growing once sampling stops.
    const countAfter = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once sampling stops");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-mechanical-fan-in-per-suite-runid-unified AC3 — --run-id is honored verbatim; default falls back to a fresh randomUUID", async () => {
  // OVERRIDE: an explicit --run-id (the mechanical fan-in per-suite id) becomes the canonical runId
  // in BOTH the state and the round record (the record ↔ suite-load-<runId>.jsonl join key). The fake
  // suite also captures the QUAY_RUN_ID env the runner delivers, to pin the shortRunId truncation
  // (a LONG --run-id must still deliver a ≤8-char short id — the tmux socket sun_path length constraint).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runid-override-"));
  const { f, dir } = fakeSuite(
    'printf "%s" "$QUAY_RUN_ID" > quay-run-id.txt\n' +
      'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2, runId: "mfi-gap-test-1788022868-abc123" });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on a green suite");
    const s = readState(root);
    assert.equal(s.runId, "mfi-gap-test-1788022868-abc123", "--run-id is used verbatim as the state runId (not a fresh randomUUID)");
    const rec = lastRoundRecord(root);
    assert.equal(rec.runId, "mfi-gap-test-1788022868-abc123", "the round record carries the SAME canonical runId (record ↔ telemetry join key)");
    // shortRunId length constraint: the runner derives its per-run namespace id by truncating the runId
    // to 8 chars — a LONG --run-id must not leak a long id into QUAY_RUN_ID (tmux socket sun_path bound).
    const delivered = fs.readFileSync(path.join(root, "quay-run-id.txt"), "utf8");
    assert.equal(delivered, "mfigapte", `the child received the 8-char truncated short id (got ${JSON.stringify(delivered)})`);
    assert.ok(delivered.length <= 8, "the delivered QUAY_RUN_ID is ≤8 chars (tmux socket sun_path length constraint)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // DEFAULT: no --run-id ⇒ a fresh randomUUID (an independent run stays self-naming — no regression).
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runid-default-"));
  const faked = fakeSuite(
    'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root: root2, command: `bash ${faked.f}`, laneCount: 2 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on a green suite");
    const s = readState(root2);
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.runId), `default runId is a randomUUID (got ${s.runId})`);
  } finally {
    fs.rmSync(root2, { recursive: true, force: true });
    fs.rmSync(faked.dir, { recursive: true, force: true });
  }
});

test("gap-suite-load-sampler-orphan-process AC2 — an UNCLEAN host exit (SIGKILL, no terminal state) reaps the sampler via host-death detection", async () => {
  // The state-driven stop only fires when SOMEONE writes a terminal state / removes the state file.
  // A host that dies UNCLEANLY (SIGKILL — uncatchable; worker mid-exit exception; fan-in wrapper
  // killed before its `rm -f`) leaves the state file stuck at "running" and the sampler must still
  // stop. This test drives that branch directly: the host backgrounds the sampler then never writes
  // a terminal state — the host is SIGKILLed, and the sampler must detect the host's death (its
  // ppid changes when the kernel reparents the orphan) and exit on its own.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-orphan-"));
  const stateFile = path.join(root, "sampler.state.json");
  const outFile = path.join(root, "suite-load-orphan.jsonl");
  const samplerPath = path.join(REPO_ROOT, "plugin", "scripts", "suite-load-sampler.ts");
  fs.writeFileSync(stateFile, JSON.stringify({ state: "running" }), "utf8");
  // Host = a bash wrapper that backgrounds the sampler then sleeps, modeling the suite host the
  // sampler must follow. It has NO terminal-state / rm -f step — the unclean-exit branch.
  const host = spawn(
    "bash",
    [
      "-c",
      `node --no-warnings --experimental-strip-types "${samplerPath}" --state-file "${stateFile}" --out-file "${outFile}" --run-id "orphan-test" --interval 0.2 & sleep 60`,
    ],
    { stdio: "ignore", detached: true },
  );
  host.unref();
  const pidFile = `${outFile}.pid`;
  try {
    // Wait (bounded) for the sampler to write its first sample + pid sidecar while the host is alive.
    let samplerPid = 0;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { lines = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean); } catch { lines = []; }
      try { samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { samplerPid = 0; }
      if (lines.length >= 1 && samplerPid > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(lines.length >= 1, "the sampler wrote >=1 sample while its host was alive");
    assert.ok(samplerPid > 0, "the sampler wrote its pid sidecar");

    // Unclean host death: SIGKILL the host wrapper (no terminal state, no rm -f). The sampler must
    // detect the host's death (ppid change) and exit on its own — the AC2 orphan-reaping invariant.
    process.kill(host.pid, "SIGKILL");

    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try { process.kill(samplerPid, 0); } catch { gone = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after its host was SIGKILLed (host-death reaping, never an orphan)");

    // The timeseries stops growing once the host is dead (no post-mortem pollution).
    const countAfter = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once the host is dead");
  } finally {
    try { process.kill(host.pid, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gap-suite-load-sampler-early-red-truncates-load-curve AC2/AC3 — the sampler keeps sampling through an EARLY-RED state (finishedAt null) and stops only once finishedAt is written", async () => {
  // The finishedAt-driven stop (gap-suite-load-sampler-early-red-truncates-load-curve): the runner
  // writes state="red" + finishedAt:null on the FIRST failure line while the suite keeps running to
  // its natural end. The old state-driven stop (`state !== "running"`) truncated a red round's load
  // curve at first-failure. This test drives that branch directly: a state file stuck at early-red
  // (state="red", finishedAt:null) must NOT stop the sampler — it keeps sampling (AC2, the fix) —
  // and stops cleanly once finishedAt is written (AC3, 结束即停 / no idle-spin, green-round parity).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-earlyred-"));
  const stateFile = path.join(root, "sampler.state.json");
  const outFile = path.join(root, "suite-load-earlyred.jsonl");
  const samplerPath = path.join(REPO_ROOT, "plugin", "scripts", "suite-load-sampler.ts");
  // Early-red: state=red but finishedAt=null — the suite is still running to its natural end.
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ state: "red", reason: "failed", runId: "early-red-test", finishedAt: null }),
    "utf8",
  );
  // Host = a bash wrapper that backgrounds the sampler then sleeps, modeling the suite host.
  const host = spawn(
    "bash",
    [
      "-c",
      `node --no-warnings --experimental-strip-types "${samplerPath}" --state-file "${stateFile}" --out-file "${outFile}" --run-id "early-red-test" --interval 0.2 & sleep 60`,
    ],
    { stdio: "ignore", detached: true },
  );
  host.unref();
  const pidFile = `${outFile}.pid`;
  try {
    // AC2 — the sampler must KEEP sampling while finishedAt is null even though state=red (the
    // early-red continuation). Wait (bounded) for >=2 samples: the old state-driven stop would exit
    // on first sight of the red state and write ZERO samples, so this assertion is the regression
    // fence (it fails on the pre-fix code, passes on the fix).
    let samplerPid = 0;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { lines = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean); } catch { lines = []; }
      try { samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { samplerPid = 0; }
      if (lines.length >= 2 && samplerPid > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(samplerPid > 0, "the sampler wrote its pid sidecar");
    assert.ok(lines.length >= 2, "the sampler kept sampling through the early-red state (finishedAt null, state=red)");

    // AC3 — the terminal write sets finishedAt; the sampler must then stop (结束即停 / no idle-spin).
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ state: "red", reason: "failed", runId: "early-red-test", finishedAt: Date.now() / 1000 }),
      "utf8",
    );

    let stopped = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try { process.kill(samplerPid, 0); } catch { stopped = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(stopped, "the sampler exited after finishedAt was written (terminal stop, no idle-spin)");

    // No post-terminal samples: the timeseries stops growing once finishedAt is set.
    const countAfter = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once finishedAt is set");
  } finally {
    try { process.kill(host.pid, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
