# 外层编排 loop tick 指令

**启动方式**（在编排会话，即本会话或 `/clear` 后的新会话）：

```
/loop 20m 执行 orchestration/orchestrator-loop-tick.md 中的 tick 指令
```

---

## 定位

双层持续开发的**外层**。内层是开发会话（tmux `quay-0:0.0`），它执行任务；外层观察它、消解它的停摆、
必要时纠偏，并把真正需要人的事攒起来。

**外层存在的唯一理由：消费内层的停止条件。** 内层撞到「合并冲突 / 套件红 / 审查 2 轮后仍 REFUTED /
超 90 分钟 / needs-human 积压 ≥3」就停下等人——外层就是那个「人」的常规部分。内层仍然停，只是停的
时长从「到人回来」变成「到下一个 20 分钟 tick」。

## 授权边界（已与人约定，不可自行放宽）

| 外层可以 | 外层不可以 |
|---|---|
| 解阻塞（回退、bisect、判断发现真伪、分诊积压） | **直接改代码** |
| 重排队列、补建任务、纠正错误前提 | 改变方向或范围 |
| 写 `orchestration/`、队列状态文件 | 写 `packages/` `plugin/` `experiments/` `tasks/` |
| 给内层下指令 | 替内层执行 |

**外层不直接改代码**——它下指令，内层执行。理由：保持单一写入者。本会话 2026-08-02 有过一次
`git stash` 事故，正是外层动了内层正在工作的树。

人在，但不需要被打扰：**常规自行处理，非常规攒起来**等人有空看。

## Tick 步骤

### 1. 观察（只读，不动手）

```bash
tmux capture-pane -p -t quay-0:0.0 | tail -20      # 内层在做什么
git -C /home/yale/work/quay log --oneline -10       # 落地了什么
git -C /home/yale/work/quay status --short          # 树是否干净
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
cat docs/analysis/batch2-queue-state.md             # 内层自报的队列状态
```

**以 git 和实测为准，不以内层的自述为准。** 内层报告过「AC9 满足」而实测 627s 超限；报告过任务
done 而 DoD 未勾。每个 tick 都要独立核实至少一项它声称完成的事。

### 2. 分类本 tick 的动作

**必须**记录本 tick 属于哪一类——这是判断分层是否退化的唯一依据：

| 类型 | 含义 |
|---|---|
| `no-action` | 内层正常推进，无需介入 |
| `unblock` | 内层停摆，外层消解后恢复 |
| `correct` | 内层在推进但方向/做法有问题，纠偏 |
| `escalate` | 超出授权，攒给人 |

**退化判据**：若多数 tick 是 `correct`，说明内层自主性不足——**该修内层，不是加密外层频率**。
若多数是 `no-action`，分层是对的。

### 3. 按内层的停摆原因消解

| 内层停在 | 外层做什么 |
|---|---|
| 合并冲突 | 读两边意图，指示内层回退或修复。**不自己 merge** |
| 全量 suite 非绿 | bisect 定位；判断新引入还是既有；既有的指示建任务，新引入的指示回退 |
| 审查 2 轮仍 REFUTED | 读审查发现，判断是否真实。真实 → 指示缩小范围重做；不实 → 指示记录理由后推进 |
| 任务超 90 分钟 | 判断是任务过大（指示拆分）还是卡住（指示放弃并建任务记录） |
| needs-human 积压 ≥3 | 分诊：真阻塞的攒给人，可继续的指示内层继续 |
| 就绪队列为空 | 从任务库补一批（见步骤 4） |

### 4. 队列补充

队列空时，从 `tasks/` 取下一批。**复用已有机制，不新建**：

- 候选：`status: todo` 或 `ready` 且带 `milestone-candidate` 标签
- 依赖就绪：父任务 done、无未满足前置（`it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN）
- 并发资格：`checkTouchesPair`（`plugin/scripts/touches-orthogonality-check.ts`）对**所有在飞任务
  和彼此**两两检查，重叠则不同批
- 优先级：阻塞其它任务的优先；`gap-*` 缺陷类优先于 `DIR-*` 新能力

把补充结果写进队列状态文件，指示内层派发。

### 5. 升级（攒起来，不打扰）

以下**不自行决定**，写进 `orchestration/escalations.md` 等人：

- 同一失败在外层消解后**再次出现**——循环不收敛，不是单点故障
- 需要改变**方向或范围**的决定（不只是解阻塞）
- 外层自己的停止条件触发（见步骤 7）

每条升级要写：现象、外层已尝试什么、为什么超出授权、建议的两个以上选项。

### 6. 学习：更新目标与方法的描述

**每个 tick 都要问**：这一轮看到的东西，是否改变了我们对目标或方法的理解？

若是，更新对应文件并提交：

- `orchestration/exp6-phase1-sustained-unattended-operation.md` —— 目标、AC、DoD 的修正
- `docs/analysis/fast-mode-loop-tick.md` —— 内层机制的修正
- 本文件 —— 外层机制的修正

**这是机制的一部分，不是可选项。** 本会话已多次出现「前提错了才发现」（`extractMechanismClaims`
不在拆分决策路径上、416s 上限设在不知成本结构时、readiness check 不查套件）。不写下来，下一个
tick 或 `/clear` 后的会话会重犯。

修正时**必须写明是什么证据推翻了原判断**，不只是改结论。

### 7. 外层自己的停止条件

**连续 3 个 tick 没有推进任何任务状态** → 停止 loop，叫人，附上三次 tick 各自看到了什么。

「推进」的定义：有任务状态变化、有 commit 落地、或有升级项产生。三次都是 `no-action` 且内层无进展
= 系统卡住了，不是在正常工作。

### 8. 写回并重新排程

- 更新 `orchestration/tick-log.md`：时刻、动作类型、做了什么、内层状态快照
- `ScheduleWakeup` 20 分钟（1200 秒）

## 每个 tick 必报

- 动作类型（`no-action` / `unblock` / `correct` / `escalate`）
- 独立核实了内层的哪一项声称，结果如何
- 内层在飞任务数与各自已运行时长
- 遥测当前：任务数、均耗时、tasksPerHour
- 累计动作类型分布（退化判据）

不要只说「内层在跑」——没有这些，分层是否有效无法判定。

## 相关文件

| 文件 | 作用 |
|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | 目标、AC、DoD |
| `docs/analysis/fast-mode-loop-tick.md` | 内层 tick 指令 |
| `docs/analysis/batch2-queue-state.md` | 队列状态（内层写，外层读+补） |
| `orchestration/escalations.md` | 攒给人的非常规项 |
| `orchestration/tick-log.md` | 每 tick 记录 |
| `adr/ADR-021-*.md` | 四项原则 |
| `docs/proposals/exp6-queue-driven-concurrent-executor.md` §0 | 两阶段交付范围 |
