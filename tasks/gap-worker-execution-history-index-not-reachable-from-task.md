---
id: gap-worker-execution-history-index-not-reachable-from-task
title: 任务执行历史索引不可从任务体/续做 prompt 到达——suite 日志路径零记录、续做只带一句 reason、Needs-Human 无 run_id
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

任务执行历史索引已存在于 `.quay/worker-outcome.jsonl`，但**任务体零指针、suite 日志路径任何记录都没记、续做 prompt 只带一句 reason**。

**触发实证**：`gap-suite-classification-lpt-scheduler-ts-ization` 连续 3 次 exited-not-landed（同一 `run_id wk-prod-1788218643`：03:44 anti-drift 8 violations / 04:21 ac-precheck 0/3 fail-fast / 04:57 suite red）。真因（静态检查 checker-mutation-check AC5：canonical=561 vs `scripts/test.sh --list-files`=171）只存在于 `.quay/fan-in-suite-<task>-<runId>.log`（183KB，实测在盘），而**任何记录里都没有这个文件的路径**。

**已有索引（⛔ 不重复造）**：`worker-outcome.jsonl`（每尝试一条，含 ts/run_id/session_id/…/failure_reason + `mechanical_fan_in{outcome,step,reason,lockHoldSecs,suiteOutcome,landedSha,fanInLog}`）是唯一真相源；`fan-in-step-trace.jsonl` + `fan-in-<task>-<runId>.log`；web `/task/<id>` Runs 区块（serve-task.ts:523）已可点 run id / transcript / fan-in 日志。任务体 `## Execution record`（97 条）是里程碑时代手写散文、无写入器，⛔ 不复用。

**缺口（本任务修 A+B+C）**：
- **A**：suite 日志谁也没记——`mechanical_fan_in` 只记 `fanInLog`（3.6KB 步骤 trace），suite 步 `verdict.logFile = null`（`worker-driver.ts:2477` 一路 logFile:null）；183KB 真因文件只能靠命名约定猜（硬规则 4c「穿不过中间层的量」）。
- **B**：续做 prompt 结构上看不到历史——`buildContinueWorkerPrompt`（`worker-driver.ts:1121`）只塞 `the last round exited-not-landed because: <reason>`（`lastExitedNotLandedReason` 只取最后一条，`driver-filters.ts:583`）；重跑 worker 看不到前两次栽在哪、看不到日志路径。
- **C**：任务体唯一 durable 人可读面 `## Needs-Human`（`driver-filters.ts:631`）只写时间戳+原因+失败步，无 run_id / 无日志路径 / 无 session_id。

**设计取舍（⛔ 勿偏）**：历史保留在 `worker-outcome.jsonl` 单一真相源，**任务体只放不随轮次增长的指针块**——不把逐轮历史 copy 进 tasks/*.md（两个 writer + 每轮 churn + 与 develop 同步打架）。run_id 是 driver 轮次级、非 per-attempt（本例 3 次同 runId），**索引主键 = ts+step，⛔ 不能用 runId**。

## Plan

1. **A（suiteLog 记录）**：`mechanical_fan_in` 增 suiteLog 字段；suite 步 `verdict.logFile` 指向 `.quay/fan-in-suite-*.log`（不再 null）。
2. **B（续做历史）**：`continueStateForTask`（`worker-driver.ts:1060`）收集全部 exited-not-landed 尝试（不只最后一条）；`buildContinueWorkerPrompt` 带前 N 次尝试的 (ts, step, reason) 清单 + `.quay/fan-in-suite-` 绝对路径。
3. **C（Needs-Human 指针）**：`markNeedsHuman` 注记补 run_id / 日志路径 / session_id（复用已读的 outcome，⛔ 不新增 reader）。

## Acceptance Criteria

- [ ] AC1（A，能取假，落地后窗）：落地后窗口内 `outcome=red ∧ step=suite` 的 outcome 记录，suiteLog 非 null 计数 = 全部；suite 步 `verdict.logFile` 指向 `.quay/fan-in-suite-*.log`；（⛔ 仍 null ⇒ 假）。
- [ ] AC2（B，能取假）：续做 prompt 文本含前 N 次尝试的 (ts, step, reason) 清单 ∧ 含 `.quay/fan-in-suite-` 字面绝对路径 ∧ 该路径在盘上存在（`continueStateForTask` 收集全部 exited-not-landed，⛔ 只含一句 reason ⇒ 假）。
- [ ] AC3（C，能取假）：新写的 `## Needs-Human` 注记行含 run_id ∧ 含 `.quay/fan-in-` 路径 ∧ 含 session_id（`markNeedsHuman` 复用已读 outcome，⛔ 不新增 reader）。

## Definition of Done

A+B+C 落地：suiteLog 进 mechanical_fan_in + suite 步 logFile 指向 `.quay/fan-in-suite-*.log`；续做 prompt 带前 N 次 (ts,step,reason) 清单 + 可到达日志绝对路径；Needs-Human 注记含 run_id/路径/session_id；AC1-3 全勾；全量 suite 绿；且用一条真实 exited-not-landed 记录实测续做 prompt 里能拿到 suite 日志路径。

## Touches

- plugin/scripts/worker-driver.ts（A：suiteLog + verdict.logFile；B：continueStateForTask 收集全部 + buildContinueWorkerPrompt）
- plugin/scripts/driver-filters.ts（B：全部尝试读法；C：markNeedsHuman 注记补 run_id/路径/session_id）
- plugin/test/worker-driver-fan-in.test.mjs（A 的 suiteLog 记录 + 负控制）
- plugin/test/worker-driver-resident.test.mjs（B 的续做 prompt 内容断言）
- plugin/test/driver-filters.test.mjs（C 的注记内容断言）
- tasks/gap-worker-execution-history-index-not-reachable-from-task.md（自身）
