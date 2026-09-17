// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/6 (17 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { FAMILY_SRC, test } from "node:test";
import { DRIVER, RECONCILE_INTERVAL_SECS_DEFAULT, RESIDENT_INTERVAL_MS_DEFAULT, WORKER_PROCESS_NAME, after, assert, branchHeadSubjectAsync, cleanupOrphanWorktree, continueStateForTask, continueStateForTaskAsync, countBranchCommitsAsync, counterNodeE, enumerateColdStartInflight, enumerateLiveWorkerCmdlines, enumerateTaskWorktreeTasks, fileURLToPath, fs, hasLiveWorkerForTask, isHalted, makeGitRoot, makeRoot, parseIntervalMs, parseReconcileIntervalSecs, path, readOutcomeLines, readRoundLines, resourceGateCheck, rmSafe, runGit, runMechanicalFanIn, spawn, spawnResident, spawnSync, waitFor, workerArgvForTask, workerArgvForTaskAsync, workerPromptForTaskAsync, worktreePathsForTaskAsync, worktreePresentForTask, worktreePresentForTaskAsync, writeTaskFile, writeTouchedTask } from "./helpers/worker-driver-fan-in-harness.mjs";

test("结构面（能取假）— after 钩子里的删除一律走 rmSafe（裸 fs.rmSync 抛错会跳过后续 drv.stop()）", () => {
  const HOOK = "t." + "after(";
  const RAW_RM = "fs." + "rmSync(";
  const src = FAMILY_SRC;
  const hooks = src.split(HOOK).slice(1);
  const offenders = [];
  hooks.forEach((h, i) => {
    const end = h.includes("\n  });") ? h.indexOf("\n  });") + 7 : h.indexOf("\n") + 1;
    const win = h.slice(0, end > 0 ? end : h.length);
    if (win.includes(RAW_RM)) offenders.push(`hook#${i + 1}`);
  });
  assert.ok(hooks.length >= 10, `解析到 ${hooks.length} 个 after 钩子 —— 少于 10 说明判据没看到它们（空转，⛔ 不是"都合格"）`);
  assert.deepEqual(offenders, [], `after 钩子仍用裸 fs.rmSync（改用 rmSafe）：${offenders.join(", ")}`);
});

// ── AC150-3 (falsifiable): 资源门/halt 判定抽到 driver-shared.ts，worker-driver 只是 re-export ──


test("AC150-3 — worker-driver re-exports the SAME resourceGateCheck / isHalted as driver-shared (单份实现)", async () => {
  const shared = await import("../scripts/driver-shared.ts");
  // worker-driver.test.mjs 顶部从 worker-driver.ts import 了 resourceGateCheck / isHalted（re-export 面）。
  assert.equal(resourceGateCheck, shared.resourceGateCheck, "resourceGateCheck 同一份实现（worker re-export = shared）");
  assert.equal(isHalted, shared.isHalted, "isHalted 同一份实现（worker re-export = shared）");
});

// ── 派发前 depends_on 过滤（gap-worker-driver-dispatch-pre-filter-missing AC1）───────────────────────
// worker-driver 把 ready-pool-check 的 ready 列表直接派发、不二次过滤 depends_on ⇒ 依赖未满的任务
// 仍被派发（ac138 白烧一轮：代码已 land、依赖链未满、翻 done 会重造 DEP-DONE-IFF-DEPS 违例）。修法 =
// 派发前对候选做 depends_on 过滤（AC152 起经 driver-filters.ts 的 depsSatisfied 谓词，纯函数测试见
// driver-filters.test.mjs）。


test("AC1 — depends_on gate in the resident loop: a candidate whose dep is not done is NOT dispatched (ac138 白烧一轮防)", async (t) => {
  const root = makeGitRoot("ac1-deps");
  // gap-prereq（ready，未 done）+ gap-dep（depends_on gap-prereq），都写进 tasks/ 并提交。
  fs.writeFileSync(path.join(root, "tasks", "gap-prereq.md"), "---\nid: gap-prereq\nstatus: ready\n---\n\nbody\n");
  runGit(root, ["add", "tasks/gap-prereq.md"]);
  runGit(root, ["commit", "-q", "-m", "prereq ready"]);
  fs.writeFileSync(path.join(root, "tasks", "gap-dep.md"), "---\nid: gap-dep\nstatus: ready\ndepends_on:\n  - gap-prereq\n---\n\nbody\n");
  runGit(root, ["add", "tasks/gap-dep.md"]);
  runGit(root, ["commit", "-q", "-m", "dep ready"]);

  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-dep'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-dep\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => readRoundLines(root).length >= 1, 15000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC1: dep-not-done candidate is never dispatched");
  assert.equal(readOutcomeLines(root).length, 0, "zero workers dispatched");
  // 负控制（⛔ 不能是「池空才不派」）：round 记录 pool=1 证明 ready-pool 确实给了 gap-dep 候选——
  // 是 depends_on 过滤把它滤掉的（不是 selector 没选、也不是池空）。与 Touches 互斥同属非终态过滤
  // （依赖由别的任务落地，非本驱动等待可解）⇒ 无在飞 worker 可等 ⇒ 轮询等依赖落地。
  const rounds = readRoundLines(root);
  assert.equal(rounds[rounds.length - 1].pool, 1, "ready-pool reported pool=1 (gap-dep), yet nothing dispatched — the filter is the cause");
  assert.equal(rounds[rounds.length - 1].in_flight, 0, "nothing in flight");
  await drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（node:test after 钩按注册序 FIFO：rmSync 先注册会先于 drv.stop 运行 ⇒ 驱动仍在写 round/cnt ⇒ ENOTEMPTY；stop 现 await 'exit'）
});


test("AC1 对照 — dep done ⇒ the candidate IS dispatched (the filter is the difference, not a blanket stop)", async (t) => {
  const root = makeGitRoot("ac1-deps-ok");
  writeTaskFile(root, "gap-prereq", "done");
  fs.writeFileSync(path.join(root, "tasks", "gap-dep.md"), "---\nid: gap-dep\nstatus: done\ndepends_on:\n  - gap-prereq\n---\n\nbody\n");
  runGit(root, ["add", "tasks/gap-dep.md"]);
  runGit(root, ["commit", "-q", "-m", "dep done"]);
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-dep']:[],pool:n===0?1:0})"),
    "--selector-cmd", "node -e console.log('gap-dep\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => readOutcomeLines(root).length >= 1, 15000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC1 对照: dep-done candidate IS dispatched (exactly once)");
  assert.equal(spawned[0].task, "gap-dep");
  assert.equal(readOutcomeLines(root)[0].final_state, "completed", "the dep-done candidate lands cleanly");
  await drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（node:test after 钩按注册序 FIFO：rmSync 先注册会先于 drv.stop 运行 ⇒ 驱动仍在写 round/cnt ⇒ ENOTEMPTY；stop 现 await 'exit'）
});

// ── gap-worker-driver-cold-start-inflight-blind：冷启动在飞盲区 ───────────────────────────────────
// restart / supervisor 崩溃自动 respawn 后，新驱动的 running 是纯内存数组、从空集起，不认得重启前
// 就存活的 worker ⇒ 重复派发（撞同一 worktree），重复者被杀后 failed 终态又触发
// cleanupOrphanWorktree 误删原 worker 仍在用的共享 worktree+分支。修法 = 冷启动枚举「worktree 在 ∧
// 存活 worker 在」的 task 进排除集 + cleanupOrphanWorktree 存活校验。


test("cold-start pure — enumerateColdStartInflight / hasLiveWorkerForTask: worktree ∧ live worker ⇒ in-flight; worktree-only ⇒ orphan", (t) => {
  const root = makeRoot("coldstart-pure");
  t.after(() => rmSafe(root));
  const live = "claude-fjdac --settings x --model m -n quay-task-worker -p '... Task: gap-cs-a ...'";

  // worktree + live worker ⇒ in-flight；只有 worktree 无进程 ⇒ orphan（不排除）。
  assert.deepEqual(
    [...enumerateColdStartInflight(root, { worktreeTasks: ["gap-cs-a", "gap-cs-b"], workerCmdlines: [live] })].sort(),
    ["gap-cs-a"],
    "only the task with BOTH a worktree and a live worker is in-flight (gap-cs-b is an orphan worktree)",
  );
  // worktree 但无存活 worker ⇒ 空（orphan 可重派、可清——正是交叉核对的意义）。
  assert.deepEqual(
    [...enumerateColdStartInflight(root, { worktreeTasks: ["gap-cs-a"], workerCmdlines: [] })],
    [],
    "a worktree without a live worker is an orphan — NOT excluded from dispatch",
  );
  // 无 task worktree ⇒ 空（⛔ 短路，不白扫 /proc）。
  assert.deepEqual(
    [...enumerateColdStartInflight(root, { worktreeTasks: [], workerCmdlines: [live] })],
    [],
    "no task worktree ⇒ nothing in-flight",
  );

  // hasLiveWorkerForTask 纯谓词：cmdline 须同时含 quay-task-worker 与 task id。
  assert.equal(hasLiveWorkerForTask("gap-cs-a", [live]), true);
  assert.equal(hasLiveWorkerForTask("gap-cs-a", ["node -e x quay-task-worker gap-zzz"]), false, "wrong task id ⇒ not a live worker for this task");
  assert.equal(hasLiveWorkerForTask("gap-cs-a", ["node -e x gap-cs-a"]), false, "no quay-task-worker name ⇒ not a worker");

  // ⛔ 词边界回归（2026-08-24 实测假阳性）：短 id `gap-t` 不得作为前缀命中 `gap-test-…` 的存活 worker。
  const gapTestWorker = "claude -n quay-task-worker -p '... Task: gap-test-fixture-pollutes-bash-history ...'";
  assert.equal(hasLiveWorkerForTask("gap-t", [gapTestWorker]), false, "gap-t must NOT match gap-test-… (word boundary, not substring)");
  assert.equal(hasLiveWorkerForTask("gap-test-fixture-pollutes-bash-history", [gapTestWorker]), true, "the full id matches its own worker");
});


test("enumerateTaskWorktreeTasks — lists task/<id> branches, skips the main checkout + non-task branches", (t) => {
  const root = makeGitRoot("coldstart-enum");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-enum`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeTaskFile(root, "gap-enum-a", "ready");
  assert.deepEqual(enumerateTaskWorktreeTasks(root), [], "no task worktree yet (main checkout's branch is not a task branch)");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-enum-a", wtPath]);
  assert.deepEqual(enumerateTaskWorktreeTasks(root), ["gap-enum-a"], "the task/<id> worktree is enumerated");
});


test("enumerateLiveWorkerCmdlines — real /proc scan finds a spawned fake worker (fail-soft otherwise)", async (t) => {
  const fake = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, "gap-proc-scan"], { stdio: "ignore" });
  t.after(() => { try { fake.kill("SIGKILL"); } catch { /* already gone */ } });
  await new Promise((r) => setTimeout(r, 50));
  const cmdlines = enumerateLiveWorkerCmdlines();
  assert.ok(
    cmdlines.some((c) => c.includes(WORKER_PROCESS_NAME) && c.includes("gap-proc-scan")),
    "the spawned fake worker's cmdline is found by the /proc scan",
  );
  // fail-soft：非 /proc 目录 ⇒ []（硬规则 3b：读不懂 ≠ 无存活，但绝不抛）。
  assert.deepEqual(enumerateLiveWorkerCmdlines("/nonexistent-proc-dir"), []);
});


test("AC1 (cold-start) — surviving worker + its worktree ⇒ resident loop does NOT re-dispatch that task", async (t) => {
  const root = makeGitRoot("coldstart-ac1");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-cs`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });

  // 幸存 worker 的 worktree（branch task/gap-cs-a）——旧 driver 已 fork、新 driver 冷启动前就在。
  writeTaskFile(root, "gap-cs-a", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-a", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cs-a"), true, "precondition: survivor worktree present");

  // 存活 worker 进程（cmdline 同时含 quay-task-worker 与 task id——/proc 扫描靠它识别）。
  const fakeWorker = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, "gap-cs-a"], { stdio: "ignore" });
  t.after(() => { try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ } });

  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cs-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cs-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  await waitFor(() => drv.events().some((e) => e.event === "cold-start-inflight"), 15000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC1: surviving worker's task is NOT re-dispatched");
  const cs = drv.events().find((e) => e.event === "cold-start-inflight");
  assert.ok(cs, "the cold-start in-flight enumeration is recorded (not silent)");
  assert.deepEqual(cs.tasks, ["gap-cs-a"], "the survivor is the enumerated in-flight task");
  assert.equal(readOutcomeLines(root).length, 0, "zero outcomes — nothing dispatched");
  drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（同 dep-done 对照：rmSync 先注册会先于 drv.stop 运行 ⇒ ENOTEMPTY 跳过 drv.stop ⇒ 驱动泄漏挂死）
});


test("AC1 对照 — orphan worktree (no live worker) ⇒ the task IS re-dispatched (the live-worker cross-check is the difference)", async (t) => {
  const root = makeGitRoot("coldstart-neg");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-neg`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeTaskFile(root, "gap-cs-b", "done");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-b", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cs-b"), true, "precondition: orphan worktree present (no live worker)");

  // 无存活 worker ⇒ 冷启动枚举为空 ⇒ gap-cs-b 不被排除 ⇒ 会被派发（worker-spawned 出现）。
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-cs-b']:[],pool:n===0?1:0})"),
    "--selector-cmd", "node -e console.log('gap-cs-b\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "orphan worktree alone does NOT block re-dispatch — the task IS dispatched");
  assert.equal(spawned[0].task, "gap-cs-b");
  drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（rmSync 先注册会先于 drv.stop 运行 ⇒ ENOTEMPTY 跳过 drv.stop ⇒ 驱动泄漏挂死）
});


test("AC2 (cold-start) — cleanupOrphanWorktree skips a worktree a live worker is using; cleans a true orphan", (t) => {
  const root = makeGitRoot("coldstart-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeTaskFile(root, "gap-cs-c", "ready");
  runGit(root, ["branch", "develop"]); // 基准分支 = develop（生产一致）；git log develop..task/<id> 判产出需要它存在
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-c", wtPath]);

  const liveCmdline = "claude -n quay-task-worker -p '... Task: gap-cs-c ...'";
  // 存活 worker 正在用 ⇒ 跳过（skippedLiveWorker=true，removed=false，worktree 仍在）。
  const skipped = cleanupOrphanWorktree(root, "gap-cs-c", [liveCmdline]);
  assert.equal(skipped.removed, false, "AC2: not removed while a live worker uses it");
  assert.equal(skipped.skippedLiveWorker, true, "the skip is reported as skippedLiveWorker (not 'removed', not 'no worktree')");
  assert.equal(skipped.error, null);
  assert.equal(worktreePresentForTask(root, "gap-cs-c"), true, "the shared worktree survives (not deleted)");

  // 无存活 worker（真 orphan）⇒ 清理（对照，证明 skip 是存活校验在起作用，不是永远不清）。
  const cleaned = cleanupOrphanWorktree(root, "gap-cs-c", []);
  assert.equal(cleaned.removed, true, "a true orphan (no live worker) IS cleaned");
  assert.equal(cleaned.skippedLiveWorker, false);
  assert.equal(worktreePresentForTask(root, "gap-cs-c"), false, "orphan worktree removed");
});

// ── gap-worker-driver-cold-start-inflight-refresh：冷启动在飞集合每趟 pass 现观测 ────────────────────
// 原 gap-worker-driver-cold-start-inflight-blind 只修了「冷启动 ⇒ 不重复派发」一个方向：enumerateColdStartInflight
// 在 while(true) 之前 const 冻结一次、全生命周期不刷新 ⇒ 冷启动 worker 结束后其 task 仍永久假在飞、
// 该 driver 余生不可派。修法 = 每趟 pass 现观测（SPEC §5.2 actual=observe()）。AC1（原有方向，保绿）+
// AC2（承重条·原缺的那半）+ AC3（现观测，无循环外 const 快照）逐条取假。


test("AC2 (cold-start-refresh) — survivor finishes ⇒ its task leaves the exclusion set and IS re-dispatched (same driver process)", async (t) => {
  const root = makeGitRoot("coldstart-ac2-refresh");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2r`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeTaskFile(root, "gap-cs-a", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-a", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cs-a"), true, "precondition: survivor worktree present");

  // 幸存 worker 进程（旧 driver 所 fork、冷启动前就在）。
  const fakeWorker = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, "gap-cs-a"], { stdio: "ignore" });
  t.after(() => { try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ } });

  // ready-pool 持续给 gap-cs-a 候选、selector 持续选它；冷启动在飞时被排除，worker 结束后重新可派。
  // --concurrency 1 + 派发后的 worker 长跑（不退出）⇒ 只派发一次，无重派循环（spawned.length===1 可断言）。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cs-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cs-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)",
    "--concurrency", "1",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());

  // Phase 1: 冷启动发现幸存 worker ⇒ 不派发（排除集挡住，⛔ 不是池空——round 记录 pool=1 证明候选在）。
  await waitFor(() => drv.events().some((e) => e.event === "cold-start-inflight"), 15000);
  const cs = drv.events().find((e) => e.event === "cold-start-inflight");
  assert.ok(cs, "the cold-start enumeration is observed (recorded)");
  assert.deepEqual(cs.tasks, ["gap-cs-a"], "the survivor is the enumerated in-flight task");
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC2 phase 1: survivor not re-dispatched while its worker is alive");

  // Phase 2: 幸存 worker 退出 + worktree 消失（模拟其 fan-in 落地）⇒ 现观测使 task 离开排除集 ⇒
  //   同一 driver 进程内重新可派。⛔ 冻结快照（旧缺陷）下此步恒不派 ⇒ 假。
  try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ }
  try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC2: exactly one re-dispatch after the survivor finished (concurrency 1 + long-running worker ⇒ no re-dispatch loop)");
  assert.equal(spawned[0].task, "gap-cs-a", "the re-dispatched task is the former cold-start survivor");
  drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（rmSync 先注册会先于 drv.stop 运行 ⇒ ENOTEMPTY 跳过 drv.stop ⇒ 驱动泄漏挂死）
});


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
