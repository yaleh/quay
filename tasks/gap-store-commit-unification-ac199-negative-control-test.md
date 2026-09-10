---
id: gap-store-commit-unification-ac199-negative-control-test
title: AC-199 双向负控制单测存在、带 @test-group 标注（进默认 suite）、且跑绿（SPEC 阶段 1 切片）
status: done
labels:
  - gap
parent: "null"
children: []
extra:
  schema: execution
goal_ac: AC-199
---
## Proposal

正本：`orchestration/SPEC-store-commit-unification-2026-09-08.md` §7 AC-199；判据 `goals/AC-199-test-group-suite.md`（goal=GOAL-008）。今天读数（已实测，位置判定）：`packages/quay/test/store-commit.test.mjs` 不存在 ⇒ 判据第一条（`test -f`）即红。

根因（硬规则 4 推论三）：commit-after-write 统一原语（`store-commit.ts` 四态返回、传播按读者归位）需要一个双向负控制单测，否则「测试绿」只是回声不是测量——四组负控制缺一不可：① propagate:"develop" 关掉 ⇒ develop 拿不到该写；② propagate:"none" 打开 ⇒ develop 不拿到该写；③ 目标不在 git 工作树 ⇒ 返回 not-in-git 而非 failed；④ 内容字节相同 ⇒ 返回 unchanged 且工作树干净（脏 goals/*.md 会挡 develop→doc ff-only，即 gap-meta-commitgoalfile 修过的 bug）。

本任务 = SPEC 阶段 1 的 AC-199 判据面切片：确保 `packages/quay/test/store-commit.test.mjs` 存在、带 `@test-group` 标注（ADR-019 in-file skip，进默认 suite）、四组负控制全绿、且该文件出现在默认 suite 选择里。与 `gap-store-commit-unification-stage1`（AC-195）、`gap-store-commit-unification-ac196-four-state-return`（AC-196）、`gap-store-commit-unification-ac197-five-kind-wiring`（AC-197）、`gap-store-commit-unification-ac198-rev-parse-root`（AC-198，均 ready）是同一原子改动的不同判据面——原语构建、五 store 接线、rev-parse root、四态词表分别由 AC-195/197/198/196 判据面覆盖，本 AC 只判「单测存在 + @test-group + 四组负控制 + 跑绿」这一个切片。阶段 2（传播按读者归位）与阶段 3（驱动侧直写点）范围外。

## Plan

1. 核 AC-199 判据当前读数 = 文件不存在 ⇒ 红（`test -f packages/quay/test/store-commit.test.mjs` 退出非 0）。
2. 建 `packages/quay/test/store-commit.test.mjs`，前三行含 `@test-group` 标注（ADR-019 in-file skip，进默认 suite；若由 stage1 已建，验证 `head -3 | grep -q '@test-group'` 在位即可，不重做）。
3. 写四组双向负控制（SPEC §7，缺一不可否则是回声不是测量），各自断言生产行为而非注入假数据：① propagate:"develop" 关掉 ⇒ develop 拿不到该写；② propagate:"none" 打开 ⇒ develop 不拿到该写；③ 目标不在 git 工作树 ⇒ 返回 not-in-git 而非 failed；④ 内容字节相同 ⇒ 返回 unchanged 且工作树干净。
4. 跑 AC-199 判据三行（test -f + head -3 grep @test-group + node --test）全绿。

## Acceptance Criteria

- [x] 单测文件存在：`test -f packages/quay/test/store-commit.test.mjs`
- [x] 前三行含 @test-group 标注（进默认 suite）：`head -3 packages/quay/test/store-commit.test.mjs | grep -q '@test-group'`
- [x] 四组负控制断言在位（非零测试回声）：`grep -q 'not-in-git' packages/quay/test/store-commit.test.mjs && grep -q 'unchanged' packages/quay/test/store-commit.test.mjs && grep -q 'propagate' packages/quay/test/store-commit.test.mjs`
- [x] 跑绿：`node --no-warnings --experimental-strip-types --test packages/quay/test/store-commit.test.mjs`

## Definition of Done

真实落地 = 测试文件真的穿过默认 suite 且四组负控制真的测了生产行为，不是「零测试跑绿」的回声（DIR-026 Reading A / 硬规则 4 推论三）：`node --no-warnings --experimental-strip-types --test packages/quay/test/store-commit.test.mjs` 退出 0 且输出含 4 个测试用例（非 0 tests），该文件经 `@test-group` 被 `scripts/test.sh` 默认 suite 选中（非 skip）；四组负控制各自有真实断言——① propagate develop 关 ⇒ develop 拿不到该写 ② propagate none 开 ⇒ develop 不拿到该写 ③ 目标不在 git 工作树 ⇒ not-in-git 而非 failed ④ 内容字节相同 ⇒ unchanged 且 `git status --porcelain goals/` 为空（用 git 直接量核对，非测试自报）。

## Touches

- packages/quay/test/store-commit.test.mjs
- tasks/gap-store-commit-unification-ac199-negative-control-test.md
