---
id: gap-ac147-manager-liveness-independent-channel
title: AC147 manager 自身活性由【不依赖 manager】的通道兜底——失能超 T 有机制让人知道
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

取消两层后只剩人看 manager。「看门人」缺口：今天是三层互看（outer 阻塞 3h17m 期间是 manager 发现、inner 执行）；新架构下 manager 阻塞时 driver 仍在跑（比 outer 一阻塞派发即停更好），但语义工作停摆且无人察觉直到人去看。⇒ 本质用【层间冗余】换【机制连续性】，需一个**不经过 manager 的机制**在 manager 失能超阈值 T 时让人知道。⛔ 不要求自动解除阻塞（代答越界），只要求让人知道。

## Plan

落一个独立于 manager 的活性兜底（heartbeat 超时检测 + 通知，放 `plugin/scripts/manager-liveness-independent-check.ts` + 测试 `plugin/test/manager-liveness-independent-check.test.mjs`），阈值 T 落笔方定；负控制用本会话现成样本回放（outer 04:13:54Z–07:30:07Z 的 AskUserQuestion 阻塞态）。新建文件按上述命名落地，不另取名。

## Acceptance Criteria

- [x] AC1（能取假，独立通道）：manager 失能（交互阻塞/心跳停/进程死）超 T，存在不经过 manager 的机制让人知道；（⛔ 只能靠人主动去看 ⇒ 假）。— test `AC1 — 进程死` / `AC1 — 心跳停` / `AC1 — 进程状态未知`（judge() 对陈旧心跳产非空 notification、对新鲜心跳产 null——两方向都取假）
- [x] AC2（能取假，负控制回放）：把 manager 置入 AskUserQuestion 阻塞态（现成样本 outer 04:13:54Z–07:30:07Z），T 后须有通知；（⛔ T 后无通知 ⇒ 假）。— test `AC2 — AskUserQuestion 阻塞态回放：T 后 judge() 产出非空 notification` + `CLI — 负控制回放：T 后 exit 1 且通知写入 --notify-file`（正方向 `CLI — 正控制：新鲜心跳 exit 0 且不落盘` 同时取假）

## Definition of Done

manager 活性独立兜底落地：不经过 manager 的 heartbeat 超时检测 + 通知机制到位；AC1/AC2 全勾；负控制样本回放（outer 04:13:54Z–07:30:07Z 阻塞态）通过。

## Touches

- plugin/scripts/manager-liveness-independent-check.ts (new)（manager 活性兜底检测 + 通知）
- plugin/test/manager-liveness-independent-check.test.mjs (new)（负控制回放：AskUserQuestion 阻塞态 T 后须通知）
- plugin/scripts/capability-catalog.sh（新脚本注册：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 五表各加一行）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照 scripts 296→297）
- tasks/gap-ac147-manager-liveness-independent-channel.md（自身）

## Needs-Human

**执行 2026-08-28T18:14:51.307Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
