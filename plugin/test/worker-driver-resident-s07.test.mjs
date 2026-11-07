// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/8 (5 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, assert, branchHeadSubject, buildContinueWorkerPrompt, fs, lastExitedNotLandedReason, makeGitRoot, os, path, rmSafe, runGit, spawnSync, REPO_ROOT } from "./helpers/worker-driver-resident-harness.mjs";
import { RESOLVE_ALL_FLAG, conflictAction, dualCopyPeer, formatBatchResolution, isDualCopyFile, isTickDoc, isTakeDevelopDoc, listUnmergedFiles, resolveAllConflictsMechanically, resolveConflictMechanically, takeDevelopDocPromptRules, takeDevelopDocRule } from "../scripts/conflict-resolution-rules.ts";

/** 逐字命中数（硬规则 2 的读数面：负臂要「0 次」，⛔ 不是「看起来没有」）。 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** worker-driver 生产路径里那条批量命令的 CLI 入口（与 kernelSiblingArgv 同源形态：raw .ts + flag）。 */
const RULES_CLI = path.join(REPO_ROOT, "plugin", "scripts", "conflict-resolution-rules.ts");

test("AC1/AC2/AC3 (能取假) — buildContinueWorkerPrompt encodes the merge-conflict resolution protocol (one mechanical command / code semantic-union / commit --no-edit)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT in docs/proposals/quay-product-outline.md)",
  });
  // AC1 (指令存在): prompt names the conflict state (unmerged paths / CONFLICT) and the resolve action.
  assert.match(p, /(unmerged|CONFLICT)/, "AC1: prompt names the merge-conflict state (unmerged paths / CONFLICT)");
  assert.match(p, /resolve/, "AC1: prompt instructs the worker to resolve the conflict");
  assert.match(p, /never exit while unmerged paths remain/, "AC1: prompt forbids exiting with unmerged paths (next fan-in merge step would fail again)");
  // AC2 (outline 冲突取 develop 版): ⛔ 自 gap-conflict-mechanical-resolver-not-wired 起，prompt 不再教
  // agent 手跑 `git checkout develop --`（那是机器可判的，改由批量命令真跑）；它给的是**单一命令** +
  // 「只处理它点名 MANUAL 的文件」。能取假：命令缺席 / 手跑指令回潮 ⇒ 红。
  assert.match(p, new RegExp(`${RESOLVE_ALL_FLAG} /wt`), "AC2: prompt names the ONE mechanical resolver command, scoped to this worktree");
  assert.match(p, /handle ONLY the files it names/, "AC2: only the files the command did NOT resolve are the worker's job");
  assert.equal(countOf(p, "git checkout develop"), 0, "AC2 (负臂): the hand-run `git checkout develop --` instruction is gone (the machine runs it)");
  assert.doesNotMatch(p, /write-inventory/, "AC2: ⛔ no longer re-run the retired --write-inventory");
  // AC3 (code 并集 + commit): code conflict ⇒ semantic union + git commit --no-edit.
  assert.match(p, /semantic union/, "AC3: code-file conflict ⇒ take the semantic union of both sides");
  assert.match(p, /git commit --no-edit/, "AC3: complete the merge with git commit --no-edit");
});

// ── gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward ──────────────────────────────
// 冲突消解协议（gap-continue-prompt-conflict-resolution-protocol）只教 outline/code 两型；三型新暴露
// （硬规则 5b：修好一个 ≠ 没有别的）——dual-copy 文件冲突（.claude/workflows/* ↔ plugin/workflows/*
// 须字节一致，⛔ 语义并集会发散两副本）、ff-not-fast-forward（suite 长跑期间 develop 又进新落地 ⇒
// 任务分支落后 develop）、modify/delete（一侧删一侧改）。AC1/AC2/AC4 钉住 prompt 里三型消解指令，
// 删掉任一条 ⇒ 测试红（AC3 能取假）。


test("gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward — AC1/AC2/AC3/AC4 (能取假): buildContinueWorkerPrompt teaches dual-copy byte-identical sync / ff re-merge / modify-delete deletion-side", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at step=ff: CONFLICT (content): Merge conflict in .claude/workflows/fan-in-execute.js",
  });
  // AC1 (dual-copy): 冲突时两副本同步字节一致，⛔ 不语义并集（并集让两副本发散）。
  // gap-conflict-mechanical-resolver-not-wired：dual-copy 的**消解动作**已是机器可判（批量命令真跑
  // `git checkout develop -- <rel>` + 字节同步），prompt 不再教 agent 手跑 ⇒ 此处断言的是
  // 「prompt 点名 dual-copy 属于该命令覆盖的范围」+「手跑指令 0 次」（下面 AC2 负臂有逐字计数）。
  assert.match(p, /dual-copy/, "AC1: prompt names the dual-copy file type as covered by the mechanical resolver");
  assert.equal(countOf(p, "byte-identical"), 0, "AC1: the hand-run byte-identical re-sync instruction is gone (the machine does it)");
  // AC2 (ff): ff-not-fast-forward 时先 merge develop 再 ff，⛔ 不重实现。
  assert.match(p, /not fast-forward/, "AC2: prompt names the ff-not-fast-forward failure");
  assert.match(p, /merge develop again/, "AC2: ff-not-fast-forward ⇒ merge develop again before the driver re-runs ff");
  assert.match(p, /do NOT re-implement/, "AC2: ff-not-fast-forward ⇒ ⛔ no re-implementation (branch-lag, not a code defect)");
  // AC4 (modify/delete): 判删除侧——分支删（有替代实现）⇒ 接受删除 git rm；develop 删 ⇒ 接受删除 git rm。
  assert.match(p, /modify\/delete/, "AC4: prompt names the modify/delete conflict type");
  assert.match(p, /judge WHICH side deleted/, "AC4: modify/delete ⇒ judge which side deleted");
  assert.match(p, /git rm/, "AC4: modify/delete ⇒ accept the deletion with git rm");
  assert.match(p, /never silently restore the deleted file/, "AC4: ⛔ never revive the deleted file");
});


test("gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward — 结构面 (能取假): worker-driver.ts 三型消解指令无残留/无遗漏", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // gap-conflict-mechanical-resolver-not-wired：dual-copy 的消解动作**从 prompt 降到可执行载体**——
  // 结构面因此改判：(a) prompt 渲染的是同一模块的批量旗标，(b) 手跑指令已从 **prompt 输出**消失。
  // ⛔ 这里不断言源码里没有 `byte-identical`/`git checkout develop --` 字样——本文件第 3047 行的
  // JSDoc 正是在描述「这个命令真跑什么」，按位置判定，注释/文档里提到不算命中（硬规则 2）。判「prompt
  // 里没有了」的判据在下面的 AC2 负臂（读 buildContinueWorkerPrompt 的输出，逐字计数 0）。
  assert.match(src, /kernelSiblingArgv\("conflict-resolution-rules\.ts", \[RESOLVE_ALL_FLAG, worktree\]\)/,
    "dual-copy/take-develop/delete-side are executed by the batch command (single source: the module's flag)");
  assert.match(src, /not fast-forward/, "ff-not-fast-forward instruction present in source");
  assert.match(src, /modify\/delete/, "modify/delete instruction present in source");
  assert.match(src, /judge WHICH side deleted/, "modify/delete deletion-side judgment present in source");
});

// ── gap-continue-conflict-rule-missing-task-files ─────────────────────────────────────────────
// 冲突消解协议 6 条 + 1 FF 段无一点名 tasks/*.md，相邻 3 条（outline / dual-copy / tick doc）逐字教
// 「取 develop 版」——worker 把任务文件类比成 doc 会静默抹掉自己这一轮勾上的 - [x] AC 与 ## Evidence，
// 且抹掉后与正确解同形（下一轮 ac-precheck 才红，理由误导为「AC 未勾」而非「合并把它抹了」）。
// 修法：新增 (2b) 任务文件规则——per-hunk 取并集（保留 develop 侧 Touches/Needs-Human/status: +
// 分支侧 AC 勾选/Evidence），⛔ 不取 develop 版、⛔ 不手写 status: frontmatter（status: 冲突取 develop
// 值）。删掉该规则 ⇒ 测试红（AC5 能取假）。


test("gap-continue-conflict-rule-missing-task-files — AC1/AC2/AC3 (能取假): buildContinueWorkerPrompt teaches per-hunk union for tasks/<id>.md (⛔ not take-develop, ⛔ not write status:)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT in tasks/gap-x.md)",
  });
  // AC1 (规则落地): prompt 点名任务文件类。
  assert.match(p, /tasks\/<id>\.md/, "AC1: prompt names the task-file type (tasks/<id>.md)");
  // AC2 (并集 + 保留 AC/Evidence + 禁取 develop 版)。
  assert.match(p, /per-hunk union/, "AC2: task-file conflict ⇒ per-hunk union of both sides");
  assert.match(p, /keep your branch's edits/, "AC2: keep the branch's edits (its - [x] AC ticks + ## Evidence additions)");
  assert.match(p, /## Evidence/, "AC2: keep the branch's ## Evidence additions");
  assert.match(p, /do NOT "take the develop version"/, "AC2: ⛔ explicitly forbids take the develop version");
  // AC3 (status: 例外 + 写所有权一致)。
  assert.match(p, /frontmatter yourself/, "AC3: ⛔ do not write status: frontmatter (worker doesn't own frontmatter)");
  assert.match(p, /take develop's value verbatim/, "AC3: status: conflict ⇒ take develop's value (write-ownership separation)");
});


test("gap-continue-conflict-rule-missing-task-files — 结构面 (能取假): worker-driver.ts 任务文件规则无残留/无遗漏", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.match(src, /tasks\/<id>\.md/, "task-file rule present in source (grep tasks/ in function body)");
  assert.match(src, /per-hunk union/, "per-hunk union instruction present in source");
  assert.match(src, /frontmatter yourself/, "status: write-ownership exception present in source");
  assert.match(src, /take develop's value verbatim/, "status: take-develop-value exception present in source");
});

// ── gap-fan-in-merge-develop-derived-recompute-and-reason（B；A 已退役）─────────────────────────────
// 机械 fan-in step 2 `git merge develop` 冲突的【具体文件】没传回下一轮 worker——CONTINUE prompt 的 reason
// 读通用 failure_reason（「task status=ready not done」），⛔ 不含冲突文件 ⇒ worker 无从精准 resolve。
// 修法（原 B）：lastExitedNotLandedReason 改读 mechanical_fan_in（step + reason 拼接「step=merge-develop:
// CONFLICT in <file>」）。原 A（driver 对 derived 文件机械重算）已退役：outline §6 DELIVERY-INVENTORY 快照被
// gap-delivery-inventory-check-time-computation 删除（计数改 check-time 计算），无 derived 文件可重算。

// ── gap-arbitrary-semantics-unenforced-carriers AC2 — rules (3)/(4)/(5) have an EXECUTABLE carrier ──
// ⑥⑦⑧ 的规则 (3) dual-copy / (4) tick-doc / (5) modify-delete 从「prompt 散文」升成可执行承接：决策函数
// conflictAction 按位置（路径模式 + git status 冲突码）给机械动作，resolveConflictMechanically 真跑 git。
// 负臂把规则表里的 modify/delete 删掉后重跑（⛔ 不是 assert.match 字符串在场）⇒ 动作变 manual ⇒ 红。

test("gap-arbitrary-semantics-unenforced-carriers AC2 — rules (3)/(4)/(5) are machine-decidable by POSITION (conflictAction)", () => {
  // (3) dual-copy: both copies classify as dual-copy-sync, with the peer derived (never a keyword guess).
  assert.equal(conflictAction(".claude/workflows/fan-in-execute.js", "UU").kind, "dual-copy-sync");
  assert.equal(conflictAction("plugin/workflows/fan-in-execute.js", "UU").kind, "dual-copy-sync");
  assert.equal(dualCopyPeer(".claude/workflows/fan-in-execute.js"), "plugin/workflows/fan-in-execute.js");
  assert.equal(dualCopyPeer("plugin/workflows/fan-in-execute.js"), ".claude/workflows/fan-in-execute.js");
  assert.equal(dualCopyPeer("packages/quay/src/x.ts"), null);
  assert.ok(isDualCopyFile(".claude/workflows/x.js"));
  assert.ok(!isDualCopyFile(".claude/workflows/a/b.js"), "a nested path is not a dual-copy file");
  // (4) tick doc: only `orchestration/*-tick-core.md`.
  assert.equal(conflictAction("orchestration/manager-tick-core.md", "UU").kind, "take-develop");
  assert.ok(isTickDoc("orchestration/manager-tick-core.md"));
  assert.ok(!isTickDoc("orchestration/other.md"));
  // (5) modify/delete: DU (deleted by us) and UD (deleted by them) both accept the deletion.
  assert.equal(conflictAction("tasks/x.md", "DU").kind, "delete-side");
  assert.equal(conflictAction("tasks/x.md", "UD").kind, "delete-side");
  // a code file is NOT machine-decidable.
  assert.equal(conflictAction("packages/quay/src/x.ts", "UU").kind, "manual");
});

test("gap-arbitrary-semantics-unenforced-carriers AC2 — resolveConflictMechanically actually performs the git resolution", () => {
  // take-develop: the working-tree edit is replaced by develop's committed content.
  const take = makeGitRoot("ac2-take");
  runGit(take, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(take, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(take, "orchestration", "manager-tick-core.md"), "develop-version\n", "utf8");
  runGit(take, ["add", "orchestration/manager-tick-core.md"]);
  runGit(take, ["commit", "-q", "-m", "tick doc"]);
  fs.writeFileSync(path.join(take, "orchestration", "manager-tick-core.md"), "branch-version\n", "utf8");
  const takeRes = resolveConflictMechanically(take, "orchestration/manager-tick-core.md", "UU");
  assert.equal(takeRes.resolved, true, takeRes.reason);
  assert.equal(takeRes.action, "take-develop");
  assert.equal(fs.readFileSync(path.join(take, "orchestration", "manager-tick-core.md"), "utf8"), "develop-version\n");

  // delete-side: modify/delete accepts the deletion with git rm.
  const del = makeGitRoot("ac2-delete");
  runGit(del, ["branch", "-M", "develop"]);
  fs.writeFileSync(path.join(del, "dead.md"), "x\n", "utf8");
  runGit(del, ["add", "dead.md"]);
  runGit(del, ["commit", "-q", "-m", "dead"]);
  const delRes = resolveConflictMechanically(del, "dead.md", "DU");
  assert.equal(delRes.resolved, true, delRes.reason);
  assert.equal(delRes.action, "delete-side");
  assert.equal(fs.existsSync(path.join(del, "dead.md")), false, "git rm must remove the file");

  // dual-copy-sync: both copies end byte-identical to develop's version.
  const dual = makeGitRoot("ac2-dual");
  runGit(dual, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(dual, ".claude", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dual, "plugin", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dual, ".claude", "workflows", "x.js"), "develop\n", "utf8");
  fs.writeFileSync(path.join(dual, "plugin", "workflows", "x.js"), "develop\n", "utf8");
  runGit(dual, ["add", ".claude", "plugin"]);
  runGit(dual, ["commit", "-q", "-m", "dual copies"]);
  fs.writeFileSync(path.join(dual, ".claude", "workflows", "x.js"), "branch\n", "utf8");
  const dualRes = resolveConflictMechanically(dual, ".claude/workflows/x.js", "UU");
  assert.equal(dualRes.resolved, true, dualRes.reason);
  assert.equal(dualRes.action, "dual-copy-sync");
  assert.equal(fs.readFileSync(path.join(dual, ".claude", "workflows", "x.js"), "utf8"), "develop\n");
  assert.equal(fs.readFileSync(path.join(dual, "plugin", "workflows", "x.js"), "utf8"), "develop\n");
});

test("gap-arbitrary-semantics-unenforced-carriers AC2 — 负臂 (能取假): deleting the modify/delete rule changes the ACTION, not a string", () => {
  const srcPath = path.join(REPO_ROOT, "plugin", "scripts", "conflict-resolution-rules.ts");
  const src = fs.readFileSync(srcPath, "utf8");
  const mutated = src.replace(/new Set\(\["DU", "UD"\]\)/, "new Set([])");
  assert.notEqual(mutated, src, "mutation anchor drifted — the negative arm would be vacuous");
  assert.ok(mutated.includes("new Set([])"), "the mutation must leave its marker");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac2-mutant-"));
  try {
    fs.writeFileSync(path.join(dir, "conflict-resolution-rules.ts"), mutated, "utf8");
    fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "gate-script-base.ts"), path.join(dir, "gate-script-base.ts"));
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", path.join(dir, "conflict-resolution-rules.ts"), "--judge", "tasks/x.md", "DU", "--json"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, `the mutated rule table must classify modify/delete as manual (exit 1), got ${r.status}: ${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.kind, "manual", "after deleting the modify/delete rule, DU is no longer delete-side");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-conflict-outline-half-only-in-prompt-prose ────────────────────────────────────────────────
// THE DEFECT: the "outline doc ⇒ take the develop version" rule existed TWICE — mechanically nowhere
// (the `isTickDoc` regex is `^orchestration/[^/]*-tick-core\.md$`, so a UU on the outline fell to
// `manual`) and as prompt PROSE in worker-driver (`(1) outline doc (…): take the develop version`).
// The prose half had no executable carrier ⇒ a worker that ignored it still passed the suite
// (硬规则 9: 可见性 ≠ 执行). FIX: ONE registry (`TAKE_DEVELOP_DOC_RULES`) that the mechanical decision
// AND the prompt prose both render from, and `isTickDoc` survives as a NAMED SUBSET (its name must not
// drift to cover the outline — 硬规则 8: 编号/命名不得复用).
//
// 改前逐字读数（本 worktree、改代码之前，命令
//   `node --experimental-strip-types plugin/scripts/conflict-resolution-rules.ts --judge docs/proposals/quay-product-outline.md UU --json`）:
//   {"kind":"manual","reason":"not a machine-decidable rule — resolve semantically","peer":null}   exit=1
// 改后逐字读数见下面 AC1 断言（同一个调用 ⇒ kind:"take-develop"）。

const OUTLINE_REL = "docs/proposals/quay-product-outline.md";

test("gap-conflict-outline-half-only-in-prompt-prose AC1 — the outline flips manual→take-develop, and isTickDoc does NOT drift to cover it", () => {
  const action = conflictAction(OUTLINE_REL, "UU");
  assert.equal(action.kind, "take-develop", "AC1: the outline conflict is machine-decidable after the fix");
  // The reason must NAME the matched rule (a bare "take-develop" cannot be audited back to a registry entry).
  assert.match(action.reason, /rule: outline-doc/, "AC1: the reason names which registry rule matched");
  assert.equal(takeDevelopDocRule(OUTLINE_REL)?.id, "outline-doc");
  assert.equal(isTakeDevelopDoc(OUTLINE_REL), true, "AC1: the outline is a take-develop doc");
  // The NAME DOES NOT DRIFT: `isTickDoc` keeps meaning exactly `orchestration/*-tick-core.md`.
  assert.equal(isTickDoc("orchestration/manager-tick-core.md"), true, "AC1: isTickDoc still true for tick-core");
  assert.equal(isTickDoc(OUTLINE_REL), false, "AC1: isTickDoc is FALSE for the outline (name must not widen)");
  assert.equal(isTickDoc("orchestration/other.md"), false, "AC1: isTickDoc stays a family of tick-core docs only");
  // 取假: the rule is the EXACT path, not the `docs/proposals/` directory or a keyword.
  assert.equal(conflictAction("docs/proposals/some-other-proposal.md", "UU").kind, "manual",
    "AC1 (取假): a neighbouring proposal does NOT take develop — the selector is the exact path");
  assert.equal(conflictAction(OUTLINE_REL, "DU").kind, "delete-side",
    "AC1: the modify/delete code still wins (position/code precedence unchanged)");
});

test("gap-conflict-outline-half-only-in-prompt-prose AC2 — resolveConflictMechanically really runs `git checkout develop --` on a CONFLICTED outline (file content, not a return string)", () => {
  const root = makeGitRoot("outline-take-develop");
  runGit(root, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(root, "docs", "proposals"), { recursive: true });
  fs.writeFileSync(path.join(root, OUTLINE_REL), "develop-counts=1\n", "utf8");
  runGit(root, ["add", OUTLINE_REL]);
  runGit(root, ["commit", "-q", "-m", "outline on develop"]);

  // A real branch (not just a dirty file): this is what the driver merges into.
  runGit(root, ["checkout", "-q", "-b", "task/x"]);
  fs.writeFileSync(path.join(root, OUTLINE_REL), "branch-counts=2\n", "utf8");
  runGit(root, ["add", OUTLINE_REL]);
  runGit(root, ["commit", "-q", "-m", "branch edits the outline"]);

  runGit(root, ["checkout", "-q", "develop"]);
  fs.writeFileSync(path.join(root, OUTLINE_REL), "develop-counts=99\n", "utf8");
  runGit(root, ["add", OUTLINE_REL]);
  runGit(root, ["commit", "-q", "-m", "develop moves on"]);

  runGit(root, ["checkout", "-q", "task/x"]);
  const merge = spawnSync("git", ["-C", root, "merge", "develop"], { encoding: "utf8" });
  assert.notEqual(merge.status, 0, "fixture: the merge must actually conflict");
  // The fixture must really be conflicted — an un-conflicted tree would make this test vacuous.
  assert.match(runGit(root, ["status", "--porcelain"]), new RegExp(`UU ${OUTLINE_REL}`),
    "fixture: the outline is an unmerged path (UU)");

  const res = resolveConflictMechanically(root, OUTLINE_REL, "UU");
  assert.equal(res.resolved, true, res.reason);
  assert.equal(res.action, "take-develop");
  assert.equal(fs.readFileSync(path.join(root, OUTLINE_REL), "utf8"), "develop-counts=99\n",
    "AC2: the outline's CONTENT is develop's version after the mechanical resolution");
  assert.equal(fs.readFileSync(path.join(root, OUTLINE_REL), "utf8").includes("branch-counts=2"), false,
    "AC2: the branch side is gone (no hand-merge)");
});

test("gap-conflict-outline-half-only-in-prompt-prose AC3 — the worker prompt still renders from the SAME module (no second list in worker-driver)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: `mechanical fan-in red at merge develop (CONFLICT in ${OUTLINE_REL})`,
  });
  // gap-conflict-mechanical-resolver-not-wired：单一真相源的**形态变了**，判据跟着变。以前 prompt 拷贝
  // 注册表渲染（`take the develop version … quay-product-outline`）；现在 prompt 只给**同一模块提供的
  // 批量命令**——注册表具体条目由命令**执行**，⛔ 不再有「散文副本」，因此不再有漂移面。
  assert.match(p, new RegExp(`${RESOLVE_ALL_FLAG} /wt`),
    "AC3: the prompt carries the batch command rendered from the registry module's flag (single source)");
  // 反面对照：注册表的散文渲染**不再**出现在 prompt 里（它现在是命令的输出，不是提示词的副本）。
  const rendered = takeDevelopDocPromptRules().join(" ");
  assert.equal(p.includes(rendered), false, "AC3: the registry's prose rendering is no longer copied into the prompt");
  assert.equal(countOf(p, "git checkout develop"), 0, "AC3: the take-develop hand-run instruction is gone from the prompt");
  assert.equal(countOf(p, "do NOT hand-merge the counts"), 0, "AC3: the outline's hand-merge ⛔ clause is gone from the prompt");
  // (b) worker-driver holds ZERO occurrences of the path string — the prose literal is gone.
  const src = fs.readFileSync(DRIVER, "utf8");
  const occurrences = src.split("quay-product-outline").length - 1;
  assert.equal(occurrences, 0, `AC3: worker-driver.ts must hold no literal outline path, found ${occurrences}`);
});

test("gap-conflict-outline-half-only-in-prompt-prose AC3 — 负臂 (能取假): deleting the registry row flips BOTH the decision AND the prompt half", () => {
  const srcPath = path.join(REPO_ROOT, "plugin", "scripts", "conflict-resolution-rules.ts");
  const src = fs.readFileSync(srcPath, "utf8");
  const mutated = src.replace(/\n  \{\n    id: "outline-doc",[\s\S]*?\n  \},/, "");
  assert.notEqual(mutated, src, "mutation anchor drifted — the negative arm would be vacuous");
  assert.equal(mutated.includes("outline-doc"), false, "the mutation must actually remove the registry row");
  assert.equal(mutated.includes("quay-product-outline"), false, "the mutation must remove the path literal too");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac3-outline-mutant-"));
  try {
    fs.writeFileSync(path.join(dir, "conflict-resolution-rules.ts"), mutated, "utf8");
    fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", "gate-script-base.ts"), path.join(dir, "gate-script-base.ts"));
    const entry = path.join(dir, "conflict-resolution-rules.ts");
    // Side 1 — the MECHANICAL decision goes back to manual.
    const judge = spawnSync(process.execPath,
      ["--experimental-strip-types", entry, "--judge", OUTLINE_REL, "UU", "--json"], { encoding: "utf8" });
    assert.equal(judge.status, 1, `mutant: the outline must fall back to manual (exit 1), got ${judge.status}: ${judge.stderr}`);
    assert.equal(JSON.parse(judge.stdout).kind, "manual", "mutant: kind is manual again");
    // Side 2 — the PROMPT half loses the outline rule (same module, same mutation).
    const render = spawnSync(process.execPath,
      ["--experimental-strip-types", entry, "--render-prompt-rules"], { encoding: "utf8" });
    assert.equal(render.status, 0, render.stderr);
    assert.equal(render.stdout.includes("quay-product-outline"), false,
      "mutant: the rendered prompt rules no longer name the outline");
    assert.equal(render.stdout.includes("outline doc"), false, "mutant: the outline rule line is gone");
    // Negative control: the tick-doc entry SURVIVES — the mutation removed exactly one rule, not the table.
    assert.ok(render.stdout.includes("tick doc (orchestration/*-tick-core.md)"),
      "mutant: the tick-doc rule must survive (the mutation is targeted, not a table wipe)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-conflict-mechanical-resolver-not-wired ────────────────────────────────────────────────────
// THE DEFECT: `resolveConflictMechanically` had behavior tests but ZERO production callers — the
// worker's continue prompt still spent 1842 chars teaching the agent to hand-run the same git
// commands (硬规则 9: 可见性 ≠ 执行). FIX: a BATCH entry point (`resolveAllConflictsMechanically` +
// `RESOLVE_ALL_FLAG`) that the real prompt names as ONE command, plus "handle ONLY the files it
// prints as MANUAL".
//
// 判据形态（⛔ 不是 assert.match 字符串在场）：下面第一条正臂先按**字面从真实 prompt 里抠出那条
// 命令**，再把它当子进程跑在真 merge 冲突仓库上 ⇒ 它证明的是「prompt 给的那条命令真能解决冲突」，
// 不是「prompt 里有某个词」。第二、三条把 prompt 里**已删除**的机器可判指令逐字计数为 0。

/** 真 merge 冲突夹具：take-develop（tick doc）/ dual-copy（两副本）/ delete-side（DU）/ manual（code）。 */
function makeMergeConflictFixture(tag) {
  const root = makeGitRoot(tag);
  runGit(root, ["branch", "-M", "develop"]);
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, "utf8");
  };
  w("orchestration/manager-tick-core.md", "develop-tick\n");
  w(".claude/workflows/x.js", "develop-dual\n");
  w("plugin/workflows/x.js", "develop-dual\n");
  w("dead.md", "develop-dead\n");
  w("packages/quay/src/code.ts", "develop-code\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "base"]);
  runGit(root, ["checkout", "-q", "-b", "task/x"]);
  w("orchestration/manager-tick-core.md", "branch-tick\n");
  w(".claude/workflows/x.js", "branch-dual\n");
  w("plugin/workflows/x.js", "branch-dual\n");
  fs.rmSync(path.join(root, "dead.md"));            // the BRANCH deletes ⇒ modify/delete (DU)
  w("packages/quay/src/code.ts", "branch-code\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "branch"]);
  runGit(root, ["checkout", "-q", "develop"]);
  w("orchestration/manager-tick-core.md", "develop-tick2\n");
  w(".claude/workflows/x.js", "develop-dual2\n");
  w("plugin/workflows/x.js", "develop-dual2\n");
  w("dead.md", "develop-dead2\n");
  w("packages/quay/src/code.ts", "develop-code2\n");
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "develop moves"]);
  runGit(root, ["checkout", "-q", "task/x"]);
  const merge = spawnSync("git", ["-C", root, "merge", "develop"], { encoding: "utf8" });
  assert.notEqual(merge.status, 0, "fixture: the merge must actually conflict (an un-conflicted tree makes this vacuous)");
  return root;
}

/** The ONE command the worker prompt names for `worktree`, extracted by position from the prompt text. */
function extractBatchCommandFromPrompt(worktree) {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: worktree,
    branchCommits: 3,
    branchHeadSubject: "x",
    acChecked: 0,
    acTotal: 3,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT)",
  });
  const marker = `${RESOLVE_ALL_FLAG} ${worktree}`;
  const end = p.indexOf(marker);
  assert.ok(end > 0, `AC1: the prompt must name the batch command scoped to the worktree; got prompt without it`);
  const start = p.lastIndexOf("`node ", end);
  assert.ok(start >= 0 && start < end, "AC1: the command must be rendered inside a code span starting at `node ");
  const command = p.slice(start + 1, end + marker.length);
  assert.equal(countOf(p, RESOLVE_ALL_FLAG), 1, "AC1: exactly ONE command (a second one would be a second source)");
  return command;
}

test("gap-conflict-mechanical-resolver-not-wired AC1 (正臂, 真 git) — the command the REAL prompt names resolves take-develop / dual-copy / delete-side", (t) => {
  const root = makeMergeConflictFixture("cmr-ac1");
  t.after(() => rmSafe(root));
  const before = runGit(root, ["status", "--porcelain"]);
  assert.match(before, /UU orchestration\/manager-tick-core\.md/, "fixture: the tick doc is unmerged");
  assert.match(before, /UU \.claude\/workflows\/x\.js/, "fixture: the dual-copy file is unmerged");
  assert.match(before, /UU plugin\/workflows\/x\.js/, "fixture: the dual-copy peer is unmerged");
  assert.match(before, /DU dead\.md/, "fixture: modify/delete (deleted by us) is present");
  assert.match(before, /UU packages\/quay\/src\/code\.ts/, "fixture: the manual code file is unmerged");

  // The command comes OUT OF THE PROMPT — this is the production-reachability reading (AC1).
  const command = extractBatchCommandFromPrompt(root);
  const argv = command.split(" ");
  assert.equal(argv[0], "node", `AC1: the prompt names a runnable command, got ${JSON.stringify(command)}`);
  const run = spawnSync(process.execPath, argv.slice(1), { encoding: "utf8" });

  // take-develop ------------------------------------------------------------------
  assert.equal(fs.readFileSync(path.join(root, "orchestration/manager-tick-core.md"), "utf8"), "develop-tick2\n",
    "AC1 take-develop: the tick doc carries develop's CONTENT after the command ran");
  // dual-copy ---------------------------------------------------------------------
  const a = fs.readFileSync(path.join(root, ".claude/workflows/x.js"), "utf8");
  const b = fs.readFileSync(path.join(root, "plugin/workflows/x.js"), "utf8");
  assert.equal(a, "develop-dual2\n", "AC1 dual-copy: copy A is develop's version");
  assert.equal(b, a, "AC1 dual-copy: the two copies end BYTE-IDENTICAL");
  // delete-side -------------------------------------------------------------------
  assert.equal(fs.existsSync(path.join(root, "dead.md")), false, "AC1 delete-side: the deletion was accepted (git rm)");
  // AC1's reading, verbatim: no unmerged path is left for the three machine-decidable classes.
  const after = runGit(root, ["status", "--porcelain"]);
  for (const rel of ["orchestration/manager-tick-core.md", ".claude/workflows/x.js", "plugin/workflows/x.js", "dead.md"]) {
    assert.equal(new RegExp(`^(U|.U) ${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(after), false,
      `AC1: ${rel} must no longer be an unmerged path; status was:\n${after}`);
  }
  assert.match(run.stdout, /RESOLVED take-develop: orchestration\/manager-tick-core\.md/, "AC1: the report names the take-develop resolution");
  assert.match(run.stdout, /RESOLVED dual-copy-sync: \.claude\/workflows\/x\.js/, "AC1: the report names the dual-copy resolution");
  assert.match(run.stdout, /RESOLVED delete-side: dead\.md/, "AC1: the report names the delete-side resolution");
});

test("gap-conflict-mechanical-resolver-not-wired AC1 (负臂, 逐字读数) — a MANUAL file is left byte-for-byte untouched AND is named in the output", (t) => {
  const root = makeMergeConflictFixture("cmr-ac1-neg");
  t.after(() => rmSafe(root));
  const REL = "packages/quay/src/code.ts";
  const untouchedBytes = fs.readFileSync(path.join(root, REL), "utf8");
  assert.match(untouchedBytes, /<<<<<<< /, "fixture: the manual file really carries conflict markers before the run");

  const command = extractBatchCommandFromPrompt(root);
  const argv = command.split(" ");
  const run = spawnSync(process.execPath, argv.slice(1), { encoding: "utf8" });

  // (a) untouched: same bytes, still an unmerged path.
  assert.equal(fs.readFileSync(path.join(root, REL), "utf8"), untouchedBytes,
    "AC1 负臂: the manual file's bytes are UNCHANGED (⛔ the batch must not checkout/rm a manual file)");
  assert.match(runGit(root, ["status", "--porcelain"]), new RegExp(`UU ${REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    "AC1 负臂: the manual file is still an unmerged path");
  // (b) named in the output — verbatim reading (the manual list is the worker's work item).
  const named = countOf(run.stdout, `MANUAL ${REL}`);
  assert.equal(named, 1, `AC1 负臂: the manual file is named exactly once in the report; stdout=\n${run.stdout}`);
  assert.equal(run.status, 1, "AC1 负臂: a manual file remaining ⇒ non-zero exit (⛔ 不与「全部解决」同形)");
  // (c) it is NOT in the resolved list (⛔ "handled" and "needs judgment" must not look alike).
  assert.equal(countOf(run.stdout, `RESOLVED manual: ${REL}`), 0, "AC1 负臂: a manual file is never reported as RESOLVED");
});

test("gap-conflict-mechanical-resolver-not-wired (硬规则 3b) — an unreadable conflict set is 'NOT EVALUATED', never '0 unmerged'", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmr-nongit-"));
  t.after(() => rmSafe(dir));
  const r = spawnSync(process.execPath,
    ["--no-warnings", "--experimental-strip-types", RULES_CLI, RESOLVE_ALL_FLAG, dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0, "a failing `git status` must exit non-zero");
  assert.match(r.stdout, /NOT EVALUATED/, "the failure is reported as NOT EVALUATED");
  assert.doesNotMatch(r.stdout, /0 unmerged/, "⛔ an unreadable set must never be reported as 'no conflicts'");
});

test("gap-conflict-mechanical-resolver-not-wired AC2 (负臂, 逐字计数 0) — the machine-decidable hand-run instructions are gone; the JUDGING rules survive", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "x",
    acChecked: 0,
    acTotal: 3,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT)",
  });
  // (a) machine-decidable instructions (rules 1 & 3) — 0 occurrences each.
  assert.equal(countOf(p, "git checkout develop"), 0, "rule (1): the hand-run `git checkout develop --` instruction is gone");
  // ⚠️ 判据按【指令形态】计数，⛔ 不按短语计数：`take the develop version` 仍出现 1 次，但那是规则
  // (2b) 的**禁止句**（`⛔ do NOT "take the develop version"`）——任务文件恰恰不许取 develop 版。
  // 机器可判的那条指令的形态是「短语 + 括号里的 git 命令」，它必须为 0。
  assert.equal(countOf(p, "take the develop version (`"), 0,
    "rule (1): the take-develop INSTRUCTION form (phrase + its git command) is gone; rule (2b)'s ⛔ prohibition legitimately survives");
  assert.match(p, /do NOT "take the develop version"/, "rule (2b)'s prohibition against taking develop's version survives (it is the opposite instruction)");
  assert.equal(countOf(p, "byte-identical"), 0, "rule (3): the hand-run byte-identical re-sync instruction is gone");
  assert.equal(countOf(p, "do NOT take a semantic union"), 0, "rule (3): the dual-copy ⛔ clause is gone");
  assert.equal(countOf(p, "do NOT hand-merge the counts"), 0, "rule (1): the outline ⛔ clause is gone");
  // (b) judging rules (2)/(2b)/(5)/(6) + FF — still present.
  assert.match(p, /semantic union/, "rule (2) code semantic union survives");
  assert.match(p, /per-hunk union/, "rule (2b) task-file per-hunk union survives");
  assert.match(p, /judge WHICH side deleted/, "rule (5) modify/delete judgment survives");
  assert.match(p, /git commit --no-edit/, "rule (6) add+commit survives");
  assert.match(p, /not fast-forward/, "the FF clause survives");
});

test("gap-conflict-mechanical-resolver-not-wired — 结构面 (能取假): the batch entry point is reachable from the prompt AND has a production caller", () => {
  const driverSrc = fs.readFileSync(DRIVER, "utf8");
  assert.match(driverSrc, /kernelSiblingArgv\("conflict-resolution-rules\.ts", \[RESOLVE_ALL_FLAG, worktree\]\)/,
    "worker-driver.ts renders the ONE command from the module's own flag (single source)");
  assert.match(driverSrc, /import \{ RESOLVE_ALL_FLAG \} from "\.\/conflict-resolution-rules\.ts"/,
    "the flag comes from the rules module (⛔ no second literal)");
  // The batch actually enumerates through the SAME per-file decision function (⛔ not a second rule table).
  const rulesSrc = fs.readFileSync(RULES_CLI, "utf8");
  assert.match(rulesSrc, /export function resolveAllConflictsMechanically/);
  assert.match(rulesSrc, /const action = conflictAction\(f\.rel, f\.status\)/,
    "the batch decides with conflictAction — the SAME rule table, no fork");
  assert.match(rulesSrc, /const res = resolveConflictMechanically\(root, f\.rel, f\.status\)/,
    "the batch executes with resolveConflictMechanically — the SAME executor, no fork");
});
