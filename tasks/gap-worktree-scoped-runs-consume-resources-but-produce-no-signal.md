---
id: gap-worktree-scoped-runs-consume-resources-but-produce-no-signal
title: a worktree's heavy scoped verification consumes the machine but produces
  NO observable signal — inner-panel worktree runs 16+ node --test / 22 node
  procs with NO own .quay/full-suite-state.json, so its completion updates
  nothing anyone waits on; the resources it consumes keep the resource gate
  WAIT, blocking the main-repo suite (the signal the waiting subagent needs);
  cross-layer no-total-budget (concurrency-cap task) + worktree-no-state = a
  resource sink with no signal output — the coordination root of tonight's
  deadlock (subagent waited 1h6m for a signal no one produced)
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**worktree 的重 scoped 验证吃满机器却不产出任何可等的信号——资源黑洞 + 无信号输出的叠加形态。**

### 实测（管理者 2026-08-07 08:15Z + 外层复验）

| 项 | 值 |
|---|---|
| node-MainThread | 22（管理者 29，波动） |
| node --test | 17，其中 **16 个属 quay-worktrees/inner-panel** |
| inner-panel worktree 的 `.quay/full-suite-state.json` | **不存在** |
| 主仓 `.quay/full-suite-state.json` mtime | **07:21:40（56 分钟未动）** |

⇒ 机器满载（cpu-some 86），但满载的是 inner-panel worktree 的 scoped 验证，**不是** subagent 在等的
主仓全量套件。

### 为什么这是新形态（两个既有缺陷叠成一个）

1. **跨层无总预算**（`gap-test-concurrency-cap-does-not-scope-nested-spawns`）：worktree 各自跑，
   没有共享进程预算——inner-panel 一 Worktree 起 16 个 node --test，无人协调。
2. **worktree 无独立状态文件**（本任务）：worktree 没有自己的 `.quay/full-suite-state.json`，
   ⇒ 它的重跑完成**不更新任何人在等的文件**。

**叠成的形态**：**资源黑洞 + 无信号输出**——inner-panel 的 16 个 node --test 把机器吃满（资源闸 WAIT），
主仓套件（subagent 等的那件事）被闸挡无法跑，而 worktree 自己的完成又不产生任何信号。**机器满载，
但没人在做那件被等的事**。

### 为什么这是协调根因（不是噪音）

2026-08-07 08:0x 的僵局直接由此产生：subagent 等主仓 re-run 信号 1h6m，而主仓套件被 worktree 的
负载挡在资源闸外；worktree 跑完又不更新状态文件 ⇒ 无人产生那个信号。**僵局能解是因为 reason-axis
修复 + 外层重跑，但本形态会让同类僵局复发**——只要 worktree 的重活吃满机器且无信号输出。

### 修复方向（接法留执行时）

1. **worktree 重跑产生信号**：worktree 跑全量/重 scoped 时写自己的状态文件（或共享一个总预算/状态
   权威），让「在等的人」能看到；
2. **或主仓套件优先**：资源闸对 worktree scoped 与主仓全量区分优先级（主仓全量是 subagent 等的信号，
   worktree scoped 是可延后的）；
3. **或总预算协调**（与 concurrency-cap 任务同解法）：worktree 与主仓共享进程预算，避免一 Worktree
   独占 4 核。

## Contract

```
measure worktree_node_tests = `ps -eo args= | grep 'node --test' | grep -c '/quay-worktrees/'` stdout 数字段（当前 16）
measure main_suite_stale_min = `python3 -c "import time,os; print(int((time.time()-os.path.getmtime('.quay/full-suite-state.json'))/60))"` stdout 数字段（当前 56）
invariant worktree 的重 scoped 跑必须产出可观察的信号（自己的状态文件或共享权威），不得吃满机器而无信号输出
invoke `ps -eo args= | grep 'node --test' | grep -c '/quay-worktrees/'`
control 人为让一个 worktree 跑重 scoped 且不写状态文件 ⇒ 主仓套件必须仍能跑（不被闸永久挡）或该 worktree 必须产出信号
resume 若中断，先跑 measure 读当前 worktree node 数 + 主仓 state 陈旧度
```

## Acceptance Criteria

- [ ] AC1: **worktree 重跑产出信号**——worktree 跑重 scoped 时写自己的状态文件（或共享权威），
      「在等的人」能读到
- [ ] AC2: **主仓套件不被 worktree 负载永久挡**——资源闸区分主仓全量（信号）与 worktree scoped
      （可延后），或总预算协调（与 concurrency-cap 同解法）
- [ ] AC3: **负控制**——人为让 worktree 跑重 scoped + 不写状态 ⇒ 主仓套件仍能跑或 worktree 产出信号
      （不重演"机器满载无信号"）
- [ ] AC4: 与 `gap-test-concurrency-cap-does-not-scope-nested-spawns`（跨层总预算）、
      `gap-suite-cutoff-what-tears-test-process-at-session-topology`（套件信号可信度）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 主仓套件在 worktree 重负载下仍能完成（不被闸永久挡），subagent 等不到的信号不再产生
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- plugin/scripts/full-suite-runner.ts（若加 worktree 状态文件/优先级）
- plugin/scripts/resource-gate.sh（主仓 vs worktree 优先级）
- plugin/scripts/（或新共享进程预算）
- tasks/gap-worktree-scoped-runs-consume-resources-but-produce-no-signal.md（自身文件）
- tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md（交叉标注）
- tasks/gap-suite-cutoff-what-tears-test-process-at-session-topology.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T08:2xZ
changed: 管理者 2026-08-07 观测（node 计数 + worktree 无状态文件），请外层判断 → 裁定立案：
  资源黑洞 + 无信号输出叠加形态，协调根因（僵局的土壤）。
