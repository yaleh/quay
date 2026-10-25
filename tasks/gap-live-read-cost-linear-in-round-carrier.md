---
id: gap-live-read-cost-linear-in-round-carrier
title: 在飞/lanes 读取成本 ∝ 载体大小：readLive 全量读 90MB worker-round.jsonl，外部消费者每轮 1.1–1.2s
status: done
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

- [x] AC1（逐字等价）：`quay lanes --json` 与 `quay driver live --kind worker --json` 在**同一输入**（同一份 round/outcome/workflow-events 载体 + 固定 nowMs）下，改动前后输出逐字相等；贴改动前后两次实跑输出与 `sha256`。
- [x] AC2（成本）：把 `.quay/worker-round.jsonl` 换成 ≥50MB 的合成载体后，`quay lanes --json` 的墙钟从基线（贴基线读数）降到 ≤ 基线的 60%，且输出与「同一逻辑内容的小载体」逐字相等。
- [x] AC3（负控制，语义不能被「只读最后一行」改变）：构造「最后一行不带 `in_flight_tasks`、但倒数第 N 行带」的载体，新读法必须仍返回那最后一条带键记录；再构造「全部行都不带该键」⇒ 返回空集而不是报错。两次都贴实跑输出。
- [x] AC4（三态不变）：`readLive` 的 `status` 仍能区分 `ok` / `empty` / `error`；`lanes` 的退出码约定（`live.status === "error"` ⇒ exit 1 且 stdout 无 JSON）不变；贴一条 error 分支实跑。

## DoD

- 改动落在 `packages/quay/src/observation/records.ts`（尾部反向扫描）与 `packages/quay/src/observation.ts`（`.workflow-events` 读取策略），⛔ 不新增第二份 `/proc` 扫描或事件解析实现。
- `packages/quay/test/` 内有 `node:test` 覆盖 AC2/AC3（合成载体用临时目录，⛔ 不碰真实 `.quay/`），文件头带 `// @test-group product`。
- 若改动改变了任何已发布 JSON 字段或退出码，必须在 `packages/quay/src/cli/help.ts` 同步登记；否则不动 help。

## Touches

- `packages/quay/src/observation/records.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/test/observation-live-read-cost.test.mjs`
- `tasks/gap-live-read-cost-linear-in-round-carrier.md`

## Evidence（2026-10-25）

### 实现形状

- `records.ts`：`readWorkerRoundInFlightTasks` 改为**从 EOF 反向按窗口扫描**（首窗 256KiB，未命中 ×4 增长到整文件），返回「最后一条带 `in_flight_tasks` 的记录」；新增 `readCarrierHeadText(root, rel, maxBytes=64KiB)`（只 pread 头部）与其内部 `readRangeText`。语义不变：窗口首行若是被截断的行则丢弃；整文件都无键 ⇒ `[]`（真的「没有」，不是「没看」）。
- `observation.ts`：不再 `readFileSync` 整份 round 载体（生产 94MB）。in-flight 侧直接让 `readWorkerRoundInFlightTasks(root)` 自己尾扫；`workerDriverOnlineMs` 只收到**头部 64KiB 切片**——它从 round 文本里唯一取的事实是「最早的 `ts`」，而载体是追加序（生产 94MB / 61190 条实测：第 0 条的 ts 即全文件最小值）。
- ⛔ 未新增第二份 `/proc` 扫描或事件解析实现；`.workflow-events`（579 小文件）实测 `readEventsFromDir` = **5.6ms**（占整次调用 0.4%），因此本轮**不改**它——DoD 括号里点名的这条轴经测量不是成本来源，改动它只会带来语义风险而无收益。

### AC1 — 逐字等价

同一 fixture：`/tmp/glr-ac1/root/.quay/worker-round.jsonl` → 生产 94MB 载体（符号链接）、`worker-outcome.jsonl` → 生产 8MB、`.workflow-events` → 生产 579 文件目录；`PIN_NOW_MS=1793000000000` 固定时钟（`node --import pin-now.mjs`）。旧代码 = 主检出 `4f376a5ee`，新代码 = 本任务 worktree 分支。

`quay lanes --json` 改动前（sha256 `c5cc359efe60e1466c06d31241eae163623c313bf5329e23f4a2a543a5ac4166`）：

```json
{
  "windowHours": 3,
  "nowMs": 1793000000000,
  "lanes": [
    [ { "taskId": "gap-live-read-cost-linear-in-round-carrier", "runId": "worker-gap-live-read-cost-linear-in-round-carrier", "startMs": 1792934871695, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null } ],
    [ { "taskId": "gap-task-log-no-tail-cursor-for-initial-sync", "runId": "worker-gap-task-log-no-tail-cursor-for-initial-sync", "startMs": 1792934940153, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null } ],
    [ { "taskId": "gap-worker-dispatch-carrier-owner-and-contract-unregistered", "runId": "worker-gap-worker-dispatch-carrier-owner-and-contract-unregistered", "startMs": 1792934954002, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null } ],
    [],
    []
  ],
  "overflow": 0
}
```

`quay lanes --json` 改动后：**与上面逐字相同**，sha256 `c5cc359efe60e1466c06d31241eae163623c313bf5329e23f4a2a543a5ac4166`（`cmp` 无差异）。

`quay driver live --kind worker --json` 改动前（sha256 `8c86f9890ea150ada7221f051527bd666ce608f2b5edba738fe3039d520239a8`）：

```json
{
  "root": "/tmp/glr-ac1/root",
  "kind": "worker",
  "workerSignal": { "evaluated": true, "reason": null },
  "telemetry": { "status": "ok", "reason": null },
  "inFlight": [
    { "taskId": "gap-live-read-cost-linear-in-round-carrier", "runId": "worker-gap-live-read-cost-linear-in-round-carrier", "pid": null, "sessionId": null, "startedAtMs": 1792934871695, "implCompletedAtMs": null, "status": null, "phase": "implementing", "suite": null, "minutes": 1085.47175, "liveness": "unknown" },
    { "taskId": "gap-task-log-no-tail-cursor-for-initial-sync", "runId": "worker-gap-task-log-no-tail-cursor-for-initial-sync", "pid": null, "sessionId": null, "startedAtMs": 1792934940153, "implCompletedAtMs": null, "status": null, "phase": "implementing", "suite": null, "minutes": 1084.3307833333333, "liveness": "unknown" },
    { "taskId": "gap-worker-dispatch-carrier-owner-and-contract-unregistered", "runId": "worker-gap-worker-dispatch-carrier-owner-and-contract-unregistered", "pid": null, "sessionId": null, "startedAtMs": 1792934954002, "implCompletedAtMs": null, "status": null, "phase": "implementing", "suite": null, "minutes": 1084.0999666666667, "liveness": "unknown" }
  ]
}
```

改动后：**逐字相同**，sha256 `8c86f9890ea150ada7221f051527bd666ce608f2b5edba738fe3039d520239a8`。

### AC2 — 成本

合成载体（filler 心跳 ~1KiB/行 + 末条带 `in_flight_tasks`），固定时钟，同一台机同一次会话，best-of-5：

| 载体大小 | 旧（基线） | 新 | 新/旧 |
|---|---|---|---|
| 54,289,068 B（AC 下限 ≥50MB） | 294ms | 174ms | **59.2%** |
| 105,331,068 B | 455ms | 181ms | **39.8%** |
| 169,461,069 B | 569ms | 174ms | 30.6% |

⇒ 旧读法随载体线性增长（294→455→569），新读法基本常数（174→181→174）。54MB 点之所以贴近 60%，是 ~175ms 的**进程+模块导入 floor** 占比所致（不是载体成本）；105MB 点即 39.8%。

输出等价（新-大载体 / 新-小载体 / 旧-大载体三者 sha256 相同）：

```
61072b16a8a83345fec3e882717c5d5cb161061b3a60370beb0bdf4e7a9c774d  lanes-new-big.json    (105MB 载体)
61072b16a8a83345fec3e882717c5d5cb161061b3a60370beb0bdf4e7a9c774d  lanes-new-small.json  (同一逻辑内容的小载体)
61072b16a8a83345fec3e882717c5d5cb161061b3a60370beb0bdf4e7a9c774d  lanes-old-big.json
```

`quay lanes --json` 在 105MB 载体上的实跑输出：

```json
{
  "windowHours": 3,
  "nowMs": 1793000000000,
  "lanes": [
    [ { "taskId": "task-A", "runId": "worker-task-A", "startMs": 1792454400000, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null } ],
    [ { "taskId": "task-B", "runId": "worker-task-B", "startMs": 1792458000000, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null } ],
    [], [], []
  ],
  "overflow": 0
}
```

测试侧（`packages/quay/test/observation-live-read-cost.test.mjs` AC2 用例）在同一进程内用**旧算法**（整读 + 逐行 parse + keep-last）跑同一个 ≥50MB 文件做分母，断言尾扫 ≤ 60% 且 <50ms——比例约 100×，不依赖宿主负载。

### AC3 — 负控制

(a) 最后一行不带键、倒数第 3 行带键；实跑 `quay lanes --json`（新）返回那条记录（与旧实现逐字相同）：

```json
{ "windowHours": 3, "nowMs": 1793000000000,
  "lanes": [ [ { "taskId": "task-X", "runId": "worker-task-X", "startMs": 1792454400000, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null },
               { "taskId": "task-Y", "runId": "worker-task-Y", "startMs": 1793000000000, "endMs": 1793000000000, "phase": "implementing", "finalState": null, "fanInOutcome": null } ],
             [], [], [], [] ],
  "overflow": 0 }
```

(b) 全部行都不带该键：`quay lanes --json` exit 0，返回 5 条空 lane（空集，不报错）：

```json
{ "windowHours": 3, "nowMs": 1793000000000, "lanes": [ [], [], [], [], [] ], "overflow": 0 }
```

测试文件另覆盖两个窗口增长分支：带键记录距 EOF ~5MB（首窗 256KiB 未命中 ⇒ 扩窗找到）与带键行本身 >400KB（首窗是一个无换行片段 ⇒ 扩窗到整行）。

### AC4 — 三态与退出码

`readLive` 三态实跑（同一临时 workspace 分别造三种输入）：

```
ok    => status: ok    | reason: null
empty => status: empty | reason: 未找到遥测记录（.workflow-events/ 不存在）
error => status: error | reason: 读取遥测失败：ENOTDIR: not a directory, scandir '/tmp/glr-ac4/error/.workflow-events'
```

`error` 分支的 `quay lanes --json`：exit **1**，stdout **0 字节**，stderr：

```
quay lanes: the live telemetry carrier could not be read under /tmp/glr-ac4/error (读取遥测失败：ENOTDIR: not a directory, scandir '/tmp/glr-ac4/error/.workflow-events'). ⛔ This is NOT "no records in the window" — refusing to print 5 empty lanes for a failed read.
```

`ok` 与 `empty` 分支均 exit 0。改动未增删任何已发布 JSON 字段或退出码 ⇒ `cli/help.ts` 不动。

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务只替换同一模块内的载体读取策略（尾部反向扫描 / 头部截读），未新增或删除任何模块依赖边，L_D/L_G 的结构读数不因该改动变化，本轮未重跑 archguard。