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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 11/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { RUNNER, after, assert, fakeSuite, fs, lastRoundRecord, os, path, read, readState, readStateRunId, releaseGate, runRunner, sharedGreenShape, statePath, waitExit, writeStateGuarded } from "./helpers/full-suite-runner-shards-harness.mjs";

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
