// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/8 (5 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, after, assert, branchHeadSubject, buildContinueWorkerPrompt, continueStateForTask, dryRunLaunch, launchArgv, makeGitRoot, path, readProfiles, rmSafe, runGit, spawn, workerArgvForTask, workerPromptForTask, writeTaskFile } from "./helpers/worker-driver-resident-harness.mjs";

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


test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC1: buildContinueWorkerPrompt is mechanical too (worker exits, driver takes over; ⛔ no fan-in-execute.js / generateRunId / scriptPath)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  // 续做 prompt 与创建 prompt 同源 driverFanInNote：worker 实现后退出、driver 接手机械跑 fan-in，
  // ⛔ 不再写旧 workflow 兜底签名（fan-in-execute.js / generateRunId / scriptPath）。
  assert.match(p, /exit — the worker-driver takes over/, "AC1: continue prompt also lets the driver take over fan-in");
  assert.match(p, /mechanically runs fan-in/, "AC1: names the mechanical fan-in");
  assert.match(p, /do NOT call the fan-in workflow/, "AC1: worker never calls the workflow (driver decision)");
  assert.doesNotMatch(p, /fan-in-execute\.js/, "⛔ no fan-in-execute.js path (workflow retired from the worker prompt)");
  assert.doesNotMatch(p, /generateRunId/, "⛔ no generateRunId (worker no longer dispatches the workflow)");
  assert.doesNotMatch(p, /scriptPath/, "⛔ no scriptPath placeholder");
  assert.match(p, /\/wt/, "continue prompt still embeds the concrete worktree path (reuse, not a placeholder)");
});
