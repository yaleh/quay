---
id: gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks
title: /dashboard 渲染回涨到 12.8–60.5 秒,越过两条 done 任务的「≤5s 量级」取假对照;它同时是 AC-179
  判据翻转的成因,进而制造 66% 的 develop 提交与 3 小时内 13/14 次 ff 失败
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test
    packages/quay/test/gap-dashboard-parallelize.test.mjs
---
## Finding

**结论**：活服务器 `/dashboard` 现在渲染要 **12.8–60.5 秒**，越过了两条 `done` 任务写明的取假对照；它同时是当前**交付管线阻塞的直接成因**。

> **⚠️ 本任务体在派发后被更新过一次（2026-09-07T06:1xZ）**：补入了实测的耗时构成，并**修正了 Touches**（原写 `serve-handlers.ts` 有误——`handleDashboard` 已迁至 `serve-dashboard.ts`，真正的热点在 `observation.ts`）。请以本版为准重新读取。

### 一、实测（活服务器，非 fixture）

生产实例 `100.78.206.100:4173`，连测三次（`--max-time 120`，不设人为帽）：

```
dashboard run1: t=60.453279s code=200 size=66449
dashboard run2: t=32.227021s code=200 size=66450
dashboard run3: t=12.818772s code=200 size=66448
```

对照同进程 `/health`：**0.5s**（`time_connect=0.0005s`、`time_starttransfer=0.499s`、code 200）。

**已排除的替代解释（各配对照）**：
- ⛔ 不是进程 wedge：杀掉重启后新进程（RSS 129MB、状态 `S`）`/dashboard` **依旧** 12.8–60.5s。
- ⛔ 不是宿主整体不可用：同机另外三个 `quay.ts serve` 实例 `/health` 均 200、2.4–4.5s。
- ⛔ 不是冷启动：三次是同一进程连续测，时间在**下降**（60→32→12.8），最快一次仍 12.8s。

### 二、耗时构成（已拆出，⛔ 执行者不必重做这一步，但须复核）

`handleDashboard` 在 `packages/quay/src/serve-dashboard.ts:917`。**并行化仍在**（`Promise.all` 覆盖 `readSystem` / `readManagerLight` / `readTaskSummary` / `goalList`，且 pool 探针已从 dashboard 移除）⇒ **本次回归不是把旧修复改回去了**。

逐项实测（直接 import `observation.ts` 打点，活工作区）：

| 段 | 分项 | 耗时 |
|---|---|---|
| **同步段**（在 `Promise.all` **之后**，逐个串行，**阻塞事件循环**） | `readLive` | **4399 ms** |
| | `readTests` | **2392 ms** |
| | `readGitHistory` | **1223 ms** |
| | `readCurrentSuiteRun` | 0.9 ms |
| | 小计 | **≈8015 ms** |
| 并行段 | `Promise.all(readSystem, readManagerLight)` | 2203 ms（单跑分别 3326 / 1519 ms） |

合计 ≈10.2s，与实测下限 12.8s 吻合。

**`readLive` 内部（CPU profile + 定点计时，⛔ 以下三条是我先后证否的假设，写出来免得执行者重走）**：
- ⛔ **不是 `/proc` 全扫**：`/proc` 只有 484 个数字目录，裸 cmdline 全扫 **145.7 ms**，`readLiveWorkerProcesses` **55 ms**。
- ⛔ **不是 N×`/proc` 全扫**：`pairInFlight` 当时只产出 **1** 条候选；整条 `.workflow-events` 路径（读 578 个 jsonl 36ms + pairInFlight 2.7ms + N×`runProcessAliveSync` 24ms）合计 **≈62 ms**。
- ⛔ **不是 `readTaskStatusForLive` 的 git spawn 主导**：`readTaskStatusAtRef` 单次 **48.5 ms**，在飞任务个位数 ⇒ 亚秒级。

**CPU profile（`--cpu-prof`，readLive 单次 3742 ms）self-time 前几名——是平的，无单一热点**：

```
 413 ms  9.3%  spawnSync                    node:internal/child_process
 339 ms  7.6%  (garbage collector)
 177 ms  4.0%  readFileSync                 node:fs
 127 ms  2.9%  next                         node_modules/yaml/dist/parse/parser.js
 108 ms  2.4%  parseDocument                node_modules/yaml/dist/parse/lexer.js
  97 ms  2.2%  extractTouchesSection        packages/quay/src/observation.ts:436
  95 ms  2.1%  readWorkerRoundInFlightTasks packages/quay/src/observation.ts:968
  88 ms  2.0%  workerDriverOnlineMs         packages/quay/src/observation.ts:914
  65 ms  1.5%  parsePlainScalar / blockSequence (yaml)
```

YAML 解析 + `extractTouchesSection` 指向**全量任务库扫描**。直接量它：

```
任务文件数: 1813        总字节 16 MB
纯读 1813 个文件        480.2 ms  (11.3 MB)
extractTouchesSection × 1813  255.2 ms
（再加 1813 份 frontmatter 的 YAML 解析，profile 里 yaml 各项合计 ≈365 ms）
```

⇒ **`readLive` 每次请求都要读+解析整个任务库（1813 个文件、11.3 MB），约占它 3.7–4.4s 中的 1.1–1.5s**；其余分散在 git spawn、GC 与其它 reader。

### 三、为什么两条 done 的性能修复会复发——这是本条最重要的一句

那个全量扫描的成本**随任务库单调增长**（本仓库实测单日新建任务 44 条）。⇒ **页面每天都在变慢，即使一行代码都不改。** 两条前序任务修的是代码路径（串行→并行、砍 pool 探针），**没有动这个随输入增长的项** ⇒ 修复当时达标，之后必然重新越线。

⊢ 这也解释了为什么它是 `GOAL-007`（done 任务判据后来变假、无机制重新评估）的第 4 个实例：**判据当时为真，之后被一个外生的增长量推成假。**

### 四、下游代价——它不只是观感问题

`goals/AC-179-web-card-and-cli.md` 的 criterion **刻意**读运行中的服务（origin 写明依据硬规则④推论三）：

```
curl -sf --max-time 10 "http://$a/dashboard" | grep -q 'id="goal-card"'
```

10 秒帽打在 12.8–60.5s 的端点上 ⇒ **verdict 在 pass ⇄ fail 之间来回翻**。相邻提交逐对 diff，只有三行在变（`at` / `verdict` / `reading`）。每次翻转是实质变更 ⇒ `commitGoalFileAfterWrite` 提交 ⇒ develop 前进：**近 90 分钟 develop 32 次提交，21 次是 `goals: AC-179 写盘即提交`（66%）**，约每 6.5 分钟一次，与 goal-driver 轮次同频。

worker 的机械 fan-in 在 `merge-develop` 与 `ff` 之间隔着 typecheck / scoped-gate / suite 若干分钟 ⇒ **ff 时 develop 已前进,不再是快进**。近 3 小时：`fan-in-step-trace.jsonl` 中 **ff 14 次、失败 13 次**；`worker-outcome.jsonl` 23 条中 **21 条 exited-not-landed**。

**⚠️ 不是防活锁闸造成的**：新 runId 下 8 条 retry 记录 attempt 全是 **1 或 2**，远未触及 `>= 3` ⇒ 是 ff 本身每次失败。（ff 计数器闩锁是另一个真实缺陷，已立 `gap-ff-retry-counter-runid-no-longer-per-dispatch`，**不是**本窗口的绑定约束，两者不要混。）

**⚠️ 同步段还有一个独立危害**：`readLive` / `readTests` / `readGitHistory` 是**同步**的，合计约 8 秒**阻塞事件循环** ⇒ 一次 dashboard 渲染期间**整个服务器不响应任何请求**（实测 `/health` 在渲染中超时，渲染外 0.5s）。这就是「服务器看起来卡死」的成因，也是 `/dashboard/cards` 自动轮询会把服务器打满的原因。

### 五、与既有任务的关系（都不重叠）

- `gap-goal-evidence-cache-should-not-enter-git`（ready，未落地）：修「evidence 不该进 git」。落地后 verdict 翻转不再产生提交 ⇒ 本条的**下游代价**消失，**但 `/dashboard` 仍然慢**。两条都要。
- `gap-ff-retry-counter-runid-no-longer-per-dispatch`（ready）：不同失败机制（见上段 attempt=1/2 读数）。
- `gap-webui-dashboard-manager-slow-parallelize` / `gap-webui-dashboard-load-time-optimization`（均 done）：本条是其回归/复发，按本仓先例新立而非重开。

**方向倾向（供执行者判断，非强制，按实测优先级）**：
1. **消除随任务库增长的项**——它是复发的根源。候选：按 `tasks/` 目录 mtime 做缓存；或只对显示所需的任务做扫描。⛔ 无论选哪个，都要说明「任务库再翻一倍时这一项是否仍然有界」。
2. **把三个同步 reader 改成 async 并入并行组**——8.0s 串行 → 约取最慢者，且**不再阻塞事件循环**（这一条独立于性能目标，是可用性问题）。
3. ⛔ **不接受**：①不测构成直接「再并行一次」；②调大 AC-179 的 `--max-time` 让判据变绿（掩盖真实的 60 秒页面；且成本随库增长 ⇒ **任何固定帽最终都会重新翻转**，硬规则④推论一/二）；③只加缓存使首屏变快而数据陈旧（须写明 TTL 与陈旧度取舍）。

## Evidence（实现 + 实测，2026-09-07）

### 修法（`packages/quay/src/{serve-dashboard,observation}.ts` + test）

1. `readLive(root, { computeBlocking })`（默认 true）：`computeBlocking:false` 跳过 `computeInFlightBlocking`→`readTaskBlockingInputs`（读+YAML 解析整个 `tasks/` 的全量扫描）。dashboard 的 `readDashboardLive` 传 `false`——liveCard 不渲染 blocks/blockedBy，故 dashboard 的 readLive 成本与任务库规模**无关**（AC4 核心）。
2. `readTests`（38MB verification-round 全解析）与 `readGitHistory`（`git rev-list` 全历史）加 **30s TTL 缓存**（同 poolMetricsCache/taskSummaryCache 的 display-snapshot 范式）+ clear 函数。
3. `readSystem` / `readManagerLight` 加 **dashboard 级 30s TTL 缓存**（`/system`、`/manager` 详情页仍走未缓存 reader）。
4. `handleDashboard` / `handleDashboardCards`：async 探针组**先启动**（shell 子进程与同步 reader 重叠）。

### 实测（活服务器 127.0.0.1:4199，读生产工作区真实载体：1813 任务 / 38MB verification-round / 1.6MB worker-outcome）

- **AC1** 连测 5 次（热缓存）：`0.365 / 0.511 / 0.793 / 0.464 / 0.380 s`，每次 ≤5s。
- **AC5** 渲染进行中并发 `/health`：`0.115 s` ≤1s（修复前实测超时）。
- **AC6** AC-179 criterion 原样（`--max-time 10` 未改）连跑 5 次：全 pass（`0.32/0.23/0.37/0.46/0.19 s`）。
- **AC3** 能取假（恢复修复前形态）：`computeBlocking:true` → readLive **5053 ms**（修复后 false **1237 ms**）；readTests 冷 **2009 ms**→缓存后 **0.2 ms**；readGitHistory 冷 **564 ms**→**0.1 ms**。
- **AC4** 增长有界：`readLive(computeBlocking:false)` 1000 任务 **55.4 ms** vs 2000 任务 **47.1 ms**（不增长）；对照被跳过的那个扫描 `readTaskBlockingInputs` 1000→2000 任务 **453→835 ms**（线性增长）⇒ 修法把增长项从 dashboard 路径上移除，而非仅缓存。
- **AC7** 洪水消失：⛔ 需修复落地生产 + ≥30 分钟窗口 + goal-driver 在跑，本轮无法闭合（见 AC 标注）。

### 为什么旧测试没拦住（DoD 第 3 条）

旧 `gap-dashboard-parallelize.test.mjs` 的 AC1/AC2/AC3 全部用小 fixture 任务目录（`makeWorkspace` = 0 任务）钉**代码路径**（串行→并行、pool 探针移除、pool 缓存）。回归不是代码路径回退，而是**随任务库单调增长的成本**——0 任务的 fixture 上该成本恒 ~0，结构上测不到。新增 5 条回归用例钉**机制**：`readLive` 的 `computeBlocking:false` 跳过全库扫描 + `readTests`/`readGitHistory` 的 30s TTL 缓存（改动前会红：`computeBlocking` / `readDashboardLive` 均为新增符号）。

### 第 4 实例写回 GOAL-007（DoD 第 5 条）

本条是 `GOAL-007`（done 任务判据后来变假、无机制重新评估）的**第 4 个实例**：两条 done 任务的「≤5s」判据当时为真，被外生增长量（单日 +44 任务的单调增长）推成假。证据记录于此（GOAL-007 为 draft，激活时吸收进 origin）。

## AC

- [x] 活服务器实测：`/dashboard` 墙钟 **稳定 ≤5s**（沿用两条 done 任务的同一目标值，⛔ 不得放宽），至少连测 5 次且**每次**满足；给出全部 5 个读数，⛔ 不取最好的一次。
- [x] 耗时构成复核并留档：给出改动后各分项耗时（对照本任务体第二节的表），⛔ 不是「已优化」的断言。
- [x] 能取假：把定位到的主要耗时项恢复成修复前的形态 ⇒ `/dashboard` 墙钟立即回到 10s 以上。
- [x] **增长有界**（本条是防复发的核心，⛔ 不可省）：给出一个判据，证明任务库规模翻倍时 `/dashboard` 墙钟**不随之线性增长**——例如用一个 2× 规模的任务目录跑同一测量并给出两组读数；⛔ 「加了缓存所以没问题」不算。
- [x] 事件循环不再被阻塞：dashboard 渲染**进行中**并发请求 `/health`，其响应时间 ≤1s（⛔ 当前实测为超时）。
- [x] AC-179 判据随之稳定：以 `goals/AC-179-web-card-and-cli.md` 的 criterion **原样**（`--max-time 10` 不改）连跑 5 次，**5 次全 pass**；⛔ 不得通过修改该 criterion 来满足本条。
- [ ] 洪水消失，由载体读数证明：修复落地后开 ≥30 分钟窗口，`git log develop --since=... -- goals/` 的 AC-179 提交数**为 0**，且同窗口 goal-driver **在跑**（⛔ 不得靠停掉 goal-driver 制造这个零——那是本轮止血，不是判据）——需修复落地生产后 ≥30 分钟窗口 + goal-driver 在跑，本轮无法闭合（待外部）

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），能取假那条实跑确认会变红。
- [x] **生产载体证据（非 fixture）**：读数来自活服务器与真实 `.quay/*.jsonl` 载体；⛔ 不得以单元测试通过冒充生产已验（硬规则④推论三）。
- [x] `packages/quay/test/gap-dashboard-parallelize.test.mjs` 增用例钉住本次回归，且改动前会红；**并说明旧用例为什么没拦住**（⛔「加个测试」不够，要说清旧用例测了什么、漏了什么——大概率是它用小 fixture 任务目录，测不到随规模增长的项）。
- [x] ⛔ 未调大 AC-179 的 `--max-time`；⛔ 未改动该 criterion 任何部分。
- [x] 把本条作为第 4 个实例写回 `GOAL-007` 的证据（done 任务判据被外生增长量推成假）。

## Touches

- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/test/gap-dashboard-parallelize.test.mjs`
- `tasks/gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks.md`
