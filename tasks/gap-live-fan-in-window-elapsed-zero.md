---
id: gap-live-fan-in-window-elapsed-zero
title: web live 页机械 fan-in 窗口 elapsed 恒 0——round 载体无每任务起始时间戳，readLive fail-closed 到 nowMs
status: ready
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

web live 页对「机械 fan-in 窗口」的在飞任务，elapsed 恒显「3s ago / 0.0 分钟」+ pid「—」，无法区分「刚派发」与「已跑很久」。

**代码根因（逐行核实）**：`observation.ts` `readLive` 对机械 fan-in 窗口在飞任务走 round 载体路径（`readWorkerRoundInFlightTasks` → `worker-round.jsonl` 的 `in_flight_tasks`）。该路径 fail-closed 赋 `startedAtMs: nowMs` / `minutes: 0`（`observation.ts:1465-1480`，注释原文「no per-task start on the round carrier — "just now", never a fabricated long elapsed」）。round 载体只带 task id 列表（`in_flight_tasks`），**不带每任务起始时间戳** ⇒ readLive 无真起点可读，只能回退 nowMs。

**实测证据（2026-09-01 生产载体，peer 核实）**：`gap-suite-scheduler-main-lpt-missing` 01:24:20 派发，3 轮共 ~82 分钟（`worker-outcome.jsonl` 01:24→01:46 / 01:47→02:15 / 02:16→02:46，全 exited-not-landed），每轮 suite ~14 分钟。第二轮 fan-in 窗口（02:30:53-02:46:42 fan-in 锁持有）内，live 页恒渲染 `runId=worker-<task>`、pid=—、3s ago、0.0 分钟、阶段 fan-in——与**实现期**（/proc 路径有真实 pid + 真实 elapsed）形成对照：实现期正常，fan-in 窗口才错。

**真起点其实存在**：
- `worker-outcome.jsonl.started_at`（但只在 worker 结束时写，进行中拿不到）；
- `fan-in-step-trace.jsonl.ts`（步骤时刻，进行中就有，`worker-driver.ts:1834-1846` 写）；
- driver 心跳写 round 时知道派发时刻（`worker-driver.ts:868` 写 `in_flight_tasks` 时同样处可取）。

**正确机制（peer 建议）**：round 载体（或 fan-in step trace）带上每任务起始时间戳；`readLive` 优先读真起点，缺失才回退 nowMs（保留 ③b 诚实兜底——不伪造长时长）。

## Plan

1. **writer 侧**（`plugin/scripts/worker-driver.ts`）：round 载体 `in_flight_tasks`（或 fan-in-step-trace）带上每任务起始时间戳（派发时刻，driver 已知）。
2. **reader 侧**（`packages/quay/src/observation.ts`）：`readLive` 的 round-carrier 分支优先读真起点（`started_at` / step ts），缺失才回退 `nowMs`（保留「刚起步」诚实兜底，不伪造长时长）。
3. **验证**：fan-in 窗口 live 页 elapsed 与真起点一致；无起点载体仍回退 nowMs。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`readLive` round-carrier 分支读真起点优先——grep `observation.ts` 含「读 `started_at` / step 起始 ts」优先逻辑，缺失才回退 `nowMs`；（⛔ 仍无条件 `startedAtMs: nowMs` ⇒ 假）。
- [ ] AC2（能取假，生产载体，硬规则 4 推论三）：落地后时间窗内，fan-in 窗口 live 页 elapsed 与真起点一致（对照 `worker-outcome.started_at` / `fan-in-step-trace.ts`，N 只计落地后轮）；（⛔ 用落地前轮冒充 / 仍恒 0 ⇒ 假）。
- [ ] AC3（能取假，诚实兜底不退化）：无起点载体时仍回退 `nowMs`（「刚起步」，不伪造长时长）——负控制：剥离起点后 readLive 报 0 而非猜测长值；（⛔ 回退路径伪造长 elapsed ⇒ 假）。

## Definition of Done

round 载体 / fan-in step trace 带每任务起始时间戳；readLive 读真起点优先、缺失回退 nowMs；AC1-AC3 全勾；全量 suite 绿；fan-in 窗口 live 页 elapsed 与真起点一致实测。

## Touches

- packages/quay/src/observation.ts（readLive round-carrier 分支读真起点优先、缺失回退 nowMs）
- plugin/scripts/worker-driver.ts（round 载体 in_flight_tasks / fan-in-step-trace 带每任务起始时间戳）
- packages/quay/test/live-state.test.mjs（或 serve-handlers/serve——readLive 断言更新）
- tasks/gap-live-fan-in-window-elapsed-zero.md（自身）
