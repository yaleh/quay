---
id: gap-ac117-spec-phase3-mcp-control-plane
title: AC117 SPEC §5 阶段 3——MCP 控制面（halt / setPreference / forceDispatch，身份可核）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac116-spec-phase2-concurrency-stash
---

**type:** execution

## Proposal

**来源**：manager 投「结晶」阶段 AC117（编号绑定：SPEC §5 阶段 3，判据正本在 SPEC，⛔ 不在此复制）。

**形态**：驱动暴露 HTTP/SSE MCP：halt / setPreference / forceDispatch。

**为什么 inner 执行**：MCP 控制面 + .halt 退役属产品机件 → inner 域。

## Plan

1. 驱动暴露 HTTP/SSE MCP 三操作（halt / setPreference / forceDispatch）。
2. 调用方身份显式传且可核（Mcp-Session-Id 只能区分连接、不知道调用方 ⇒ 身份走 header 或 tool 参数）。
3. 取假验证：不带身份调用 ⇒ 拒，⛔ 不得按默认身份放行。

## Acceptance Criteria

- [x] AC1：halt 语义 = 停止新派发、⛔ 不杀在飞（与现 .halt 边界一致）。
- [x] AC2：调用方身份显式传且可核（走 header 或 tool 参数，非 Mcp-Session-Id）。
- [x] AC3（能取假）：不带身份调用 ⇒ 拒，⛔ 不得按默认身份放行。

## Definition of Done

- [x] MCP 控制面三操作 + 身份可核 + 无身份拒取假通过；AC1-3 全勾；land 到 develop。

## Retires

- `.halt` 文件机制（被 MCP halt 取代，⛔ 不得两者并存 = 两个真相源）

## Touches

- plugin/scripts/worker-driver.ts（MCP 控制面，落点 inner 定）
- plugin/test/worker-driver.test.mjs（AC1/AC2/AC3 取假测试——扩 Touches：测试文件是新增代码的必要落点）
- tasks/gap-ac117-spec-phase3-mcp-control-plane.md（自身）
