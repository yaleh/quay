---
id: gap-serve-search-timeout-all-body-fetch
title: serve /tasks ?q= 搜索超时——?q= 全量取 1572 任务 body 致 MCP -32001 超时、搜索恒空
status: todo
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

`quay serve` 的 `/tasks?q=` 搜索恒空：`serve-task.ts` 在 `qFilter` 存在时设 `taskList({ includeBody: true })`（line 16-17），MCP 一次性返回全部 1572 任务的 body（大 payload）→ MCP 请求超时（`-32001 Request timed out`）→ handler 报错 → 渲染 0 行。

**实证（2026-08-28）**：搜 `q=test` / `q=M103` / `q=outDegree`（均在第 1 页任务的标题里）全部 0 行；serve 日志 `[quay serve] request handler error (GET /tasks?q=test): McpError: MCP error -32001: Request timed out`。无 q 的列表正常（分页 20/页）。任务详情页 `/task/<id>` 正常（HTTP 200）——数据完整，纯搜索路径坏。

**影响**：Web UI 搜索完全不可用（CB-007 的 search affordance 名存实亡）；用户无法从列表定位任务（只能靠详情页直链或翻 ~79 页）。

## Plan

1. 搜索路径不要全量取 body：改由 provider/MCP 侧支持搜索过滤（task_list 加 search 参数，MCP 侧过滤），或分批取（分页 + 流式），或只取 title + body 摘要而非全文。
2. 或给搜索请求更大的 MCP 超时 / 流式响应。
3. 负控制：无 q 列表不回归；搜标题词能命中。

## Acceptance Criteria

- [ ] AC1（能取假，搜索可用）：`/tasks?q=<标题词>` 能命中目标任务（⛔ 仍恒空 ⇒ 假）。
- [ ] AC2（能取假，无 q 不回归）：无 q 列表仍分页正常（⛔ 分页破 ⇒ 假）。
- [ ] AC3（能取假，超时消除）：搜索请求无 `-32001 Request timed out`（⛔ 仍超时 ⇒ 假）。

## Definition of Done

搜索可用且不超时；无 q 列表不回归；1572 任务规模下稳定。

## Touches

- packages/quay/src/serve-task.ts（qFilter 的 body 获取策略）
- packages/quay/src/provider-client.ts（若改 taskList 搜索传递）
- packages/quay-native/（若 MCP task_list 加 search 参数）
- tasks/gap-serve-search-timeout-all-body-fetch.md（自身）