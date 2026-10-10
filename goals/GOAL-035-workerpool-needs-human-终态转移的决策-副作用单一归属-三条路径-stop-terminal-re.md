---
id: GOAL-035
title: WorkerPool needs-human
  终态转移的决策/副作用单一归属：三条路径（stop-terminal/retry-cap/quick-death）收敛到一个
  applyNeedsHumanTransition，修复 quick-death 路径转移结构上不可见 + kind
  误标两个真实缺陷（Driver/Routine/WorkerPool OOD 重构第二阶段，候选①）
status: draft
kind: goal
origin: 继 GOAL-030~034 后第二阶段
branch: true
---
## 背景

GOAL-030~034 的五次试点都是「import 边/package SCC」收敛（状态表/决策函数/副作用函数的物理归属）。本 goal 是用户明确要求的**第二阶段**：不再做纯 import/SCC 清理，而是找 Driver/Routine/WorkerPool 领域内真实的**状态/决策归属 + 不变量**问题——一个结构上可被绕过的不变量，而不是文件位置问题。

## 调查结论（创建本 goal 前完成；候选评估与去重）

**去重**：检查了 `tasks/*.md` 近期改动、`goal_list`（active/draft 均为空）、ADR 列表（最新到 ADR-036，枚举单一真源机制，与本次候选无关）、GOAL-034 的三个遗留小缺陷（`gap-worker-blocker-reason-invisible-on-the-board`、`gap-promotion-driver-blind-to-unsatisfiable-ac-block`、`gap-ac355-criterion-false-from-goal-acceptance-active-guard`、`gap-systemd-scope-probe-params-differ-from-real-scope`，均已 `done`）、22 个同机 peer 会话（`ListAgents`）——「项目新版本发布」会话 busy 处理发布，不触碰本范围文件；「Quay refactor architecture liaison」busy 但是 archguard 仓库、只读查 quay，上一个 goal 已确认无文件级冲突；无会话持有 Driver/Routine/WorkerPool/Policy-Gate 源码文件的在飞任务。

**评估了 3 个候选**：

1. **WorkerPool「needs-human 终态转移」的决策/副作用归属（选中，见下）。**
2. **Driver/WorkerPool 层面的声明式 quota + 独立 Policy/Gate + 全局安全上限**——核实现状：`plugin/scripts/driver-config.ts` 已是全仓库并发 cap 的声明式单一源（六个 kind 各自的 `cap`/`intervalMs`，GOAL-030 之前的既有工作）；独立 Policy/Gate = `resource-gate.sh`（host 级 PSI/loadavg/mem 只读快照，GO/WAIT，覆盖全部 kind，不分 kind）；**全局安全上限** 在 routine 维度已有 `routine_quota.global_ceiling`（`gap-routine-quota-canonical-config-and-policy-gate` / `gap-routine-quota-consumer-convergence`，均 done）。Driver/WorkerPool 维度目前**没有**跨 kind 的并发总量上限（只有逐 kind cap），但 `gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot`（done）已对「是否需要一把跨进程锁/共享槛」做过复现实测 + 方向评估，**人已裁定**（DIR-132）降为非优先、记为观察项（硬规则 12：没有实际竞态发生率数据之前不立新机制）。本次未发现新的发生率证据 ⇒ **不重开**，维持现状（结论：该轴已被充分调查、理由仍然成立，不是本次候选）。
3. **Routine 两个任务创建调用点的标签口径分歧**（`probe-routine.ts::fileRoutineTask` 标签带 routine 名，`meta-driver.ts::createAutoDriveTask` 不带）——真实、已被 `gap-routine-quota-consumer-convergence`（done）的 Evidence 段显式记录为「供后续板压力设计任务的前置输入」，但改动规模是单个调用点的标签参数，**不足以撑起一个 branch Goal 的全套机制**（fork/self-host/before-after/fan-in/post-merge）；留作一条常规 task 处理，不在本 goal 范围。

**选中候选的机械事实（源码读取，按位置核对，非关键词猜测）**：`plugin/scripts/worker-driver.ts` 的 `onWorkerFinished(rw, r)` 闭包（约 5272-5395 行，`runResidentLoop` 内，生产中每一个 worker 退出都经过这里）里，「把一个任务标记为 needs-human」这一个决策的**效果**（内存 `retryState.needsHuman`/`counts` 更新 + 磁盘 `markNeedsHuman()` 落盘承诺）目前有 **3 条独立写法**，只有部分走统一路径：

- **路径 A（`exited-not-landed` → `decideExitedNotLandedAction` 判定 stop-terminal）**：直接 `retryState.needsHuman.add(...)` + `retryState.counts.set(id, maxRetries)`，批量进 `needsHumanWrites` 数组，随后统一循环调 `markNeedsHuman()` 并把结果 push 进 `needsHumanResults`（+ 发 json 事件）。
- **路径 B（`exited-not-landed` → `advanceRetryCap` 重试上限耗尽）**：调用 `driver-filters.ts::advanceRetryCap`（既有的、正确的单一 mutator 函数），其返回值同样汇入 A 的 `needsHumanWrites` 批处理循环——**这条路径本身是干净的**。
- **路径 C（quick-death 退避耗尽，`backoff.newlyNeedsHuman`）**：**直接** `retryState.needsHuman.add(r.taskId)`（不走 `advanceRetryCap`，这是对的——它有自己独立的 `backoffState` 计数器，不该复用 `retryState.counts`），然后**立即、不经批处理**调用 `markNeedsHuman(rootDir, r.taskId, reason)`（省略 `kind` 参数，落盘 `kind` 被静默记成缺省值 `"retry-cap"`，即使原因文案正确描述了快速死亡退避——**一处真实的误标**）——**返回值被丢弃**：既不 push 进 `needsHumanResults`，也不发 `needs-human` json 事件。路径 A/B 的转移在 round 记录（`needsHumanResults`，生产可观测载体）里可见；路径 C 的转移**结构上不可见**——这正是硬规则 9（可见性 ≠ 执行）的一个真实实例，不是比喻。

判断（ownership）：「needs-human 转移的副作用」（内存 Set/Map 更新 + 磁盘承诺 + 结果留痕）**应该只有一个拥有者**，路径 A/B 已经事实上趋同（经同一个批处理循环），路径 C 是唯一的离群点——这恰好是方法论第 3 节「只有当某个边界已经出现第二个真实实例才升格为命名模式」的反向确认：A/B 已经是两个真实实例共享同一段代码，证明抽出一个单一函数是合理的，C 不跟进才是异常，不是「提前设计模式」。

## 范围与非目标

范围：在 `plugin/scripts/driver-filters.ts` 新增一个导出函数 `applyNeedsHumanTransition(state: RetryState, root: string, write: {id, reason, kind}, opts?: {countsOverride?: number})`——内部做「若未标记则 `needsHuman.add` + 可选 `counts.set(countsOverride)`」+ 调用既有 `markNeedsHuman()`，返回其结果（`{id, ok, reason, committed}`，⛔ 不丢弃）。`NeedsHumanKind` 新增 `"quick-death-backoff"` 值（修正路径 C 当前的误标）。`worker-driver.ts` 的 `onWorkerFinished` 内，路径 A/B 的既有批处理循环与路径 C 均改为调用这个函数，路径 C 额外补上 `needsHumanResults.push` 与 `needs-human` json 事件，使三条路径在可观测性上一致。

⛔ 非目标（有意排除）：
- `advanceRetryCap`/`reconcileNeedsHumanWithDisk`/`markNeedsHuman`/`recordQuickDeathBackoff` 四个既有函数的签名与内部逻辑不变（它们各自的决策语义是对的，只是其中一个消费端——路径 C——没有统一消费它们共同的"记录"那一步）；
- `environment-fatal` 分支（故意不 markNeedsHuman，硬 return）不变；
- 不碰 `promotion-driver.ts`/`meta-driver.ts`/`quality-gate-driver.ts`/`outer-driver.ts`/`goal-driver.ts`/`driver-runtime.ts`/`driver-shared.ts`/`driver-config.ts`——本刀只处理 worker-driver.ts 这一个 kind 内部的一处具体不变量，不是「把所有 driver kind 的常驻循环状态都收进一个大 class」（那是方法论第 4 节会反对的过大切片，且 `residentLoopStop` 这类真正跨 kind 共享的控制器已经存在、已经收敛，不需要动）；
- 不新增声明式 quota 配置或跨进程锁（候选②已核实现状充分，见上）；
- 不处理 Routine 标签口径分歧（候选③，留给常规 task）；
- 不重启任何生产进程（worker-driver 目前正在生产运行，本 goal 只改源码，不触发热重载）。

## 判据形态

三态退出码（同既有 goal branch）：0 达成；1 未达成且同行带 `CAUSE=`；3 未评估。

## AC

- AC-356（结构护栏，pre-merge）：`applyNeedsHumanTransition` 单一定义；`NeedsHumanKind` 含 `"quick-death-backoff"`；`worker-driver.ts` 对 `retryState.needsHuman.add(`/`retryState.counts.set(` 的直接调用各归零（≥2 处改口调用新函数）；quick-death 分支现在也 `needsHumanResults.push` + 发 `needs-human` 事件；四个既有函数签名与 `environment-fatal` 硬 return 均未动；`git diff --name-only develop...HEAD` 不越界到其余六个 driver 文件。
- AC-357（函数级可证伪契约 + 回归，pre-merge）：`plugin/test/driver-filters.test.mjs` 新增对 `applyNeedsHumanTransition` 的测试（≥2 处引用：正常落盘 accept 路径 + 一个 `ok:false`/`committed:false` 的失败态能正确传出而不是被吞掉或抛异常——复用该文件已有的 `markNeedsHuman` 同类负控制手法，如 AC4「repo-less temp dir ⇒ committed:false, no throw」）；`plugin/test/worker-driver.test.mjs` 全量回归绿（这是生产中每个 worker 退出都走的代码路径，不能只测新函数不测调用方）。
- AC-358（post-merge 生产验证）：`develop` 尖端（`merge-base` 一致性核验）重跑 AC-356 的结构检查 + 两个测试文件全量回归。⚠️ `worker-driver.test.mjs` 文件较大（4379 行），评估本 AC 时建议显式传一个较大的 `--timeout`（如 900000ms），避免把真实超时误判为回归。

## 验证步骤

1. fork point：develop tip `1b87254733ca2ac33412e708c65ea2d1e160f9c1`（GOAL-034 落地之后）。
2. goal 转 active + `branch:true` ⇒ `goal/GOAL-035` 懒创建。
3. 一个 task 在该分支落地（范围见上）。
4. AC-357 的函数级负控制 + 两个测试文件回归。
5. 人工触发 `quay goal merge GOAL-035 --reason ...`；worker-driver 机械 fan-in（⚠️ 本 goal 修改的正是 worker-driver.ts 自身——fan-in 由生产 worker-driver 执行，验证其在修改了自己的源码后仍能正确跑完 fan-in 流程，这本身是一种隐性自举证明，见下节）。
6. 规定 merge shape（develop first-parent 恰好一个合并提交）。
7. post-merge 验证（AC-358）。

## 自举说明

本 goal 修改的是 worker-driver.ts 自身的 `onWorkerFinished` 逻辑，而 fan-in 阶段恰好由生产中的 worker-driver 来执行——这意味着「fan-in 成功落地」本身就隐含证明了修改后的代码在真实常驻循环里跑过至少一轮完整周期（driver 要跑完当前任务的 fan-in，必然经过自身的主循环）。不需要额外的 realpath 自举检查（不同于 GOAL-030/031 那种"子进程加载了哪棵树"的问题）——但这意味着本 task 的实现必须格外小心：如果改动引入了一个会在 `onWorkerFinished` 本身执行时抛异常的缺陷，生产 worker-driver 可能在落地自己这次改动的过程中就被卡住。AC-357 要求的全量回归正是为了在落地前拦住这类缺陷。

## 停止扩大范围的信号

需要碰列在非目标里的任一文件才能完成本刀；或为了"顺手"把 `residentLoopStop`/跨 kind 常驻循环状态也收进来——任一出现 ⇒ 不扩大范围，回到调查。

## 退出条件

`applyNeedsHumanTransition` 是 `retryState.needsHuman`/`counts` 变更的唯一 mutator（按 AC-356 实测）；三条路径在 `needsHumanResults`/json 事件上行为一致；quick-death 转移的 `kind` 标注正确（不再误标 `retry-cap`）；两个测试文件全绿；GOAL-035 以恰好一个合并提交进入 develop；AC-356/357/358 全部 achieved。
