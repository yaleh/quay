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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/10 (9 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, SEL_CLI, assert, cleanup, extractBlockFromPrompts, fs, makeStaleBootstrapRepo, path, runBash, runSyncCli, runWorkflow, spawn, spawnSync, symlinkRuntimeTrees, vm } from "./helpers/fan-in-execute-paths-harness.mjs";

test("⑦b wiring — the step-0 prompt carries the --bootstrap-sync call (worktree-first, root fallback) BEFORE step-1 merge develop", async (t) => {
  const WT = "/tmp/wt-bs-sync";
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-bs-sync", worktree: WT, root: REPO_ROOT, runId: "fm-bs-sync", mergeTarget: "develop" },
  });
  const step0 = extractBlockFromPrompts(prompts, "【无锁段 step 0", "【无锁段 step 1");
  const syncLines = step0.split("\n").filter((l) => l.includes("--bootstrap-sync"));
  assert.ok(syncLines.length >= 1, `step-0 prompt must carry a --bootstrap-sync call, got none among:\n${step0}`);
  // worktree-first with root fallback (a worktree forked before this mode landed cannot run it from itself)
  const assignLine = step0.split("\n").find((l) => l.trim().startsWith("sync_helper="));
  assert.ok(assignLine, `step-0 must resolve the sync helper (sync_helper=...), got none among:\n${step0}`);
  assert.ok(assignLine.includes(`${WT}/plugin/scripts/select-static-checks-for-touches.ts`),
    `the sync helper must resolve worktree-first, got: ${assignLine}`);
  const fallbackLine = step0.split("\n").find((l) => l.includes('[ -f "$sync_helper" ]'));
  assert.ok(fallbackLine && fallbackLine.includes(path.join(REPO_ROOT, "plugin", "scripts", "select-static-checks-for-touches.ts")),
    `the sync helper must fall back to root, got: ${fallbackLine ?? "(missing)"}`);
  const execLine = syncLines.find((l) => l.includes("--bootstrap-sync --worktree"));
  assert.ok(execLine, "the sync executable line must be present");
  assert.ok(execLine.includes(`--worktree ${WT}`) && execLine.includes("--merge-target develop"),
    `the sync call must carry the worktree + merge-target, got: ${execLine}`);
  // It must precede step-1's `git merge develop` (the "在 merge develop 前先同步" requirement)
  const step1 = extractBlockFromPrompts(prompts, "【无锁段 step 1", "【无锁段 step 2");
  assert.ok(step0.includes("--bootstrap-sync") && step0.length > 0, "sync must live in step 0 (before merge develop)");
  assert.ok(step1.includes("git merge ${mergeTarget}") || step1.includes("git merge develop") || step1.includes("git merge"),
    "step 1 must still carry the merge-develop step");
});


test("⑦b REAL stale sync — a bootstrap-HIT worktree forked before the poll-bounded fix lands: --bootstrap-sync merges develop ⇒ fan-in-execute.js becomes the latest", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", "plugin/workflows/fan-in-execute.js": "" });
  // Before: the worktree's fan-in-execute.js is the OLD (fork-time) version.
  assert.equal(fs.readFileSync(path.join(repo, "plugin", "workflows", "fan-in-execute.js"), "utf8").trim(), "OLD-fan-in-execute");
  const r = runSyncCli(repo, ["--merge-target", "develop"]);
  assert.equal(r.status, 0, `sync cli failed: ${r.stderr}`);
  assert.match(r.stdout, /merged=1/, `the stale worktree must merge develop, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /conflict=1/, "a non-overlapping merge must not conflict");
  // After: the worktree's fan-in-execute.js is the develop-latest (POLL-BOUNDED).
  assert.equal(fs.readFileSync(path.join(repo, "plugin", "workflows", "fan-in-execute.js"), "utf8").trim(), "POLL-BOUNDED-fan-in-execute");
  // The branch's OWN orchestration modification is preserved (self-validation survives the sync).
  assert.equal(fs.readFileSync(path.join(repo, "plugin", "scripts", "fan-in-ff-merge.sh"), "utf8").trim(), "branch-modified-ff-merge");
});


test("⑦b REAL conflict — branch AND develop both modify fan-in-execute.js ⇒ conflict=1 + abort (worktree clean, branch version preserved; step-1 will resolve)", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", "plugin/workflows/fan-in-execute.js": "" });
  // Branch also modifies fan-in-execute.js (overlapping with develop's poll-bounded fix ⇒ conflict)
  fs.writeFileSync(path.join(repo, "plugin", "workflows", "fan-in-execute.js"), "BRANCH-CHANGED-fan-in-execute\n");
  runBash("git add plugin/workflows/fan-in-execute.js && git commit -qm 'branch also changes fan-in-execute'", { cwd: repo });
  const r = runSyncCli(repo, ["--merge-target", "develop"]);
  assert.equal(r.status, 0, `sync cli failed: ${r.stderr}`);
  assert.match(r.stdout, /conflict=1/, `overlapping fan-in-execute.js edits must conflict, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /merged=1/, "a conflicting merge must not report merged");
  // Abort left the worktree clean and the branch version intact.
  const status = runBash("git status --porcelain --untracked-files=no", { cwd: repo });
  assert.equal(status.stdout.trim(), "", `worktree must be clean after abort, got: ${status.stdout}`);
  assert.equal(fs.readFileSync(path.join(repo, "plugin", "workflows", "fan-in-execute.js"), "utf8").trim(), "BRANCH-CHANGED-fan-in-execute");
});


test("⑦b REAL dirty — a worktree with a tracked modification ⇒ skipped (step-1 merge handles it; never clobbers local work)", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", "plugin/workflows/fan-in-execute.js": "" });
  fs.writeFileSync(path.join(repo, "README.md"), "uncommitted local edit\n");
  const r = runSyncCli(repo, ["--merge-target", "develop"]);
  assert.equal(r.status, 0, `sync cli failed: ${r.stderr}`);
  assert.match(r.stdout, /skipped=1/, `a dirty worktree must be skipped, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /merged=1/, "a dirty worktree must not be merged by the sync");
});


test("⑦b REAL json — the sync reports a machine-readable outcome (merged/conflict/skipped) for the dispatch rule", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", "plugin/workflows/fan-in-execute.js": "" });
  const r = spawnSync("node", ["--experimental-strip-types", SEL_CLI, "--bootstrap-sync", "--worktree", repo, "--merge-target", "develop", "--json"], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.merged, true, JSON.stringify(parsed));
  assert.equal(parsed.conflict, false, JSON.stringify(parsed));
  assert.ok(parsed.head, `merged result must carry the new HEAD, got: ${JSON.stringify(parsed)}`);
});

// ── ⑧ suite 等待 + 阶段 2 承载 (gap-fan-in-turn-budget-suite-timeout → gap-subagent-turn-budget-13min-falsified) ──
// AC1 取假: 构造 step2 code_delta 非空 ⇒ 全量 suite 必跑且机械步骤必完成（flip/ff/bracket 全执行）。
// 2026-08-20 证伪: 旧设计假设「subagent ~13min 回合预算硬超时」⇒ 每轮起一个新短命轮询 agent + 脚本
// setTimeout。该数字是假的（真实限制仅 Bash 单次 600s 硬顶 + suite 实测 19+ min）⇒ 修复: suite 交给
// 【长生命周期载体】(detached setsid 进程)，【等待】由【单个阶段 2 agent】在本回合内多次 <600s Bash
// 循环承担（有界阻塞等待 timeout 540 + sleep 15，最多 maxSuitePolls 次），suite 绿后执行机械步骤；
// suite 红 ⇒ 返回 suite-red，脚本派 Fix agent 重启动后重派阶段 2。这些测试用脚本化的 agent 序列驱动
// vm 实执行的工作流, 断言控制流 (绿/红→修/轮询上限/ff-retry) 与 phase 1/2 的 prompt 结构。


test("⑧ turn-budget 取假 — phase-1 suite-launch DETACHES (setsid + & + disown), NOT foreground, NOT Bash(run_in_background:true)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-detach", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-detach", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(launch.includes("setsid"), "suite-launch must use setsid (detached session — survives subagent exit)");
  assert.ok(launch.includes("& disown"), "suite-launch must background + disown (long-lived carrier)");
  assert.ok(launch.includes("suite_exit_marker"), "suite-launch must define the exit marker (the script-owned wait signal)");
  assert.ok(launch.includes('rc=$?'), "the detached wrapper must capture the suite exit code");
  assert.ok(launch.includes('printf "exit=%s'), "the detached wrapper must write the exit code to the marker");
  // gap-suite-wait-bash-stale-pid-poll：suite_pid 必须是 wrapper 自写的真实 PID（pidfile），NOT 瞬态
  // setsid 父进程（$! fork 即退——kill -0 恒失败误报死进程，生产实测 2026-08-21，负控制 3 行确认）。
  assert.ok(launch.includes("suite_pid_file="), "suite-launch must write the wrapper PID to a pidfile (kill -0 polls a live process — gap-suite-wait-bash-stale-pid-poll)");
  assert.ok(launch.includes('printf "%s %s\\n" "$$"'), "the detached wrapper must self-record its PID + start timestamp (`pid started_ms`) into the pidfile (kill -0 polls a live process + the cross-relaunch stuck-holder detector needs the held duration — gap-suite-lock-holder-stuck-detection)");
  assert.ok(launch.includes('suite_pid=$(cut -d\' \' -f1 "$suite_pid_file"'), "suite-launch must parse the pid from the 2-field pidfile record (pid = field 1, gap-suite-lock-holder-stuck-detection)");
  assert.ok(!launch.includes("suite_pid=$!"), "suite-launch must NOT record the transient setsid parent PID ($! is dead — fork-and-exit)");
  // ⛔ NOT the two forbidden forms (f6b824b5 实证: Bash(run_in_background:true) 死于 subagent 退出; 前台 bash 超 10min 上限).
  // Only the EXECUTABLE lines matter — the comments legitimately name the forbidden form to forbid it.
  const execLines = launch.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!execLines.some((l) => l.includes("run_in_background")), "suite-launch executable lines must NOT use Bash(run_in_background:true)");
  // Phase 1 must instruct immediate return (no suite wait in the subagent turn).
  const phase1 = prompts[0];
  assert.ok(phase1.includes("不等待 suite") || phase1.includes("立即返回"), "phase-1 must instruct the agent NOT to wait for the suite (立即返回)");
  assert.ok(phase1.includes("bash scripts/test.sh --for-task"), "scoped gate stays in phase 1");
  assert.ok(phase1.includes("bash scripts/test.sh --static-checks-doc"), "doc check stays in phase 1");
});


test("⑧ turn-budget 取假 — suite-launch block decides by code_delta: non-empty ⇒ full suite starts; empty ⇒ doc-only skip", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-delta", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-delta", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // step 2 hands code_delta to step 4 via a file (bash vars don't persist across Bash calls).
  assert.ok(launch.includes("/tmp/fan-in-code-delta-"), "launch must read the code_delta handoff written by step 2");
  assert.ok(launch.includes('[ "$code_delta" != "" ]'), "launch must branch on code_delta non-empty ⇒ start the full suite");
  assert.ok(launch.includes("full_suite_ran=true"), "the full-suite branch must write full_suite_ran=true");
  assert.ok(launch.includes("skip_reason=doc-only-delta"), "the doc-only branch must write skip_reason=doc-only-delta");
  assert.ok(launch.includes("PRE-VERIFIED-SUITE"), "the pre-verified reuse branch must be present (suite_head-pinned)");
});


test("AC126 AC1 — the fan-in suite launch runs full-suite-runner.ts --buckets <task-id> (bucket-execution wiring, unified onto the correct runner)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-ac126-wiring", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-ac126", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // The suite-launch command string must carry `--buckets <task-id>` — the task id is interpolated at
  // workflow-build time, so the literal task id must appear (AC1: 生产 suite 路径真正传).
  assert.ok(launch.includes("--buckets gap-ac126-wiring"), "suite-launch must pass --buckets <task-id> (the interpolated task id)");
  const setsidLine = launch.split("\n").find((l) => l.includes("setsid bash -c"));
  assert.ok(setsidLine, "suite-launch must contain the detached setsid launch line");
  // gap-fan-in-red-bucket-run-not-recorded AC2 — the bucket path runs through the CORRECT runner
  // (full-suite-runner.ts --buckets), the single writer of verification-round.jsonl green AND red — NOT a
  // parallel `bash scripts/test.sh` harness + green-only writer (the human ruling: 定义正确机制并实现).
  assert.ok(setsidLine.includes("full-suite-runner.ts"), "the detached launch command must run full-suite-runner.ts (the correct runner)");
  assert.ok(setsidLine.includes("--buckets gap-ac126-wiring"), "the runner must be passed --buckets <task-id>");
  assert.ok(setsidLine.includes("--state-dir"), "the runner must be passed --state-dir (writes state/ledgers into the shared checkout)");
  assert.ok(setsidLine.includes("--runner inner"), "the runner must be passed --runner inner (explicit layer identity)");
  assert.ok(setsidLine.includes("--log-file"), "the runner must be passed --log-file (tees the suite stream into the fan-in log)");
  assert.ok(!setsidLine.includes("bash scripts/test.sh --buckets"), "the detached launch must NOT run a parallel bash scripts/test.sh harness");
});


test("gap-fan-in-red-bucket-run-not-recorded AC2 — the detached suite-launch no longer hand-spawns a suite-load-sampler (the runner spawns its own state-driven sampler)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-sampler-wiring", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-test-sampler-wiring", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // The old detached direct run (setsid bash scripts/test.sh) bypassed full-suite-runner.ts (the ONLY
  // spawner of suite-load-sampler.ts), so it hand-spawned the sampler + a per-task state file. Now the
  // bucket path runs THROUGH the runner, which spawns its OWN state-driven sampler — the manual spawn is
  // gone (two parallel mechanisms converged to one: the runner is the single sampler spawner again).
  assert.ok(!launch.includes("suite-load-sampler.ts"), "suite-launch must NOT hand-spawn suite-load-sampler.ts (the runner spawns it)");
  assert.ok(!launch.includes("fan-in-suite-sampler-"), "suite-launch must NOT manage a per-task sampler state file (the runner owns the sampler lifecycle)");
});
