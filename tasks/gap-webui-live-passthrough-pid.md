---
id: gap-webui-live-passthrough-pid
title: web /live 透传 pid（LiveWorker/InFlightTask 补 pid 字段，约 3 行）
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

`readLiveWorkerProcesses`（`packages/quay/src/observation.ts:670`）把 pid 读了又丢——`LiveWorker`/`InFlightTask` 类型无 `pid` 字段，`readLive`（`:840`）透传时也丢掉 ⇒ `/live` 响应拿不到 pid，下游无法从 live 视图定位进程/会话。补上 pid 透传（约 3 行）。

## Plan

给 `LiveWorker`/`InFlightTask` 加 `pid` 字段；`readLiveWorkerProcesses` push 时带上 pid；`readLive` 组装 `LiveWorker`/`InFlightTask` 时透传。

## Acceptance Criteria

- [ ] AC1（能取假）：`/live` 响应每个 live 条目含 `pid` 字段（⛔ pid 缺失 ⇒ 假）。

## Definition of Done

pid 从 `readLiveWorkerProcesses` 读到 `/live` 响应全程透传；AC1 全勾；无 pid 字段的 `LiveWorker`/`InFlightTask` 构造点清零。

## Touches

- packages/quay/src/observation.ts（readLiveWorkerProcesses / readLive / LiveWorker / InFlightTask）
- packages/quay/src/serve-live.ts（/live handler）
- packages/quay/test/observation.test.mjs（对应测试）
- tasks/gap-webui-live-passthrough-pid.md（自身）