---
id: gap-worker-task-transcript-access-webui
title: worker task 详情页接入 transcript：派发钉 session-id 持久化 + /live 活体关联 + web Runs
  区块（带路径穿越防护）
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

人提议（架构已批准）：为每个 worker 执行的任务找到对应 Claude Code transcript，web task 详情页提供下载/展示链接；/live 页在飞任务详情直接访问「执行中」transcript 更好。

**现状（manager + Explore 核实）**：①worker-driver 每个 worker `cwd=主检出根` spawn ⇒ 所有 transcript 落同一项目目录 `~/.claude/projects/-home-yale-work-quay/<session-id>.jsonl`；②当前无任何地方记录 session id（worker-outcome.jsonl 有 run_id/worker_pid 但无 session_id；dispatch-record 也无）；③worker 显示名统一 quay-task-worker，按名扫描无法区分任务；④`~/.claude/sessions/<pid>.json` 给活进程 pid→sessionId 精确映射，但进程退出即删——只覆盖在飞。

**相邻缺陷（相关，可独立修）**：run_id 在常驻 driver 循环里非每次派发唯一——runPrefix 进程启动算一次，同任务同进程内重派多次拿相同 run_id。

## Plan

三部分（人批准）：①**主路径**——worker-driver 每次派发（每尝试非每任务）生成新 UUID，spawn 传 `claude --session-id <uuid>`，computeOutcome() 写 session_id 到 worker-outcome.jsonl ⇒ 查找机械化（按 task 过滤 → N 行 → session_id → transcript）。②**零成本加分**——/live 已 /proc 扫 worker_pid，join `~/.claude/sessions/<pid>.json` 拿活体 sessionId（今天可做，不改 worker-driver，只覆盖在飞）。③**web UI**——handleTaskDetail() 加 Runs 区块（按 task 过滤 worker-outcome 逐行渲染 + 链接），新端点**自带路径穿越防护**（session_id 严格 UUID 正则校验，路径永远拼已知项目 slug），inline 预览复用 readTranscriptTail() + 原始 JSONL 下载（Content-Disposition: attachment）。

**范围约束（人）**：不把 transcript 内容复制进 task 文件；worker-outcome.jsonl 已按 task 建索引是活查询源。

## Acceptance Criteria

- [ ] AC1（能取假，session_id 持久化）：worker-outcome.jsonl 每行有 session_id，且同任务重派 N 次有 N 个不同 session_id（⛔ 仍无 session_id 或重派同 session_id ⇒ 假）。
- [ ] AC2（能取假，/live 活体关联）：/live 在飞任务的详情能访问其「执行中」transcript（pid→sessionId join；⛔ 无链接 ⇒ 假）。
- [ ] AC3（能取假，web Runs 区块 + 穿越防护）：task 详情页 Runs 区块按尝试逐行渲染 transcript 链接 + 下载；非 UUID 的 session_id 参数被拒（⛔ 任意路径可读 ⇒ 假）。

## Definition of Done

三部分落地 develop；AC1-3 全勾；一个任务 N 次尝试的 transcript 可从详情页逐次访问（AC1/AC3）、/live 在飞任务当场访问执行中 transcript（AC2）。

## Touches

- plugin/scripts/worker-driver.ts（--session-id pin + computeOutcome session_id 字段）
- packages/quay/src/observation.ts（/live pid→sessionId join）
- packages/quay/src/serve-handlers.ts（Runs 区块 + 新端点 + 路径穿越防护）
- packages/quay/src/serve.ts（Runs 区块 + 新端点 + 路径穿越防护）
- packages/quay/test/serve-handlers.test.mjs（或对应测试）
- tasks/gap-worker-task-transcript-access-webui.md（自身）