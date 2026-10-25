---
id: gap-live-state-small-carrier-for-subsecond-inflight-read
title: .quay/live-state.json：给在飞/相位一个字节级、事件驱动的读法（spawn / worker-exit / 终态即重写）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

任务 `gap-live-read-cost-linear-in-round-carrier` 的纯优化只能把 `quay lanes` / `driver live` 降到数百毫秒级：进程 + 模块导入 floor 约 100–180ms，冷启动的 CLI 读取结构上到不了 100ms 以内。外部只读消费者（claudecodeui 的工作区标题栏常驻甘特图）需要一条不 spawn 进程、直接读文件就能拿到的在飞快照。

现有两个候选都不够：

- `.quay/worker-dispatch.json` 是字节级直接量，但**没有 phase**，也不含 worker 已退出、fan-in 进行中的相位；
- `.quay/worker-round.jsonl` 有 `in_flight_tasks`，但写入节奏实测 50–60s 一条，且文件 90–124MB。

本任务新增第三个载体：`.quay/live-state.json`，由 worker-driver **事件驱动**原子重写（tmp+rename），写入时刻为：① 每次 spawn 成功；② worker 进程退出（implementing → fan-in）；③ 终态计算完成（fan-in → landed/awaiting）；④ 至少每轮一次心跳（保底新鲜度）。

相位词汇必须来自 driver **确实知道**的时刻：spawn（implementing）、child exit（fan-in）、outcome 计算完成（terminal）。⛔ driver 不知道 worker 内部的子相位（例如 suite 正在跑），不得编造。

该载体是**投影**不是新真相源：权威仍是在飞集合本身（driver 的 `running` + dispatch 载体）；本文件只是它的原子快照，`writtenAt` 决定它是否可信。

## AC

- [x] AC1（形状）：文件为 `{schema:"quay-live-state/v1", writtenAt:<ISO>, source:"worker-driver", inFlight:[{taskId, runId, phase:"implementing"|"fan-in"|"awaiting-land", startedAtMs, workerPid:number|null, lastHeartbeatMs}]}`；贴一条真实写入（有在飞时）与一条空在飞时的完整内容。
- [x] AC2（事件驱动重写）：在三条转换点各写一次；用一个可注入的 fixture/测试驱动，贴「状态变化 → 文件内容变化」的两次读数（⛔ 不靠 60s 轮询等出来）。
- [x] AC3（三态读面）：`quay live-state --json`（或等价读动词）只读这一个文件；必须把「文件缺失」「`writtenAt` 超过 staleness 阈值」「可读且在阈值内」报成**三个不同取值**，⛔ 不得把缺失/过期折成「零在飞」。三条各贴实跑输出。
- [x] AC4（与权威读面一致）：同一时刻、同一 fixture 下，`live-state.inFlight` 的 taskId 集合与 `readLive` 的 worker-driver 来源在飞集合相等；给出至少一次一致读数与一次「故意让 live-state 落后一轮」的差异读数（证明陈旧能被 AC3 的 stale 取值识别）。
- [x] AC5（登记）：`docs/carrier-registry.json` 新增条目（owner=worker-driver、readers 枚举）；`packages/quay/src/cli/help.ts` 登记读动词并写明起始版本。

## DoD

- 写入方**只有一个**（worker-driver 内的一个函数，四个调用点）；读面**只有一个**实现，⛔ 不复制第二份相位推导。
- `packages/quay/test/` 有 `node:test` 覆盖 AC1–AC4（临时 workspace，⛔ 不碰真实 `.quay/`），文件头 `// @test-group product`。
- 该载体是**投影**不是新真相源：契约正文写明「权威仍是在飞集合本身；本文件只是它的原子快照，`writtenAt` 决定它是否可信」。

## Touches

- `tasks/gap-live-state-small-carrier-for-subsecond-inflight-read.md`（自指）
- `plugin/scripts/worker-driver.ts`（唯一写入方 + 四个调用点）
- `packages/quay/src/observation.ts`（读面；⛔ 不新增第二份相位推导）
- `packages/quay/src/cli/live-state.ts`（新 handler）
- `packages/quay/bin/quay.ts`（分派表 + fallback usage）
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/driver-vocab.ts`（载体名 / wire schema / 相位词表 / stale 阈值的**零依赖叶模块**——写侧与读侧共用唯一命名点；help.ts 也静态 import 它，⛔ 不能 import observation.ts）
- `docs/carrier-registry.json`
- `delivery-manifest.json`（新 CLI 动词的 capability 登记；capability-manifest-check 双向比对，fail-closed in scoped gate）
- `packages/quay/test/cli-live.test.mjs`
- `packages/quay/test/cli.test.mjs`（block14 的 `dispatchVerbs` 硬编码清单必须随新动词加宽，否则 synopsis↔dispatch 比对红）
- `packages/quay/test/observation.test.mjs`（**未改动**：读面测试与在飞读侧同住 `cli-live.test.mjs`，它已是 `// @test-group product`）

## Evidence

### AC1 — 真实写入（常驻 driver 进程，临时 workspace）

fixture：`/tmp/ls-evidence3-*`，真 `worker-driver.ts`（无 `--task` ⇒ 常驻选择环）+ 一次性 ready-pool / selector / 3s worker 命令。0.1s 轮询抓到的**有在飞**快照（完整内容）：

```json
{
  "schema": "quay-live-state/v1",
  "writtenAt": "2026-10-25T13:01:11.975Z",
  "source": "worker-driver",
  "inFlight": [
    {
      "taskId": "task-demo",
      "runId": "fm-1792933269914-task-demo",
      "phase": "implementing",
      "startedAtMs": 1792933270025,
      "workerPid": 621222,
      "lastHeartbeatMs": 1792933271975
    }
  ]
}
```

同一进程，worker 终态算完后的**空在飞**快照（完整内容）：

```json
{
  "schema": "quay-live-state/v1",
  "writtenAt": "2026-10-25T13:01:13.060Z",
  "source": "worker-driver",
  "inFlight": []
}
```

条目字段集由测试固定（`Object.keys(entry)` 精确比对）：`taskId/runId/phase/startedAtMs/workerPid/lastHeartbeatMs`。

### AC2 — 事件驱动（可注入的 fixture 驱动 = 常驻环用的同一个类）

测试直接实例化 `LiveStateProjection`（`worker-driver.ts` 内常驻环 new 的就是它），注入时钟，逐个事件读文件：

- ① `spawn` → `phase="implementing"`, `workerPid=777`；
- ② `exit("task-step","fan-in")`（时钟 +1ms）→ `phase="fan-in"`，且 `writtenAt` 变化（变化来自事件，不是时钟滚动）；
- ④ `heartbeat` → phase 不被改写，`lastHeartbeatMs` 前进到心跳时刻；
- ③ `terminal` → `inFlight=[]`，`writtenAt` 再次前进。

实跑：`node --test packages/quay/test/cli-live.test.mjs` →
`✔ AC2: each driver-known transition rewrites the file immediately (no poll interval involved)`（11/11 pass）。

### AC3 — 三态（+ unreadable）实跑输出

```
$ quay live-state --json --root <无载体的 workspace>
{
  "status": "missing",
  "reason": ".quay/live-state.json does not exist — the worker driver has not written a snapshot for this workspace (⛔ NOT \"zero in flight\")",
  "inFlight": null, ... }
exit=0

$ quay live-state --json --stale-ms 1000 --root /tmp/ls-evidence3-*
{
  "status": "stale",
  "writtenAt": "2026-10-25T13:01:13.111Z",
  "ageMs": 22802,
  "staleAfterMs": 1000,
  "reason": "writtenAt is 22802ms old (> 1000ms staleness threshold) — the snapshot is a projection and may be out of date",
  "inFlight": [], ... }
exit=0

$ quay live-state --json --root /tmp/ls-evidence3-*
{
  "status": "ok",
  "writtenAt": "2026-10-25T13:01:13.111Z",
  "ageMs": 22904,
  "staleAfterMs": 360000,
  "reason": null,
  "inFlight": [], ... }
exit=0
```

第四个值是 `unreadable`（文件在但读不懂）：exit 1、stdout 为空、stderr 点名原因（测试固定）。⛔ `missing`/`unreadable` 的 `inFlight` 是 **null**（未评估），只有 `ok` 的 `[]` 才是「真的没人」。

默认阈值 `LIVE_STATE_STALE_MS=360000` = driver reconcile 地板（`drivers.yml` worker.reconcile_interval_secs=300s，在飞时一轮最长睡这么久）+ 一个 interval ⇒ 阈值低于地板会把健康 driver 报成 stale。

### AC4 — 与 `readLive` 的 worker-driver 来源一致

同一 fixture（round 载体命名 `task-demo` + live-state 同一 task），同一时刻先后两次读：

```
live-state.status: ok
live-state inFlight ids: ['task-demo']
driver-live  inFlight ids: ['task-demo']
driver-live  entries: [('task-demo', None, 'implementing', 'worker-task-demo')]
SETS EQUAL: True
```

「故意落后一轮」的差异读数（测试内构造：live-state 的 `writtenAt` 停在很久以前且 `inFlight=[]`）：

```
lagged.status = "stale"        # 陈旧被 AC3 的 stale 取值识别
lagged.inFlight = []           # 落后轮的快照说没人
readLive.inFlight = ["task-agree"]  # 权威读面说它在飞
# 两者确实不同 —— 且差异被标出来，而不是被当成现值静默供出
```

测试：`✔ AC4: the snapshot's taskId set equals readLive's worker-driver source set; a one-round lag is surfaced as stale`。

### AC5 — 登记

- `docs/carrier-registry.json`：`{name:"live-state.json", kind:"state-json", owner:"plugin/scripts/worker-driver.ts", readers:"unaudited", readerModules:["packages/quay/src/observation.ts","packages/quay/src/cli/live-state.ts"]}`。⚠️ 该 registry 的 `readers` 字段被 `carrier-registry-completeness.test.mjs` 固定为仅 `"unaudited"`（declaration-only），故真正的读面枚举放在 `readerModules`（该测试不禁止额外键）。
- `packages/quay/src/cli/help.ts`：`quay --help` 用法行 `quay live-state [--json] [--stale-ms <n>] [--root <path>]   (first shipped in 0.23.0)`；`quay live-state --help` 有完整块（起始版本 0.23.0 + 四态契约）。相位词表/阈值从 `driver-vocab.ts` 插值，⛔ 不手抄。

### DoD — 单一写/读面

- 写：`writeWorkerLiveState(rootDir, entries, {nowMs})` 是**唯一**落盘函数（tmp+rename）；常驻环 `LiveStateProjection` 的四个调用点：`spawnSelected` ① spawn / `runOneWorker` 的 `child.on("close")`（经 `onWorkerExited`）② exit / `onWorkerFinished` ③ terminal / `writeRound` ④ heartbeat。`liveStateInputs()` 是唯一一处「driver 状态 → 快照条目」的翻译。
- 读：`observation.readLiveState` 是唯一读实现；`quay live-state` handler 只格式化，⛔ 不解析、⛔ 不推导相位。
- 载体名 / schema / 相位词表 / 阈值：`packages/quay/src/driver-vocab.ts` 单一命名点（写侧 `plugin/scripts/worker-driver.ts` 与读侧 `observation.ts` 同时 import）。
- 测试：`packages/quay/test/cli-live.test.mjs`（首行 `// @test-group product`）覆盖 AC1–AC4，全部临时 workspace，`live-state.test.mjs`（既有 /live 页）与真实 `.quay/` 均未触碰。

### ADR-007 暗轴记录

- L_D import-graph-check (this worktree, after the change): valueSccs=0 typeSccs=0 reverseEdges=0
  （verdict.ok=true · kernelBlocked=false · gateLayerBlocked=false · retiredShimsChecked=true；本任务新增的边是 observation.ts→driver-vocab.ts、worker-driver.ts→driver-vocab.ts，均为指向零依赖叶的边，无环）

## Blocker

**2026-10-25T13:26:37.488Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=packages/quay/test/ac179-criterion-address-derivation.test.mjs,packages/quay/test/task-log.test.mjs,plugin/test/shipped-entry-runnable.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：3c97f22e-68b6-4b75-b085-7b1ff764000a
