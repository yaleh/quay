---
id: gap-web-session-drops-queue-operation-records
title: quay-web /session/<id>
  渲染管线静默丢弃「忙时入队、随后被吸收」的跨会话消息（queue-operation/attachment 无 .message 字段被过滤门丢弃）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

quay-web 的 `/session/<id>` 渲染管线**静默丢弃**「跨会话消息在接收方忙时入队、随后被吸收进正在进行回合」这一类事件（人实测确认：页面上完全看不到自己发的一条消息）。

**根因（manager 读码核实 file:line，outer 复核）**：`packages/quay/src/observation.ts` `parseTranscript`（:2935-2936）与 `readTranscriptTail`（:2632-2633）的唯一过滤门是 `if (!msg || !msg.content) continue;`——**只认有 `.message.content` 的记录**。而 Claude Code 原生的两类记录**都没有 `.message` 字段**：
```
queue-operation：{type, operation:enqueue/remove, content, reason?:"absorbed_mid_turn"}
attachment：    {type, attachment:{type:"queued_command",...}, origin:{kind:"peer", name, body}}
```
⇒ 被该门**无差别丢弃**——不是特殊处理、不记日志，就是 `continue` 跳过。

**⊢ `reason:"absorbed_mid_turn"` 比「渲染遗漏」更彻底**：事件发生时**从未产生过带 `.message.content` 的记录**——不是页面没渲染，是当前 transcript schema 下这个语义事件根本没有可渲染的物化形态，唯一留痕只有 `queue-operation` 那一行本身，页面从不读它。

**⊢ 对照**：接收方空闲时到达的跨会话消息正常物化成 `type:"user"`/`role:"user"`（字符串内容），走同一个门能通过、渲染成普通气泡——即「忙时入队」与「闲时直达」两条路径，**只有一条被这道门挡住**。

**⊢ SPEC 留白**：`orchestration/SPEC-web-session-observability-and-control-2026-08-24.md` §3.1（:160-163）只定义 user/assistant/system 三类的渲染；§7.4（:451-459）提到过 `{attachment, queue-operation, ai-title, atis-latch, last-prompt}` 这个更大的记录类型清单，但从未给它们分配渲染方案——**这不是相对 SPEC 的实现 bug，是 SPEC 自己留白**。

**⊢ 附带（相关但独立，⛔ 不在本条 AC 内）**：`serve-send.ts` 的「消息投递」状态（已送达/待批准/到期）是**基于接收方权限设置的预测**（读 `/proc/<pid>/cmdline` 解出 defaultMode/crossSessionInbound），完全不读 transcript；而 `plugin/scripts/transcript-delivery-check.ts` 是**另一条独立实现**，读 transcript 找物化证据判定送达。两个「投递状态」概念互不 relate，回答同一问题的不同半面——属「两套平行机制」族，需单独判断是否调和，⛔ 不塞进本条渲染缺口。

## Plan

1. 给 `queue-operation`/`attachment` 补一条渲染路径——用它们已有的 `content`/`origin.body` 字段渲染成可区分标记（如「外部消息于 T 被吸收进当前回合，未开新回合：<内容>」），按 timestamp 就近挂在它前后的回合上；⛔ **不伪造 `.message.content` 记录**。

## Acceptance Criteria

- [x] AC1（能取假，吸收事件可渲染）：一条 `reason="absorbed_mid_turn"` 的 queue-operation 记录在 /session/<id> 页面可见（渲染成可区分标记）；（⛔ 仍不可见 ⇒ 假）。Evidence：`observation.test.mjs` AC1 测试 — `parseTranscript` 产出 `role:"external"` + `kind:"external"` turn，`renderSessionPage` 输出含「外部消息被吸收进当前回合（未开新回合）」+ 内容；48 测试全绿。
- [x] AC2（能取假，闲时直达不回归）：空闲时到达的跨会话消息（type:"user"）仍正常渲染成气泡，不回归；（⛔ 被误删/误改 ⇒ 假）。Evidence：`observation.test.mjs` AC2 negative control — `type:"user"` 仍产出 `role:"user"` + `kind:"text"`，页面无 `tx-external` 标记。
- [x] AC3（能取假，不伪造物化）：渲染不伪造 `.message.content` 记录（queue-operation/attachment 按 timestamp 就近挂，⛔ 不污染 transcript 本体）。Evidence：`observation.test.mjs` AC3 测试 — 混合 transcript 中 `user` turn 恰 1 条（真 type:"user"），queue/attachment 走独立 `external` block，不产出伪造 user turn。

## Definition of Done

queue-operation/attachment 有渲染路径；AC1-AC3 全勾；「忙时入队后吸收」的跨会话消息在页面上可见且可区分。

## Touches

- packages/quay/src/observation.ts（parseTranscript/readTranscriptTail 补 queue-operation/attachment 渲染路径）
- packages/quay/src/serve-sessions.ts（session 渲染层 — renderTurnsHtml 补 external block 渲染分支）
- packages/quay/test/observation.test.mjs（queue-operation/attachment 渲染测试 + 闲时直达不回归负控制；serve 渲染测试实现方按 renderSessionPage 归属并入本文件）
- tasks/gap-web-session-drops-queue-operation-records.md（自身）