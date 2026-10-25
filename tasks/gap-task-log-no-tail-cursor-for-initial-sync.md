---
id: gap-task-log-no-tail-cursor-for-initial-sync
title: task log 零条 transitions 时 nextCursor 为 null：外部消费者无法「一次全量打底 + 从当前尾部增量」，只能猜时间窗
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

外部只读消费者的标准接法是「一次 `quay task list --json --no-body` 打底，之后只消费增量」。但 `quay task log --json --since <ISO>` 在没有匹配事件时返回 `nextCursor: null`（`packages/quay/src/cli/task-log.ts:398`：`const nextCursor = last === null ? null : {...}`），消费者因此拿不到「当前尾部」的 cursor：

- 实测（消费方 claudecodeui，quay 0.22.0，1155 条事件载体）：`--since <当前时刻 ISO>` 返回 0 条 + `nextCursor: null` + `complete:false`；
- 唯一可用做法是猜一个恰好覆盖最近事件的时间窗（实测用「40 分钟前」），这依赖猜测而不是契约；
- 从 seq 1 重放全部历史则把「打底」成本翻倍，且与 `task list` 的结果重复。

这不是「读不到」而是「读到了却拿不到起跑位置」。当前 `nextCursor` 的定义是「本页最后一条**已投递**事件的位置」（`task-log.ts:31-36`），零条已投递时它无值 —— 语义本身没错，缺的是另一个量：carrier 的**尾部位置**。

## AC

- [ ] AC1（一次调用拿到起跑 cursor）：实现二选一——文档里**始终**多一个 `tailCursor: {v,carrierEpoch,seq} | null`，或支持 `--since tail`；两者都必须带当前 `carrierEpoch`。贴实跑输出：载体有 1155 条事件时，不带 `--since` 的 `task log --json` 返回的尾部 seq 等于最后一条 transition 的 `order`。
- [ ] AC2（含语义不变）：把该尾部 cursor 原样传回 `--since`，返回 1 条边界事件（`order === seq`）+ 其后新增事件；边界事件的 `eventId` 与上次读到的一致 ⇒ 可按 `eventId` 去重。贴两次实跑输出。
- [ ] AC3（epoch 轮换）：替换/伪造 `.quay/task-status-events-state.json` 的 epoch 后传旧 cursor ⇒ `rebase:true`、`rebaseReason` 非空，且尾部 cursor 的 `carrierEpoch` 是新 epoch。贴实跑输出。
- [ ] AC4（三态，⛔ 不伪造尾部）：载体不存在 ⇒ 与「载体存在但 0 条事件」不同的取值（不得返回 seq=0 的假尾部）；载体存在但全部行 corrupt ⇒ `tailCursor: null` 且 `coverage.carrier.corrupt > 0` 在 `reasons` 里被点名。两条各贴实跑输出。
- [ ] AC5（兼容）：`nextCursor` 的定义与取值不变（贴改动前后 `sha256`）。

## DoD

- 改动落在 `packages/quay/src/cli/task-log.ts` 与 `packages/quay/src/cli/help.ts`（契约段：尾部 cursor 的存在、含语义、epoch 轮换时的重同步规则）。
- `packages/quay/test/task-log.test.mjs` 增加覆盖 AC1–AC4 的 `node:test`（fixture 用临时 root，⛔ 不碰真实 `.quay/`）。
- help.ts 契约段写明该字段/flag 从哪个版本起可用。

## Touches

- `tasks/gap-task-log-no-tail-cursor-for-initial-sync.md`（自指）
- `packages/quay/src/cli/task-log.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/task-log.test.mjs`