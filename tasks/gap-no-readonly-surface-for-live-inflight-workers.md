---
id: gap-no-readonly-surface-for-live-inflight-workers
title: 没有任何只读出口能拿到「当前在飞 worker」——`driver status` 不扫在飞 worker
  子进程（只报载体字段），外部消费者只能自己扫 `/proc`
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**这是能力缺口（capability gap），不是 bug。** 「当前正在跑哪些任务」这份数据，quay 只在**进程内**算，没有任何 CLI / MCP 只读出口。

### 1. 机件侧：没有任何只读出口

- **`quay driver status` 不报在飞 worker 子进程。** `packages/quay/src/cli/help.ts` 的 driver 段里 `status` 一行（`help.ts:460-462`）只列出载体字段 `{kind, supervisor_pid, driver_pid, alive, carrier_path, carrier_records, last_record_ts}` —— 整份字段表里没有任何 per-worker 数据。
  - 归因更正（以盘上为准）：父 agent 说 `driver status` 的 help 文本自己声明「does NOT scan in-flight worker children」。盘上该句在 `help.ts:507`，属 **server** 段 `restart` 的描述，**不是** driver 段的 `status` 行；driver 段里最接近的是 `stop` 行（`help.ts:454-455`）「For worker, in-flight workers are NOT killed (they orphan and finish)」。**结论不变（没有出口），只是那句话不在被归因的那一段。**
- **MCP 侧同样没有** live / in-flight 工具。
- **`quay driver` 的 verb 全表 = `start|stop|drain|resume|status|restart|log`**（`packages/quay/src/cli/driver-vocab.ts:23` 的 `VERBS`）。其中唯一的只读 verb 是 `log`（读 driver 的日志载体），**不读在飞 worker 集合**。`liveness` 只有直调 `plugin/scripts/driver-runtime.ts` 才有，`VERBS` 未收录（已知 CLI 表层缺口先例）。

### 2. 数据只在 Web 进程内产生

`readLive()`（`packages/quay/src/observation.ts:1925`）在其内部 `:2030` 调 `readLiveWorkerProcesses("/proc", { root })`（定义于 `observation.ts:962`，export）。三个调用点全在 serve 内部：

- `packages/quay/src/serve-dashboard.ts:1594`（`readDashboardLive`，dashboard 的 "Loop pulse" 卡）
- `packages/quay/src/serve-live.ts:262`
- `packages/quay/src/serve-task.ts:619`（此点直调 `readLiveWorkerProcesses`）

### 3. 底层数据已是干净的结构化接口（均已 export）

- `LiveResult`（`observation.ts:199`）：`{ status, reason, inFlight: InFlightTask[], concurrencyCap, cpuPressure, liveState, liveExplanation, activity }`
- `InFlightTask`（`observation.ts:132`）：`{ taskId, runId, pid: string|null, sessionId, startedAtMs: number, implCompletedAtMs, status, phase, ... }`
- `LiveWorker`（`observation.ts:881`）：`{ taskId, pid: string, startedAtMs: number|null, repoRoot: string|null }`

`readLive(root, opts)` 是**纯函数** —— 只读 carrier 文件 + `/proc`，不走网络、不依赖 serve 在跑。它唯一的“外部”依赖是可选注入的 `liveWorkers` seam；为 null 时（`:2030`）自己执行 `workerDriverActive(root) ? readLiveWorkerProcesses("/proc", { root }) : []`。所以补一个只读 CLI verb 是薄薄一层（解析参数 → 调 `readLive` → 打印 JSON），不是新机制。

### 4. 为什么这是边界问题，而不是便利诉求

一个外部只读消费者（真实场景：只读面板想镜像 dashboard 的 "Loop pulse" Gantt 卡）只有两条路：(a) 自己仿写一份 `/proc` 扫描；(b) 放弃「当前在跑」那半、只画历史。(a) 的真正危险不是“重复实现”，而是**它扫的判据是 cmdline 里的字符串标记** —— `workerTaskIdFromCmdline` 读 `Task: <id>`、`workerRepoRootFromCmdline` 读 `Repo root: <path>`（`observation.ts:903` / `:916`）。那是 quay 的**内部约定、不是稳定接口**。它一旦变更，外部扫描**不会报错，只会返回空**：「读不到」与「没有在跑」**同形**（硬规则 3b）。消费者会看到一张空白的「当前在跑」面板，且没有任何东西告诉它坏了。这正是应由 quay 集中提供、而不是每个消费者各扫一遍的理由。

### 5. 顺带排除的替代路径（立案者实测；执行者应复验）

现成 HTTP 出口救不了这个需求：

- `/dashboard/cards` 的 content-type 是 `application/json`，但内容装的是**预渲染的 HTML 字符串**（`"liveCard":"<div id=\"live-card\" ...`），服务页面局部刷新（`DASHBOARD_CARD_REFRESH_MS = 30_000`），不是程序消费面。
- `/health` 只有 `{ ok, stale, evaluated, processStartedAt, latestCodeCommitAt, source }`，无 worker 数据。
- `/live` 渲染的是 **HTML**（`renderLivePage`），非机器可读。

### 6. 必须一起设计进去的约束（漏了它会静默给错数）

- **`/proc` 是 host-global 的。** quay 靠 cmdline 里那条机器生成的 `Repo root: <path>` 标记做**按项目过滤** —— `LiveWorker.repoRoot` 的注释（`observation.ts:890-898`）明说这条判别式就是把共驻项目的 worker 挡在本项目 in-flight 视图之外。本机同时跑着多个用户的 quay 实例。任何新出口**必须接受 `--root` 并施加同一过滤**（即经由 `readLive` / `readLiveWorkerProcesses` 的 root 参数），否则消费者看到的是全机器的 worker，而**现象是「数据变多了」而不是「数据错了」**，极易被当成正常放过。
- **两种「空」必须可区分**（硬规则 3b：判定机件读不懂输入时，不得返回与合格同形的值）。至少两处会把「无法评估」折成「零在飞」：① `readLive` 的 `/proc` 扫描被 `workerDriverActive(root)` 门控（`:2030`），本 workspace 的 driver 不活跃时扫描根本不发生；② `readLiveWorkerProcesses` 在 `/proc` 不可读时 `catch { return [] }`（`:962-964`）。新出口必须给「未评估」一个与「零个在飞」不同的取值（不同字段值或不同退出码）。
- **输出形状的诚实 null / 类型**：`LiveWorker.startedAtMs` 可为 `null`（fail-closed 朝向“刚开始”，绝不编造长耗时，`:886-889`）；`LiveWorker.pid` 是**字符串**不是数字（`:885`）。注意：若选择复用 `readLive` 的 `InFlightTask` 而不是裸 `LiveWorker`，则 `InFlightTask.startedAtMs` 已被 `readLive` 用 `w.startedAtMs ?? nowMs`（`:2033`）补成 `number`，而 `pid` 变成 `string|null`（carrier-only 条目为 null）。执行者必须在任务体里写清暴露的是哪一种形状、以及该形状的 null 语义。

<!-- dedup-ref -->
**去重（按机制，非症状）**：以机制词 `readLive` / `readLiveWorkerProcesses` / `Loop pulse` / `driver liveness` / `/proc` 检索任务库，未命中同机制任务。相关但机制不同（仅供追溯，均不构成本任务的前置）：`gap-worker-driver-cold-start-inflight-blind`（cold-start 的 in-flight 盲区，改的是 driver 内部排除集，不是外部只读出口，已 done）。

## Requested action

1. 新增一个**只读** CLI verb，把在飞 worker 集合作为 JSON 输出。命名二选一，由实现者定，选定后在 `cli/help.ts` 登记：
   - `quay live --json`（更贴既有 `/live` 路由命名）：分派路由加在 `packages/quay/bin/quay.ts`（参照 `:179-220` 的分派表），另需在顶层 usage 块（`help.ts:60-106`）与 fallback usage 串（`bin/quay.ts:223`）登记，并在 `help.ts` 加 `sub === "live"` 的 help 段。
   - `quay driver live --json`（更贴 driver 命名空间）：`VERBS`（`cli/driver-vocab.ts:23`）加 `live`，`cli/driver.ts` 在委派 kernel 之前截住它（参照既有只读 verb `log` 的处理）。
2. **复用** `readLive` / `readLiveWorkerProcesses`，**不得**另写一份 `/proc` 扫描 —— 本任务的全部意义就是消除第二份实现。
3. 必须接受 `--root` 并施加与 dashboard 相同的按项目过滤。
4. 不启动、不依赖 serve 进程（纯函数已具备此性质，保持它）。
5. 输出必须区分「零个在飞」与「无法评估」（硬规则 3b）。

## AC

- [ ] AC1（主判据）：该只读 verb 输出 JSON，含在飞 worker 集合，每个元素至少有 `taskId` / `pid` / `startedAtMs`。贴**实跑输出**（命令 + 完整 JSON + 退出码），不是代码引述。
- [ ] AC2（root 过滤，本任务最重要的 AC）：在一台有**其他项目在用 worker** 的主机上运行，输出**只含**调用方 workspace 的 worker。**双向负控制**：① 本 workspace 有 worker 在飞 ⇒ 出现在输出里；② 另一 root 的 worker ⇒ **不出现**。两个方向都贴实跑输出（同一条命令，只换 `--root`）。写不出②，就等于没验证过滤，AC2 不成立。
- [ ] AC3（语义一致性）：取值与 dashboard "Loop pulse" 卡同源（同一 `readLive` 调用链），**不出现两套实现**。任务体需说明如何证明：至少给出 ① `DoD2` 的同形状命中数；② 一条可区分对照 —— 临时注入 `liveWorkers` 为空或让 `readLive` 的 in-flight 集合变化，dashboard 与新 verb **同向**变化（贴两次读数）。
- [ ] AC4（诚实空态）：区分「零个在飞」与「无法评估」两种取值，贴实跑输出证明二者可被程序区分（不同字段取值或不同退出码）。至少覆盖 `workerDriverActive(root) === false` 与 `/proc` 不可读两条路径中的一条。
- [ ] AC5（形状的诚实 null / 类型）：输出形状的 null / 类型被正确处理**并在任务体里声明是哪一种形状**：若暴露裸 `LiveWorker`，`startedAtMs === null` 与 `pid` 为字符串各有一条断言；若暴露 `readLive` 的 `InFlightTask`，`pid === null` 的 carrier-only 条目与 `startedAtMs` 为 `number` 各有一条断言。贴单测或实跑输出。
- [ ] AC6（测试形态）：测试用 `node:test`，文件头带 `// @test-group product`（`packages/quay/test/` 既有约定，见 `packages/quay/test/cli.test.mjs:1`）。
- [ ] AC7（CLI 表层登记）：`packages/quay/src/cli/help.ts` 已登记该 verb（顶层 usage 行 + 对应 `sub === "..."` 的 help 段）；若选 `quay driver live`，`cli/driver-vocab.ts` 的 `VERBS` 同步（`help.ts` 与 `cli/driver.ts` 的帮助文本由 `VERBS.join("|")` 插值，改一处即三处可见，且 `plugin/scripts/enum-surface-parity-check.ts` 的面 `cli-driver-usage-verbs` 会机械守）。

## DoD

- [ ] DoD1（真实落地读数）：在**有真实 worker 在飞**的时刻真跑一次，输出里出现该 worker 的记录（贴实跑输出）。本任务自身的执行 worker 就是一个真实在飞 worker（同一 `--root`），可直接作为观察对象。**只被 fixture / `liveWorkers` 注入 seam 满足的判据不算测量**（硬规则 4 推论三：实现了、测试绿了、生产没跑过 ⇒ 与没实现同形）。
- [ ] DoD2（无第二份扫描）：确认没有产生第二份 `/proc` 扫描实现。给出「同形状命中数」：在 `packages/quay/src` 下枚举 `/proc` 扫描形状（如 `readdirSync("/proc"` / `readdirSync(procDir`），**立案实测该形状只有 `observation.ts` 一处**（`readLiveWorkerProcesses`，`:962`）；本任务完成后该数必须仍为 1（⛔ 不得新增第二处 `/proc` 扫描实现）。
- [ ] DoD3（负控留痕）：root 过滤的负控（AC2 两向）实际跑过并留痕，不得只贴绿侧。
- [ ] DoD4（不依赖 serve）：证明该 verb 在**没有 serve 进程**时也能给出读数（纯函数路径）。贴无 serve 时刻的实跑输出，或一条明确不 import serve 模块的测试。

## Touches

- `tasks/gap-no-readonly-surface-for-live-inflight-workers.md`（自指）
- `packages/quay/src/cli/help.ts`（两方案都要：登记 verb + usage 行）
- `packages/quay/test/cli-live.test.mjs`（新测试）
- 若选 `quay live`：
  - `packages/quay/bin/quay.ts`（分派表 + fallback usage 串 + 必要时 jsonCommands）
  - `packages/quay/src/cli/live.ts`（新 handler）
- 若选 `quay driver live`：
  - `packages/quay/src/cli/driver-vocab.ts`（`VERBS` 加 `live`）
  - `packages/quay/src/cli/driver.ts`（委派 kernel 前截住该 verb）
- `packages/quay/src/observation.ts`（**仅在需要薄导出 / 三态 helper 时才动**；`readLive`:1925 与 `readLiveWorkerProcesses`:962 已 export，正常情况零改动。**不得在此新增第二份 `/proc` 扫描**。）
