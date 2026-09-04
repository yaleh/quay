---
id: gap-webui-session-detail-view
title: web /session/<sessionId> 单一会话视图（sessionId 寻址 + 结构化分块渲染 + 路径穿越防护）
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

新增 `/session/<sessionId>` 单一会话视图：寻址键必须是 sessionId（⛔ 非 pid / task id / transcript 路径，理由见 SPEC §7.1）；新 transcript 渲染器取代 `readTranscriptTail`（只取 3 条 × 500 字截断 = 预览级，非观测级）。**渲染形态（SPEC §7.4，本功能真正的新工作量，⛔ 不是复用即可）**：按 `message.content` 的 `text`/`tool_use`/`tool_result`/`thinking` 分块、工具调用与结果配对折叠，接近 Claude Code web 端形态（⛔ 非全文摊平纯文本）。`-p` 与交互式 transcript schema 同族（实测），一个渲染器覆盖两者。安全按 house pattern：参数只作查找键、永不作路径分量（`/tests/file?path=` 同法，`serve-handlers.ts:3065`）。

**⛔ blocker（人裁定 ①，未决）**：实时性方案会首次打破全站零客户端 JS 约定。本条先落【非实时/轮询】形态（列表 + 手动刷新），实时形态待裁定 ① 后再加，⛔ 不默认引入客户端 JS。

## Plan

新增 `/session/<sessionId>` 路由 + 结构化渲染器（content 分块 + tool 配对折叠）；sessionId 作查找键（白名单校验、不拼路径）；transcript 渲染覆盖 `-p` + 交互式同族 schema。

## Acceptance Criteria

- [x] AC1（能取假，sessionId 寻址）：用 sessionId 能取到对应会话视图（⛔ 用 pid/task id/路径寻址 ⇒ 假）。
- [x] AC2（能取假，结构化分块非摊平）：transcript 渲染按 `message.content` 的 `text`/`tool_use`/`tool_result`/`thinking` 分块，`tool_use` 与其 `tool_result` 成对且可折叠、`thinking` 可区分（有可 grep 块标记），`-p` 与交互式同走此渲染；（⛔ 全文摊平为纯文本 dump、无分块结构 ⇒ 假）。
- [x] AC3（能取假，路径穿越防护）：`../` 或绝对路径作 sessionId 参数不触发文件系统访问（⛔ 触发 ⇒ 假）。

## Definition of Done

`/session/<sessionId>` 落地（非实时形态 + 结构化渲染）；AC1-3 全勾；sessionId 只作查找键、路径穿越防护覆盖；渲染按 content 分块 + tool 配对折叠（接近 web 端形态）；实时形态留待裁定 ①。

## Touches

- packages/quay/src/observation.ts（readTranscriptTail / 新渲染器）
- packages/quay/src/serve-sessions.ts（/session/<sessionId> handler）
- packages/quay/test/observation.test.mjs（对应测试）
- tasks/gap-webui-session-detail-view.md（自身）