// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/8 (5 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, WORKER_PROCESS_NAME, after, assert, defaultSelectorArgv, defaultWorkerArgv, fs, hasLiveWorkerForTask, launchArgv, makeGitRoot, makeRoot, path, readProfiles, readRoundLines, readTaskStatus, rmSafe, runGit, spawn, spawnResident, waitFor, worktreePresentForTask, writeTaskFile } from "./helpers/worker-driver-resident-harness.mjs";
import { resolveRole } from "../scripts/profile-policy.ts";

test("AC6 end-to-end (superseded-reclaim) — a real superseded worktree is reclaimed by the resident loop (worktree removed, branch preserved)", async (t) => {
  const root = makeGitRoot("sup-wire-e2e");
  writeTaskFile(root, "gap-sup-wire", "superseded");
  runGit(root, ["branch", "develop"]); // readTaskStatus 读 develop ref；develop 指到含 superseded 任务文件的 commit
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  // ⚠️ 顺序是【承重】的：after 钩子按注册序执行，驱动必须先死、目录后删。反过来（先删目录）会与
  // 仍在写 <root>/.quay/ 的驱动赛跑 —— 递归删除先删文件、再 rmdir 时目录又被驱动重建 ⇒ ENOTEMPTY
  // 抛出 ⇒ 该测试剩余 after 钩子（含 drv.stop()）被整体跳过 ⇒ 驱动泄漏 ⇒ 本文件进程永不退出 ⇒
  // 套件静默到被看门狗杀掉。故用 holder 把 stop 注册在清理【之前】（drv 此时还没 spawn）。
  let drv = null;
  t.after(async () => { if (drv) await drv.stop(); });
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-wire", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-sup-wire"), true, "precondition: superseded worktree present");

  drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  await waitFor(() => {
    const r = readRoundLines(root).find((rec) => rec.superseded_reclaim && rec.superseded_reclaim.reclaimed.includes("gap-sup-wire"));
    return r != null;
  }, 20000);
  const rounds = readRoundLines(root);
  const reclaimRound = rounds.find((rec) => rec.superseded_reclaim && rec.superseded_reclaim.reclaimed.includes("gap-sup-wire"));
  assert.ok(reclaimRound, "a round record shows gap-sup-wire was reclaimed by the reconcile step");
  assert.ok(reclaimRound.superseded_reclaim.candidateCount >= 1, "candidateCount reflects the superseded worktree");
  assert.equal(worktreePresentForTask(root, "gap-sup-wire"), false, "the superseded worktree is actually removed");
  assert.match(runGit(root, ["branch", "--list", "task/gap-sup-wire"]), /gap-sup-wire/, "branch preserved (⛔ never git branch -D)");
});

// ── gap-superseded-mid-flight-live-worker-not-stopped：superseded 活 worker 被 reconcile 步 SIGTERM ──
// AC5（接线，非「函数存在」）：常驻循环 reconcile 步真实走到本次改动——superseded + 存活 worker 的任务，
//   其 round 记录 perTask 条目带 liveWorkerSignaled=true（⛔ 仅改导出函数而 reconcile 步不调 ⇒ round 记
//   录无该字段 ⇒ 该 AC 假）。AC6（读生产载体，默认 process.kill）：spawnResident 不注入任何缝（走真实
//   git//proc + 默认 process.kill）——round 记录带 liveWorkerSignaled 字段，且 fake worker 真被 SIGTERM
//   杀死（⛔ 只是 flag 自证 = 回声，硬规则 4 推论三）。


test("AC5/AC6 (superseded-mid-flight wiring + production carrier) — a live worker on a superseded task is SIGTERM'd by the reconcile step; round record carries liveWorkerSignaled", async (t) => {
  const root = makeGitRoot("sup-mf-wire");
  const taskId = "gap-sup-mf-wire";
  writeTaskFile(root, taskId, "superseded");
  runGit(root, ["branch", "develop"]); // readTaskStatus 读 develop ref；develop 指到含 superseded 任务文件的 commit
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  // ⚠️ 顺序承重，同 AC6 end-to-end：驱动先死、目录后删（理由是那里的注释；本条 2026-09-12 实测
  // 因顺序反了而泄漏驱动 ⇒ 整个套件被静默看门狗杀掉）。holder 让 stop 注册在清理之前。
  let drv = null;
  t.after(async () => { if (drv) await drv.stop(); });
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  runGit(root, ["worktree", "add", "-q", "-b", `task/${taskId}`, wtPath]);
  assert.equal(worktreePresentForTask(root, taskId), true, "precondition: superseded worktree present");

  // 存活 worker：cmdline 含 quay-task-worker + task id（hasLiveWorkerForTask / findLiveWorkerPid 命中）。
  const fake = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, taskId], { stdio: "ignore" });
  t.after(() => { try { fake.kill("SIGKILL"); } catch { /* gone */ } });
  const fakeExited = new Promise((resolve) => fake.once("exit", (code, signal) => resolve(signal)));
  await new Promise((r) => setTimeout(r, 100)); // 让 /proc/<pid>/cmdline 可读

  drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);

  await waitFor(() =>
    readRoundLines(root).some((rec) =>
      rec.superseded_reclaim &&
      Array.isArray(rec.superseded_reclaim.perTask) &&
      rec.superseded_reclaim.perTask.some((p) => p.taskId === taskId && p.liveWorkerSignaled === true)
    ), 30000);

  const rounds = readRoundLines(root);
  const signaledRound = rounds.find((rec) =>
    rec.superseded_reclaim && rec.superseded_reclaim.perTask.some((p) => p.taskId === taskId && p.liveWorkerSignaled === true));
  assert.ok(signaledRound, "AC5: a round record shows the reconcile step reached the mid-flight signal path (liveWorkerSignaled true)");
  const entry = signaledRound.superseded_reclaim.perTask.find((p) => p.taskId === taskId);
  assert.equal(entry.liveWorkerSignaled, true, "AC6: production carrier perTask entry carries liveWorkerSignaled=true");
  assert.equal(entry.skippedLiveWorker, true, "still skippedLiveWorker this round (disk reclaim deferred to next round)");
  assert.equal(await fakeExited, "SIGTERM", "AC6: default process.kill delivered SIGTERM to the live worker (⛔ not just a flag)");
});

// ── gap-worker-driver-resident-loop-intermittent-hang：挂起复现负控制 ───────────────────────────────
// 根因（实测 RUN 8 ENOTEMPTY）：常驻测试 after 钩按注册序 FIFO 运行，`fs.rmSync(root)` 先注册先运行、
// 此刻驱动仍活（每轮写 root/.quay/worker-round.jsonl）⇒ rmSync ENOTEMPTY ⇒ 抛错跳过后续 `drv.stop()`
// ⇒ 驱动泄漏（spinning、持 stdout pipe）⇒ node --test 等不到 EOF 挂死。修法 = ① spawnResident 用
// detached:true 让驱动成进程组组长、stop() 杀整组（⛔ 只杀驱动会留孤儿 worker 持 pipe + 孤儿 counter
// 子进程与 rmSync 竞态）；② 常驻测试统一「先 drv.stop 再 rmSync」的 after 钩顺序（或 body 末 inline
// drv.stop）。本负控制只验①：长命 worker（sleep 100，stdio:"inherit"）在 stop 后【不得】持 pipe——
// stop 杀整组 ⇒ 孤儿 worker 一起死 ⇒ stdout pipe 界内关闭；旧只杀驱动 ⇒ 孤儿 worker 持 pipe 到 100s。

test("negative control — drv.stop kills the whole process group: a long-lived worker does NOT hold the stdout pipe open", async (t) => {
  const root = makeGitRoot("group-kill");
  writeTaskFile(root, "gap-gk", "done");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-gk'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-gk\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "sleep 100", // 长命 worker：若 stop 不杀整组，孤儿 worker 持 stdout pipe 写端
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"));
  const closed = new Promise((resolve) => drv.child.stdout.on("close", resolve));
  drv.stop();
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("stdout pipe still open after stop — an orphaned worker held it (group-kill not applied)")), 10000)),
  ]);
});

// ── AC140（可配 wrapper + model + 按 role；单一真相源；覆盖语义统一）+ L3（driver 消费 policy）─────
// 驱动的 LLM spawn 不再硬编码 `["claude","-p",prompt]`——单一构造 launchArgv 现在【经 L2 policy
// （profile-policy.ts loadProfiles + resolveRole）解析语义 kind → profile】后直接出 argv（L3
// gap-driver-binding-semantic-kind-to-profile），⛔ 不再 `bash quay-launch.sh <role>` 把解析交给 bash 里
// 的第二份实现。wrapper/model/--bare 由 .quay/profiles.yml 的 profiles/roles 承载（AC154 profile 抽层）。
// 取假靠读【启动语义】字段（launcher / --model），⛔ 不靠 argv0（claude-fjdac 末行 exec claude 使
// argv0 恒为 claude）。quay-launch.sh 保留给非驱动路径（manager/outer/inner），AC140-2 仍经它 dry-run。





test("AC140-1 — single constructor: launchArgv resolves kind → profile via policy (launcher from profile, ⛔ not bash quay-launch.sh)", () => {
  const tw = launchArgv("task-worker", "WPROMPT", REPO_ROOT);
  assert.equal(tw[0], "claude-fjdac", "launcher resolved from profile (⛔ bash quay-launch.sh)");
  assert.equal(tw[1], "--settings");
  // ⛔ 不钉具体模型名（模型名是运行环境取值，会随网关漂移）：断言 argv 的 --model 与【policy 解析值】
  //   一致 —— 这才是本 AC 的「单一构造」性质，且【能取假】：launchArgv 一旦绕过 policy 或硬编码就红。
  const policyModel = resolveRole(readProfiles(), "task-worker").model;
  assert.equal(tw[tw.indexOf("--model") + 1], policyModel,
    "argv 的 --model 必须等于 policy 的解析值（单一构造；⛔ 不钉具体模型名）");
  assert.equal(tw[tw.indexOf("-n") + 1], "quay-task-worker");
  assert.equal(tw[tw.length - 1], "WPROMPT", "prompt is the last argv payload");
  assert.ok(!tw.includes("quay-launch.sh"), "no bash quay-launch.sh in the spawn argv (⛔ bash 第二份实现)");

  const sel = launchArgv("selector", "SPROMPT", REPO_ROOT);
  assert.equal(sel[0], "claude-fjdac");
  assert.equal(sel[sel.indexOf("-n") + 1], "quay-selector");

  const fix = launchArgv("fix-worker", "FPROMPT", REPO_ROOT);
  assert.equal(fix[0], "claude-fjdac");
  assert.equal(fix[fix.indexOf("-n") + 1], "quay-fix-worker");

  // 单一真相源：default* 都经同一构造（argv[0] = profile launcher，调用点只传语义 kind）。
  assert.equal(defaultWorkerArgv("gap-x", REPO_ROOT)[0], "claude-fjdac");
  assert.equal(defaultSelectorArgv(["a"], REPO_ROOT)[0], "claude-fjdac");
});


test("AC140-1b — L3 由 policy 解析（能取假）：合成 profile 的 launcher/model 流进 argv（⛔ 非硬编码）", (t) => {
  const root = makeRoot("profile");
  t.after(() => rmSafe(root));
  // 合成 profiles.yml：launcher=claude（⛔ 非 claude-fjdac）+ model=synth-model——若 launchArgv 硬编码
  // claude-fjdac/deepseek-v4-pro 或绕过 policy，这些字段不会照合成值流进 argv ⇒ 取假。
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"),
    "version: 1\n" +
    "profiles:\n  w:\n    launcher: claude\n    model: synth-model\n    bare: false\n    auth: key\n" +
    "roles:\n  task-worker:\n    profile: w\n    name: quay-synth\n");
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  const settingsPath = path.join(root, ".claude", "launch.settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify({ $schema: "x", permissions: {}, env: { KEEP: "1" } }));

  const a = launchArgv("task-worker", "P", root);
  assert.equal(a[0], "claude", "launcher from the SYNTHETIC profile (⛔ hardcoded claude-fjdac)");
  assert.equal(a[a.indexOf("--model") + 1], "synth-model", "model from the SYNTHETIC profile");
  assert.equal(a[a.indexOf("-n") + 1], "quay-synth", "name from the SYNTHETIC profile");
  assert.equal(a[a.length - 1], "P");
  // 无 unset / 无 role env ⇒ --settings 直接是文件路径（非合并 JSON）。
  assert.equal(a[a.indexOf("--settings") + 1], settingsPath);
});
