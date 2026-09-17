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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, RUNNER, after, assert, fakeSuite, fakeTestShRecordingArgs, fs, os, path, poll, read, readState, runCli, runOnce, runRunner, spawn, statePath, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

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
