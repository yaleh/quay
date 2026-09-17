// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/10 (11 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { WORKER_PROCESS_NAME, after, assert, cleanupOrphanWorktree, counterNodeE, enumerateColdStartInflight, enumerateLiveWorkerCmdlines, enumerateTaskWorktreeTasks, fileURLToPath, fs, hasLiveWorkerForTask, isHalted, makeGitRoot, makeRoot, path, readOutcomeLines, readRoundLines, resourceGateCheck, rmSafe, runGit, spawn, spawnResident, waitFor, worktreePresentForTask, writeTaskFile, FAMILY_SRC } from "./helpers/worker-driver-fan-in-harness.mjs";

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
