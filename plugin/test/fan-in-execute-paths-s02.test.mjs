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

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/6 (16 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, antiDriftBlockFor, antiDriftLandBlockFor, assert, bracketCloseBlockFor, buildTaskManifest, checkTaskAntiDrift, cleanup, commitFiles, extractBlockFromPrompts, flipBlockFor, fs, makeAntiDriftRepo, makeFlipDir, makeTelemetryFakeRoot, os, path, promptContaining, runBash, runWorkflow, startBracket, symlinkPluginForGit } from "./helpers/fan-in-execute-paths-harness.mjs";

test("③ multiple exact 'status: ready' matches ⇒ exit 2 + FATAL (refuses to multi-flip)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-flipmulti-"));
  t.after(() => cleanup(dir));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  const taskFile = path.join(dir, "tasks", "gap-test-multi.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-multi",
    "status: ready",
    "---",
    "## Evidence",
    "status: ready",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-multi", dir), { cwd: dir });
  assert.equal(r.status, 2, `ambiguous (2 exact matches) must exit 2, got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /应恰有 1 行/);
});

// ── ④ flip AC-completion gate (gap-fan-in-flip-no-ac-completion-check, REAL bash) ───────────────


test("④ AC 未全勾（gap-ac72 形态真样本）⇒ exit 2 + FATAL, 不翻 done (workflow no longer bypasses AC47)", async (t) => {
  const dir = makeFlipDir("fan-in-flipac-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-acfail.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-acfail",
    "status: ready",
    "---",
    "## Acceptance Criteria",
    "- [ ] AC1 判据1：未勾",
    "- [ ] AC2 判据2：未勾",
    "## Definition of Done",
    "- [ ] DoD 未勾",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-acfail", dir), { cwd: dir });
  assert.equal(r.status, 2, `AC 未全勾 must exit 2 (flip refused), got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /AC 完成闸未通过/);
  const after = fs.readFileSync(taskFile, "utf8");
  assert.match(after, /^status: ready$/m, "file must NOT be flipped when ACs are unchecked");
  assert.doesNotMatch(after, /^status: done$/m, "file must NOT be flipped when ACs are unchecked");
});


test("④ AC/DoD 段缺失 ⇒ exit 2 NOT-EVALUATED, 不翻 done (无法评估 ≠ 合格)", async (t) => {
  const dir = makeFlipDir("fan-in-flipacnone-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-nosec.md");
  fs.writeFileSync(taskFile, "---\nid: gap-test-nosec\nstatus: ready\n---\n## Plan\nonly a plan\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-nosec", dir), { cwd: dir });
  assert.equal(r.status, 2, `missing AC/DoD section must exit 2 (NOT-EVALUATED), got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(fs.readFileSync(taskFile, "utf8"), /^status: ready$/m, "file must NOT be flipped when AC/DoD section is absent");
});


test("④ 剩余未勾均为（待外部）⇒ 翻 done (established awaiting-verification done-flip shape)", async (t) => {
  const dir = makeFlipDir("fan-in-flipacext-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-ext.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-ext",
    "status: ready",
    "---",
    "## Acceptance Criteria",
    "- [x] AC1 impl done",
    "- [ ] AC2 等全量套件绿（待外部）",
    "## Definition of Done",
    "- [ ] 外层验证（待外部）",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-ext", dir), { cwd: dir });
  assert.equal(r.status, 0, `待外部-only must flip (exit 0), got ${r.status}: ${r.stderr}`);
  assert.match(fs.readFileSync(taskFile, "utf8"), /^status: done$/m, "frontmatter flipped to done");
});


test("④ AC 完成闸与承重点③ 行形检查并列 — 两检查都过才翻（AC 闸在行形检查之后、sed 之前）", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-both", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-both", mergeTarget: "develop" },
  });
  const flip = extractBlockFromPrompts(prompts, "# flip-block-start", "# flip-block-end");
  assert.ok(flip.includes("fan-in-ac-completion-gate.ts"), "flip block must run the AC completion gate (判据3 兼容不互斥)");
  assert.ok(flip.includes("flip_count=$(grep -c '^status: ready$'"), "flip block must still run the ③ line-shape pre-check");
  assert.ok(flip.indexOf("fan-in-ac-completion-gate.ts") > flip.indexOf("flip_count="), "AC gate must come AFTER the line-shape pre-check");
  assert.ok(flip.indexOf("fan-in-ac-completion-gate.ts") < flip.indexOf("sed -i"), "AC gate must come BEFORE the sed flip");
});

// ── ⑤ anti-drift-touches 守卫（gap-anti-drift-touches-zero-coverage-fast-mode, REAL git + REAL prompt）──

/** A real temp git repo replaying the fan-in workflow's step-1 post-merge state: `develop` is the
 *  landing baseline with a doc-only commit, the task branch (`task/<id>`) FORKS FROM `develop` and
 *  holds the task file + the task's changed files, `develop` advances while the task runs, and it is
 *  then MERGED into the task branch (so `git diff --name-only develop...HEAD` = exactly the files the
 *  fan-in would land — develop's own doc change excluded). The REAL `plugin/` tree is symlinked in
 *  AFTER the final commit/merge so it is never part of the git diff.
 *
 *  ⚠️ BRANCH MODEL (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing): the
 *  topology is part of what the check under test judges. `anti-drift-touches-check` classifies the
 *  merge target against the project's default branch BEFORE computing the diff, and a target that is
 *  NOT a continuation of it is reported as `BASELINE-MISMATCH` (exit 3 — a verdict about the REPO's
 *  shape, deliberately never folded into "N violation(s)"). Committing the task's work on `main` and
 *  merging `develop` INTO `main` builds exactly that divergent shape (main is then no longer an
 *  ancestor of develop), so the anti-drift judgment these tests assert would never be reached. This
 *  fixture must therefore model a quay-initialized repo: `main` stays an ancestor of `develop`, and
 *  the work is committed on a branch forked from `develop`. */



test("⑤ wiring — step 1 runs anti-drift-touches-check with the actual diff after the merge", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-ad-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-ad-wire", mergeTarget: "develop" },
  });
  const step1 = extractBlockFromPrompts(prompts, "【无锁段 step 1", "【无锁段 step 2");
  assert.ok(step1.includes("# anti-drift-block-start"), "anti-drift check must run inside step 1 (after the merge)");
  assert.ok(step1.includes("anti-drift-touches-check.ts --task"), "prompt must invoke the anti-drift driver");
  assert.ok(step1.includes("--merge-target develop"), "driver must receive the merge target");
});


test("⑤ driver unit — buildTaskManifest extracts declared Touches as globs (ONE touches-parser)", () => {
  const body = "---\nid: x\n---\n## Touches\n- tasks/x.md\n- plugin/test/**\n";
  const builds = buildTaskManifest(body, ["tasks/x.md", "plugin/test/a.test.mjs"]);
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0].declaredGlobs, ["tasks/x.md", "plugin/test/**"]);
  assert.deepEqual(builds[0].actualFiles, ["tasks/x.md", "plugin/test/a.test.mjs"]);
});


test("⑤ driver unit — a legitimately scoped task build is OK; a stray write is HARD-FAIL (judgment unchanged)", () => {
  const ok = checkTaskAntiDrift("## Touches\n- pkg/a/**\n", ["pkg/a/x.js", "pkg/a/y.js"]);
  assert.equal(ok.ok, true, "actual ⊆ declared must be clean");
  const stray = checkTaskAntiDrift("## Touches\n- pkg/a/**\n", ["pkg/a/x.js", "pkg/OTHER/stray.js"]);
  assert.equal(stray.ok, false, "out-of-declared write must be a violation");
  assert.ok(stray.violations.find((v) => v.type === "out-of-declared" && v.file === "pkg/OTHER/stray.js"));
});


test("⑤ REAL negative control — a task whose ACTUAL diff touches a file OUTSIDE its declared Touches ⇒ HARD-FAIL (AC2)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-ad",
    body: "---\nid: gap-test-ad\nstatus: ready\n---\n## Touches\n- tasks/gap-test-ad.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/OTHER/stray.js": "stray\n" },
  });
  t.after(() => cleanup(repo));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(repo, "plugin"), "dir");
  const block = await antiDriftBlockFor("gap-test-ad", repo);
  const r = runBash(block, { cwd: repo });
  assert.notEqual(r.status, 0, `out-of-scope touch must HARD-FAIL (exit non-zero), got ${r.status}`);
  assert.match(r.stdout, /ANTI-DRIFT HARD FAIL/, "driver must print ANTI-DRIFT HARD FAIL");
  assert.match(r.stdout, /pkg\/OTHER\/stray\.js/, "the out-of-declared file must be named");
  assert.match(r.stderr, /FATAL/, "the block must FATAL on the guardrail bite");
});


test("⑤ REAL positive — a task whose ACTUAL diff is fully within its declared Touches ⇒ stays green (AC3)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-ad-ok",
    body: "---\nid: gap-test-ad-ok\nstatus: ready\n---\n## Touches\n- tasks/gap-test-ad-ok.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(repo, "plugin"), "dir");
  const block = await antiDriftBlockFor("gap-test-ad-ok", repo);
  const r = runBash(block, { cwd: repo });
  assert.equal(r.status, 0, `legitimate scoped change must stay green, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/, "driver must print ANTI-DRIFT OK");
});

// ── ⑨ land 前 anti-drift 重跑（gap-fan-in-fix-commit-delta-escapes-touches-coverage）────────────────
// THE DEFECT: step-1's anti-drift check runs right after the merge; fix-agent commits (suite red → fix
// patch → re-run) land AFTER it, so their touched files are never re-checked against ## Touches (real:
// gap-worktree-remove-orphans-probes's fix commit c2917261 modified full-suite-runner.test.mjs — outside
// Touches — and landed unnoticed). FIX: re-run the SAME driver at land time (持锁段 step 5, before flip
// done / ff), where `git diff --name-only ${mergeTarget}...HEAD` now includes the fix commits. Judgment
// logic UNCHANGED (AC3); only a call site is added. Normal fan-in (no fix, or fix within Touches) must
// not false-positive (AC2).


/** Symlink the REAL plugin/ tree into a temp repo as a RUNTIME-ONLY tree, and keep it OUT of git.
 *  The real fan-in worktree has plugin/ as a TRACKED real dir; here it is only a runtime-resolution
 *  symlink (the driver resolves ${worktree}/plugin/scripts/…). Without the .git/info/exclude entry a
 *  later `git add -A` (a fix-agent commit) would stage the symlink and pollute `git diff`.
 *  ⛔ HAZARD: because this symlink points at the REAL repo's plugin/, any test that WRITES a file under
 *  <temp>/plugin/… writes through the symlink into the real worktree (the recorded
 *  full-suite-runner.test.mjs truncation, 2026-08-17). Fix-agent commit fixtures in this file must use
 *  a NON-plugin path (e.g. packages/quay/test/…) to model the out-of-scope file. */



test("⑨ wiring — the phase-2 prompt carries a land-time anti-drift block BEFORE flip done / ff (持锁段 step 5)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-adland-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-adland-wire", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# anti-drift-land-block-start", "# anti-drift-land-block-end");
  assert.ok(block.includes("anti-drift-touches-check.ts --task"), "land block must invoke the anti-drift driver");
  assert.ok(block.includes("--merge-target develop"), "land block must pass the merge target");
  assert.ok(block.includes("exit 2"), "land block must fail closed (exit 2) on violation");
  // Placement: the block runs in the phase-2 prompt, in the持锁段 step 5, BEFORE the flip done and the ff.
  const p2 = promptContaining(prompts, "# anti-drift-land-block-start");
  const step5Idx = p2.indexOf("【持锁段 step 5");
  const landIdx = p2.indexOf("# anti-drift-land-block-start");
  const flipIdx = p2.indexOf("# flip-block-start");
  const ffIdx = p2.indexOf("ff-merge.ts --task");
  assert.ok(step5Idx !== -1, "phase-2 prompt must carry 持锁段 step 5");
  assert.ok(landIdx > step5Idx, "land block must be inside step 5 (持锁段)");
  assert.ok(flipIdx > landIdx, "land block must come BEFORE the flip block (flip done)");
  assert.ok(ffIdx > landIdx, "land block must come BEFORE the ff-merge");
});


test("⑨ REAL fix commit out-of-bounds ⇒ HARD FAIL — step-1 passes, the land re-check bites (AC1 取假)", async (t) => {
  // The falsifiable case: step-1's anti-drift (the ONLY check in the pre-fix flow) passes on the pre-fix
  // state; the fix agent then commits a file OUTSIDE Touches (the c2917261 shape: a test file not
  // declared); the land-time re-check must HARD-FAIL (no flip done, no ff).
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-adland",
    body: "---\nid: gap-test-adland\nstatus: ready\n---\n## Touches\n- tasks/gap-test-adland.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  symlinkPluginForGit(repo);
  // 1. The step-1 anti-drift check (the pre-fix flow's only guard) passes on the in-scope state.
  const step1 = await antiDriftBlockFor("gap-test-adland", repo);
  const r1 = runBash(step1, { cwd: repo });
  assert.equal(r1.status, 0, `step-1 anti-drift must pass pre-fix, got ${r1.status}: ${r1.stderr}`);
  assert.match(r1.stdout, /ANTI-DRIFT OK/, "step-1 must print ANTI-DRIFT OK pre-fix");
  // 2. The fix agent commits a file OUTSIDE Touches (the recorded defect shape: a test file not
  // declared). NOTE: NOT under plugin/ — the temp repo's plugin/ is a runtime-only symlink excluded
  // from git; the out-of-declared falsifiability is path-independent (the c2917261 shape = a test file
  // outside the declared Touches).
  commitFiles(repo, { "packages/quay/test/full-suite-runner.test.mjs": "import { test } from 'node:test'\n" }, "fix: hermetic seam");
  // 3. The land-time re-check must now HARD-FAIL (the fix commit's file is out-of-declared).
  const land = await antiDriftLandBlockFor("gap-test-adland", repo);
  const r2 = runBash(land, { cwd: repo });
  assert.notEqual(r2.status, 0, `land re-check must HARD-FAIL on the fix commit's out-of-scope file, got ${r2.status}`);
  assert.match(r2.stdout, /ANTI-DRIFT HARD FAIL/, "driver must print ANTI-DRIFT HARD FAIL");
  assert.match(r2.stdout, /packages\/quay\/test\/full-suite-runner\.test\.mjs/, "the fix commit's out-of-declared file must be named");
  assert.match(r2.stderr, /FATAL/, "the block must FATAL (no flip done, no ff)");
});


test("⑨ AC2 idempotent — a fix commit fully WITHIN Touches does not false-positive (land re-check passes)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-adland-ok",
    body: "---\nid: gap-test-adland-ok\nstatus: ready\n---\n## Touches\n- tasks/gap-test-adland-ok.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  symlinkPluginForGit(repo);
  // The fix agent commits a file WITHIN Touches (a legit in-scope fix — must NOT false-positive).
  commitFiles(repo, { "pkg/a/z.js": "z\n" }, "fix: in-scope");
  const land = await antiDriftLandBlockFor("gap-test-adland-ok", repo);
  const r = runBash(land, { cwd: repo });
  assert.equal(r.status, 0, `legitimate in-scope fix must stay green, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/, "driver must print ANTI-DRIFT OK");
});


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
