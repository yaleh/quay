---
id: gap-dashboard-gantt-runid-dedup-collapses-driver-round-shared-id
title: 循环脉搏甘特图按 run_id 去重，而 run_id 是 driver 轮次共享值（非每任务唯一）⇒ 历史任务块被误判重复几乎全部丢弃
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**结论**：`serve-dashboard.ts` 的 `mergeLiveAndHistoryIntervals()`（`gap-dashboard-live-swimlane-fixed-lane-gantt-timeline` 落地，commit `041f6022d`）按 `worker-outcome.jsonl` 的 `run_id` 字段去重合并「循环脉搏」甘特图的区间列表，但该字段**不是「每次任务执行一个」，而是「worker-driver 进程/轮次一个」**（形如 `wk-prod-<epoch>`）——同一 driver 进程生命期内派发的所有任务，写进 outcome 记录的 `run_id` 全是同一个值。去重逻辑（`serve-dashboard.ts:331-337` 的 `add()`：`if (seen.has(iv.runId)) return;`）把这当成「同一次运行的重复记录」，导致同一 driver 轮次派发的几十个不同任务被当成重复只留一条 ⇒ **甘特图丢失绝大多数历史任务块**，与同一页面的测试/FAN-IN 时间段卡片（数据源不同，不受此影响）显示的密度严重不符——用户 2026-09-10 走查 dashboard 时发现「12h 窗口测试/fan-in 卡有大量段落，循环脉搏甘特图记录却很少」。

**实测复现（对生产 `.quay/worker-outcome.jsonl` 2026-09-10 实测，非构造样本）**：
```
过去 12h 窗口内、started_at/ended_at 均可解析且与窗口相交的历史记录：52 条
按 run_id 去重后存活：2 条（因为这 52 条记录只用了 2 个不同的 run_id 值：
  wk-prod-1788779505 / wk-prod-1788972473 —— driver 两次重启各留一个轮次号，
  期间派发的几十个不同任务全部共享各自轮次的同一个 run_id）
```

**根因的两处独立佐证（非本任务首次发现该语义，是新代码复踩旧坑）**：
1. `plugin/scripts/worker-driver.ts:4021` 已有明确警告注释：「⛔ NOT runId (wk-prod-`<epoch>`) — that is the driver-process[round id]」；`worker-driver.ts:3493` 同样写着「⛔ 不用共享的 wk-prod（那是 driver 轮次号，一 driver 轮次内多个…）」。
2. 已有一条 `status: done` 的任务 `gap-ff-retry-counter-runid-no-longer-per-dispatch` 记录了**同一个 `run_id` 语义漂移**（从「每次 dispatch 一个」变成「driver 进程生命期一个」）踩过另一个消费者（`packages/quay/src/fan-in/ff-merge.ts` 的重试计数器）的坑，且已修过。本任务是两天后的**全新代码**（`gap-dashboard-live-swimlane-fixed-lane-gantt-timeline`，2026-09-09 落地）里重新踩中的同一个错误假设——同硬规则 5b「在某处修好 X ≠ X 只在那一处」。

**为什么单测没拦住**：`packages/quay/test/serve-dashboard.test.mjs`（AC1，`run_id: "R1"/"R2"/"R3"`）与 `packages/quay/test/observation.test.mjs`（DoD 端到端，`run_id: "wk-a"/"wk-b"`）的 fixture 里每条记录的 `run_id` 都各自不同，从未构造过「多条不同任务共享同一个 `run_id`」这种真实生产形状，去重逻辑的这个致命缺陷在现有测试里天然不可见。

**修复方向（评审时已给出，非本任务遗留悬念）**：去重不能用 `worker-outcome.jsonl` 的裸 `run_id` 作跨源去重键。`readLive().inFlight`（在飞）与 `worker-outcome.jsonl`（outcome 只在 worker 退出时才写）在时间上天然不会重叠，原本想防的「同一次运行既在在飞又在历史里重复画」这个场景本身很少真实发生；即便要防，也应换成在 outcome 记录内部真正唯一的组合键（如 `taskId + started_at`），而不是跨越多个任务共享的 driver 轮次号。

## Acceptance Criteria

- [x] 用真实生产数据形状构造回归测试：多条 `WorkerOutcomeRecord`（不同 `task`、不同 `started_at`/`ended_at`）共享同一个 `run_id`（如 `wk-prod-1`），断言 `mergeLiveAndHistoryIntervals()` 的输出**每条历史记录都独立保留**（不因共享 run_id 被误判为重复而丢弃）——单测覆盖当前 `serve-dashboard.test.mjs` AC1 遗漏的这个具体生产形状
- [x] 保留原有「同一次运行既在 `inFlight` 又在 `worker-outcome.jsonl`（in-flight 侧尚未终态化前被重复计入）不应重复画两个块」的去重语义，但去重键改为不依赖跨任务共享的 `run_id`（如 `taskId + started_at` 组合，或直接依据两源在时间上不重叠的事实简化/移除跨源去重）——单测覆盖新去重键在真正同一次运行（in-flight + 其终态 outcome 记录，taskId 和 startedAtMs 一致）时仍正确去重为一条
- [x] 对生产 `.quay/worker-outcome.jsonl` 12h 窗口跑一次 `mergeLiveAndHistoryIntervals()`（集成测试或手动验证脚本均可，但需落一条可复核的命令+输出到 PR/commit），确认修复后输出条数与「窗口内 started_at/ended_at 均可解析且相交的记录数」量级一致（不再因去重键误判被砍到个位数）
- [x] `scripts/test.sh` 全绿

## Definition of Done

在真实 `/dashboard?hours=12` 请求路径下，甘特图渲染出的历史任务块数量与页面同一窗口内测试/FAN-IN 卡片显示的任务落地密度量级相符（不再是「大量落地 vs 几乎无记录」的明显不一致）——用生产数据核实，不是仅构造样本通过单测。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/test/observation.test.mjs
- tasks/gap-dashboard-gantt-runid-dedup-collapses-driver-round-shared-id.md