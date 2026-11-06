---
id: gap-goal-driver-blocked-taxonomy
title: stalled 拆分：blocked-needs-human / blocked-promotion / blocked-dispatch，各带 owner
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-next-projection
goal_ac: AC-935
---
## Proposal

`stalled` 一个态同时表示 needs-human、todo 过不了晋升门、ready 被池排除。三者的处置完全不同（请人 / 修四件套 / 查依赖与 worktree），但 driver 只报告"stalled"。本任务把它拆成三个独立取值，每个带 `blocker` 与 `owner`，复用已有的 `isTaskStuck` 与 ready-pool 判定，不新增语义判断。仍不写 task 状态（DIR-131）。旧字面量 `stalled` 可以留在类型里做迁移期兼容，但本轮 fact 不再 emit 它。

## Plan

1. `GapState` 增加 `blocked-needs-human` / `blocked-promotion` / `blocked-dispatch`；`computeGoalGaps` 按 `isTaskStuck` 的成因分派。
2. `goalNextProjection` 的 owner/action 映射：needs-human → human/ask-human；promotion → worker/fix-artifacts；dispatch → worker/fix-dispatch。
3. 保留 `stalled` 字面量做类型兼容，但不在轮 fact 中 emit；更新视图与消费者。
4. 测试：三态各自的正控与负控（needs-human 不被判成 promotion，反之亦然）。
5. live 证据：最新一轮 round fact 中出现至少一条 `blocked-*`，且 owner 在枚举内。

## AC

- [ ] `node --test plugin/test/goal-driver.test.mjs packages/quay/test/goal-analysis.test.mjs` 退出码 0。
- [ ] `GapState` 含三个新取值；轮 fact 不再 emit `stalled`；每个 blocked 行带 blocker 与 owner。
- [ ] 负控：needs-human 任务不被判成 blocked-promotion；todo 过不了晋升门不被判成 blocked-needs-human。
- [ ] 最新 round fact 中出现至少一条 `blocked-*`，owner 在枚举内。
- [ ] 不写 task 状态：`git diff` 只含 goal 侧文件。

## DoD

真实交付物是 blocked 三态、投影映射与一份 live 证据。证据必须来自真实轮次的一条 `blocked-*` 行（带 owner），不能只用 fixture；负控必须证明两种成因不会被互相误判。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务只细分 goal 缺口态与投影映射，不改变模块依赖图，未产生 L_D/L_G 数值读数。

## Touches

- packages/quay/src/core/goal-analysis.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-runtime.ts
- packages/quay/test/goal-analysis.test.mjs
- plugin/test/goal-driver.test.mjs
- plugin/test/goal-driver-s01.test.mjs
- plugin/test/goal-driver-s06.test.mjs
- plugin/test/helpers/goal-driver-harness.mjs
- docs/evidence/2026-11-06-goal-blocked-taxonomy.md (new)
- tasks/gap-goal-driver-blocked-taxonomy.md
