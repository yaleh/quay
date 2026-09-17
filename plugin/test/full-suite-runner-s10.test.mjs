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
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 10/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { GREEN_SUITE, RUNNER, after, assert, execSync, fakeSuite, fakeTestShRecordingArgs, fs, isGitWorktree, os, path, poll, read, readState, releaseGate, runCli, runRunner, spawn, waitExit, writeStateGuarded } from "./helpers/full-suite-runner-shards-harness.mjs";

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
