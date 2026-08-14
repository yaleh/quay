---
id: gap-ac63-ff-explicit-doc-check-before-merge
title: AC63 ff 前必须显式跑 doc 检查——ff 不触发任何钩子（本设计唯一的真风险）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac62-fan-in-ff-merge-lock-protocol
---

**type:** execution

## Proposal

**AC63（ff 前显式跑 doc 检查——本设计唯一的真风险）判据（SPEC-fan-in-ff-merge-lock-2026-08-14 §5 逐字）**：
`precommit-guard.ts` 实现注释逐字：「**Fast-forward merges create no merge commit, so pre-merge-commit does not fire for them**」⇒ 改成 ff-only 后，**doc 检查在 fan-in 路径上一个钩子都不触发**（pre-commit 只由 `git commit` 触发，pre-merge-commit 只由 `--no-ff` 触发）。

**⇒ 第 3 步是必需的，不是冗余**：subagent 必须在 ff 之前显式跑 `bash scripts/test.sh --static-checks-doc`，且它属于**无锁段**（内容检查，与竞争无关）。

**⚠️ doc 检查跑两次，刻意不去重（人 2026-08-14 确认）**：
- 第一次：subagent 自己 git commit 时，pre-commit 钩子触发 ⇒ 只覆盖【自己的改动】
- 第二次：第 3 步显式跑 ⇒ 覆盖【与 develop 合并之后的内容】
- **两次检查的对象不同 ⇒ 去重会漏掉合并引入的文档冲突。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 确认 ff 前显式跑 `scripts/test.sh --static-checks-doc`（无锁段第 3 步）。
2. **刻意不去重**：两次 doc 检查（commit 时 + ff 前显式）对象不同，去重漏合并引入的冲突。
3. 接线 + 验证。

## Acceptance Criteria

- [x] AC1 ff 前必跑 `bash scripts/test.sh --static-checks-doc`（无锁段第 3 步），不依赖任何钩子触发。
- [x] AC2 两次 doc 检查刻意不去重（commit 时覆盖自己改动 / ff 前显式覆盖合并后内容）——去重漏合并引入的文档冲突。
- [x] AC3 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] ff 前必跑 `bash scripts/test.sh --static-checks-doc` 接线进协议第 3 步（不依赖任何钩子触发）。
- [x] 两次 doc 检查刻意不去重（commit 时覆盖自己改动 / ff 前显式覆盖合并后内容）——去重漏合并引入的文档冲突。
- [x] 既有测试全绿、`--for-task` scoped 门绿。

## Touches

- orchestration/fast-mode-tick-core.md（A6 协议第 3 步——ff 前显式 doc 检查）
- plugin/scripts/precommit-guard.ts（确认 ff 不触发钩子的注释与 doc-check 入口对齐）
- （负控制 fixture）
- tasks/gap-ac63-ff-explicit-doc-check-before-merge.md（自身）

## Evidence

- **precommit-guard.ts 注释对齐（本任务 Touch）**：MERGE-PATH COVERAGE 块补 AC62/AC63 段——fan-in 约定已改 ff-only ⇒ `git merge --ff-only` 不产生 merge commit，pre-commit 与 pre-merge-commit 都不触发 ⇒ doc 检查在 ff 路径无钩子触发；A6 无锁段第 3 步**显式**跑 `bash scripts/test.sh --static-checks-doc`（不依赖钩子）；两次 doc 检查刻意不去重（commit 时覆盖自己改动 / 第 3 步覆盖与 develop 合并后内容，去重漏合并引入的文档冲突，人 2026-08-14 确认）。
- **负控制 fixture（本任务 Touch，`plugin/test/precommit-guard.test.mjs` 新增 AC63 用例）**：安装 pre-commit + pre-merge-commit 两个计数钩子后 `git merge --ff-only` ⇒ 触发 **0** 个钩子（`hook-fires.log` 不存在）；对照：普通 `git commit` 触发 pre-commit 且不触发 pre-merge-commit（证明计数器会抓火，零是真零）。这钉死「ff 路径 doc 检查无钩子触发 ⇒ 第 3 步显式跑必需」这个承重前提。
- **C17（fast-mode-tick-core.md A6 第 3 步，outer 落地，本任务不改）**：A6 无锁段第 ③ 步已含「全量 suite + doc 检查 `bash scripts/test.sh --static-checks-doc`(ff 不触发任何钩子,AC63;刻意不去重…)」——由 AC62 fan-in 落地（commit `1e65dc26`）接线。本任务验证对齐，无需再改（建议见报告）。
- **scoped 门 `--for-task gap-ac63-ff-explicit-doc-check-before-merge --allow-thin`**：exit 0，31 tests / 31 pass / 0 fail（含新增 AC63 负控制用例）；ts-typecheck 闸 ADMITTED（exit 0，Touches 无新增/移动 .ts）；`--static-checks-doc` exit 0。
- **落地 commit**：`40fcccc3`（worktree 内，未 merge；status 保持 ready）。
