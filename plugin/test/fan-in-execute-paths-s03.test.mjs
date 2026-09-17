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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/6 (15 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, SEL_CLI, assert, bootstrapBlockFor, bracketCloseBlockFor, cleanup, extractBlockFromPrompts, fs, makeRepoWithDelta, makeStaleBootstrapRepo, makeTelemetryFakeRoot, path, promptContaining, runBash, runSyncCli, runWorkflow, spawn, spawnSync, startBracket, symlinkRuntimeTrees, vm } from "./helpers/fan-in-execute-paths-harness.mjs";

test("⑥ REAL idempotent — a task with NO open bracket is a no-op (exit 0, no write)", async (t) => {
  const root = makeTelemetryFakeRoot();
  t.after(() => cleanup(root));
  const runIdA = startBracket(root, "gap-test-close-a");
  const block = await bracketCloseBlockFor("gap-test-close-a", root, root, runIdA);
  // Close once (writes the end event)…
  assert.equal(runBash(block, { cwd: REPO_ROOT }).status, 0);
  // …then close again: no open bracket ⇒ --close-task exits 0, no second end event.
  assert.equal(runBash(block, { cwd: REPO_ROOT }).status, 0, "second close must be an idempotent no-op");
  const rep = runBash(`node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json --root "${root}"`, { cwd: REPO_ROOT });
  const report = JSON.parse(rep.stdout);
  assert.ok(!(report.inProgress || []).some((p) => p.taskId === "gap-test-close-a"), "bracket must stay closed");
  assert.equal((report.tasks || []).filter((c) => c.taskId === "gap-test-close-a").length, 1, "exactly one completed pair");
});

// ── ⑦ verification-round 入账统一 (gap-fan-in-red-bucket-run-not-recorded) ──────────────────────────
// The fan-in bucket path now runs through full-suite-runner.ts --buckets (SUITE_LAUNCH), which is the
// single writer of verification-round.jsonl (green AND red), full-suite-state.json, measure-history.jsonl
// and suite-load-<runId>.jsonl. The OLD step-4.5 mirror writers (pre-verified-round-record.ts /
// mirror-full-suite-state.ts / mirror-measure-history.ts) — a green-only parallel harness grafted onto the
// bypassed runner — are REMOVED (两套平行机制收敛为一). A red bucket round is now recorded by the runner
// at suite exit (state=red in verification-round.jsonl), not left unrecorded (硬规则 3b).


test("⑦ wiring — the fan-in prompt no longer carries the green-only mirror writers (the runner writes verification-round green+red)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-pvr", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-pvr", mergeTarget: "develop" },
  });
  // The phase-2 prompt (step 4.5) must NOT invoke any of the three mirror writers — the runner already
  // wrote verification-round.jsonl / full-suite-state.json / measure-history.jsonl at suite exit (green+red).
  const p2 = promptContaining(prompts, "per-task-suite-record.ts");
  assert.ok(!p2.includes("pre-verified-round-record.ts"), "phase-2 must NOT call pre-verified-round-record.ts (the green-only writer is retired from the fan-in path)");
  assert.ok(!p2.includes("mirror-full-suite-state.ts"), "phase-2 must NOT call mirror-full-suite-state.ts (the runner writes full-suite-state.json)");
  assert.ok(!p2.includes("mirror-measure-history.ts"), "phase-2 must NOT call mirror-measure-history.ts (the runner writes measure-history.jsonl)");
  // per-task-suite-record stays: it writes per-task-suite-records.jsonl (a SEPARATE ledger the runner does not write).
  assert.ok(p2.includes("per-task-suite-record.ts"), "phase-2 must still write the per-task-suite record (a separate ledger)");
});

// ── ⑦ fan-in orchestration bootstrap (gap-fan-in-orchestration-bootstrap-self-fix) ───────────────────
// THE DEFECT: fan-in orchestration files resolve from the MAIN checkout, so a task that modifies one of
// them (fan-in-execute.js / select-static-checks-for-touches.ts / fan-in-ff-merge.sh / per-task-suite-
// record.ts / full-suite-runner.ts) has its own fan-in run by the OLD main version — its fix is never
// exercised (self-reference). FIX: (a) the A6 dispatch rule uses the WORKTREE scriptPath when the branch
// modifies an orchestration file (driven by --bootstrap-orchestration, tested below); (b) every fan-in
// orchestration script call in the prompt resolves from ${worktree} (not cwd, not ${root}).



test("⑦ worktree-resolution — every fan-in orchestration script call is ${worktree}-rooted (not cwd, not ${root})", async (t) => {
  const WT = "/tmp/wt"; // the interpolated worktree value in the emitted prompts
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-bs", worktree: WT, root: REPO_ROOT, runId: "fm-bs", mergeTarget: "develop" },
  });
  const all = prompts.join("\n\n----PROMPT----\n\n");
  // The orchestration scripts a task can modify MUST resolve from the worktree — the branch's own fix
  // must be what the fan-in runs (gap-fan-in-orchestration-bootstrap-self-fix). Across the split fan-in,
  // some live in phase 1 (classify/anti-drift/ts-typecheck) and some in phase 2 (record/flip/ff/bracket).
  const mustBeWorktreeRooted = [
    "select-static-checks-for-touches.ts --classify-delta", // step 2 (phase 1)
    "per-task-suite-record.ts",                             // step 4.5 (phase 2)
    "fan-in-ac-completion-gate.ts",                         // step 5 (phase 2)
    "closure-lag-check.sh",                                 // step 5.5 (phase 2)
    "anti-drift-touches-check.ts",                          // step 1 (phase 1)
    "fan-in-ts-typecheck-gate.ts",                          // step 3 (phase 1)
  ];
  for (const frag of mustBeWorktreeRooted) {
    // Match the EXECUTABLE line (not a comment that merely mentions the frag): the line must carry
    // both the frag and the worktree-rooted path.
    const line = all.split("\n").find((l) => l.includes(frag) && l.includes(`${WT}/plugin/scripts/`));
    assert.ok(line, `a prompt must carry a ${WT}-rooted call to ${frag}`);
    assert.doesNotMatch(line, /bash \$\{?root\}?\/plugin\/scripts/, `call must NOT be root-rooted: ${line}`);
  }
  // The ff-merge moved to the TS module (gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-
  // live): it is worktree-rooted at packages/quay/src/fan-in/ff-merge.ts — a DIFFERENT path prefix
  // than the plugin/scripts orchestration scripts above, so it is asserted separately.
  const ffLine = all.split("\n").find((l) => l.includes("ff-merge.ts --task"));
  assert.ok(ffLine, "a prompt must carry a worktree-rooted ff-merge.ts call");
  assert.ok(ffLine.includes(`${WT}/packages/quay/src/fan-in/ff-merge.ts`), `ff-merge must be ${WT}-rooted at packages/quay/src/fan-in, not plugin/scripts: ${ffLine}`);
  // The scoped gate (step 4) still runs `cd ${worktree} && bash scripts/test.sh --for-task` (worktree-rooted);
  // the full-suite bucket path is the SUITE_LAUNCH `cd "$1" && node plugin/scripts/full-suite-runner.ts` —
  // also worktree-rooted (the runner resolves through the worktree's plugin tree).
  assert.ok(all.includes(`cd ${WT} && bash scripts/test.sh --for-task`), "step-4 scoped run must cd into the worktree");
  // step-2 classify carries the worktree-rooted registry (--root <worktree>) so a branch-modified
  // scripts/test.sh @static-object annotation is what the classification reads.
  const classifyLine = all.split("\n").find((l) => l.includes("--classify-delta") && l.includes(`--root ${WT}`));
  assert.ok(classifyLine, `classify must carry the worktree-rooted --root, got none among:\n${all.split("\n").filter((l) => l.includes("--classify-delta")).join("\n")}`);
  assert.ok(classifyLine.includes(`${WT}/plugin/scripts/`), `classify must be ${WT}-rooted, got: ${classifyLine}`);
});


test("⑦ 取假一 — a branch modifying plugin/workflows/fan-in-execute.js ⇒ step-0 verdict HIT + WARN (dispatch must use the worktree scriptPath)", async (t) => {
  const repo = makeRepoWithDelta({ "plugin/workflows/fan-in-execute.js": "export const meta = { name: 'fan-in-execute-branch-version' }\n" });
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/workflows/fan-in-execute.js": "" });
  const block = await bootstrapBlockFor("gap-test-bs-hit", repo, REPO_ROOT);
  const r = runBash(block, { cwd: repo });
  assert.equal(r.status, 0, `step-0 bash failed: ${r.stderr}`);
  assert.match(r.stdout, /FAN-IN-BOOTSTRAP=hit/, `branch modifying fan-in-execute.js must be detected as a hit, got stdout:\n${r.stdout}`);
  assert.match(r.stdout, /plugin\/workflows\/fan-in-execute\.js/, "the hit must name the modified orchestration file");
  // 取假一 WARN (falsifiable): the running workflow is the ROOT version (REPO_ROOT), which differs from
  // the branch's committed fan-in-execute.js ⇒ the self-bootstrap gap is detected at runtime (if the A6
  // dispatcher followed the hit and used the worktree scriptPath, this WARN would NOT fire).
  assert.match(r.stderr, /FAN-IN-BOOTSTRAP-WARN/, `root workflow running against a modified branch copy must warn, got stderr:\n${r.stderr}`);
});


test("⑦ 取假一 negative — a branch modifying only tasks/*.md ⇒ step-0 verdict MISS (main-checkout scriptPath is correct)", async (t) => {
  const repo = makeRepoWithDelta({ "tasks/gap-test-bs-miss.md": "status: ready\n" });
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "tasks/gap-test-bs-miss.md": "" });
  const block = await bootstrapBlockFor("gap-test-bs-miss", repo, REPO_ROOT);
  const r = runBash(block, { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /FAN-IN-BOOTSTRAP=miss/, `doc-only branch must be a miss, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /FAN-IN-BOOTSTRAP=hit/, "a doc-only branch must NOT be a hit");
  assert.doesNotMatch(r.stderr, /FAN-IN-BOOTSTRAP-WARN/, "a doc-only branch must not warn");
});


test("⑦ 取假二 — a branch modifying an orchestration script AND carrying a checker-read .md ⇒ HIT + the .md classifies as CODE (old regex called it doc)", async (t) => {
  // The branch modifies plugin/scripts/fan-in-ff-merge.sh (an orchestration file, not the classify
  // script — so the symlinked REAL classify runs) AND carries orchestration/manager-tick-core.md in
  // its delta. 取假二: the OLD hand-written `[.]md$` regex called that .md doc ⇒ the fan-in skipped the
  // full suite; the worktree-resolved registry classify must call it CODE.
  const repo = makeRepoWithDelta({
    "plugin/scripts/fan-in-ff-merge.sh": "export const x = 1\n",
    "orchestration/manager-tick-core.md": "## (src:N) violation\n",
  });
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", "orchestration/manager-tick-core.md": "" });
  // step 0: the branch modifies an orchestration file ⇒ HIT (dispatcher must use the worktree scriptPath).
  const block = await bootstrapBlockFor("gap-test-bs-two", repo, REPO_ROOT);
  const r0 = runBash(block, { cwd: repo });
  assert.equal(r0.status, 0, r0.stderr);
  assert.match(r0.stdout, /FAN-IN-BOOTSTRAP=hit/, `orchestration-script modification must be a hit, got stdout:\n${r0.stdout}`);
  assert.match(r0.stdout, /fan-in-ff-merge\.sh/, "the hit must name the modified orchestration file");
  // step 2: the worktree-resolved classify (--root ${worktree}) must classify the checker-read .md as CODE.
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-bs-two", worktree: repo, root: REPO_ROOT, runId: "fm-bs-two", mergeTarget: "develop" },
  });
  const step2 = extractBlockFromPrompts(prompts, "【无锁段 step 2", "【无锁段 step 3");
  const bashLines = step2.split("\n").filter((l) => /^(fork=|delta=|code_delta=)/.test(l));
  const r2 = runBash(bashLines.join("\n") + '\necho "RESULT_CODE_DELTA=[$code_delta]"', { cwd: REPO_ROOT });
  assert.equal(r2.status, 0, `step-2 bash failed: ${r2.stderr}`);
  const m = r2.stdout.match(/RESULT_CODE_DELTA=\[([\s\S]*)\]/);
  assert.ok(m, `code_delta echo missing:\n${r2.stdout}`);
  assert.match(m[1], /orchestration\/manager-tick-core\.md/, `checker-read .md must classify as code (取假二), got: ${m[1]}`);
  assert.match(m[1], /plugin\/scripts\/fan-in-ff-merge\.sh/, `the modified orchestration script must also be code, got: ${m[1]}`);
});


/** A hermetic repo modeling the stale-bootstrap shape: develop carries an OLD fan-in-execute.js, then
 *  advances with the POLL-BOUNDED fix; a task branch forks from the OLD base and modifies a DIFFERENT
 *  orchestration file (bootstrap-HIT) — so its own fan-in-execute.js is stale. Returns the dir. */



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
