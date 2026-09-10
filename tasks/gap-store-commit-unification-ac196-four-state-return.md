---
id: gap-store-commit-unification-ac196-four-state-return
title: AC-196 四态返回：store-commit.ts 词表含 not-in-git/unchanged，旧 boolean 提交函数 =
  0（SPEC 阶段 1 切片）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-196
---
## Proposal

正本：`orchestration/SPEC-store-commit-unification-2026-09-08.md` §3 不可协商第 3 条 + §7 AC-196；判据 `goals/AC-196-not-in-git-unchanged-boolean-0.md`（goal=GOAL-008）。今天读数（已实测，位置判定）：`packages/quay/src/store-commit.ts` 不存在；`function commitGoalFileAfterWrite`（`goal-store.ts:264`）与 `function commitMetaFileAfterWrite`（`meta-store.ts:77`）两个 boolean 提交函数都在 ⇒ 判据 4 条全红。

根因（SPEC §1.2 分歧④）：goal/meta 把「不在 git 工作树」「内容没变所以跳过」「commit 真失败」三件事都返回 `false` —— 判定输出词表若无「未评估」态就无法区分「查过且合格」与「没查成」（硬规则 3b）。

本任务 = SPEC 阶段 1 的 AC-196 判据面切片：确保 `store-commit.ts` 四态返回词表含 `not-in-git` 与 `unchanged`，并删除两个旧 boolean 提交函数（goal-store/meta-store 改调 `commitStoreWrite`、对 `failed` 单独落痕）。与 `gap-store-commit-unification-stage1`（goal_ac: AC-195，ready）是同一原子改动的不同判据面——原语构建、五 store 接线、rev-parse root、负控制单测分别由 AC-195/197/198/199 判据面覆盖，本 AC 只判「词表四态 + 旧 boolean = 0」这一个切片；单测本体归 AC-199，本 AC 只核 not-in-git/unchanged 两态在负控制③④中被断言。

## Plan

1. 核/建 `packages/quay/src/store-commit.ts` 四态词表：`CommitOutcome = "committed" | "unchanged" | "not-in-git" | "failed"`（SPEC §3）；`grep -q not-in-git` 与 `grep -q unchanged` 均命中（若由 AC-195 已建，验证两词在位即可）。
2. 删 `goal-store.ts` 的 `commitGoalFileAfterWrite`（:264，含 :292 git commit 与 :265 path.dirname root），调用点改 `commitStoreWrite`（propagate 默认 none、skipIf 字节相同，SPEC §4 声明表），对 `failed` 落痕。
3. 删 `meta-store.ts` 的 `commitMetaFileAfterWrite`（:77，含 :105 git commit 与 :78 path.dirname root），调用点改 `commitStoreWrite`，同上。
4. 核测试负控制③④断言 not-in-git / unchanged（`store-commit.test.mjs`，本体归 AC-199 但语义属本 AC）。
5. 跑 AC-196 判据四条，全绿。

## Acceptance Criteria

- [x] 原语存在且词表四态齐备：`test -f packages/quay/src/store-commit.ts && grep -q 'not-in-git' packages/quay/src/store-commit.ts && grep -q 'unchanged' packages/quay/src/store-commit.ts`
- [x] 旧 boolean 提交函数 = 0：`test "$(grep -rl 'function commitGoalFileAfterWrite\|function commitMetaFileAfterWrite' packages/quay/src | wc -l)" -eq 0`
- [x] goal-store/meta-store 已改调 commitStoreWrite：`grep -q commitStoreWrite packages/quay/src/goal-store.ts && grep -q commitStoreWrite packages/quay/src/meta-store.ts`

## Definition of Done

真实落地 = AC-196 判据四条在生产工作树全部取真（不是「计划里说要删」）：`git show HEAD:packages/quay/src/store-commit.ts` 存在且含 `not-in-git`/`unchanged`；`goal-store.ts`/`meta-store.ts` 里 `function commitGoalFileAfterWrite`/`function commitMetaFileAfterWrite` 按位置判定不再出现（非注释/字符串命中，硬规则 2）；且一次真实写盘往返——经 goal-store 写一个 goal 文件，`git log -- goals/` 可见提交、`git status --porcelain goals/` 为空（unchanged 不留脏），提交消息来自新原语而非旧 boolean 路径。

## Touches

- packages/quay/src/store-commit.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/meta-store.ts
- packages/quay/test/store-commit.test.mjs
- tasks/gap-store-commit-unification-ac196-four-state-return.md