---
id: gap-webui-task-runs-block
title: web /task/<id> Runs 区块（补 cfg 参数 + parseWorkerOutcomeRecords 字段取满，复用
  transcript-access）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  depends_on:
    - gap-worker-task-transcript-access-webui
---
**type:** execution

## Proposal

`/task/<id>` Runs 区块：handler 现在【没有 `cfg` 参数】（`serve-handlers.ts:1349`，对比 `/goal/:id` `:3529` 有），要先补；`parseWorkerOutcomeRecords`（`observation.ts:563`）只取 4 个字段而盘上有 14 个（含 `worker_pid` 已在盘上但被丢）。**⚠️ 与 `gap-worker-task-transcript-access-webui` 直接重叠——按人裁定②那条先落地，本条复用它沉淀的读取+校验函数，⛔ 不造两份实现。**

## Plan

先落 `gap-worker-task-transcript-access-webui`（读 session + 校验函数）；本条复用其函数给 `/task/<id>` 补 `cfg` 参数 + Runs 区块；`parseWorkerOutcomeRecords` 取满盘上字段（含 worker_pid）。

## Acceptance Criteria

- [x] AC1（能取假，cfg 补齐）：`/task/<id>` handler 有 `cfg` 参数（与 `/goal/:id` 同构）且 Runs 区块渲染（⛔ 无 cfg 或 Runs 空 ⇒ 假）。
- [x] AC2（能取假，字段取满）：`parseWorkerOutcomeRecords` 取盘上全部字段（含 worker_pid）（⛔ worker_pid 仍丢 ⇒ 假）。
- [x] AC3（能取假，复用不重造）：复用 `gap-worker-task-transcript-access-webui` 的读取+校验函数（⛔ 另造一份实现 ⇒ 假）。

## Definition of Done

`/task/<id>` Runs 区块落地（复用 transcript-access 的读取+校验）；AC1-3 全勾；`parseWorkerOutcomeRecords` 字段取满。

## Touches

- packages/quay/src/serve-task.ts（/task/<id> handler + cfg）
- packages/quay/src/serve-handlers.ts（/task/<id> 路由调用点传 cfg）
- packages/quay/src/observation.ts（parseWorkerOutcomeRecords）
- packages/quay/test/observation.test.mjs（对应测试）
- tasks/gap-webui-task-runs-block.md（自身）