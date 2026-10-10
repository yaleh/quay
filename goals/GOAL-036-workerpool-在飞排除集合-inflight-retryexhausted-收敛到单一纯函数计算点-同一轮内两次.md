---
id: GOAL-036
title: WorkerPool 在飞排除集合（inFlight/retryExhausted）收敛到单一纯函数计算点：同一轮内两次独立
  inFlightTasks() 调用可因异步窗口漂移的结构性风险收口（Driver/Routine/WorkerPool OOD 重构，用户
  2026-10-11 批准三轨①，优先项）
status: draft
kind: goal
origin: 用户 2026-10-11 正式批准推进三条架构改进（Driver/Routine/Pool、Gate/Fan-in、Goal
  transition），本 goal 是优先项①的实施，②③本轮只设计不实施
---
## 背景

用户 2026-10-11 正式批准推进三条架构改进：①Driver/Routine/WorkerPool 身份与归属（本 goal，优先）；
②Gate/Fan-in 验证/判定/事件/合并职责边界；③Goal 状态机收敛到类似 Task 的显式 transition contract。
②③本轮**只做只读设计+反证**，不实施、不与①并行做大规模重构（用户明确要求）——其设计产物记录在本 goal
的「相关但本轮不落地」一节，供下一轮裁定是否立案。

本 goal 承接 `docs/architecture/quay-domain-model-2026-10-11.md`（已提交 `e8ddb7e48`）§7 Candidate 5
「Pool's dispatch-exclusion state has no single owner」，并在立项前用一个专门的只读调查 agent 对**当前
develop 尖端**（`8cb36c2fd`）重新核实了全部引用行号与事实（不是直接照搬上一轮文档）。

## 调查结论（创建本 goal 前完成；机械事实 / 判断 分开写）

**机械事实（本轮重新读取 `plugin/scripts/worker-driver.ts`/`driver-filters.ts` 源码确认，行号为
develop `8cb36c2fd` 上的实测）**：

- `worker-driver.ts` 的常驻选择环（`runResidentLoop`）里，`inFlightTasks()`（:5224，闭包 `running.map(...).
  concat([...coldInflight])`）在**同一轮**内被独立调用 **两次**：一次在 `:5740`（`readyPoolCheck(...,
  inFlightTasks(), ...)`，这次调用本身是 `await` 的异步子进程调用），一次在 `:5753`（
  `makeFilterContext(rootDir, { inFlight: inFlightTasks(), ... })`）。两次调用之间横跨一次 `await`——
  如果 `coldInflight`/`running` 在这段异步窗口内发生变化（例如某个并发的 reap/finalize 回调修改了
  `coldInflight`），两次读到的"当前在飞集合"**可以不一致**，而两个消费者（候选池计算、派发前过滤）本应
  读到同一个快照。
- 这不是假设的风险——同一机制已经真实出过事故：`tasks/gap-worker-driver-cold-start-inflight-blind.md`
  与其续作 `tasks/gap-worker-driver-cold-start-inflight-refresh.md`（均 `done`）记录的正是"在飞集合的
  两次观测互相不一致"这一形态（前者是冻结快照与存活 worker 不一致，后者修复了跨轮刷新但同一轮内的
  双读风险此前未被处理）。
- `retryState`（:5176）与 `backoffState`（:5194）均明确注释"⛔ 不落盘"——跨轮存活于常驻循环内，`quay
  driver restart --kind worker` 会静默清空它们（已在 `docs/architecture/quay-domain-model-2026-10-11.md`
  §6 Finding 6 记录，本 goal **不**处理这一半，见下方非目标）。
- **本轮调查纠正了上一份候选草稿里一个会引入真实回归的错误设计**：`docs/architecture/quay-domain-
  model-2026-10-11.md` 的 Candidate 5 的早期措辞曾暗示可以把退避（backoff）也折进同一个"每轮计算一次"
  的汇总对象里。实测 `worker-driver.ts:5751` 附近的既有注释逐字写明：**"now 每候选取一次现时刻（⛔
  循环外一次 now 快照会把『退避刚到期』的 task 误滤一整轮）"**——即 `isBackedOff` 必须按候选、用当刻
  `Date.now()` 现场判定，不能预先算成一个轮起始的静态集合。若本 goal 把 backoff 也折进汇总对象，就是
  重新引入一个已经被修过的缺陷（`gap-worker-driver-selector-api-error-no-backoff` AC2 的既有修复）。
  **本 goal 明确排除 backoff**，只收敛 `inFlight`/`retryExhausted` 两项——这是本次调查本身的产物，不是
  预先假设的范围。

判断（ownership）：「本轮在飞排除集合」应该只有一个计算点，两个消费者（`readyPoolCheck` 的候选池计算、
`applyTaskFilters` 的派发前过滤）读同一个值，而不是各自独立调用同一个闭包两次——这正是方法论「状态应有
唯一拥有者」在"同一轮内的瞬时快照"这个细粒度上的实例，和 GOAL-035 的"needs-human 转移副作用应有唯一
拥有者"是同一形态的不同对象。

## 范围与非目标

范围：在 `plugin/scripts/driver-filters.ts` 新增一个纯函数 `computeDispatchExclusion(running, coldInflight,
retryState)`，返回 `{ inFlight: string[]; retryExhausted: Set<string> }`；`worker-driver.ts` 的常驻选择环
在 `step = "ready-pool"` 之后、`:5740` 之前调用它恰一次，把结果分别喂给 `readyPoolCheck`（:5740）与
`makeFilterContext`（:5753），移除两处各自独立调用 `inFlightTasks()` 的写法。

⛔ 非目标（有意排除，供下一刀接手）：
- **backoff 排除（`isBackedOff`/`Date.now()`）不折进本函数**——必须保持按候选现场判定，理由见上「调查
  结论」；`:5758` 附近的现有逐候选 `.filter((id) => !isBackedOff(...))` 逐字不变。
- `retryState`/`backoffState` 跨 driver 重启静默清零——另案（`quay driver restart` 帮助文本补一句说明），
  不在本 goal 范围，也不在本 goal 判断是否需要持久化。
- `promotion-driver.ts` 对 `makeFilterContext` 的使用（它没有 `coldInflight`/`backoffState`，继续按
  现状传 `retryExhausted` 即可）——不touch。
- ②（Gate/Fan-in 事件归属）与③（Goal transition contract）两条，本轮**只设计不实施**，不在本 goal
  Touches 范围内，见下方「相关但本轮不落地」一节。
- 不改变 `readyPoolCheck`/`applyTaskFilters`/`makeFilterContext` 的对外签名语义（纯提取，行为保持）；
  不重启任何生产进程。

## 相关但本轮不落地（②③的只读设计产物，供记录与后续裁定）

**②Gate/Fan-in（独立只读调查已完成，本 goal 不实施）**：`.quay/gate-events.jsonl` 的真实写入点比此前
记录的更多——除 `gate/engine.ts:131`（经 `runGate`）外，`gate/lifecycle.ts` 6 处、`goal-store.ts` 2 处、
`mcp-server.ts:536` 均经由 `verdictFromAcceptance`/`verdictFromGateCheck`（属"evaluated"一类）；真正
不同类的是 `worker-fan-in.ts:1279`（硬编码 `"pass"`）、`worker-fan-in.ts:2502`（落地结果映射）、
`goal-merge.ts:268`（`verdict:"request"`，人的合并请求意图，非检查结果）——**三类，不是两类**：
evaluated / recorded / requested。提议的最小切片：给 `GateEvent` 加一个必填的 `provenance: "evaluated" |
"recorded" | "requested"` 字段，约 10 处写入点各加一个字面量字段，**不改变任何写入点的决策逻辑，不让
fan-in 改走 `runGate`**（用户明确约束：不可简单让 fan-in 改走 Gate 导致实际 landing 路径语义变化——本
设计完全不触碰 fan-in 的决策/合并逻辑，只给事件记录本身补一个诚实的来源标注）。风险点（本轮已核实，
非假设）：由于这些字面量多是直接构造对象字面量传入（非显式 `: GateEvent` 类型标注），把字段设为必填
后 `tsc` 未必能在每个遗漏点报错——落地时需要一个静态枚举扫描兜底（类似既有 `gate-event-coverage-
check.ts` 的手法），否则"加了类型字段但漏了某个写入点"不会被编译器挡住。`appendGoalMergeResultEvent`
（`worker-fan-in.ts:2502`）目前**零测试引用**，是一个真实的既有覆盖缺口，若②后续立项应顺带补上。

**③Goal transition contract（独立只读调查已完成，本 goal 不实施）**：`goal-store.ts::write()` 里枚举到
的内联闸门（`activating`/`goalInAcScope`/I1' cap/attribution/fidelity 等，约 12 处，每处的判定条件与
放行/拦截效果已逐条记录）**不应该照搬 Task 的 `LIFECYCLE_EDGES`+`decideTransition`**——Goal 的真实触发
条件（人工合并请求、AC 充分性、`branch:true`+分支存在性、`pre-merge`/post-merge 相位）天然跨多个
`(from,to)` 边共享，不是边独立的，照搬会把这些谓词硬塞成不透明的逐边回调格子，并不比现状更"声明式"。
诚实的最小切片应该**只做成员合法性**（36 个 `(from,to)` 对里哪些是可达边），完全不碰 activation/
zero-AC/cap/attribution/fidelity 的既有判定逻辑与 `flipGoal`（保证 Goal 状态历史兼容——不回溯校验任何
既有 `statusLog` 条目，纯增量式声明已发生过的边，不拒绝任何历史上实际产生过的 transition）。调查本身
已经发现一个真实的、与本提案主张直接相关的缺陷（作为"调查有牙"的负对照）：`flipGoal` 的
`disposeOld.to==="achieved"` 路径（goal-store.ts:2364-2402）**从不追加 statusLog**，而同一语义的状态
翻转经 `write()` 自身的 `statusChanged` 路径时**总会**追加——同一个"达成后处置"动作，走两个函数会有
不同的留痕保证。此缺陷记录在案，是否单独立案修复留给用户裁定（本 goal 不碰，也不建议与"建表"这一步
绑在一起落地，因为前者是行为缺陷，后者是纯增量式声明，耦合在一起会让回归面变大、不利于分别验收）。

## 判据形态

三态退出码（同 GOAL-030~035）：0 达成；1 未达成且同行带 `CAUSE=`；3 未评估。

## AC

- AC-359（结构护栏，pre-merge）：`computeDispatchExclusion` 单一定义、纯函数（无 I/O）、不含 backoff；
  `worker-driver.ts` 在 ready-pool→apply-filters 窗口内对它恰调用 1 次，旧的 `inFlightTasks()` 双调用
  归零；backoff 的逐候选 `Date.now()` 现场判定逐字不变；`advanceRetryCap`/`RetryState`/`isBackedOff`
  三个既有符号未动；`git diff --name-only develop...HEAD` 不越界到 gate/goal-store/goal-merge/
  worker-fan-in/ready-pool-check 任一文件。
- AC-360（函数级契约 + 负对照 + 回归，pre-merge）：`plugin/test/driver-filters.test.mjs` 新增对
  `computeDispatchExclusion` 的测试（≥2 处引用：基本正确性 + 一条确定性/纯度负对照——同样输入调用
  两次，输出深度相等，证明它是纯快照而非会漂移的再观测）；`driver-filters.test.mjs` 与
  `worker-driver.test.mjs` 全量回归绿。
- AC-361（post-merge 生产验证）：`develop` 尖端（`merge-base` 一致性核验）重跑 AC-359 的结构检查 +
  两个测试文件全量回归。⚠️ `worker-driver.test.mjs` 较大，评估本 AC 时建议显式传一个较大的
  `--timeout`（如 900000ms）。

## 验证步骤

1. fork point：develop tip `8cb36c2fd94616aa7169dbe475d6671ee939adf6`。
2. goal 转 active + `branch:true` ⇒ `goal/GOAL-036` 懒创建。
3. 一个 task 在该分支落地（范围见上）。
4. AC-360 的负对照 + 两个测试文件回归。
5. 人工触发 `quay goal merge GOAL-036 --reason ...`；worker-driver 机械 fan-in（本 goal 改的是
   worker-driver.ts 自身的常驻选择环——fan-in 由生产中的 worker-driver 执行，隐性自举证明同 GOAL-035）。
6. 规定并入形态（develop first-parent 恰好一个合并提交）。
7. post-merge 验证（AC-361）。

## 停止扩大范围的信号

需要碰 backoff 逻辑、`retryState`/`backoffState` 持久化、或 Gate/Fan-in/Goal 任一文件才能完成本刀——
任一出现 ⇒ 不扩大范围，回到调查。为了"顺手"统一 promotion-driver 的 `makeFilterContext` 用法也是一个
扩大信号（它没有本刀要解决的双读问题）。

## 退出条件

`computeDispatchExclusion` 是 `{inFlight, retryExhausted}` 在一轮调度内的唯一计算点；两个消费者
（`readyPoolCheck`、`applyTaskFilters`）读同一次调用的结果；backoff 的现场判定不变；两个测试文件全绿；
GOAL-036 以恰好一个合并提交进入 develop；AC-359/360/361 全部 achieved。
