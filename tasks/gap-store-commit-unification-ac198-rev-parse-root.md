---
id: gap-store-commit-unification-ac198-rev-parse-root
title: AC-198 root 取自 git rev-parse --show-toplevel，不再把
  path.dirname(&lt;kind&gt;Dir) 当 git 根（SPEC 阶段 1 切片）
status: done
labels:
  - gap
parent: "null"
children: []
extra:
  schema: execution
goal_ac: AC-198
---
## Proposal

正本：`orchestration/SPEC-store-commit-unification-2026-09-08.md` §3 不可协商第 1 条 + §7 AC-198；判据 `goals/AC-198-root-git-rev-parse-show-toplevel-path-dirname-kind-dir-git.md`（goal=GOAL-008）。今天读数（已实测，位置判定）：`const root = path.dirname(goalDir)` 在 `packages/quay/src` 命中 **2** 处（`goal-store.ts:265` `commitGoalFileAfterWrite`、`goal-store.ts:491` `checkAchievedFailing`）；`const root = path.dirname(metaDir)` 命中 **1** 处（`meta-store.ts:78` `commitMetaFileAfterWrite`）；`packages/quay/src/store-commit.ts` 不存在 ⇒ `rev-parse` 判据亦红。AC 判据共 3 条 grep 行（分布在 goal-store / meta-store 两个文件；AC 标题写「2 处」指文件数，机器判据是 3 条 grep 行）。

根因（SPEC §1.2 分歧①，硬规则 4 推论二）：`path.dirname(<kind>Dir)` 假设 `goals/`、`meta/` 直接躺在仓库根下——今天恰好成立，换布局或在 worktree 里就静默指向错误的根。`quay-native/src/store.ts` 已经是正确写法（`git rev-parse --show-toplevel`），本 AC 把它推广到 goal/meta 两个 kind——含 goal-store 里非提交路径的 `checkAchievedFailing`（它同样拿 `path.dirname(goalDir)` 当 criterion 执行 cwd）。

本任务 = SPEC 阶段 1 的 AC-198 判据面切片：确保 root 一律 `git rev-parse --show-toplevel`（提交路径经 `commitStoreWrite` 原语的默认 root 参数，非提交路径直接 rev-parse），`packages/quay/src` 里不再有任何 `const root = path.dirname(<kind>Dir)`，且原语 `store-commit.ts` 含 `rev-parse`。与 `gap-store-commit-unification-stage1`（AC-195）、`gap-store-commit-unification-ac196-four-state-return`（AC-196）、`gap-store-commit-unification-ac197-five-kind-wiring`（AC-197，均 ready）是同一原子改动的不同判据面；单测本体归 AC-199。阶段 2（传播按读者归位）与阶段 3（驱动侧直写点）范围外。

## Plan

1. 核 AC-198 判据当前读数 = 3 条 grep 行 + `store-commit.ts` 不存在。
2. 核/建 `packages/quay/src/store-commit.ts` 原语 root 默认 `git rev-parse --show-toplevel`（⛔ 非 `path.dirname`，硬规则 4 推论二；若由 AC-195 已建，验证 `grep -q 'rev-parse'` 在位即可，不重做）。
3. `goal-store.ts`：消掉两处 `const root = path.dirname(goalDir)`——`commitGoalFileAfterWrite`（:265）随改调 `commitStoreWrite`（propagate none、skipIf 字节相同，SPEC §4 声明表）消失；`checkAchievedFailing`（:491）是 criterion 执行 cwd（非提交路径，不接 commitStoreWrite），改用 `git rev-parse --show-toplevel`。
4. `meta-store.ts`：消掉 `commitMetaFileAfterWrite`（:78）的 `const root = path.dirname(metaDir)`，改调 `commitStoreWrite`。
5. 跑 AC-198 判据三条，全绿。

## Acceptance Criteria

- [x] AC-198 判据本判据（goal-store 不再 path.dirname 当 root）：`test "$(grep -rn 'const root = path.dirname(goalDir)' packages/quay/src | wc -l)" -eq 0`
- [x] AC-198 判据本判据（meta-store 不再 path.dirname 当 root）：`test "$(grep -rn 'const root = path.dirname(metaDir)' packages/quay/src | wc -l)" -eq 0`
- [x] 原语用 rev-parse：`test -f packages/quay/src/store-commit.ts && grep -q 'rev-parse' packages/quay/src/store-commit.ts`

## Definition of Done

真实落地 = AC-198 判据三条在生产工作树全部取真（不是「计划里说要换」）：`grep -rn 'const root = path.dirname(goalDir)\|const root = path.dirname(metaDir)' packages/quay/src` 按位置判定计数 = 0（非注释/字符串命中，硬规则 2）；`store-commit.ts` 含 `git rev-parse --show-toplevel`。并做一次真实写盘往返负控制——在一个 worktree 里经 goal-store 写一个 goal 文件，提交落在 `git rev-parse --show-toplevel` 解析出的该 worktree 根（`git -C <worktree> log -- goals/` 可见该提交、主检出 `git log -- goals/` 不见），证明 root 解析在 worktree 布局下正确，而非 `path.dirname(goalDir)` 会静默指向的主检出根。

## Touches

- packages/quay/src/store-commit.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/meta-store.ts
- packages/quay/test/store-commit.test.mjs
- tasks/gap-store-commit-unification-ac198-rev-parse-root.md