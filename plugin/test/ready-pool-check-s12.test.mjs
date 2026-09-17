// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 12/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { applyPromotions, assert, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, os, parseTask, path, propagateDocBranchToDevelop, setTaskStatus, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("propagateDocBranchToDevelop: doc-branch flip fast-forwards to develop (AC6)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `propagate-ff-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-base", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // The detach: the main checkout moves to a doc-only branch; develop is no longer checked out anywhere.
  git("checkout", "-q", "-b", "author");
  const developBefore = git("rev-parse", "develop");
  // A flip lands on the doc branch (what commitTaskStatus commits before propagate).
  writeTask(root, "gap-flip", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "tasks: gap-flip todo→ready（promotion-driver 机械晋升）");
  assert.notEqual(git("rev-parse", "author"), developBefore, "doc branch advanced past develop");

  propagateDocBranchToDevelop(root);

  assert.equal(git("rev-parse", "develop"), git("rev-parse", "author"),
    "AC6: develop fast-forwarded to the doc branch head — the flip is visible to task worktrees");
});


test("propagateDocBranchToDevelop: develop advanced independently ⇒ semantic sync reconcile (non-ff)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `propagate-nonff-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-base", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "author");
  // Doc branch commits a flip (its own file).
  writeTask(root, "gap-flip", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "flip on doc branch");
  // Develop advances independently (a different file) — the two branches diverge.
  git("checkout", "-q", "develop");
  writeTask(root, "gap-land", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "land on develop");
  const developHead = git("rev-parse", "develop");
  git("checkout", "-q", "author");

  propagateDocBranchToDevelop(root);

  assert.notEqual(git("rev-parse", "develop"), developHead, "develop advanced (semantic sync landed)");
  // 语义兜底把 ff 失败/结果写进 .quay/doc-develop-sync.jsonl（gitignored 运行时遥测，非合并残留）——
  // 干净态判据 = 无 unmerged 路径 + 无 tracked 改动（⛔ 把 untracked .quay 遥测误判成脏树）。
  assert.equal(git("ls-files", "-u"), "", "semantic sync left no unmerged paths");
  assert.equal(
    git("status", "--porcelain").split("\n").filter((l) => l.trim() && !l.includes(".quay/")).join("\n"),
    "",
    "semantic sync left no tracked residue (excluding untracked .quay/ telemetry)",
  );
  assert.match(git("show", "develop:tasks/gap-flip.md"), /^status: ready$/m,
    "the doc-branch flip is visible on develop after semantic sync");
});


test("applyPromotions in a repo-less root still lands the write (committed=false, no throw)", (t) => {
  const root = makeWorkspace("apply-nogit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions[0].committed, false, "repo-less root ⇒ the commit is a no-op, surfaced as committed=false");
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "the status write still lands on disk");
});


test("applyPromotions 每轮无条件双向同步——池空无翻转也同步（⛔ 仍只翻转触发 ⇒ 假，缺口 2026-08-31）", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-pool-empty-sync-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  // 一个已 done 的任务（非 todo ⇒ 非晋升候选 ⇒ 池空无翻转）。
  writeTask(root, "gap-done", { status: "done", labels: ["gap"], body: fourArtifactBody({ checkedAc: 4 }) });
  git("add", ".");
  git("commit", "-q", "-m", "init with done task");
  git("checkout", "-q", "-b", "author");
  // develop 前进（模拟 fan-in 落地），doc 落后 develop——池空无翻转也必须同步。
  git("checkout", "-q", "develop");
  writeTask(root, "gap-landed", { status: "done", labels: ["gap"], body: fourArtifactBody({ checkedAc: 4 }) });
  git("add", ".");
  git("commit", "-q", "-m", "develop-only: gap-landed done (fan-in)");
  git("checkout", "-q", "author");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, false, "无合格候选 ⇒ 池空无翻转（缺口的前提）");
  assert.equal(
    git("rev-parse", "author"),
    git("rev-parse", "develop"),
    "池空无翻转 ⇒ applyPromotions 仍双向同步（doc 追上 develop）",
  );
});

// ── MULTI-PATH TOUCHES GUARD (gap-promotion-driver-commit-bypasses-precommit-touches-guard) ──────────
// The promotion commit path runs `git commit --no-verify`, so the pre-commit hook's Touches detector
// never fires there (production: e7be44a0 landed a `serve-handlers.ts + serve.ts` bullet). The guard
// re-runs the SAME judgment BEFORE the status write — a multi-path candidate must NOT be promoted
// (stays todo, tree stays clean, reason surfaced), the negative control against the silent bypass.


test("applyPromotions blocks a multi-path Touches candidate — no commit, stays todo, reason surfaced (AC1)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-multipath-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // An ELIGIBLE candidate whose ## Touches carries a multi-path bullet (the e7be44a0 shape: "a.ts + b.ts").
  writeTask(root, "gap-multi", gapTask("gap-multi", { touches: ["- code/a.ts + code/b.ts"] }));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("status", "--porcelain"), "", "baseline clean before promotion");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true, "the gate still recommends the candidate (multi-path is not a gate criterion — the commit-path guard must catch it)");
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-multi");
  assert.equal(r.applied_promotions[0].ok, false, "AC1: the multi-path bullet is blocked at promotion, not silently landed");
  assert.equal(r.applied_promotions[0].reason, "touches-multi-path-bullet");
  assert.equal(r.applied_promotions[0].committed, false, "blocked ⇒ never committed");

  // The status must NOT have flipped — the task stays todo (not promoted into develop).
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-multi.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*todo$/m, "blocked candidate must remain todo on disk");
  assert.equal(git("status", "--porcelain"), "", "AC1: no write, no commit — the tree stays clean (nothing entered develop)");
});


test("setTaskStatus patches frontmatter todo→ready and preserves the body (AC1 mechanism)", (t) => {
  const root = makeWorkspace("sts");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = "**type:** execution\n\n## Proposal\nA real proposal paragraph long enough to be counted.\n\n## Plan\nA real plan paragraph long enough to be counted.\n";
  writeTask(root, "gap-a", { status: "todo", labels: ["gap"], body });

  const out = setTaskStatus(root, "gap-a", "ready");
  assert.equal(out.ok, true);
  assert.equal(out.from, "todo");
  assert.equal(out.to, "ready");

  const raw = fs.readFileSync(path.join(root, "tasks", "gap-a.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status line rewritten");
  assert.ok(raw.includes("## Proposal"), "body preserved");
  assert.match(raw, /^id: gap-a$/m, "other frontmatter preserved");
});


test("setTaskStatus no-ops on non-todo and on missing files (no clobber / idempotent)", (t) => {
  const root = makeWorkspace("sts-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-done", { status: "done", labels: ["gap"], body: fourArtifactBody() });

  assert.equal(setTaskStatus(root, "gap-ready", "ready").ok, false, "already ready ⇒ not a todo ⇒ no-op");
  assert.equal(setTaskStatus(root, "gap-done", "ready").ok, false, "done task must not be clobbered");
  assert.equal(setTaskStatus(root, "gap-missing", "ready").ok, false, "missing file ⇒ ok:false");
  assert.equal(setTaskStatus(root, "gap-ready", "ready").reason, "not-todo");

  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-ready.md"), "utf8"), /^status:\s*ready$/m);
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-done.md"), "utf8"), /^status:\s*done$/m);
});

// ── UNCOMMITTED-FLIP POISONING (gap-promotion-uncommitted-flip-poisons-settaskstatus) ─────────────
// `setTaskStatus` used to read the WORKTREE file to decide "is it todo". A flip that landed (ready)
// but whose commit failed leaves an UNCOMMITTED ready on disk while develop is still todo — the next
// promotion round (which JUDGES candidates from the develop ref via taskReadRef) read that leftover
// ready and returned `not-todo` (skip), so the commit never re-ran and develop stayed todo forever
// (worker-driver reads develop ⇒ pool=0 ⇒ no dispatch, ~20 min stall; memory
// uncommitted-promotion-blocks-fan-in-clean-tree). The fix: judge "is todo" from the develop ref
// (canonical, 硬规则 4b 代理量); a develop-todo + disk-ready leftover is re-committed (the disk
// `ready` is already the target, so the `status: todo` replace is a no-op and the commit reconciles).


test("setTaskStatus judges todo from develop — a dirty ready leftover re-commits, develop converges (AC1 能取假)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-poison-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));
  git("add", ".");
  git("commit", "-q", "-m", "init todo");
  git("checkout", "-q", "-b", "author");
  // The poison: the flip landed on disk (ready) but the commit failed — develop/HEAD stay todo.
  writeTask(root, "gap-candidate", { ...gapTask("gap-candidate"), status: "ready" });
  assert.match(git("show", "develop:tasks/gap-candidate.md"), /^status:\s*todo$/m,
    "precondition: develop still todo (the poison)");
  assert.match(git("status", "--porcelain"), /M tasks\/gap-candidate\.md/,
    "precondition: worktree dirty — ready uncommitted");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, taskReadRef: "develop" };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].ok, true, "AC1: develop-todo ⇒ re-flip, ⛔ not a not-todo skip");
  assert.equal(r.applied_promotions[0].committed, true, "AC1: the leftover ready is re-committed");
  assert.match(git("show", "develop:tasks/gap-candidate.md"), /^status:\s*ready$/m,
    "AC1: develop converges to ready");
});
