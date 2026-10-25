---
id: gap-live-state-small-carrier-for-subsecond-inflight-read
title: .quay/live-state.json：给在飞/相位一个字节级、事件驱动的读法（spawn / worker-exit / 终态即重写）
status: todo
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

## AC

- [ ] AC1（形状）：文件为 `{schema:"quay-live-state/v1", writtenAt:<ISO>, source:"worker-driver", inFlight:[{taskId, runId, phase:"implementing"|"fan-in"|"awaiting-land", startedAtMs, workerPid:number|null, lastHeartbeatMs}]}`；贴一条真实写入（有在飞时）与一条空在飞时的完整内容。
- [ ] AC2（事件驱动重写）：在三条转换点各写一次；用一个可注入的 fixture/测试驱动，贴「状态变化 → 文件内容变化」的两次读数（⛔ 不靠 60s 轮询等出来）。
- [ ] AC3（三态读面）：`quay live-state --json`（或等价读动词）只读这一个文件；必须把「文件缺失」「`writtenAt` 超过 staleness 阈值」「可读且在阈值内」报成**三个不同取值**，⛔ 不得把缺失/过期折成「零在飞」。三条各贴实跑输出。
- [ ] AC4（与权威读面一致）：同一时刻、同一 fixture 下，`live-state.inFlight` 的 taskId 集合与 `readLive` 的 worker-driver 来源在飞集合相等；给出至少一次一致读数与一次「故意让 live-state 落后一轮」的差异读数（证明陈旧能被 AC3 的 stale 取值识别）。
- [ ] AC5（登记）：`docs/carrier-registry.json` 新增条目（owner=worker-driver、readers 枚举）；`packages/quay/src/cli/help.ts` 登记读动词并写明起始版本。

## DoD

- 写入方**只有一个**（worker-driver 内的一个函数，四个调用点）；读面**只有一个**实现，⛔ 不复制第二份相位推导。
- `packages/quay/test/` 有 `node:test` 覆盖 AC1–AC4（临时 workspace，⛔ 不碰真实 `.quay/`），文件头 `// @test-group product`。
- 该载体是**投影**不是新真相源：契约正文写明「权威仍是在飞集合本身；本文件只是它的原子快照，`writtenAt` 决定它是否可信」。

## Touches

- `tasks/gap-live-state-small-carrier-for-subsecond-inflight-read.md`（自指）
- `plugin/scripts/worker-driver.ts`（唯一写入方 + 四个调用点）
- `packages/quay/src/observation.ts`（读面；⛔ 不新增第二份相位推导）
- `packages/quay/src/cli/live-state.ts`（新 handler，若选择新动词）
- `packages/quay/bin/quay.ts`（分派表 + fallback usage）
- `packages/quay/src/cli/help.ts`
- `docs/carrier-registry.json`
- `packages/quay/test/cli-live.test.mjs`
- `packages/quay/test/observation.test.mjs`