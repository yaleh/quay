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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/8 (11 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { GREEN_SUITE, RUNNER, assert, fakeSuite, fakeTestShRecordingArgs, fs, lastRoundRecord, os, path, poll, readState, runCli, runRunner, sharedGreenShape, spawn, statePath, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

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


test("gap-perfile-memory-cost-collection-missing AC2 — the runner's verification-round perFile[] carries memPeakKb (writer 之一)", async () => {
  // The SAME two-writer contract as the cpu sibling above, for the peak-memory dimension: this is the
  // full-suite-runner.ts half; pre-verified-round-record.ts's half lives in its own test file. Both go
  // through the shared parsePerFileLines, so a line WITHOUT mem_peak_kb leaves the field ABSENT
  // (缺键 ≠ 0) rather than landing a fabricated 0.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-perfile-mem-"));
  const { f, dir } = fakeSuite(
    'echo "__PERFILE__ duration_ms=123.456 /repo/a.test.mjs passed=true end_ms=1724000000123 cpu_ms=45.6 mem_peak_kb=185728"\n' +
      'echo "__PERFILE__ duration_ms=9 /repo/b.test.mjs passed=true cpu_ms=7"\n' +
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
    assert.equal(a.memPeakKb, 185728, "mem_peak_kb is parsed into memPeakKb on the runner's writer path");
    assert.equal(a.cpuMs, 45.6, "the cpu dimension is unaffected by the memory field's presence");
    assert.equal(b.memPeakKb, undefined, "__PERFILE__ line without mem_peak_kb → memPeakKb absent (缺键 ≠ 0)");
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
