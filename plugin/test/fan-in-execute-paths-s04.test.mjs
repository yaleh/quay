// @test-group engine
// fan-in-execute-paths.test.mjs — gap-fan-in-execute-three-unverified-paths: the three UNVERIFIED
// hot points of plugin/workflows/fan-in-execute.js, exercised through the REAL invocation path
// (判据3 — NOT fixture-only pure-function mocks; the AC78 lesson: "改 workflow 的唯一有效验证=实调").
//
//   REAL-INVOCATION harness: every test first vm-EXECUTES the actual workflow file
//   (fan-in-execute.js) with the workflow-runtime globals (args/phase/log/agent) mocked, so the
//   script's own code runs and PRODUCES the exact subagent prompt it would emit — a parser/runtime
//   break in the file (the AC78 `meta is not defined` class, or a template-literal backtick blowup)
//   fails every test, not just a source read. Then each hot point's bash block is extracted from
//   the REAL emitted prompt and EXECUTED against real git / real filesystem state:
//
//   ① code_delta 正则 (:61-65)  — run the REAL fork/merge-base/diff/code_delta pipeline in a real
//       temp git repo (doc/code/test deltas) and assert the AC75 rerun/skip classification.
//   ② --agent-id 自找 (承重点②) — run the REAL selfloc bash (candidates/count/ls -t) against a fake
//       ~/.claude tree replaying the DIR-127/DIR-128 concurrency (flat trap a017ce6b7fab53eb9),
//       assert it deterministically picks the workflow-run subagent, NOT the flat trap; zero
//       candidates ⇒ fail-closed exit 2.
//   ③ flip sed 失败路径 (承重点③) — run the REAL flip guard against real task files: normal flip,
//       line-shape mismatch (status:Ready) ⇒ exit 2 + FATAL (no silent green), body annotation
//       'status: ready——注解' preserved (anchored $, no corruption).
//   ④ flip AC 完成闸 (gap-fan-in-flip-no-ac-completion-check) — run the REAL flip block against real
//       task files: AC 未全勾（gap-ac72 形态真样本）⇒ exit 2 + FATAL + 不翻 done; AC/DoD 段缺失 ⇒
//       exit 2 NOT-EVALUATED + 不翻 done（无法评估 ≠ 合格）; 剩余未勾均为（待外部）⇒ 翻 done; ③ 行形
//       检查与 AC 闸并列（两检查都过才翻，AC 闸在行形检查之后、sed 之前）。
//   ⑤ anti-drift-touches 守卫 (gap-anti-drift-touches-zero-coverage-fast-mode) — run the REAL step-1
//       anti-drift block from the emitted prompt against a real temp git repo (task worktree after the
//       step-1 merge): a task whose ACTUAL diff touches a file OUTSIDE its declared ## Touches ⇒ the
//       block HARD-FAILs (exit 2 + FATAL + ANTI-DRIFT HARD FAIL — the AC2 负控制: 现真值=不会, 修复后应红);
//       a task whose actual diff is fully within its declared Touches ⇒ the block stays green (AC3).
//
// Run:
//   scripts/test.sh plugin/test/fan-in-execute-paths.test.mjs
//   scripts/test.sh --for-task gap-fan-in-execute-three-unverified-paths --allow-thin
//   node --test plugin/test/fan-in-execute-paths.test.mjs

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/6 (16 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, extractBlockFromPrompts, fs, os, path, promptContaining, runBash, runWorkflow, runnerHermeticEnv, spawn, spawnSync, symlinkRuntimeTrees, vm, waitForMarkerOrDeath } from "./helpers/fan-in-execute-paths-harness.mjs";

test("⑧ stage-2 wait block — completes the capture post-fields (cpu/end/wall/load/lane/suite_exit) on exit-marker hit", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-poll", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-poll", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  assert.ok(poll.includes("suite_exit_marker"), "wait block must read the exit marker");
  assert.ok(poll.includes("POLL=done SUITE_EXIT"), "wait block must emit the done + exit result");
  assert.ok(poll.includes("cpu_source"), "wait block must compute cpu_source (gnu-time or not-wired)");
  assert.ok(poll.includes("cpu_user_s"), "wait block must compute cpu_user_s (the gnu-time %U column — gap-verification-round-cpu-split-not-recorded)");
  assert.ok(poll.includes("cpu_sys_s"), "wait block must compute cpu_sys_s (the gnu-time %S column)");
  assert.ok(poll.includes("wall_ms"), "wait block must compute wall_ms from the pre-suite start_ms");
  assert.ok(poll.includes("lane_count"), "wait block must compute lane_count");
  assert.ok(poll.includes("suite_exit"), "wait block must record suite_exit into the capture");
  assert.ok(poll.includes("不要做任何等待决策"), "wait block must not make any waiting decision (fixed command)");
});


test("⑧ stage-2 wait — the SINGLE stage-2 agent drives the GREEN path: suite-started → wait-loop → mechanical steps (flip/ff/bracket)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-green", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-green", mergeTarget: "develop", maxSuitePolls: 5 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "green", ffOk: true, developHead: "d1", worktreeHead: "h1", agentIdUsed: "a1", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 (wait loop + mechanicals)
    ],
  });
  assert.equal(result.outcome, "green", "stage-2 wait must land a green suite through the mechanical steps");
  assert.equal(result.ffOk, true);
  // The stage-2 prompt (the ONE agent) must carry BOTH the wait block AND all mechanical steps
  // (gap-subagent-turn-budget-13min-falsified: the wait lives in the stage-2 agent, not a separate
  // short-lived poll agent per round).
  const p2 = promptContaining(prompts, "# flip-block-start");
  assert.ok(p2.includes("POLL=not-done"), "stage-2 prompt must carry the wait block (single agent loops <600s Bash)");
  assert.ok(p2.includes("per-task-suite-record.ts"), "stage-2 must write the per-task-suite record (step 4.5)");
  assert.ok(p2.includes("ff-merge.ts --task"), "stage-2 must run the ff-merge (step 5)");
  assert.ok(p2.includes("--worktree /tmp/wt"), "stage-2 must pass --worktree to the ff-merge (stale-lock reclaim scope, gap-worktree-remove-orphans-probes)");
  assert.ok(p2.includes("# bracket-close-block-start"), "stage-2 must close the telemetry bracket (step 5.5)");
  assert.ok(p2.includes("worktree-process-reaper.ts"), "stage-2 must reap live processes under the worktree before removal (gap-worktree-remove-orphans-probes)");
  assert.ok(p2.includes('"$reaper" --worktree /tmp/wt'), "stage-2 must scope the reaper to the worktree being removed");
  assert.ok(p2.includes("git worktree remove"), "stage-2 must clean up the worktree after ff");
  // 取假: the old shape spawned a SEPARATE short-lived poll agent per round (prompts.length >= 3 with a
  // standalone poll prompt); the new shape has the wait block INSIDE the stage-2 prompt (2 prompts total).
  assert.equal(prompts.length, 2, "green path = phase1 + stage2 (no separate poll agent)");
});


test("⑧ stage-2 wait — RED suite ⇒ stage-2 returns suite-red ⇒ Fix agent relaunches detached ⇒ re-dispatched stage-2 lands", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-red", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-red", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },                 // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                          // stage 2: suite RED (no mechanicals)
      { relaunched: true, worktreeHead: "h2", failuresFixed: ["fix-x"], note: "" },                                 // Fix agent
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched (waits again + mechanicals)
    ],
  });
  assert.equal(result.outcome, "green", "a red suite must be fixed + re-verified before landing");
  assert.ok(prompts.some((p) => p.includes("suite-fix 阶段")), "a Fix-agent prompt must be emitted for a red suite");
  assert.ok(prompts.some((p) => p.includes("你读失败日志")), "the Fix prompt must read the suite log failures");
});


test("⑧ stage-2 wait — suite process dies before writing .exit ⇒ stage-2 returns suite-pid-dead ⇒ relaunch agent re-starts detached ⇒ re-dispatched stage-2 lands (gap-suite-wait-bash-stale-pid-poll AC2)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-piddead", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-piddead", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },                 // phase 1
      { outcome: "suite-pid-dead", suiteExit: null, ffOk: false },                                                   // stage 2: pid dead, no exit marker
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "relaunch after silent death" },             // relaunch agent
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });
  assert.equal(result.outcome, "green", "a silently-dead suite must be relaunched + re-verified before landing");
  assert.ok(prompts.some((p) => p.includes("suite-relaunch 阶段")), "a relaunch-agent prompt must be emitted for a dead-pid suite");
  assert.ok(prompts.some((p) => p.includes("静默死亡")), "the relaunch prompt must name the silent-death reason");
  assert.ok(prompts.some((p) => p.includes("FIX_SCOPE_VERDICT")), "the relaunch prompt must still carry the fix-scope gate");
});


test("⑧ stage-2 wait — suite never completes within the stage-2 poll cap ⇒ stage-2 returns suite-not-done ⇒ red (bounded wait, no infinite hang)", async (t) => {
  const { result } = await runWorkflow({
    args: { task: "gap-test-tb-cap", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-cap", mergeTarget: "develop", maxSuitePolls: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },  // phase 1
      { outcome: "suite-not-done", suiteExit: null, ffOk: false },                                    // stage 2: never completed within its loop cap
    ],
  });
  assert.equal(result.outcome, "red", "a suite that never completes must fail closed");
  assert.equal(result.ffOk, false);
  assert.ok(result.message.includes("poll cap"), `message must cite the poll cap: ${result.message}`);
});


test("⑧ stage-2 wait — ff failure (develop advanced during suite) ⇒ script re-runs phase 1 (bounded) and lands on the retry", async (t) => {
  const { prompts, result, logs } = await runWorkflow({
    args: { task: "gap-test-tb-ff", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-ff", mergeTarget: "develop", maxSuitePolls: 5, maxFfRetries: 2 },
    agentResults: [
      // attempt 1
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "ff-retry", ffOk: false, note: "develop advanced" },                               // stage 2 ff FAILED
      // attempt 2 (script re-runs phase 1)
      { outcome: "suite-started", suitePid: 222, codeDelta: "code", worktreeHead: "h2", note: "" }, // phase 1 (retry)
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2
    ],
  });
  assert.equal(result.outcome, "green", "a develop-advanced ff failure must retry from phase 1 and land");
  assert.equal(prompts.length, 4, "2× (phase1 + stage2)");
  assert.ok(logs.some((l) => l.includes("ff-retry")), "log must record the ff-retry re-run");
  // The phase-1 prompt (retry) must carry the stale-flip revert preamble.
  assert.ok(prompts[2].includes("重试遗留翻转处理"), "the retry phase-1 prompt must carry the stale-flip revert");
});


test("⑧ stage-2 wait — ff-retry exhausted (maxFfRetries) ⇒ red + anti-livelock message (SPEC §7 bound)", async (t) => {
  const { result } = await runWorkflow({
    args: { task: "gap-test-tb-ffx", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-ffx", mergeTarget: "develop", maxSuitePolls: 5, maxFfRetries: 2 },
    agentResults: [
      // attempt 1
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "ff-retry", ffOk: false, note: "develop advanced" },
      // attempt 2 — ffAttempts becomes 2, 2 >= maxFfRetries(2) ⇒ red
      { outcome: "suite-started", suitePid: 222, codeDelta: "code", worktreeHead: "h2", note: "" },
      { outcome: "ff-retry", ffOk: false, note: "develop advanced again" },
    ],
  });
  assert.equal(result.outcome, "red", "exhausted ff retries must fail closed");
  assert.equal(result.ffOk, false);
  assert.ok(result.message.includes("anti-livelock"), `message must cite anti-livelock: ${result.message}`);
});


test("⑧ turn-budget REAL — a real detached suite (setsid) + the real poll block complete the capture (code_delta 非空 ⇒ suite 跑 + 机械步骤的输入齐备)", async (t) => {
  // AC1 取假 REAL invocation: 构造 step2 code_delta 非空 ⇒ 阶段 1 的 suite-launch 块把 suite 以 detached
  // 方式跑起来（长生命周期载体），轮询块补全 capture post 字段（suite_exit=0）——阶段 2 据此能执行
  // flip/ff/bracket。整条链用【真实 bash】驱动（判据3，不是 fixture mock）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-reallaunch-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-real-launch";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  // A fake suite that exits 0 (sleeps 1s so the detached launch + marker both have time to work).
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nsleep 1\nexit 0\n");
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves
  // (untracked ⇒ never in `git diff --name-only`; scripts/ already exists with the fake test.sh).
  symlinkRuntimeTrees(dir, {});

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, `/tmp/fan-in-suite-${task}.pid`, codeDeltaFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-tb-real", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");

  // Run the REAL launch block (cwd = the worktree). code_delta 非空 ⇒ the full-suite branch must fire.
  const launchRun = runBash(launchBlock, { cwd: dir, timeout: 30_000, env: runnerHermeticEnv() });
  assert.equal(launchRun.status, 0, `launch block failed: ${launchRun.stderr}`);
  assert.match(launchRun.stdout, /SUITE_OUTCOME=started/, `code_delta non-empty must start the full suite, got: ${launchRun.stdout}`);

  // Real poll: wait for the exit marker (the suite is detached; ~1s fake + the launch's ~3s confirm).
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) { if (fs.existsSync(marker)) seen = true; else await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(seen, "the detached suite must write its exit marker");

  // Run the REAL poll block (completes the capture post-fields).
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { cwd: dir, timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  // Source the completed capture and verify every field the phase-2 record needs.
  const capture = fs.readFileSync(`/tmp/fan-in-suite-${task}.env`, "utf8");
  for (const [re, name] of [
    [/^full_suite_ran=true$/m, "full_suite_ran"],
    [/^suite_exit=0$/m, "suite_exit"],
    [/^start_iso=/m, "start_iso"],
    [/^end_iso=/m, "end_iso"],
    [/^wall_ms=\d+$/m, "wall_ms"],
    [/^cpu_s=/m, "cpu_s"],
    [/^cpu_source=/m, "cpu_source"],
    [/^cpu_user_s=/m, "cpu_user_s"],
    [/^cpu_sys_s=/m, "cpu_sys_s"],
    [/^load=/m, "load"],
    [/^lane_count=\d+$/m, "lane_count"],
    [/^suite_head=/m, "suite_head"],
  ]) {
    assert.match(capture, re, `capture must carry ${name} (phase-2 入账输入)`);
  }
});


test("⑧ log-rotation REAL — relaunching the detached suite ROTATES /tmp/fan-in-suite-<task>.log to .prev and marks the current round (gap-fan-in-suite-log-cross-relaunch-reuse AC1/AC2)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-logrot-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-logrot";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  // A fake suite that emits a ROUND-TAGGED __PERFILE__ line (round-1 vs round-2 output distinguishable),
  // sleeps 1s (so the detached launch + exit marker both have time to work), and exits 0. The round tag
  // is a /tmp counter the test reads back to know which round the CURRENT log represents.
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"),
    `#!/usr/bin/env bash
count=$(cat /tmp/fan-in-suite-${task}.round 2>/dev/null || echo 0)
count=$((count+1))
echo "$count" > /tmp/fan-in-suite-${task}.round
echo "__PERFILE__ duration_ms=1.\${count} \${PWD}/round\${count}.test.mjs passed=true"
echo "__GROUP__ concurrency=2 files=1 sum_ms=10 floor_ms=10 capped=0"
sleep 1
exit 0
`);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves.
  symlinkRuntimeTrees(dir, {});

  const roundFile = `/tmp/fan-in-suite-${task}.round`;
  const suiteLog = `/tmp/fan-in-suite-${task}.log`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, marker, `/tmp/fan-in-suite-${task}.time`, suiteLog, `${suiteLog}.prev`, roundFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { try { fs.rmSync(codeDeltaFile, { force: true }); } catch (_) { /* best-effort */ } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-logrot", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");

  const waitRound = async (round) => {
    for (let i = 0; i < 150; i++) {
      const c = fs.existsSync(roundFile) ? Number(fs.readFileSync(roundFile, "utf8").trim()) : 0;
      if (c >= round && fs.existsSync(marker)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timeout waiting for round ${round} marker`);
  };

  // Round 1 (initial launch).
  const r1 = runBash(launchBlock, { cwd: dir, timeout: 30_000, env: runnerHermeticEnv() });
  assert.equal(r1.status, 0, `round-1 launch failed: ${r1.stderr}`);
  assert.match(r1.stdout, /SUITE_OUTCOME=started/, "code_delta non-empty must start the full suite");
  await waitRound(1);
  const log1 = fs.readFileSync(suiteLog, "utf8");
  // gap-fan-in-red-bucket-run-not-recorded: the runner now owns the log (--log-file "w" truncate), so there
  // is NO __FANIN_SUITE_START__ marker — the current log IS the current round's suite stream (teed by the runner).
  assert.ok(log1.includes("__PERFILE__ duration_ms=1.1 "), "round-1 suite output is in the log");
  assert.ok(log1.includes("__GROUP__ concurrency=2"), "round-1 __GROUP__ lane line present");

  // Round 2 (relaunch — the contaminated path this task fixes: same path reused without rotation).
  const r2 = runBash(launchBlock, { cwd: dir, timeout: 30_000, env: runnerHermeticEnv() });
  assert.equal(r2.status, 0, `round-2 launch failed: ${r2.stderr}`);
  assert.match(r2.stdout, /SUITE_OUTCOME=started/, "relaunch must start the suite again");
  await waitRound(2);

  const log2 = fs.readFileSync(suiteLog, "utf8");
  assert.ok(log2.includes("__PERFILE__ duration_ms=1.2 "), "round-2 suite output is in the CURRENT log");
  assert.ok(!log2.includes("__PERFILE__ duration_ms=1.1 "), "round-1 output must NOT be in the current log (rotated away — 误读旧轮 eliminated)");

  // The .prev file preserves the PREVIOUS round (diagnostics + the marker-slicing contrast).
  const prev = fs.readFileSync(`${suiteLog}.prev`, "utf8");
  assert.ok(prev.includes("__PERFILE__ duration_ms=1.1 "), ".prev preserves round-1 content");
  assert.ok(!prev.includes("__PERFILE__ duration_ms=1.2 "), ".prev must NOT contain the current round");

  // AC2 negative control ON THE PRODUCTION CARRIER: reader slicing by marker distinguishes current vs
  // historical round from the REAL rotated log (parsePerFileLines reads only the last-marker round).
  const { parsePerFileLines } = await import("../scripts/measure-trend-check.ts");
  const recs = parsePerFileLines(log2);
  assert.deepEqual(
    recs.map((r) => [r.file.split("/").pop(), r.passed]),
    [["round2.test.mjs", true]],
    "the reader slices to the current (round-2) round from the real relaunched log",
  );
});



test("⑧ split — the poll block parses a gnu-time '%U %S' line into cpu_user_s/cpu_sys_s (real values, not estimates)", async (t) => {
  // gap-verification-round-cpu-split-not-recorded AC1/AC3 — the poll block splits the SAME gnu-time line
  // whose sum becomes cpu_time_s. Seeded with the finding's real values (user=4414.230 sys=6899.653):
  // the capture must carry both columns and the writer's record must satisfy user+sys ≈ cpu_time_s.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-split-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-split";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const timeFile = `/tmp/fan-in-suite-${task}.time`;
  const logFile = `/tmp/fan-in-suite-${task}.log`;
  t.after(() => { for (const f of [capture, marker, timeFile, logFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  // Seed the pre-suite capture fields, a green exit marker, a readable suite log, and a REAL gnu-time line.
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "start_iso=2026-08-20T00:00:00.000Z",
    "start_ms=1755652800000",
    "suite_head=" + "0".repeat(40),
    `suite_log_file=${logFile}`,
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(marker, "exit=0\nend_ms=1755652801000\nend_iso=2026-08-20T00:00:01.000Z\n", "utf8");
  fs.writeFileSync(timeFile, "4414.230 6899.653\n", "utf8");
  fs.writeFileSync(logFile, "ok\n", "utf8");

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-tb-split", mergeTarget: "develop" },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const r = runBash(pollBlock, { cwd: dir });
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${r.stdout}`);

  const out = fs.readFileSync(capture, "utf8");
  assert.match(out, /^cpu_user_s=4414\.230$/m, "capture carries cpu_user_s from the gnu-time %U column");
  assert.match(out, /^cpu_sys_s=6899\.653$/m, "capture carries cpu_sys_s from the gnu-time %S column");
  assert.match(out, /^cpu_s=11313\.883$/m, "cpu_s stays the sum (user+sys) — AC1 keeps the existing field");
  assert.match(out, /^cpu_source=gnu-time$/m, "cpu_source=gnu-time for a real measurement");
});


// ── ⑧ time-file 跨 relaunch 复用（gap-fan-in-suite-time-file-cross-relaunch-reuse AC1/AC2）──────────
// THE DEFECT: the wait block's cpu_s calc was guarded only by `[ -f "$suite_time_file" ]` (missing the
// full_suite_ran=true guard that the adjacent lane_count calc carries). An isolate-rerun
// (full_suite_ran=false, ISOLATE_LAUNCH does NOT write a .time file) reading a stale
// /tmp/fan-in-suite-<task>.time left over from a prior full-suite run produced a non-null cpu_s ⇒
// per-task-suite-record rejects --cpu-time-s with --full-suite-ran=false (AC6「skip 不消耗 CPU」) ⇒ HARD
// FAIL, no flip, no ff (gap-ac148 blocked). FIX: (AC1) guard cpu_s by full_suite_ran=true; (AC2)
// ISOLATE_LAUNCH rm -f "$suite_time_file" (aligned with SUITE_LAUNCH). Sibling log-file variant
// gap-fan-in-suite-log-cross-relaunch-reuse already done — this is the time-file variant.


test("⑧ time-file guard — isolate-rerun (full_suite_ran=false) with a stale .time file leaves cpu_s=null (gap-fan-in-suite-time-file-cross-relaunch-reuse AC1)", async (t) => {
  // AC1 能取假 (negative control): seed the exact cross-relaunch residue (full_suite_ran=false + a stale
  // gnu-time .time file), run the REAL poll block. The fix's full_suite_ran guard must leave cpu_s=null;
  // before the fix the `[ -f ]`-only guard would read the stale file → cpu_s=11313.883 (red).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-timeguard-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-timeguard";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const timeFile = `/tmp/fan-in-suite-${task}.time`;
  const logFile = `/tmp/fan-in-suite-${task}.log`;
  t.after(() => { for (const f of [capture, marker, timeFile, logFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  // Seed an isolate-rerun capture (full_suite_ran=false) + a STALE gnu-time file (the residue this fix
  // targets) + a green exit marker.
  fs.writeFileSync(capture, [
    "full_suite_ran=false",
    "skip_reason=isolate-rerun-load-sensitive",
    "start_iso=2026-08-20T00:00:00.000Z",
    "start_ms=1755652800000",
    "suite_head=" + "0".repeat(40),
    `suite_log_file=${logFile}`,
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(marker, "exit=0\nend_ms=1755652801000\nend_iso=2026-08-20T00:00:01.000Z\n", "utf8");
  fs.writeFileSync(timeFile, "4414.230 6899.653\n", "utf8");
  fs.writeFileSync(logFile, "ok\n", "utf8");

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-timeguard", mergeTarget: "develop" },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const r = runBash(pollBlock, { cwd: dir });
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${r.stdout}`);

  const out = fs.readFileSync(capture, "utf8");
  assert.match(out, /^cpu_s=null$/m, "isolate-rerun must NOT read the stale .time file — cpu_s stays null (full_suite_ran guard)");
  assert.match(out, /^cpu_source=not-wired$/m, "cpu_source stays not-wired (no CPU captured for an isolate-rerun)");
  assert.match(out, /^cpu_user_s=null$/m, "cpu_user_s stays null (no gnu-time columns read)");
  assert.match(out, /^cpu_sys_s=null$/m, "cpu_sys_s stays null (no gnu-time columns read)");
});


test("⑧ time-file rm REAL — ISOLATE_LAUNCH removes the stale .time file at launch (gap-fan-in-suite-time-file-cross-relaunch-reuse AC2)", async (t) => {
  // AC2 能取假 (REAL mechanism): extract the REAL ISOLATE_LAUNCH block, pre-seed a stale gnu-time .time
  // file (the cross-relaunch residue), run the block — the rm at the top must delete it. Revert the rm
  // ⇒ the stale file survives ⇒ red.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-isorm-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-isorm";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nsleep 1\nexit 0\n");
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);

  // Extract the REAL ISOLATE_LAUNCH block (a RED sequence drives the fix prompt carrying it).
  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-isorm", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");

  // Pre-seed the cross-relaunch residue: a stale .time file (the gnu-time file a prior full-suite run left).
  const timeFile = `/tmp/fan-in-suite-${task}.time`;
  const captureFile = `/tmp/fan-in-suite-${task}.env`;
  const isolateFiles = `/tmp/fan-in-scope-isolate-${task}.files`;
  const logFile = `/tmp/fan-in-suite-${task}.log`;
  const pidFile = `/tmp/fan-in-suite-${task}.pid`;
  t.after(() => { for (const f of [timeFile, captureFile, isolateFiles, logFile, pidFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  fs.writeFileSync(timeFile, "4414.230 6899.653\n", "utf8");

  // Run the isolate-launch block (async: it launches a detached suite that sleeps 1s).
  const launchProc = spawn("bash", ["-c", isolate], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let launchOut = "";
  launchProc.stdout.on("data", (d) => { launchOut += d; });
  launchProc.stderr.on("data", (d) => { launchOut += d; });
  const launchExit = await new Promise((resolve) => { launchProc.on("exit", (code, sig) => resolve({ code, sig })); });

  assert.equal(launchExit.code, 0, `isolate-launch block failed: ${launchOut}`);
  assert.ok(!fs.existsSync(timeFile), "ISOLATE_LAUNCH must rm the stale .time file at launch (the cross-relaunch residue is gone)");
});



/** Is `pid` a live process? (kill -0 semantics; EPERM counts as alive — someone else's process.) */

/**
 * Wait until `markerPath` EXISTS or the detached suite (`pid`) is GONE — whichever comes first.
 *
 * Event-driven on purpose (gap-suite-not-robust-at-high-derived-concurrency): `fs.watch` on the
 * marker's directory is the completion source, and the suite's own pid is the failure detector. A
 * wall-clock budget takes NO part in the decision — a loaded host legitimately takes ~10x the idle
 * time, and reading that as "the lock is broken" was the defect this replaces.
 *
 * Returns "marker" | "dead" | "guard". `guardMs` is a HANG-GUARD only (explicitly overridable via
 * FANIN_TEST_MARKER_GUARD_MS) so a stuck suite reds this test instead of hanging the runner; it is
 * ~60x the measured idle cost of the fake suite below.
 */

// ── ⑧⑩ 锁等待负控制（gap-single-flight-lock-timeout-double-value AC1/AC2）────────────────────────
// THE DEFECT: test.sh 的 single-flight 锁有两套超时值（FULL_SUITE_LOCK_TIMEOUT 默认 600 + fan-in 的
// suiteLockTimeoutSecs 900 覆盖），且 600s 线已被常态化的 819-1619s full-bucket suite 跨越 ⇒ 活 suite
// 被 fail-closed「not starting」误杀 + 重试放大。
// FIX: test.sh 的锁等待改为【无界排队】（flock crash-autorelease 保证死持有者不泄漏槽），fan-in 不再经
// env 传 FULL_SUITE_LOCK_TIMEOUT（无双值、无 900 字面量）。
// ① 结构负控制（本缺陷的负控制）：launch/isolate 块不得携带 FULL_SUITE_LOCK_TIMEOUT / suite_lock_timeout
//    —— revert 本修复（重新经 env 传 / 重引入 suiteLockTimeoutSecs）⇒ 此断言红。
// ② REAL 机制（wait-and-acquire）：fake test.sh 忠实复现 test.sh 的【无界】锁等待语义（S=2 槽、非阻塞
//    try + 无界等待 + 永不 fail-closed）。两槽全忙时套件【等待】释放而【非】fail-closed。
// ── the event-driven wait's OWN falsification (AC1: it must be able to return non-"marker") ────────

test("⑧⑩ wait AC1 — marker-or-liveness driven, NOT a clock: dead suite ⇒ 'dead' without burning the budget; a marker appearing mid-wait ⇒ 'marker' (fs.watch); alive+no marker ⇒ 'guard'", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-wait-"));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  // A provably DEAD pid: spawn and reap a real child.
  const child = spawn("bash", ["-c", "exit 0"], { stdio: "ignore" });
  await new Promise((r) => child.on("exit", r));
  const deadPid = child.pid;

  // 1) dead pid + no marker ⇒ "dead" — and it must be detected as an EVENT, not by waiting out a
  //    budget (this is the whole point: no 15s/60s burn, and no false red on a slow host).
  const t0 = Date.now();
  assert.equal(await waitForMarkerOrDeath(path.join(dir, "never.exit"), deadPid, 60_000), "dead");
  assert.ok(Date.now() - t0 < 5_000, `a dead suite must be an event, not a timeout (took ${Date.now() - t0}ms)`);

  // 2) alive pid, marker arrives WHILE waiting ⇒ "marker" via fs.watch (not via the poll).
  const lateMarker = path.join(dir, "late.exit");
  const pending = waitForMarkerOrDeath(lateMarker, process.pid, 60_000);
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(lateMarker, "exit=0\n");
  assert.equal(await pending, "marker");

  // 3) alive pid + no marker ⇒ "guard" (the ONLY place a clock participates, and it is a hang-guard).
  assert.equal(await waitForMarkerOrDeath(path.join(dir, "never2.exit"), process.pid, 700), "guard");
});


test("⑧⑩ 锁等待负控制 — suite-launch 不再携带 FULL_SUITE_LOCK_TIMEOUT (无双值); REAL 槽忙→释放后获取而非 fail-closed", async (t) => {
  // RED 序列驱动 vm 实执行：fix agent prompt 携带 ISOLATE_LAUNCH 块（SUITE_LAUNCH 在 phase-1 prompt）。
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-lockwait", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-lockwait", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                          // stage 2: RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },                       // Fix agent (carries ISOLATE_LAUNCH)
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });

  // ── ① 结构负控制（无双值）──
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(!launch.includes("FULL_SUITE_LOCK_TIMEOUT"), "suite-launch must NOT pass FULL_SUITE_LOCK_TIMEOUT (single source = test.sh unbounded queue wait)");
  assert.ok(!launch.includes("suite_lock_timeout"), "suite-launch must NOT define a suite_lock_timeout override");
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");
  assert.ok(!isolate.includes("FULL_SUITE_LOCK_TIMEOUT"), "isolate-rerun launch must NOT pass FULL_SUITE_LOCK_TIMEOUT");
  assert.ok(!isolate.includes("suite_lock_timeout"), "isolate-rerun launch must NOT define a suite_lock_timeout override");

  // ── ② REAL wait-and-acquire ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-lockwait-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-lockwait-real";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);

  // Fake test.sh: faithful single-flight lock semantics (S=2 slots, non-blocking try, UNBOUNDED wait —
  // never fail-closed). The REAL scripts/test.sh is far too heavy for a unit test.
  const fakeTest = [
    "#!/usr/bin/env bash",
    "set -u",
    'lock_base="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/full-suite.lock"',
    "fds=()",
    'for i in 0 1; do exec {fd}>"${lock_base}.${i}"; fds+=("$fd"); done',
    'held=""',
    "idx=0",
    'for fd in "${fds[@]}"; do if flock -n "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    'if [ -z "$held" ]; then',
    '  while [ -z "$held" ]; do',
    "    idx=0",
    '    for fd in "${fds[@]}"; do if flock -w 1 "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    "  done",
    "fi",
    'echo "acquired full-suite single-flight slot $held"',
    "sleep 1",
    "exit 0",
    "",
  ].join("\n");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), fakeTest);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add fake test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves.
  symlinkRuntimeTrees(dir, {});

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  const tmpFiles = [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, codeDeltaFile];
  t.after(() => { for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts: prompts2 } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-lockwait-real", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts2, "# suite-launch-block-start", "# suite-launch-block-end");

  // Hold BOTH slots in a detached holder; killing it releases the flock (fd close auto-releases).
  const holder = spawn("bash", ["-c",
    `cd ${dir}; exec 8>"${dir}/.git/full-suite.lock.0"; flock -n 8 || exit 8; ` +
    `exec 9>"${dir}/.git/full-suite.lock.1"; flock -n 9 || exit 9; ` +
    `touch ${dir}/slots-held; sleep 30`], { stdio: "ignore" });
  t.after(() => { try { holder.kill("SIGKILL"); } catch (_) {} });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, "slots-held")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(path.join(dir, "slots-held")), "holder must hold both slots before the suite launch");

  // Launch the REAL SUITE_LAUNCH block (no env seam — the unbounded wait lives in test.sh). Spawn
  // asynchronously (spawnSync would block until the detached suite's inherited stdout pipe closes), verify
  // the suite is STILL WAITING (no exit marker — it did NOT fail-closed), free a slot, then await the
  // block's ~1s confirm. The suite must acquire the freed slot and run to exit 0.
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const launchStartedMs = Date.now();
  const launchProc = spawn("bash", ["-c", launchBlock], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: runnerHermeticEnv() });
  let launchOut = "";
  launchProc.stdout.on("data", (d) => { launchOut += d; });
  launchProc.stderr.on("data", (d) => { launchOut += d; });
  await new Promise((r) => setTimeout(r, 1500)); // let the suite start waiting
  assert.ok(!fs.existsSync(marker), "the suite must WAIT while both slots are held — no exit marker (never fail-closed)");
  holder.kill("SIGKILL");                       // free a slot WHILE the suite is waiting
  const launchExit = await new Promise((resolve) => { launchProc.on("exit", (code, sig) => resolve({ code, sig })); });
  assert.equal(launchExit.code, 0, `launch block failed: ${launchOut}`);

  // ── THE WAIT IS EVENT-DRIVEN, NOT A WALL-CLOCK BUDGET ───────────────────────────────────────────
  // (gap-suite-not-robust-at-high-derived-concurrency, 2026-09-16 — this REPLACES the 15s literal
  // that the previous task bumped to 60s. A bump is the wrong shape: the quantity being waited on is
  // "a real suite, on a real host, under whatever load the host has", which has NO upper bound that
  // a literal can honestly claim. Measured on the self-hosted tokyo-alpha runner at suite concurrency
  // 128: the same healthy suite took 18.2s to reach the marker where an idle 16-core dev box takes
  // ~2s — so every literal is either a false failure on a loaded host or a liveness assumption
  // disguised as a timeout.)
  //
  // The decision variable is now an EVENT or a PROCESS STATE, never a duration:
  //   • the marker appears  ⇒ DONE (fs.watch on its directory is the event source);
  //   • the detached suite's pid is GONE and the marker is still absent ⇒ the suite died without
  //     acquiring — a REAL failure, reported as `dead` (not as a timeout).
  // `FANIN_TEST_MARKER_GUARD_MS` remains as a HANG-GUARD only: it exists so a genuinely stuck suite
  // fails this test rather than hanging the runner, is explicitly configurable, and is ~60x the idle
  // cost / ~6.6x the worst measured loaded cost. While the suite is ALIVE the wait does not stop.
  // The pidfile is a HINT, never a contract (the launch block itself falls back to a pure .exit poll
  // when it cannot be read — SUITE_LAUNCH leaves `suite_pid` empty). It is trusted here ONLY when it
  // is demonstrably FRESH, i.e. written after this launch began: a stale leftover in the same /tmp
  // (measured locally: an unremovable root-owned file made the launch block's own `rm -f` fail, so
  // it held a long-dead pid) would otherwise be read as "the suite died" and the wait would fail a
  // healthy run.
  const pidFile = `/tmp/fan-in-suite-${task}.pid`;
  let suitePid = NaN;
  try {
    if (fs.statSync(pidFile).mtimeMs >= launchStartedMs - 1000) {
      suitePid = Number((fs.readFileSync(pidFile, "utf8").match(/^(\d+)/) ?? [])[1]);
    }
  } catch { /* no pidfile ⇒ marker-only wait (documented fallback) */ }
  const waitOutcome = await waitForMarkerOrDeath(marker, suitePid);
  assert.equal(waitOutcome, "marker",
    `the waiting suite must acquire the freed slot and write its exit marker (wait outcome=${waitOutcome}; "dead" ⇒ the suite process vanished before acquiring, "guard" ⇒ it stayed alive past the hang-guard with no marker)`);
  const markerText = fs.readFileSync(marker, "utf8");
  const log = fs.readFileSync(`/tmp/fan-in-suite-${task}.log`, "utf8");
  assert.match(markerText, /exit=0/, `the suite must run to exit 0 after acquiring the freed slot, got: ${markerText.trim()}`);
  assert.match(log, /acquired full-suite single-flight slot/, "the suite must log its slot acquisition");
  assert.ok(!log.includes("not starting"), "the suite must NOT fail-closed (no 'not starting' lock refusal)");
});

// ── ⑧ durationMs 真墙钟一致性（gap-fan-in-suite-duration-poll-granularity-inflation）─────────────────
// THE DEFECT: wall_ms = end_ms − start_ms where end_ms was captured at POLL-DISCOVERY time (when the
// poll agent first sees the exit marker). Under a 60s poll interval the suite's true end lands between
// polls ⇒ durationMs systematically inflated 0-60s (round232: marker mtime 23:07:41.89, true 609.1s,
// ledger recorded 674.2s — +65.1s, straddling the AC101 600s gate). FIX: the detached suite writes its
// TRUE end (end_ms/end_iso) into the exit marker at the moment it exits; the poll only READS it.


test("⑧ duration-wiring — the poll block reads end_ms/end_iso from the marker (the suite TRUE end), falling back to poll-discovery only for an old-format marker", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-poll", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-poll", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  // The fix: the poll reads the suite's TRUE end from the exit marker (written by the detached suite).
  assert.ok(poll.includes("marker_end_ms=$(sed -n 's/^end_ms=//p'"), "poll must read end_ms from the exit marker (the suite's TRUE end, not poll-discovery)");
  assert.ok(poll.includes("marker_end_iso=$(sed -n 's/^end_iso=//p'"), "poll must read end_iso from the exit marker");
  // ...and falls back to poll-discovery ONLY when the marker has no end_ms (old-format marker).
  assert.match(poll, /end_ms=\$\{marker_end_ms:-/, "end_ms must default to marker_end_ms (fallback = poll-discovery)");
  assert.match(poll, /end_iso=\$\{marker_end_iso:-/, "end_iso must default to marker_end_iso");
  // The OLD buggy form (end_ms = date +%s%3N unconditionally at poll time) must NOT be the assignment.
  assert.ok(!/^end_ms=\$\(date \+%s%3N\)$/m.test(poll), "end_ms must NOT be taken unconditionally from poll-discovery time");
  // The capture write must still record end_ms/end_iso/wall_ms.
  assert.ok(poll.includes("end_ms=%s"), "poll must still write end_ms into the capture");
  assert.ok(poll.includes("wall_ms"), "poll must still compute wall_ms");
});


test("⑧ duration REAL — wall_ms equals the suite TRUE wall clock (marker end_ms − start_ms), NOT inflated by poll-discovery latency (AC1 取假)", async (t) => {
  // THE FALSIFICATION: a real detached suite (sleep 1s → exit 0); AFTER its marker already exists we
  // deliberately delay the poll ~5s (a poll interval gap). The OLD code's poll-time `date +%s%3N` would
  // fold that whole 5s gap into wall_ms (the 0-60s inflation). The FIX must yield wall_ms ≈ the suite's
  // true duration, not the poll-discovery time.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-duration-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-duration";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nsleep 1\nexit 0\n");
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);
  // The detached launch now runs full-suite-runner.ts — symlink the REAL plugin tree so it resolves.
  symlinkRuntimeTrees(dir, {});

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, `/tmp/fan-in-suite-${task}.pid`, codeDeltaFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: dir, runId: "fm-tb-duration", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const launchRun = runBash(launchBlock, { cwd: dir, timeout: 30_000, env: runnerHermeticEnv() });
  assert.equal(launchRun.status, 0, `launch block failed: ${launchRun.stderr}`);
  assert.match(launchRun.stdout, /SUITE_OUTCOME=started/, `code_delta non-empty must start the full suite, got: ${launchRun.stdout}`);

  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const capture = `/tmp/fan-in-suite-${task}.env`;
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) { if (fs.existsSync(marker)) seen = true; else await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(seen, "the detached suite must write its exit marker");

  // Read the TRUE end the detached suite recorded in the marker + the start from the capture.
  const markerText = fs.readFileSync(marker, "utf8");
  const markerEndMs = Number((markerText.match(/^end_ms=(\d+)/m) || [])[1]);
  const markerEndIso = (markerText.match(/^end_iso=(.+)$/m) || [])[1];
  assert.ok(Number.isFinite(markerEndMs), `marker must carry the suite's TRUE end_ms (the fix's source of truth), got:\n${markerText}`);
  assert.ok(markerEndIso, `marker must carry the suite's TRUE end_iso, got:\n${markerText}`);
  const captureText = fs.readFileSync(capture, "utf8");
  const startMs = Number((captureText.match(/^start_ms=(\d+)/m) || [])[1]);
  assert.ok(Number.isFinite(startMs), "capture must carry start_ms");
  const trueDurationMs = markerEndMs - startMs;
  assert.ok(trueDurationMs > 0, `true suite duration must be positive, got ${trueDurationMs}`);

  // ⛔ THE FALSIFICATION: deliberately delay the poll ~5s AFTER the suite already ended. The OLD poll
  // would add this whole gap to wall_ms (the recorded +65.1s class of inflation).
  await new Promise((r) => setTimeout(r, 5000));

  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { cwd: dir, timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  const after = fs.readFileSync(capture, "utf8");
  const wallMs = Number((after.match(/^wall_ms=(\d+)/m) || [])[1]);
  const recordedEndIso = (after.match(/^end_iso=(.+)$/m) || [])[1];
  assert.ok(Number.isFinite(wallMs), "capture must carry wall_ms");
  assert.equal(wallMs, trueDurationMs, `wall_ms must equal the suite's TRUE duration (marker end_ms − start_ms); the ~5s deliberate poll delay must NOT inflate it (old code would record ≈ ${trueDurationMs + 5000})`);
  assert.equal(recordedEndIso, markerEndIso, `end_iso must be the suite's TRUE end (marker), not the poll time`);
  // Sanity: the true 1s-sleep suite's wall_ms must sit in the seconds-range, NOT the ~6s inflated range.
  assert.ok(wallMs < trueDurationMs + 2000, `wall_ms ${wallMs} must not exceed the true duration ${trueDurationMs} by more than a small margin (no poll-latency inflation)`);
});
