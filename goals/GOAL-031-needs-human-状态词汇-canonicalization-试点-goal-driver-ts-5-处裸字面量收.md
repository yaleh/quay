---
id: GOAL-031
title: needs-human 状态词汇 canonicalization 试点——goal-driver.ts 5 处裸字面量收敛到已有
  task-status.ts 正本（非 kernel 第二套）
status: achieved
kind: goal
origin: 人 2026-10-08 指令：按已验证的小而真实 goal branch 方法推进下一轮重构，仅做 needs-human
  裸字面量收敛。执行前核实发现原技术前提有误（canonical source 应为已有的 abi.ts +
  plugin/scripts/task-status.ts，而非 kernel/task-transition.ts——该文件只存在于未合并的
  goal/GOAL-030 分支；原 dispersion≤2 目标因此不可达成，正确底线是 4），已据实修正，范围保持极小不变。详见 body。
activatedAt: 2026-10-08T14:08:10.301Z
statusLog:
  - at: 2026-10-08T17:09:24.141Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
branch: true
---
## 背景

**这是继 GOAL-030 之后的第二个真实 goal branch 试点**，目的与 GOAL-030 相同——首先是继续验证"在分支上运行 Quay、并验证 Quay"这条自举机制本身，不是追求架构收益；范围比 GOAL-030 更小、更安全，作为机制的第二次独立验证（不同形状的改动：纯文本字面量替换，而不是新增模块+改写两处调用）。

**⚠️ 执行前核实发现的关键前提修正（必须显式记录，否则下面的 AC 会引用不存在的东西）**：

最初设想的 canonical source 是 `packages/quay/src/kernel/task-transition.ts::TASK_STATUSES/TaskStatus`——但该文件**只存在于尚未合并的 `goal/GOAL-030` 分支**（此刻 35 commits ahead of develop，AC-341/342 仍 `active`，未并入），在 `develop` 上不存在。本 goal 从 develop tip 开分支，不能依赖兄弟分支未并入的产物，否则会制造跨 goal-branch 的隐性耦合。

真正已经存在、且早已 `status: done` 的正本是 **`packages/quay/src/abi.ts`**（`TaskStatus`/`TASK_STATUSES`/`TASK_STATUS`/`isTaskStatus`，packages/* 树）与 **`plugin/scripts/task-status.ts`**（同一词表的 plugin 树自包含副本——plugin 独立打包，不能静态 import packages 源码，原因与 `sync-vendor.sh` 相同）。两者由已完成任务 `gap-abi-status-lifecycle-vocab-scattered-no-named-type` 建立，16 个消费者已迁移。

用 ArchGuard `get_literal_dispersion(value:"needs-human")` 现读（2026-10-08，develop（取值随快照时刻变化；当时读到 a8abf1a6dd0fd70b3e3f6ef8529447797e36b053，仅示例））：dispersion=5，文件 = `task-status.ts`、`github-client.ts`、`observation.ts`、`goal-driver.ts`、`workflow-baseline-metrics.ts`。逐文件逐行核实（位置判定，非关键词）：

- `plugin/scripts/task-status.ts:9`：正本声明本身，非缺陷。
- `packages/quay-github/src/github-client.ts:646`：已被 `gap-abi-status-lifecycle-vocab-scattered-no-named-type` 的 AC2 显式豁免（独立 provider 包不能静态 import `abi.ts`，QN-072/073 needle 测试钉死该字面量形状）——不可动，不计入"待收敛"。
- `packages/quay/src/observation.ts:1443,1451`：比较的是促晋升结果账本的 `action` 字段，不是 `task.status`——异词表假阳性。
- `plugin/scripts/workflow-baseline-metrics.ts:643,776`：比较的是 workflow 事件的 `outcome` 字段，同样不是 `task.status`——异词表假阳性。
- `plugin/scripts/goal-driver.ts:2088,2098,2319,2383,2443`（grep 位置核实，比 ArchGuard 自己的检测多抓到 2098 一行）：全部是货真价实的 `task.status === "needs-human"` 裸字面量比较，该文件目前零 import `task-status.ts`——**这是唯一真实、未迁移的残量**。
- 额外排除：`goal-driver.ts:823` 是 `r.status === "active" || r.status === "achieved" || r.status === "needs-human"`——GOAL-AC 的 `status` 字段（不同词表），不是 task.status，⛔ 不在本 goal 范围内；`workflow-replay.ts:138` 同理是 workflow outcome，⛔ 不碰。

**因此"dispersion 从 5 降到 ≤2"这个原始目标数值不可达成**：正确的、完全修复后的底线是 **4**（正本声明 1 + 豁免 1 + 假阳性 2），不是 2——"2"没有把"正本自身必然带字面量"和"两个假阳性文件永远不会被这次改动影响"算进去。本 goal 把目标数值改为 4，并要求逐一枚举这 4 个为什么不是缺陷（见 AC-344）。

`plugin/scripts/goal-driver.ts:823` 用 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 现读 = 6（5 条真实目标 + 1 条被排除的 goal-AC 行），修复后必须精确降到 **1**（只剩被排除的那一行，逐字节不变）——这是本 goal 核心的机械判据。

## 范围与非目标

范围：

- 仅 `plugin/scripts/goal-driver.ts` 的 5 处（`grep -n 'status === "needs-human"' plugin/scripts/goal-driver.ts | grep -v 823` 当前命中的 5 行），把裸字面量比较改为消费 `plugin/scripts/task-status.ts` 的 `isTaskStatus`/`TASK_STATUS.NEEDS_HUMAN`（新增 import）。
- 2098 行 `status === "todo" || status === "ready" || status === "needs-human"` 只替换 `needs-human` 那一项；`todo`/`ready` 两项保持裸字面量——用户显式约束（不要顺手扫 todo/ready/done）的直接后果，即使同一行风格不一致也要接受。

非目标（⛔ 有意排除）：

- ⛔ 不碰 `todo`/`ready`/`done` 任何裸字面量（即使同文件同行）。
- ⛔ 不新造 kernel 第二套声明；不 import/不依赖任何只存在于 `goal/GOAL-030` 分支的文件（`kernel/task-transition.ts`、`scripts/branch-selfhost-probe.mjs`）；不等待 GOAL-030 合并。
- ⛔ 不碰 `packages/quay/src` 的目录环（core-root<->core-cli）。
- ⛔ 不引入共享 `Verdict` 原语。
- ⛔ 不碰 `goal-driver.ts::parseSemanticSufficiencyVerdict` 与 `criterion-fidelity.ts::parseFidelityVerdict` 的重复问题。
- ⛔ 不碰 `goal-driver.ts:823`（GOAL-AC status，不同词表）、`observation.ts`/`workflow-baseline-metrics.ts`/`workflow-replay.ts`（异词表假阳性，不该变）、`github-client.ts`（已豁免，needle 测试钉住）。

## 判据形态

三态退出码（同 GOAL-030 惯例）：0 达成；1 未达成，同行带 `CAUSE=`；3 未评估（前提未落地，如 worktree/evidence 未产生、尚未并入）。

## 验证步骤

1. 激活前：对 `develop` 当前 tip 读 `get_literal_dispersion(value:"needs-human")` 作为 before 基线（dispersion=5）+ `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` = 6。
2. 激活后核验：`goal/GOAL-031` 从 develop tip 懒创建（具体 fork SHA 由懒创建机制在激活那一刻自动钉住，不在此预先写死——develop 持续被后台 driver 推进，写死一个快照点只会在几分钟内变假）；任务 worktree 从该分支开出；与 `goal/GOAL-030` 分支互不干扰（不同分支名、不同 worktree 路径、不 import 对方产物——AC-343 机械核验）。
3. 分支 tip 上：类型检查、`plugin/scripts/import-graph-check.ts`（valueSccs/typeSccs/reverseEdges/kernelViolations 不回退）、既有 suite/smoke 全绿。
4. 分支自举身份证明：**不复用 GOAL-030 的 `scripts/branch-selfhost-probe.mjs`**（只存在于未合并的 `goal/GOAL-030`，develop 上没有）——复用它验证过的**技术**（校验被加载模块的 realpath 落在本 goal 的 worktree 内，不是主检出），写一个规模相应缩小的、自包含的身份校验，落盘到 `.quay/goal-031-evidence/selfhost-identity.json`。
5. 后基线：对分支 tip 重跑 `get_literal_dispersion(value:"needs-human")` + 同一 grep，核对 dispersion 降到 4、`grep -c` 降到 1，落盘到 `.quay/goal-031-evidence/archguard-dispersion.json`。
6. 用已验证的 `archguard:arch-layer-review` skill（真实 Skill 工具调用，非手动读文件）对 before/after 做一次机械事实（facts）/声明规则（declaredRules）/语义判断（judgment）三层输出，作为归档证据（advisory，不是 gate）。
7. 人在预览上试用后 `quay goal merge GOAL-031 --reason …`。
8. 并入后：develop 上重跑 grep 读数、核对 `goal/GOAL-031` 以恰好一个合并提交进入 first-parent 链（AC-345）。

## 停止扩大范围的信号

与 GOAL-030 同构（任一出现 ⇒ 不扩大范围、不进入下一个 goal，先修机制缺口；无法恢复则放弃分支并丢弃）：代码身份假阳性（自举/模块解析落到主检出）；生产污染（沙盒改动生产 `.quay/`/`tasks/`）；隔离失效（本 goal 提交出现在 develop first-parent 链、任务落地后被再次派发）；**与 `goal/GOAL-030` 产生任何依赖或互相干扰**（本 goal 独有的新增红线）；需要往 `layers.yml` 加边；目录环增加；基线漂移；人工干预持续增加。

## 退出条件

`goal-driver.ts` 的 5 处 `needs-human` 裸字面量比较全部消费 `plugin/scripts/task-status.ts` 的既有正本，不新造第二套；不改变状态机允许边/运行时语义；`grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 从 6 精确降到 1；`get_literal_dispersion(value:"needs-human")` 从 5 降到 4，且 4 个残量逐一有记录在案的"非缺陷"理由（正本 1 + 豁免 1 + 假阳性 2）；`import-graph-check.ts` 四个棘轮量不回退；suite/smoke 全绿；分支自举身份可证明加载分支自己代码；goal branch 以恰好一个合并提交进入 develop，并入后生产读数核验通过；且全程不依赖、不干扰 `goal/GOAL-030` 分支及其未并入产物。对应 AC-343（结构与范围护栏）、AC-344（收敛读数 + 棘轮 + 分支身份）、AC-345（并入形态 + 并入后生产读数）。