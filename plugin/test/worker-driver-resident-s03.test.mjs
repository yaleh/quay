// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/5 (8 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, WORKER_PROCESS_NAME, after, assert, branchHeadSubject, buildContinueWorkerPrompt, continueStateForTask, defaultSelectorArgv, defaultWorkerArgv, dryRunLaunch, fs, hasLiveWorkerForTask, launchArgv, makeGitRoot, makeRoot, path, readProfiles, readRoundLines, readTaskStatus, rmSafe, runGit, spawn, spawnResident, waitFor, workerArgvForTask, workerPromptForTask, worktreePresentForTask, writeTaskFile } from "./helpers/worker-driver-resident-harness.mjs";

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
  assert.equal(tw[tw.indexOf("--model") + 1], "deepseek-v4-pro-anthropic");
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


test("AC140-2 — configurable: worker roles carry wrapper+model via shared profile (falsifiable vs manager)", () => {
  const p = readProfiles();
  const roles = p.roles;
  const profileOf = (role) => p.profiles[roles[role].profile];
  // 正控制：新 worker 角色照 outer/inner 抄（⛔ 不照 manager 的裸 claude + model null）；AC154 后三者共享同一 profile。
  for (const role of ["task-worker", "selector", "fix-worker"]) {
    assert.equal(profileOf(role).launcher, "claude-fjdac", `${role} profile launcher must be the wrapper (not bare claude)`);
    assert.ok(profileOf(role).model, `${role} profile model must be configured (not null)`);
    assert.ok(roles[role].name && roles[role].name.startsWith("quay-") && roles[role].name !== "quay-inner",
      `${role} needs a distinct -n name (concurrent-worker ListAgents collision)`);
  }
  // 负控制：manager 仍裸 claude + model null（照它抄就是错——quay-launch.sh 只查非空不查取值，无任何机件报错）。
  assert.equal(profileOf("manager").launcher, "claude");
  assert.equal(profileOf("manager").model, null);

  // dry-run 实测：wrapper/model 确实出现在 spawn 命令行（launcher=claude-fjdac ⇒ wrapper 在链 ⇒ ANTHROPIC_BASE_URL 注入）。
  const taskWorker = dryRunLaunch("task-worker", "-p", "TEST");
  assert.match(taskWorker, /^claude-fjdac /, `task-worker launcher is the wrapper: ${taskWorker}`);
  assert.match(taskWorker, /--model \S+/, `task-worker carries --model <m>: ${taskWorker}`);
  assert.match(taskWorker, /-n quay-task-worker/, "task-worker has its own -n name");
  assert.doesNotMatch(taskWorker, / --bare( |$)/, "task-worker (long chain) does NOT use --bare");

  const selector = dryRunLaunch("selector", "-p", "TEST");
  assert.match(selector, /^claude-fjdac /, `selector launcher is the wrapper: ${selector}`);
  // AC142 根因：selector/fix-worker 曾设 bare=true ⇒ claude --bare 不读 ANTHROPIC_AUTH_TOKEN 而
  // wrapper 置空 ANTHROPIC_API_KEY ⇒ 认证失败 exit 1（生产 13/13 全败）。修法 = 三者均 bare=false。
  assert.doesNotMatch(selector, / --bare( |$)/, "selector does NOT use --bare (AC142: --bare 不读 AUTH_TOKEN ⇒ 认证失败)");

  const fixWorker = dryRunLaunch("fix-worker", "-p", "TEST");
  assert.match(fixWorker, /^claude-fjdac /, `fix-worker launcher is the wrapper: ${fixWorker}`);
  assert.doesNotMatch(fixWorker, / --bare( |$)/, "fix-worker does NOT use --bare (AC142: --bare 不读 AUTH_TOKEN ⇒ 认证失败)");

  // 取假对照：manager（launcher=claude，无 wrapper）⇒ 无 --model，argv0 是裸 claude（wrapper 不在链）。
  const manager = dryRunLaunch("manager");
  assert.match(manager, /^claude /, `manager is bare claude: ${manager}`);
  assert.doesNotMatch(manager, /--model/, "manager has no --model (wrapper not in chain ⇒ no ANTHROPIC_BASE_URL)");
});


test("AC140-3 — override semantics unified: --worker-cmd is prefix, --worker-cmd-exact is whole-replacement", () => {
  // exact（整体替换，测试专用）：prompt 不进 argv。
  assert.deepEqual(workerArgvForTask("gap-x", "/r", { prefix: null, exact: "node -e capture" }),
    ["node", "-e", "capture"], "--worker-cmd-exact replaces the whole command (no prompt)");

  // prefix（前缀 + prompt）：prompt 作为末参数追加（wrapper/测试前缀可用）。
  const prefix = workerArgvForTask("gap-x", "/r", { prefix: "claude-fjdac --model deepseek-v4-pro", exact: null });
  assert.deepEqual(prefix.slice(0, 3), ["claude-fjdac", "--model", "deepseek-v4-pro"]);
  assert.match(prefix[prefix.length - 1], /gap-x/,
    "prefix semantics: the task prompt is appended as the last arg (exact would drop it ⇒ falsifiable)");

  // 缺省 ⇒ launchArgv("task-worker", prompt)：经 policy 解析，argv[0] 是 profile launcher。
  const def = workerArgvForTask("gap-x", REPO_ROOT);
  assert.equal(def[0], "claude-fjdac", "default worker resolves via policy (⛔ bash quay-launch.sh)");
  assert.match(def[def.length - 1], /gap-x/, "the task prompt is the last argv payload");
});

// ── gap-worker-worktree-continue-reuse ───────────────────────────────────────────────────────────
// destroy-path 修复后 exited-not-landed 的 worktree 被【保留】但没人接着做：派发 prompt 仍是「create」
// ⇒ 重派 worker 一上来 `git worktree add` 撞已存在对象 fatal。AC1（复用不撞死）：保留 worktree 在 ⇒
// 续做 prompt（复用，⛔ 不含 create）。AC2（续做不重做）：续做 prompt 携带前一轮状态（分支提交 / AC
// 勾选 / 失败原因）。


test("AC1 (能取假) — workerPromptForTask / continueStateForTask: preserved worktree ⇒ continue prompt (reuse, ⛔ create); no worktree ⇒ create prompt", (t) => {
  const root = makeGitRoot("continue");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-cr"]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeTaskFile(root, "gap-cr", "ready");

  // 无 worktree ⇒ 创建 prompt（旧行为）。
  const createPrompt = workerPromptForTask("gap-cr", root);
  assert.match(createPrompt, /create an isolated git worktree/, "no worktree ⇒ create prompt");
  assert.doesNotMatch(createPrompt, /CONTINUE \(reuse/, "create prompt does not say reuse");
  assert.equal(continueStateForTask(root, "gap-cr"), null, "no worktree ⇒ no continue state (create path)");

  // 模拟 exited-not-landed 保留的 worktree ⇒ 续做 prompt。
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cr", wtPath]);
  const contPrompt = workerPromptForTask("gap-cr", root);
  assert.match(contPrompt, /CONTINUE \(reuse/, "preserved worktree ⇒ continue prompt");
  assert.doesNotMatch(contPrompt, /create an isolated git worktree/, "AC1: continue prompt must NOT say create (create ⇒ git worktree add fatal)");
  assert.match(contPrompt, /do NOT run `git worktree add`/, "AC1: reuse not create");
  assert.ok(continueStateForTask(root, "gap-cr") != null, "worktree present ⇒ continue state gathered");
});


test("AC2 (能取假) — buildContinueWorkerPrompt carries prior-round state (branch commits / AC check / failure reason)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  assert.match(p, /3 commits/, "AC2: branch commit count carried");
  assert.match(p, /head: "implement gap-x"/, "AC2: branch head subject carried");
  assert.match(p, /checked 2\/5/, "AC2: AC check state carried (checked X/Y)");
  assert.match(p, /because: worker exited 0 but task did not land/, "AC2: failure reason carried");
  assert.doesNotMatch(p, /create an isolated git worktree/, "AC1: continue prompt never says create");
});
