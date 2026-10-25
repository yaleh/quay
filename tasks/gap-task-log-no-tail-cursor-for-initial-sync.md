---
id: gap-task-log-no-tail-cursor-for-initial-sync
title: task log 零条 transitions 时 nextCursor 为 null：外部消费者无法「一次全量打底 + 从当前尾部增量」，只能猜时间窗
status: ready
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

- [x] AC1（一次调用拿到起跑 cursor）：实现二选一——文档里**始终**多一个 `tailCursor: {v,carrierEpoch,seq} | null`，或支持 `--since tail`；两者都必须带当前 `carrierEpoch`。贴实跑输出：载体有 1155 条事件时，不带 `--since` 的 `task log --json` 返回的尾部 seq 等于最后一条 transition 的 `order`。
- [x] AC2（含语义不变）：把该尾部 cursor 原样传回 `--since`，返回 1 条边界事件（`order === seq`）+ 其后新增事件；边界事件的 `eventId` 与上次读到的一致 ⇒ 可按 `eventId` 去重。贴两次实跑输出。
- [x] AC3（epoch 轮换）：替换/伪造 `.quay/task-status-events-state.json` 的 epoch 后传旧 cursor ⇒ `rebase:true`、`rebaseReason` 非空，且尾部 cursor 的 `carrierEpoch` 是新 epoch。贴实跑输出。
- [x] AC4（三态，⛔ 不伪造尾部）：载体不存在 ⇒ 与「载体存在但 0 条事件」不同的取值（不得返回 seq=0 的假尾部）；载体存在但全部行 corrupt ⇒ `tailCursor: null` 且 `coverage.carrier.corrupt > 0` 在 `reasons` 里被点名。两条各贴实跑输出。
- [x] AC5（兼容）：`nextCursor` 的定义与取值不变（贴改动前后 `sha256`）。

## DoD

- 改动落在 `packages/quay/src/cli/task-log.ts` 与 `packages/quay/src/cli/help.ts`（契约段：尾部 cursor 的存在、含语义、epoch 轮换时的重同步规则）。
- `packages/quay/test/task-log.test.mjs` 增加覆盖 AC1–AC4 的 `node:test`（fixture 用临时 root，⛔ 不碰真实 `.quay/`）。
- help.ts 契约段写明该字段/flag 从哪个版本起可用。

## Verification（实跑读数，2026-10-25）

载体快照 = 真实 `.quay/task-status-events.jsonl` 的只读拷贝：**937 行 = 936 条 transition**，最后一条 `order=936`，epoch `f0abc6d11b8c4c6aefdd687eb6b308dc`。（AC 原文的「1155 条」是消费方当时的载体规模；这里按本次实读取数，不改写 AC 的谓词。）

- **AC1**：`task log --json`（无 `--since`）→ `tailCursor {"v":1,"carrierEpoch":"f0abc6d1…","seq":936}`；分页读到末页时最后一条 transition `order=936` ⇒ **tail seq === 最后一条 transition 的 order**。消费方原先失败的场景 `--since <now>`（0 条）→ `nextCursor:null` 而 `tailCursor.seq=936`。页大小/过滤不影响它：`--limit 1`、`--until`、`--since` 三种取法 tail 均为 `936`。
- **AC2**：取 tail 后 `--since tail` → `orders [936]`，边界 `eventId 80fd8ee79e5a65cc3332aea19454aac5`；经真实 writer 追加 1 条事件后再读同一 cursor → `orders [936,937]`、新事件 `AC2-NEW-EVENT`、边界 `eventId` 仍为 `80fd8ee7…`（⇒ 可按 eventId 去重）、`rebase:false`、新 `tailCursor.seq=937`。
- **AC3**：把 `.quay/task-status-events-state.json` 的 epoch 伪造为 `forgedepoch0123456789abcdef01234567` 后传旧 tail ⇒ `rebase:true`、`rebaseReason` 非空（"does not match the carrier's current epoch …"），`tailCursor.carrierEpoch = forgedepoch0123456789abcdef01234567`（新 epoch）、`seq:936`，并从当前 epoch 开头重放（500 条，受 `--limit`）。
- **AC4（三态）**：①载体不存在 ⇒ `tailCursor:null` + `coverage.carrier.exists:false`；②载体存在但 0 条 ⇒ `tailCursor {"v":1,"carrierEpoch":"pre-epoch","seq":0}` + `exists:true`（与①取值不同，⛔ 未给①伪造 seq=0）；③载体存在且全部行 corrupt ⇒ `tailCursor:null`、`exists:true`、`corrupt:2`，reasons 含 "2 corrupt carrier line(s) were counted and skipped"。
- **AC5**：`nextCursor` 改动前后逐字节相同，`sha256(canonical nextCursor)` = `7e779d3189c5c7516f4e0c0ced192d152d0ce292564e04daac437b5f75490c24`（before = after；同快照同参数均为 `seq:499`）。
- **测试**：`packages/quay/test/task-log.test.mjs` 新增 (i)–(l) 四条 `node:test`（临时 root fixture，⛔ 不碰真实 `.quay/`），全文件 15/15 通过；`scripts/test.sh --for-task gap-task-log-no-tail-cursor-for-initial-sync --allow-thin` = 106 tests / 0 fail。

## ADR-007 dark-axis record

该轴仍暗,理由:本切片只在 task-log 只读面新增一个字段与契约文本，未跑 archguard 的 L_D/L_G 读数，依赖结构未被本改动触及。

## Touches

- `tasks/gap-task-log-no-tail-cursor-for-initial-sync.md`（自指）
- `packages/quay/src/cli/task-log.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/task-log.test.mjs`