// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/8 (5 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, assert, branchHeadSubject, buildContinueWorkerPrompt, fs, lastExitedNotLandedReason } from "./helpers/worker-driver-resident-harness.mjs";

test("AC1/AC2/AC3 (能取假) — buildContinueWorkerPrompt encodes the merge-conflict resolution protocol (outline take-develop / code semantic-union / commit --no-edit)", () => {
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
  // AC2 (outline 冲突取 develop 版): outline inventory conflict ⇒ take the develop version (git checkout develop), ⛔ no --write-inventory.
  assert.match(p, /git checkout develop/, "AC2: outline-doc conflict ⇒ take the develop version (git checkout develop)");
  assert.match(p, /take the develop version/, "AC2: outline-doc conflict ⇒ take the develop version (⛔ no recompute)");
  assert.doesNotMatch(p, /write-inventory/, "AC2: ⛔ no longer re-run the retired --write-inventory");
  assert.match(p, /do NOT hand-merge the counts/, "AC2: outline-doc conflict ⇒ ⛔ hand-merge the counts");
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
  assert.match(p, /dual-copy/, "AC1: prompt names the dual-copy file type (.claude/workflows/* ↔ plugin/workflows/*)");
  assert.match(p, /byte-identical/, "AC1: dual-copy conflict ⇒ re-sync BOTH copies byte-identical");
  assert.match(p, /do NOT take a semantic union/, "AC1: dual-copy conflict ⇒ ⛔ not semantic union (would diverge the two copies)");
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
  // 三型各自的关键指令都在（改掉任一 ⇒ 红）。
  assert.match(src, /byte-identical/, "dual-copy sync instruction present in source");
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
