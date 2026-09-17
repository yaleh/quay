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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/10 (9 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, antiDriftLandBlockFor, assert, bootstrapBlockFor, bracketCloseBlockFor, cleanup, extractBlockFromPrompts, makeAntiDriftRepo, makeRepoWithDelta, makeTelemetryFakeRoot, path, promptContaining, runBash, runWorkflow, startBracket, symlinkPluginForGit, symlinkRuntimeTrees } from "./helpers/fan-in-execute-paths-harness.mjs";

test("⑨ AC2 idempotent — a normal fan-in with NO fix commit passes the land re-check (repeat of step 1)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-adland-none",
    body: "---\nid: gap-test-adland-none\nstatus: ready\n---\n## Touches\n- tasks/gap-test-adland-none.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  symlinkPluginForGit(repo);
  const land = await antiDriftLandBlockFor("gap-test-adland-none", repo);
  const r = runBash(land, { cwd: repo });
  assert.equal(r.status, 0, `no-fix normal fan-in must pass the land re-check, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/, "driver must print ANTI-DRIFT OK");
});

// ── ⑥ bracket-close (gap-fan-in-auto-close-telemetry-bracket, occurrence 3) ─────────────────────────
// The fan-in flow's step 5.5 closes the fanned-in task's telemetry bracket AFTER the ff succeeds
// (dispatch's --task-start was never closed on land ⇒ stale bracket until a manual/outer reconcile).
// The closure goes through closure-lag-check.sh --close-task (the A16 unified closure point) keyed by
// --taskId — it must target ONLY the task being fanned in, never a global --reconcile scan (判据2:
// in-flight / not-landed brackets must be preserved).

/** A temp "workspace root" for bracket-close tests: a real `tasks/` dir (closure-lag-check requires
 *  one) + a symlinked real `plugin/` tree (the closure command resolves `${root}/plugin/scripts/…`).
 *  The telemetry store lives under `<root>/.workflow-events/` written by the REAL fast-mode-telemetry.ts. */

/** Open ONE real telemetry bracket via the REAL --task-start. Returns the runId. */



test("⑥ wiring — the fan-in prompt carries a bracket-close block targeting ONLY the fanned-in task (no global --reconcile scan)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-close", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-close", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# bracket-close-block-start", "# bracket-close-block-end");
  assert.ok(block.includes("closure-lag-check.sh --close-task"), "block must call the A16 unified closure point");
  assert.ok(block.includes("--taskId gap-test-close"), "block must target the fanned-in task by id");
  assert.ok(block.includes("--outcome done"), "block must close with outcome done");
  assert.ok(block.includes("--root "), "block must pass the workspace root");
  // 判据2: the block must not INVOKE a global --reconcile scan (only the comment mentions it to forbid
  // it). The executable lines (non-#-comment) must be free of a --reconcile invocation.
  const execLines = block.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!execLines.some((l) => l.includes("--reconcile")), "executable lines must not run a global --reconcile scan (判据2: in-flight brackets preserved)");
  // The return contract (bracketClosed) and placement checks live in the PHASE-2 prompt (the block's own prompt).
  const p2 = promptContaining(prompts, "# bracket-close-block-start");
  assert.ok(p2.includes("bracketClosed"), "the return contract must carry the bracket-closure result");
  // placement: the block runs AFTER the ff-merge call and BEFORE the worktree cleanup.
  const ffIdx = p2.indexOf("ff-merge.ts --task");
  const blockIdx = p2.indexOf("# bracket-close-block-start");
  const cleanupIdx = p2.indexOf("ff 成功后清理");
  assert.ok(ffIdx !== -1, "ff-merge call present");
  assert.ok(blockIdx > ffIdx, "bracket-close must come after the ff-merge call");
  assert.ok(cleanupIdx > blockIdx, "bracket-close must come before the worktree cleanup");
});


test("⑥ REAL bracket-close — closes the fanned-in task's bracket AND preserves an in-flight task's bracket (判据2)", async (t) => {
  const root = makeTelemetryFakeRoot();
  t.after(() => cleanup(root));
  const runIdA = startBracket(root, "gap-test-close-a");
  const runIdB = startBracket(root, "gap-test-close-b");
  // worktree arg = the telemetry fake root (has plugin/ symlinked) — the block now resolves the
  // closure-lag-check.sh SCRIPT from ${worktree} (gap-fan-in-orchestration-bootstrap-self-fix).
  const block = await bracketCloseBlockFor("gap-test-close-a", root, root, runIdA);
  const r = runBash(block, { cwd: REPO_ROOT });
  assert.equal(r.status, 0, `bracket-close block must exit 0: ${r.stderr}`);
  const rep = runBash(`node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json --root "${root}"`, { cwd: REPO_ROOT });
  assert.equal(rep.status, 0, `report failed: ${rep.stderr}`);
  const report = JSON.parse(rep.stdout);
  const inProgressIds = (report.inProgress || []).map((p) => p.taskId);
  const completedIds = (report.tasks || []).map((c) => c.taskId);
  assert.ok(!inProgressIds.includes("gap-test-close-a"), `task A (landed) must leave inProgress after close; inProgress=${JSON.stringify(inProgressIds)}`);
  assert.ok(completedIds.includes("gap-test-close-a"), `task A must be a completed start+end pair; completed=${JSON.stringify(completedIds)}`);
  assert.ok(inProgressIds.includes("gap-test-close-b"), `task B (in-flight, not landed) must KEEP its bracket; inProgress=${JSON.stringify(inProgressIds)}`);
  assert.ok(!completedIds.includes("gap-test-close-b"), `task B must NOT be closed`);
});


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
