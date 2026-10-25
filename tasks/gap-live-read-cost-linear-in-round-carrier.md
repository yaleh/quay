---
id: gap-live-read-cost-linear-in-round-carrier
title: 在飞/lanes 读取成本 ∝ 载体大小：readLive 全量读 90MB worker-round.jsonl，外部消费者每轮 1.1–1.2s
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay lanes --json` 与 `quay driver live --kind worker --json` 每次调用都完整读取 `.quay/worker-round.jsonl`（本仓库 89.6MB / 61179 行；消费方 claudecodeui 实测 124MB）。本仓库实测：`quay lanes` 1.13s / 394MB RSS，`driver live` 0.98s；同一工作区 `quay task list --json --no-body` 仅 0.53s，说明成本随**载体大小**增长而不是随在飞任务数增长。

实测分解（2026-10-25，本仓库）：

- `worker-round.jsonl` 89.6MB：`readFileSync` 176ms + 逐行 `JSON.parse` 273ms ≈ 450ms；
- `worker-outcome.jsonl` 8MB：read 16ms + parse 17ms ≈ 33ms；
- `readLive(computeBlocking:false)` 内部合计 867ms；其余 ≈ 380ms 花在 579 个 `.workflow-events/*.jsonl` 小文件、`/proc` 扫描与 `taskWorktreeOpen` 检查；
- 进程 + 模块导入 floor ≈ 100–180ms；
- 对照：tail 读最后 256KB 并只 parse 最后一行 = **0.4ms**。

语义已经等价、读法却全量：`readWorkerRoundInFlightTasks`（`packages/quay/src/observation/records.ts:421-457`）逐行解析后**只保留最后一条带 `in_flight_tasks` 的记录**，当前实现为此读取并 parse 了全部 61179 行。`quay lanes` 的窗口参数（1h/3h/6h）不改变成本，因为过滤发生在全量读取与解析之后。

另有一个**未被外部消费者使用**的廉价直接量：`.quay/worker-dispatch.json`（worker-driver 在 spawn 后原子写、终态删除，按 taskId 索引，字段 `runId/workerPid/startedAtMs/timeoutDeadlineMs/cmdlineFingerprint`；当前无在飞时为 `{}`）。它没有 phase、没有 heartbeat，也不覆盖机械 fan-in 窗口，但读它是字节级成本。

⚠️ 写入节奏是延迟上限：`worker-round.jsonl` 实测约 50–60s 一条（最后 5 条 12:41→12:45Z）。尾部读取只降低**成本**，不改变**新鲜度**。若外部消费者需要 <100ms 且秒级新鲜度，那需要一个新的小载体（如 `.quay/live-state.json`，由 worker-driver 在派发/终态/每轮原子重写），**不在本任务范围内**，应另立任务。

## AC

- [ ] AC1（逐字等价）：`quay lanes --json` 与 `quay driver live --kind worker --json` 在**同一输入**（同一份 round/outcome/workflow-events 载体 + 固定 nowMs）下，改动前后输出逐字相等；贴改动前后两次实跑输出与 `sha256`。
- [ ] AC2（成本）：把 `.quay/worker-round.jsonl` 换成 ≥50MB 的合成载体后，`quay lanes --json` 的墙钟从基线（贴基线读数）降到 ≤ 基线的 60%，且输出与「同一逻辑内容的小载体」逐字相等。
- [ ] AC3（负控制，语义不能被「只读最后一行」改变）：构造「最后一行不带 `in_flight_tasks`、但倒数第 N 行带」的载体，新读法必须仍返回那最后一条带键记录；再构造「全部行都不带该键」⇒ 返回空集而不是报错。两次都贴实跑输出。
- [ ] AC4（三态不变）：`readLive` 的 `status` 仍能区分 `ok` / `empty` / `error`；`lanes` 的退出码约定（`live.status === "error"` ⇒ exit 1 且 stdout 无 JSON）不变；贴一条 error 分支实跑。

## DoD

- 改动落在 `packages/quay/src/observation/records.ts`（尾部反向扫描）与 `packages/quay/src/observation.ts`（`.workflow-events` 读取策略），⛔ 不新增第二份 `/proc` 扫描或事件解析实现。
- `packages/quay/test/` 内有 `node:test` 覆盖 AC2/AC3（合成载体用临时目录，⛔ 不碰真实 `.quay/`），文件头带 `// @test-group product`。
- 若改动改变了任何已发布 JSON 字段或退出码，必须在 `packages/quay/src/cli/help.ts` 同步登记；否则不动 help。