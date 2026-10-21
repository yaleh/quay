---
id: GOAL-909
title: R2：WorkerPool 聚合 + 结局处理扩展点——把 runResidentLoop 的 retry/backoff/needs-human
  状态机从闭包局部变量收进 class WorkerPool，并让新结局种类从外部注册（扩展点模板的首次检验）
status: draft
kind: goal
origin: DIR-133（人 2026-10-22
  裁定：并发争用读数是合法触发器；设计切片须含扩展点判据；元机制层优先）。触发读数：worker-driver.ts 派发器改选 5
  次（2026-08-23…10-16）+ 真实合并冲突 6 次
---
## 背景

DIR-133 的裁定 1、2 下的第一个设计切片，同时是**扩展点模板这个元机制的首次检验**（裁定 3：元机制优先）。所以本 goal 要回答两个问题：WorkerPool 能不能成为一个真正拥有状态的对象；以及「扩展点判据」能不能作为设计切片的可取假验收真正跑通。

## 调查结论（机械事实 / 判断分开）

机械事实（2026-10-22，develop @ ae0e13313 一带，按位置核对）：
- `plugin/scripts/worker-driver.ts` 7266 行。worker 结局的状态机（关注点①，`gap-worker-driver-resident-loop-decomposition-discovery` §E4）散在 `runResidentLoop` 的闭包里：`:6040 const retryState: RetryState = { counts: new Map(), needsHuman: new Set() }`、`:6058 const backoffState = newQuickDeathBackoffState()`；`:6285 onWorkerFinished` 内按 `r.outcome.final_state === "exited-not-landed"` → retry 豁免 → `decision.kind`（stop-terminal / count-and-retry / baseline-red-deadlock）→ 快速死亡退避（environment-fatal / newlyNeedsHuman / quickDeath）逐层 if/else 直接改 Map/Set。
- 触发读数（DIR-133 F4，与 serve 先例同口径）：派发器因该文件争用改选/排序 5 次，真实合并冲突 6 次；2026-09-20 抽出 worker-fan-in.ts 之后（10-16）仍在发生。
- 先例对照（DIR-133 F3）：2026-09-04 的拆分调查只做了「区域抽取」，此后 worker 子系统增量 88% 落回 worker-driver.ts / worker-fan-in.ts；serve 按关注点拆 + 分发器，增量只有 1% 落回分发器。

判断：
- 第一刀选关注点①（状态机），不按 P-1 finding 建议的「④落账 → ①」顺序。理由：这一刀同时承担扩展点模板的首次检验，①有天然的扩展点——结局 / 决策种类就是可注册的处理单元，可以用外部注册的合成单元做可取假验证；④（落账）的扩展点较弱，检验不出模板是否有效。
- GOAL-035（applyNeedsHumanTransition）、GOAL-036（在飞排除集单一计算点）已经在这块区域逐块收敛过，证明它可以安全剥离；本 goal 在其上前进一步：让状态由对象拥有，让新种类从外部接入。

## 范围与非目标

范围：
- 新建 `plugin/scripts/worker-pool.ts`，`export class WorkerPool` 以私有字段持有 retry 计数、needs-human 集合、快速死亡退避状态，状态转移只经该类的方法。
- 结局处理改为注册表分派：现有各分支成为注册在 WorkerPool 上的处理单元；`onWorkerFinished` 只做「把结局交给 WorkerPool」。
- 新增 `plugin/test/worker-pool-extension-point.test.mjs`：只 import worker-pool.ts，外部注册合成单元并自带负对照。
- 行为不变：现有 worker-driver 相关测试与全量 suite 绿；`.quay/worker-outcome.jsonl` / `worker-round.jsonl` 的记录形状不变。

非目标：
- 不碰关注点②派发决策、③spawn/fan-in、④落账（各自另立切片，届时同样要带扩展点判据）。
- 不改 retry/退避/needs-human 的判定语义与阈值；不改派发顺序。
- 不顺手给 worker-driver.ts 加体量棘轮（DIR-133 讨论中的 a 项，等本 goal 的读数再定）。

## AC

- AC-914：retry/backoff 状态由 `class WorkerPool` 拥有，worker-driver.ts 不再以闭包局部变量持有（立案当轮实测：红，2 处）。
- AC-915：扩展点——新的结局处理单元可从 worker-driver.ts 之外注册并生效，测试自带负对照（立案当轮实测：红，测试不存在）。

## 停止扩大范围的信号

- 抽取处理单元时如果需要把②派发决策的变量（running / coldInflight / stopReason）一起带进 WorkerPool，就停在边界上，用参数传入，不把派发循环卷进来。
- 若发现某个现有分支无法在不改语义的前提下表达为处理单元，如实记录在 goal 里并保留为中心文件内的显式特例，不为了凑判据改语义。

## 退出条件与元机制回读

- AC-914、AC-915 全部 achieved，全量 suite 绿，合并进 develop。
- 合并后由元机制 finding（`gap-design-evolution-meta-mechanism-readings`）回读：此后 worker 子系统的新增结局处理是否落在注册的处理单元里、而不是落回 worker-driver.ts（扩展点占比读数）；以及 worker-driver.ts 的并发争用是否下降。该回读不构成本 goal 的达成条件，它评价的是模板本身。