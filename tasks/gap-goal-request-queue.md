---
id: gap-goal-request-queue
title: goal request 队列：提交、消费、幂等
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-blocked-taxonomy
goal_ac: AC-936
---
## Proposal

上层（manager / fleet / 人）需要一个 quay-native 的入口要求"重新评估这条 AC"，而不是读 driver 内部状态或写 goal store。本任务新增 `quay goal request <goal> <ac> --reason ...`，写 `.quay/goal-requests.jsonl`（submitted）；goal-driver 每轮消费 submitted 行：重跑该 AC 判据、写 accepted/refused/not-evaluated、带 consumedAt；同一 requestId 重放不产生第二条终态。请求面不替代 gap 环：它只触发一次重新评估，不改变缺口分类。

## Plan

1. `packages/quay/src/core/goal-request.ts`：append-only 读写、requestId 稳定派生（goal+ac+reason hash）、幂等。
2. `cli/goal.ts` 增加 `request` 子命令：`--reason` 必填，<8 非空白字符拒绝且不写行。
3. goal-driver 每轮消费 submitted 行：用现有 `gateCriterion` 重跑，写终态；崩溃窗口用 write-ahead + requestId 去重。
4. 测试：提交、消费、重放、坏行、缺 goal store；未知 AC / 只读 workspace 具名拒绝。
5. live 证据：一条真实 request 的 submitted→accepted/refused 链。

## AC

- [x] `node --test packages/quay/test/goal-request.test.mjs plugin/test/goal-driver.test.mjs` 退出码 0。
- [x] `goal request` 的 `--reason` <8 非空白字符 ⇒ exit 1，不写行。
- [x] driver 每轮消费 submitted；终态 accepted/refused/not-evaluated；同一 requestId 只有一条终态。
- [x] 负控：缺 goal/缺 AC/未知 AC/只读 workspace ⇒ 具名拒绝，零写。
- [x] live 证据：`.quay/goal-requests.jsonl` 的一条 submitted→accepted/refused 链，逐字写入证据文档。

## DoD

真实交付物是请求队列模块、CLI 入口、driver 消费面与一份 live 证据。证据必须来自真实提交并被 driver 消费的一条请求（带 consumedAt），不能只用 fixture；负控必须证明缺参/未知 AC 零写。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务新增 goal 请求队列与消费面，不改变模块依赖图，未产生 L_D/L_G 数值读数。

## Touches

- packages/quay/src/core/goal-request.ts (new)
- packages/quay/src/cli/goal.ts
- packages/quay/test/goal-request.test.mjs (new)
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- plugin/scripts/driver-runtime.ts
- packages/quay/src/cli/help.ts
- docs/carrier-registry.json
- .gitignore
- docs/evidence/2026-11-06-goal-request-queue.md (new)
- tasks/gap-goal-request-queue.md
