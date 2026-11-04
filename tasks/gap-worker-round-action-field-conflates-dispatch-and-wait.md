---
id: gap-worker-round-action-field-conflates-dispatch-and-wait
title: worker-round 的 action 字段语义混装：dispatch 假阳性（cap 满轮 72/89）与 stop 混淆终态/瞬时
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`worker-round` 心跳记录的 `action` 字段（`plugin/scripts/worker-driver.ts:6023`
`action: reason != null ? "stop" : inFlight > 0 ? "dispatch" : "idle"`）把两件不同的事压进同一个值域，
导致两个非 idle 取值都不可信。值域声明在 `:2176`（`"start" | "dispatch" | "idle" | "stop" | "error"`）。

### 缺陷 A：`action="dispatch"` 断言了本轮不可能发生的事件

派发只发生在 ready-pool 步之后（`:6663` `poolSeen = pool.pool`），而 `readyPoolCheck` 的返回类型是
`pool: number`（不可空，`plugin/scripts/driver-runtime.ts:2887`）；循环体抛错的轮次走 `action="error"`
（`writeErrorRound`）。⇒ **记录里 `pool === null` ⟺ 本轮 ready-pool 步从未执行 ⟺ 本轮物理上不可能派发**。
但 cap 已满时派发循环的 while 条件（`:6650` `while (running.length < cap && ...)`）直接为假、循环体不进入，
`waitReason` 保持 null，于是三元表达式落到 `inFlight > 0 ? "dispatch"`。

实测（`.quay/worker-round.jsonl`，窗口 `2026-10-26T00:00Z → 2026-11-02T00:00Z`，与
`docs/analysis/dispatch-supply-ceiling-2026-11-02.md` AC3 同窗；总数 6791 与 89 逐值复现）：

- `action="dispatch"` 行 89 条，其中 **72 条 `pool === null`**；
- 并集第二条判据（与同一 run 的上一轮相比 `in_flight` 与 `in_flight_tasks` 集合全同）后为 74 条；
- ⇒ 真实派发轮 ≤ 17（严格界 ≤ 15）。

样例：round 1207–1211 连续五轮，`in_flight=5`（cap 满）、五个 task 完全相同、`pool=null`，全部标
`action="dispatch"`——这五轮没有派生任何 worker。

**后果（已被 in-repo 契约消费）**：`docs/analysis/dispatch-supply-ceiling-2026-11-02.md:23` 定义
「可派发 tick = `action=="dispatch"` 的行（该 tick 实际派发了至少一个新任务）」，并据此算出
「落地 / 可派发 = 93 / 89 = 104.5%」。按上述读数该分母最多成立 17，修正后 ≥5.5。文档的方向性结论
（派发供给是瓶颈）反而更强，但印出的比值及其解释是错的。

### 缺陷 B：`action="stop"` 把终端停止与瞬时等待压成同形

生产者**已经算出**这个判别位：`makeStopCondition`（`plugin/scripts/driver-runtime.ts:2170-2183`）返回
`mcp-halt → terminal: true` / `resource-gate-wait → terminal: false`；`worker-driver.ts:6653-6654` 据此分成
`stopReason` / `waitReason` 两个变量；但 `:6773` 用 `stopReason ?? waitReason` 把它们重新合并，`:6023`
一律写 `action="stop"`——**判别位在写盘这一步被丢弃**。

实测（全量 70,882 行）：`action="stop"` 68,052 行；其中 `in_flight > 0` 的 7,986 行里只有 **18 行是终态**
（`mcp-halt`），其余 7,968 行是瞬时等待（`filtered-empty` 6,913 / `resource-gate-wait` 582 /
`backoff` 398 / `pool-empty` 75）。⇒ 把 `stop` 读成「循环停了」的读者，在「stop 且有在飞」这个子集上错 99.8%；
唯一的分辨手段是对 `stop_reason` 做字符串前缀匹配（上述分析文档 §口径定义 正是这么做的），而该值域没有正本：
`orchestration/worker-driver-log-carriers.md:43` 记录的值域只写到 `start/dispatch/idle/stop`。

### 判定

这不是「字段命名不精确」，而是记录契约与其被写下的读法相互矛盾（硬规则 3/3b：值域里没有「等待」这一态，
于是「停了」与「在等」共用同一输出，读者无法区分两者）。同一族终态/瞬时混淆在本仓库已付过一次 P0 代价
（`gap-worker-driver-stopreason-latch-permanent-stop`：瞬时拒被当终态 latch ⇒ 1h48m 零派发 ≈ 3.4 个任务）。

### 修法（不改变派发行为，只改记录契约）

1. `action` 增独立取值 `wait`：瞬时等待写 `wait`，`stop` 只留给终态；`dispatch` 只在 `pool !== null`
   且本轮实际 spawn 了 worker 时写出。
2. 把生产者已算出的 `sc.terminal` 原样写进记录（`terminal: true|false`），不再丢弃。
3. `orchestration/worker-driver-log-carriers.md` 的值域行同步为新值域与 `terminal` 位。

<!-- dedup-ref -->
相关但机制不同（勿合并）：`gap-worker-driver-stopreason-latch-permanent-stop` 修的是驱动循环内 stopReason
的状态机 latch；本条修的是已写出记录的字段语义。`gap-worker-round-filter-trace-attribution` 修的是
`filtered-empty` 的归因粒度，同样不涉及 `action` 值域。分析文档的分母口径由立案会话在本次一并修正，
该文档不在本任务 Touches 内，本任务不再改它。

## AC

- [x] `action` 值域新增独立取值 `wait`，`computeWorkerRoundRecord` 的类型与写点支持四态（`wait` / `stop` / `dispatch` / `idle`），且 `dispatch` 仅在 `pool !== null` 且本轮 spawn 计数 > 0 时写出——`node --test plugin/test/worker-round-action-semantics.test.mjs` exit 0，用例覆盖 cap 满轮、瞬时等待轮、终态 halt 轮、真实派发轮四种。
- [x] round 记录新增 `terminal: boolean` 显式位，由 `stopCondition()` 的 `terminal` 原样透传；同一测试断言 halt 轮 `terminal === true`、`resource-gate-wait` 轮 `terminal === false` 且 `action === "wait"`。
- [x] `orchestration/worker-driver-log-carriers.md` 的 action 值域行含 `wait` 与 `terminal` 位：`grep -c 'wait' orchestration/worker-driver-log-carriers.md` ≥ 1，且该文件不再出现只列 `start/dispatch/idle/stop` 的旧值域行（`grep -c 'start/dispatch/idle/stop' orchestration/worker-driver-log-carriers.md` = 0）。
- [x] 负控制：把 `action` 的判定退回旧三元表达式后，上述测试必须变红（证明测试不是恒真）。
- [ ] 生产载体抽样：driver 用新代码重启并至少写出一轮之后，`.quay/worker-round.jsonl` 的新增行中 `action=="dispatch" ∧ pool==null` 计数为 0，且出现至少 1 行 `action=="wait"`（待外部）

## DoD

新代码在 driver 重启后的生产循环里实际写出三态可区分的记录：至少一轮真实瞬时等待被记为 `action="wait"`、
cap 满轮不再出现 `dispatch` 假阳性、`terminal` 位在载体上可读；`worker-round` 的 action 读法在
`orchestration/worker-driver-log-carriers.md` 有唯一正本；测试覆盖四种轮型且负控制成立（退回旧三元表达式即红）。
仅新增 fixture 或仅测试变绿不构成落地。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-round-action-semantics.test.mjs (new)
- orchestration/worker-driver-log-carriers.md
- tasks/gap-worker-round-action-field-conflates-dispatch-and-wait.md

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务为局部缺陷修复(worker round 记录字段语义 + 测试 + 文档值域),不改包/依赖结构,无可测的 L_D/L_G 读数。