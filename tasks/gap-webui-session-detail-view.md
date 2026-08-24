---
id: gap-webui-session-detail-view
title: web /session/<sessionId> 单一会话视图（sessionId 寻址 + 双 schema 渲染 + 路径穿越防护）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

新增 `/session/<sessionId>` 单一会话视图：寻址键必须是 sessionId（⛔ 非 pid / task id / transcript 路径，理由见 SPEC §7.1）；新 transcript 渲染器取代 `readTranscriptTail`（只取 3 条 × 500 字截断 = 预览级，非观测级）。`-p` 与交互式 transcript schema 同族（实测），一个渲染器覆盖两者。安全按 house pattern：参数只作查找键、永不作路径分量（`/tests/file?path=` 同法，`serve-handlers.ts:3065`）。

**⛔ blocker（人裁定 ①，未决）**：实时性方案会首次打破全站零客户端 JS 约定。本条先落【非实时/轮询】形态（列表 + 手动刷新），实时形态待裁定 ① 后再加，⛔ 不默认引入客户端 JS。

## Plan

新增 `/session/<sessionId>` 路由 + 渲染器；sessionId 作查找键（白名单校验、不拼路径）；transcript 渲染覆盖 `-p` + 交互式同族 schema。

## Acceptance Criteria

- [ ] AC1（能取假，sessionId 寻址）：用 sessionId 能取到对应会话视图（⛔ 用 pid/task id/路径寻址 ⇒ 假）。
- [ ] AC2（能取假，双 schema 覆盖）：transcript 渲染覆盖 `-p` 与交互式两者（⛔ 任一类渲染失败 ⇒ 假）。
- [ ] AC3（能取假，路径穿越防护）：`../` 或绝对路径作 sessionId 参数不触发文件系统访问（⛔ 触发 ⇒ 假）。

## Definition of Done

`/session/<sessionId>` 落地（非实时形态）；AC1-3 全勾；sessionId 只作查找键、路径穿越防护覆盖；实时形态留待裁定 ①。

## Touches

- packages/quay/src/observation.ts（readTranscriptTail / 新渲染器）
- packages/quay/src/serve-handlers.ts（/session/<sessionId> handler）
- packages/quay/test/observation.test.mjs（对应测试）
- tasks/gap-webui-session-detail-view.md（自身）