---
id: gap-webui-message-delivery-entry
title: web 消息投递入口（复用 send-to-session 协议 + 投递四态真实显示）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  depends_on:
    - gap-webui-session-detail-view
---
**type:** execution

## Proposal

消息投递入口：复用 `send-to-session.ts` 协议——把 socket 那 30 行提炼成可 import 的模块，脚本继续作诊断工具，两者共享同一实现（⛔ 不复制一份进 web 层）。**必须显示真实投递状态**：`success:true` ≠ 送达（实测 held→expired 是真实路径，SPEC §7.3 四态）——决定变量是接收方 settings（`permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept` 任一即直通，皆无则 held→expired）。

## Plan

提炼 `send-to-session.ts` 的 socket 逻辑为可 import 模块（脚本复用）；web 发送入口调同一模块；响应显示投递四态（delivered / held / expired / error），不把 `success:true` 当送达。

## Acceptance Criteria

- [ ] AC1（能取假，共享实现）：web 发送入口与 `send-to-session.ts` 用同一模块（⛔ 两份实现 ⇒ 假）。
- [ ] AC2（能取假，真实状态）：响应显示投递四态（delivered/held/expired/error），held→expired 路径可观测（⛔ 只显示 success:true 而无 held/expired 态 ⇒ 假）。

## Definition of Done

投递入口落地（复用 send-to-session 模块 + 四态显示）；AC1-2 全勾；held→expired 真实路径可观测。

## Touches

- plugin/scripts/send-to-session.ts（提炼 importable 模块）
- packages/quay/src/serve-send.ts（/send handler）
- packages/quay/test/serve-handlers.test.mjs（对应测试）
- tasks/gap-webui-message-delivery-entry.md（自身）