// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, RECONCILE_INTERVAL_SECS_DEFAULT, RESIDENT_INTERVAL_MS_DEFAULT, after, assert, branchHeadSubjectAsync, continueStateForTask, continueStateForTaskAsync, countBranchCommitsAsync, counterNodeE, fs, makeGitRoot, makeRoot, parseIntervalMs, parseReconcileIntervalSecs, path, readOutcomeLines, readRoundLines, rmSafe, runGit, runMechanicalFanIn, spawn, spawnResident, spawnSync, waitFor, workerArgvForTask, workerArgvForTaskAsync, workerPromptForTaskAsync, worktreePathsForTaskAsync, worktreePresentForTaskAsync, writeProfileCarrier, writeTaskFile, writeTouchedTask } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC3 (cold-start-refresh) — per-pass observation: no one-time `const coldInflight` snapshot outside the loop; reassigned each pass", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.doesNotMatch(src, /const\s+coldInflight\s*=/, "AC3: the one-time `const coldInflight` snapshot is gone (⛔ frozen snapshot ⇒ fake in-flight forever)");
  assert.match(src, /let\s+coldInflight\s*=\s*new Set/, "coldInflight is a mutable per-pass binding, not a frozen snapshot");
  assert.match(src, /coldInflight\s*=\s*await\s+enumerateColdStartInflightAsync\(rootDir\)/, "coldInflight is re-observed via enumerateColdStartInflightAsync each pass (async — 不阻塞地板)");
});

// ── gap-fan-in-remove-archguard-gate：archguard 结构闸已从机械 fan-in 移除（降级为按需命令）──────
// 源面负控制见 archguard-structural-gate-fan-in.test.mjs（engine 组）；本文件只保证 runMechanicalFanIn
// 的 step 序列里不再有 archguard-structure（⛔ 不在此重复 worker-driver.ts 的接点断言）。

// ── gap-worker-driver-stopreason-latch-permanent-stop ──────────────────────────────────────────────
// stopReason 一旦赋值永不复位 ⇒ 瞬时闸拒绝（resource-gate-wait）被永久 latch ⇒ 同一 driver 进程内
// 恢复不可能 ⇒ 1h48m 零派发（234 槽·分钟）。修法：WAIT（瞬时）不 latch、下一轮重读 stopCondition；
// 终态（mcp-halt）才 latch；running.length===0 且瞬时 WAIT 时不退出、等 --interval 重读。AC1-3 逐条取假。


test("parseIntervalMs — default 30000; small value; invalid ⇒ default (fail-closed to the default cadence)", () => {
  assert.equal(RESIDENT_INTERVAL_MS_DEFAULT, 30000);
  assert.equal(parseIntervalMs(undefined), RESIDENT_INTERVAL_MS_DEFAULT);
  assert.equal(parseIntervalMs("25"), 25);
  assert.equal(parseIntervalMs("abc"), RESIDENT_INTERVAL_MS_DEFAULT, "invalid ⇒ default");
  assert.equal(parseIntervalMs("-5"), RESIDENT_INTERVAL_MS_DEFAULT, "negative ⇒ default");
});

// ── gap-worker-driver-reconcile-interval：协调地板（SPEC §5.5）───────────────────────────────────────
// 边沿触发（worker 退出）+ 存储决策 = 1h48m 停摆形态。地板 = 至少每 reconcileMs 协调一次，边沿事件全丢
// 也降级「慢但正确」而非「静默停摆」。AC1（地板触发 + 生产载体）/ AC2（全边沿失效仍派发）逐条取假。


test("parseReconcileIntervalSecs — default 300s (conservative); small; invalid ⇒ default", () => {
  assert.equal(RECONCILE_INTERVAL_SECS_DEFAULT, 300);
  assert.equal(parseReconcileIntervalSecs(undefined), 300_000, "default = 300s → 300000ms");
  assert.equal(parseReconcileIntervalSecs("5"), 5_000, "5s → 5000ms");
  assert.equal(parseReconcileIntervalSecs("abc"), 300_000, "invalid ⇒ default");
  assert.equal(parseReconcileIntervalSecs("-3"), 300_000, "negative ⇒ default");
});


test("AC1 (gap-worker-driver-reconcile-interval) — in-process timer re-coordinates every ≤N s with zero worker-exit edge events (carrier = worker-round.jsonl, ⛔ not --json)", async (t) => {
  const root = makeGitRoot("reconcile-ac1");
  t.after(() => rmSafe(root));
  writeTaskFile(root, "gap-r", "done");
  // ⛔ spawn WITHOUT --json: the floor's observable carrier must be .quay/worker-round.jsonl
  // (writeRound → appendRoundToFile 无条件写文件，与 --json 无关——生产 argv 无 --json，硬规则 3b）。
  const child = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-r'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-r\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)", // 挂起：worker 退出这个边沿事件永不发生
    "--concurrency", "1",
    "--reconcile-interval", "1",  // 地板每 1s
    "--interval", "100",          // idle 轮询（在飞时不走这条，无害）
  ], { stdio: ["ignore", "ignore", "ignore"] });
  t.after(() => { if (child.exitCode === null) { try { child.kill("SIGKILL"); } catch { /* gone */ } } });

  // 挂起的 worker 只派发一次；之后地板每 ~1s 唤醒循环 ⇒ round 记录持续累积（无 worker 退出边沿事件）。
  await waitFor(() => readRoundLines(root).length >= 3, 10000);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 3, "AC1: floor wrote ≥3 round records with zero worker-exit edge events (production carrier, ⛔ not --json)");
  assert.ok(rounds.some((r) => r.in_flight >= 1), "the round records carry an in-flight worker (the floor is exercised in the in-flight branch, ⛔ not the idle poll)");
  child.kill("SIGKILL");
});


test("AC2 (gap-worker-driver-reconcile-interval) — all edge events lost (worker hangs) ⇒ floor still re-runs ready pool and dispatches within N s", async (t) => {
  const root = makeGitRoot("reconcile-ac2");
  writeTouchedTask(root, "gap-a", "plugin/scripts/aa.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/bb.ts"); // disjoint from gap-a
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const drv = spawnResident(root, [
    // ready-pool: pass1 的两次调用（派发 gap-a + pool-empty）都只给 gap-a；pass2 地板唤醒才给 gap-b。
    // 用计数器而非 marker 文件——marker 的写入时刻与 pass1 第二次 ready-pool 的 spawn 竞态（gap-b 会提前在 pass1 派发）。
    "--ready-pool-cmd", counterNodeE(rpcFile, "n>=2?JSON.stringify({ready:['gap-a','gap-b'],pool:2}):JSON.stringify({ready:['gap-a'],pool:1})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first':'gap-b\\x20second'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)", // 两个 worker 都挂起：worker 退出边沿事件永不发生
    "--concurrency", "2",
    "--reconcile-interval", "1",
    "--interval", "100",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  // gap-a 先派发（挂起）。此后无任何 worker 退出边沿事件。
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-a"), 15000);
  // 地板（⛔ 不是 worker 退出）唤醒循环 ⇒ 重读 ready 池 ⇒ 派发 gap-b。
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-b"), 10000);
  const picks = drv.events().filter((e) => e.event === "selector-picked").map((e) => e.task);
  assert.ok(picks.includes("gap-b"), `AC2: floor re-ran ready pool and dispatched gap-b with zero worker-exit edge events (picks=${picks.join(",")})`);
  await drv.stop();
});

// ── gap-worker-driver-async-selector-readypool：循环体 spawnSync→spawn（selector/readyPool/liveness/git）──
// 常驻循环体里任何 spawnSync 都会冻住协调地板（一个卡住的 selector / git 会连 setTimeout 地板一起冻住，
// SPEC §5.7）。AC1（循环体异步化，能取假 = 源面静态检查 + 慢 selector 下地板仍触发）/ AC2（child exit 唤醒
// 循环 = 异步版在子进程退出后 resolve）/ AC3（协调一趟有界，慢 selector 不冻住地板）逐条取假。


test("AC1 (gap-worker-driver-async-selector-readypool) — loop body's worker-argv construction is async (⛔ sync workerArgvForTask → continueStateForTask spawnSync git freezes the floor)", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // spawnSelected 是 async 且 await 异步 argv 构造（workerArgvForTaskAsync），⛔ 不再是同步 workerArgvForTask。
  assert.match(src, /const spawnSelected = async \(sel: \{ task: string; reason: string \}\): Promise<void>/, "spawnSelected is async");
  assert.match(src, /await workerArgvForTaskAsync\(sel\.task, rootDir, workerCmdOpts\)/, "spawnSelected awaits workerArgvForTaskAsync");
  assert.doesNotMatch(src, /workerArgv: workerArgvForTask\(sel\.task, rootDir, workerCmdOpts\)/, "the sync workerArgvForTask (continueStateForTask spawnSync git) is gone from the loop body");
  // 异步变体齐全，且 git 读走 runAsync（spawn，⛔ 非 spawnSync）。
  for (const name of ["worktreePresentForTaskAsync", "worktreePathsForTaskAsync", "countBranchCommitsAsync", "branchHeadSubjectAsync", "continueStateForTaskAsync", "workerPromptForTaskAsync", "workerArgvForTaskAsync"]) {
    assert.match(src, new RegExp(`export async function ${name}`), `${name} is defined`);
  }
  assert.match(src, /const r = await runAsync\(\["git", "-C", root, "worktree", "list", "--porcelain"\]/, "worktree async variants route through runAsync (spawn), not spawnSync");
  assert.match(src, /await continueStateForTaskAsync\(/, "continueStateForTaskAsync gathers state via async git reads (awaited)");
});


test("AC2 (gap-worker-driver-async-selector-readypool) — async variants resolve on child exit (runAsync close wakes the await); parity with sync continueStateForTask", async (t) => {
  const root = makeGitRoot("async-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-as2"]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  const body = `---\nid: gap-as2\nstatus: ready\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 done\n- [ ] AC2 todo\n`;
  fs.writeFileSync(path.join(root, "tasks", "gap-as2.md"), body);
  runGit(root, ["add", "tasks/gap-as2.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-as2"]);

  // 无 worktree ⇒ 异步创建路径（`git worktree list` 的 child exit 唤醒 await ⇒ false，不是挂起）。
  assert.equal(await worktreePresentForTaskAsync(root, "gap-as2"), false, "async git worktree list resolves (child exit wakes await)");
  assert.equal((await workerPromptForTaskAsync("gap-as2", root)).includes("create an isolated git worktree"), true, "no worktree ⇒ create prompt (async)");

  // 保留 worktree ⇒ 异步续做路径（git rev-list / log 在 child exit 后 resolve）。
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-as2", wtPath]);
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "implemented");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "implement gap-as2"]);

  assert.equal(await countBranchCommitsAsync(root, "gap-as2"), 1, "async rev-list resolves on child exit");
  assert.equal(await branchHeadSubjectAsync(root, "gap-as2"), "implement gap-as2", "async git log resolves on child exit");
  const st = await continueStateForTaskAsync(root, "gap-as2");
  assert.ok(st != null, "async continue state gathered");
  assert.equal(st.branchCommits, 1, "async state carries own commit count (parity with sync continueStateForTask)");
  assert.equal(st.acChecked, 1, "async state carries AC checked");
  const cont = await workerPromptForTaskAsync("gap-as2", root);
  assert.match(cont, /CONTINUE \(reuse/, "async continue prompt reuses the worktree");
  writeProfileCarrier(root); // L3: 默认 argv 经 policy 需要 profiles.yml + settings 载体
  const argv = await workerArgvForTaskAsync("gap-as2", root, { prefix: null, exact: null });
  assert.equal(argv[0], "claude", "async worker argv resolves via policy to the profile launcher (⛔ bash quay-launch.sh)");
  assert.match(argv[argv.length - 1], /CONTINUE \(reuse/, "async continue prompt is the argv payload");
});


test("AC3 (gap-worker-driver-async-selector-readypool) — a slow selector does not freeze the floor (round heartbeat keeps firing while the selector is slow)", async (t) => {
  const root = makeGitRoot("async-ac3");
  writeTouchedTask(root, "gap-a", "plugin/scripts/aa.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/bb.ts");
  // selector 慢（sleep 2s 后才输出 gap-b）。cap=2 + gap-a 在飞（挂起）⇒ selector 在 pass1 跑一次派 gap-b；
  // 之后两个 worker 都挂起（无 worker 退出边沿事件）⇒ 只有地板（--reconcile-interval 1）让循环活着。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a','gap-b'],pool:2}))",
    "--selector-cmd", "node -e setTimeout(()=>console.log('gap-b\\x20slow-pick'),2000)",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)", // 两个 worker 都挂起
    "--concurrency", "2",
    "--reconcile-interval", "1",
    "--interval", "100",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  // 慢 selector 派发 gap-b（约 2s），然后地板在 ~1s 节奏继续写 round 心跳（⛔ 慢 selector 没冻住地板）。
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-b"), 10000);
  await waitFor(() => readRoundLines(root).length >= 3, 10000);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 3, `AC3: the floor kept writing round heartbeats despite the 2s-slow selector (rounds=${rounds.length})`);
  assert.ok(rounds.some((r) => r.in_flight >= 1), "the round records carry in-flight workers (floor exercised in the in-flight branch)");
  await drv.stop();
});


test("AC1 (gap-worker-driver-stopreason-latch-permanent-stop) — gate first WAIT then GO ⇒ the SAME driver process (no restart) recovers dispatch", async (t) => {
  const root = makeGitRoot("stop-latch-ac1");
  writeTaskFile(root, "gap-ac1", "done");
  // gate: WAIT (exit 1) while the go-marker file is absent; GO (exit 0) once the test writes it.
  const goFile = path.join(root, "gate.go");
  const gateCmd = `node -e require('fs').existsSync(${JSON.stringify(goFile)})?process.exit(0):(console.log('{"verdict":"WAIT","reason":"load-high"}'),process.exit(1))`;
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-ac1']:[],pool:n===0?1:0})"),
    "--selector-cmd", "node -e console.log('gap-ac1\\x20pick')",
    "--resource-gate-cmd", gateCmd,
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "1",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  // Phase 1: gate WAIT ⇒ no worker dispatched, and the driver does NOT exit (polls, ⛔ not latch).
  await waitFor(() => readRoundLines(root).length >= 1, 15000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "gate WAIT ⇒ no dispatch yet");
  assert.equal(drv.child.exitCode, null, "transient WAIT did not exit the driver");

  // Phase 2: release the gate — the SAME process must recover and dispatch (stopReason 不复位即恒不派 ⇒ 假).
  fs.writeFileSync(goFile, "go\n");
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC1: gate-open recovered dispatch in the SAME driver process (no restart)");
  assert.equal(spawned[0].task, "gap-ac1");
  await waitFor(() => readOutcomeLines(root).length >= 1, 15000);
  assert.equal(readOutcomeLines(root)[0].final_state, "completed", "the recovered dispatch lands cleanly");
  await drv.stop();
});


test("AC2 (gap-worker-driver-stopreason-latch-permanent-stop) — adjacent stop rounds re-acquire the resource reading (⛔ not byte-identical)", async (t) => {
  const root = makeRoot("stop-latch-ac2");
  // gate: always WAIT (exit 1) but each call prints an incrementing reading ⇒ stop_reason differs per round.
  const gateCnt = path.join(root, "gate.cnt");
  const f = JSON.stringify(gateCnt);
  const gateCmd = `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));console.log('load='+n);process.exitCode=1`;
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-x\\x20pick')",
    "--resource-gate-cmd", gateCmd,
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => readRoundLines(root).length >= 3, 15000);
  const stops = readRoundLines(root).filter((r) => r.action === "stop");
  assert.ok(stops.length >= 2, "at least two stop rounds written (the driver re-reads the gate each poll)");
  assert.match(stops[0].stop_reason, /resource-gate-wait/);
  assert.match(stops[1].stop_reason, /resource-gate-wait/);
  assert.notEqual(stops[0].stop_reason, stops[1].stop_reason, "AC2: adjacent stop readings differ (re-acquired each round, ⛔ not latched byte-identical)");
  await drv.stop();
});
