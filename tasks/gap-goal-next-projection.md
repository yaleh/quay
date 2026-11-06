---
id: gap-goal-next-projection
title: goal-next 投影：每个 active GOAL 一行 owner/action，纯函数上收 Core
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-filing-throttle
goal_ac: AC-935
---
## Proposal

goal-driver 每轮算出大量缺口读数，但没有一条回答"这个 goal 下一步该做什么、归谁"。消费者只能读 round fact 再自己拼。本任务新增纯函数 `goalNextProjection(records, gaps, taskFacts)`：对每个 active GOAL 选出一条，排序 needs-human → stalled → workable → gap → world-gated → not-evaluated，同态按 AC id；输出 `{goal, ac, gapState, owner, action, evidenceRefs}`。`owner` 是枚举 driver/worker/human/world，`action.kind` 是枚举 file-task/resume-task/fix-artifacts/ask-human/wait。

为了让 Core CLI 与 driver 共用同一份口径，投影的纯实现放在 `packages/quay/src/core/goal-analysis.ts`，driver 经 `driver-runtime.ts` 的 Core 导入面复用；不迁移 `computeGoalGaps`（避免大范围移动）。新增 `quay goal next --json`：默认读最近一轮 `goal-round.jsonl` 的 `goal-next` fact；没有 fact ⇒ exit 3 NOT-EVALUATED（不冒充空数组）；有 fact 但 active GOAL 没有对应行 ⇒ exit 1。投影写进 round fact 的新 fact `goal-next`。

## Plan

1. 新建 `packages/quay/src/core/goal-analysis.ts`：定义与 driver 同形的 `GapState` / `GoalGap` 类型与纯函数 `goalNextProjection`（不读 fs/clock）。
2. 排序与枚举按 Proposal；每个 active GOAL 恰好一行；缺值时用独立取值，不塞默认。
3. driver 每轮调用并把结果写进 `goal-next` fact；`GoalRingReading` 增加 `next` 字段。
4. `cli/goal.ts` 增加 `next` 子命令：读最近一轮 round fact 的 `goal-next`；无 fact ⇒ exit 3；active GOAL 缺行 ⇒ exit 1；全部齐 ⇒ exit 0 并输出数组。
5. 测试：排序、枚举、0 active goal ⇒ exit 0 空数组、无 fact ⇒ exit 3、active GOAL 缺行 ⇒ exit 1。
6. live 证据：GOAL-914 激活后的一轮 round fact 中的 `goal-next` 行 + CLI 输出。

## AC

- [ ] `node --test plugin/test/goal-driver.test.mjs packages/quay/test/goal-analysis.test.mjs` 退出码 0。
- [ ] `goalNextProjection` 对每个 active GOAL 恰好一行；排序符合 needs-human→stalled→workable→gap→world-gated→not-evaluated，同态按 AC id。
- [ ] `owner` 与 `action.kind` 都是枚举；缺值时用独立取值。
- [ ] `quay goal next --root . --json` 在 fact 齐全时 exit 0 并输出数组；无 fact ⇒ exit 3；active GOAL 缺行 ⇒ exit 1。
- [ ] 最新一轮 round fact 含 `goal-next` fact，且与 CLI 输出等价。
- [ ] live 证据：GOAL-914 的一行投影与 CLI 输出逐字写入证据文档。

## DoD

真实交付物是 Core 的投影纯函数、round fact 的 `goal-next`、CLI 读面与一份 live 证据。证据必须来自 GOAL-914 激活后的真实轮次（round fact 行 + CLI stdout），不能只用 fixture；负控必须证明"无 fact"与"active GOAL 缺行"不会被读成空数组的成功。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务新增 goal 投影纯函数与读面，不改变模块依赖图，未产生 L_D/L_G 数值读数。

## Touches

- packages/quay/src/core/goal-analysis.ts (new)
- packages/quay/src/cli/goal.ts
- packages/quay/src/core/types.ts
- packages/quay/test/goal-analysis.test.mjs (new)
- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/goal-driver.test.mjs
- docs/evidence/2026-11-06-goal-next-projection.md (new)
- tasks/gap-goal-next-projection.md
