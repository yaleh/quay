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

- [x] AC1: **worktree 重跑产出信号**——worktree 跑重 scoped 时写自己的状态文件（或共享权威），
      「在等的人」能读到
      → **full-suite-runner 状态文件带 `scope: main|worktree`**（每轮状态 + verification-round 记录都写），
      worktree 全量跑经 mirror 写自己的 `<worktree>/.quay/full-suite-state.json`（实测：真实 git worktree
      跑完，worktree 自身状态文件存在且 `scope:"worktree"`）；资源闸 report 模式**恒报**
      `worktree_node_tests=N caller_scope=<main|worktree>`（活信号，无需任何状态文件）。
- [x] AC2: **主仓套件不被 worktree 负载永久挡**——资源闸区分主仓全量（信号）与 worktree scoped
      （可延后），或总预算协调（与 concurrency-cap 同解法）
      → **资源闸新增 `--main-repo-priority`**：主仓 full-suite 调用者（full-suite-runner 对非 worktree
      root 自动传入）在 worktree scoped 负载 ≥4 个 node --test 且 CPU < 85 时放行（WAIT→GO）；worktree
      自身调用者不放行（可延后，仍服从正常闸）。实测：cpu=50 原 WAIT，带 worktree 负载 + priority 标志
      ⇒ GO；同负载不带标志 ⇒ 仍 WAIT。
- [x] AC3: **负控制**——人为让 worktree 跑重 scoped + 不写状态 ⇒ 主仓套件仍能跑或 worktree 产出信号
      （不重演"机器满载无信号"）
      → 三向负控制测试全绿：① worktree 负载存在 + 主仓 priority 标志 ⇒ 主仓套件 GO（不被闸挡）；
      ② worktree 调用者 + 同样负载 ⇒ 仍 WAIT（可延后，不误放行）；③ gate report 报
      `worktree_node_tests=12`（无任何状态文件可读）⇒ worktree 负载可见，「无信号」半边被 gate 的信号封死。
- [x] AC4: 与 `gap-test-concurrency-cap-does-not-scope-nested-spawns`（跨层总预算）、
      `gap-suite-cutoff-what-tears-test-process-at-session-topology`（套件信号可信度）交叉标注
      → 两个任务文件均已加交叉标注（资源治理的「总预算」轴 vs 「优先级」轴；信号「存在性」 vs 「可信度」）。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（见 `## Execution evidence`）
- [x] 主仓套件在 worktree 重负载下仍能完成（不被闸永久挡），subagent 等不到的信号不再产生
      → 机制：资源闸 `--main-repo-priority` 让主仓 full-suite 在 worktree scoped 负载存在时仍 GO；
      负控制测试证明「worktree 重负载 + 无状态文件」下主仓套件不被闸永久挡（AC3）。
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）→ **外层 verification-round 职责**（两线快速模式：
      inner 只跑 scoped，全量套件是批量合边界的闸门，`fast-mode-loop-tick.md`），本任务不代跑

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

## Execution evidence (2026-08-08，worktree `worktree-scoped`，fork 自 integration 3f515fe9)

**前置核实**：本任务 `## Touches` 与 integration 上未验证任务（dod-over90 对 `plugin/scripts/full-suite-runner.ts`
的修改，合并于 5ed25069）相交——fork-baseline CLI 因 declaredTouches 不归一化注解路径误报 develop，但
checkTouchesPair 确认重叠 ⇒ **fork 基线取 integration**（3f515fe9）。不 revert/duplicate 其修改。

### 交付物

**1. `plugin/scripts/resource-gate.sh` — 主仓 vs worktree 优先级（AC2/AC3）**
- 新 `detect_caller_scope()`（main|worktree|unknown，git-dir vs git-common-dir）+ `read_worktree_node_tests()`
  （cwd 在 linked worktree 下的 node-MainThread 计数，Contract measure 的路径等价版）；
- report 模式恒报 `worktree_node_tests=N  caller_scope=<scope>`（AC1 活信号）；
- 新 `--main-repo-priority` 标志：主仓 full-suite 调用者 + worktree scoped 负载 ≥4（`RESOURCE_GATE_WORKTREE_LOAD_MIN`）
  + CPU < 85（`RESOURCE_GATE_WORKTREE_PRIORITY_CEILING`）⇒ CPU-WAIT 放行为 GO（**mem_wait 恒为硬挡板**）。

**2. `plugin/scripts/full-suite-runner.ts` — worktree 状态/优先级处理（AC1/AC2）**
- 新 `isGitWorktree(root)`（真实 git worktree 判定，含测试）；
- 每个状态文件 + verification-round 记录带 `scope: main|worktree`（worktree 自身状态文件 = AC1 信号）；
- `checkResourceGate(root)`：root 非 worktree ⇒ 追加 `--main-repo-priority`（主仓套件优先）；root 是 worktree
  ⇒ 不追加（worktree 全量本身可延后）。

### 实跑证据

**scoped 门（2026-08-08）**：`scripts/test.sh --for-task gap-worktree-scoped-runs-consume-resources-but-produce-no-signal --allow-thin`
**exit 0** —— 56 pass / 0 fail / 0 cancelled；scoped 静态层全绿（task-contract-check strict-subset 于本任务
+ 两个交叉任务文件；adr016-screen-use-check；dead-code-after-return-check）。选中集 = full-suite-runner +
resource-gate 两个测试文件（2/6 Touches → --allow-thin 放行）。

**关键断言（摘录，resource-gate.test.mjs / full-suite-runner.test.mjs）**：
- `AC2 — main-repo priority: --main-repo-priority lets the main-repo full suite proceed over worktree scoped load (WAIT->GO at cpu=50)`：cpu=50 原 WAIT ⇒ 带标志 GO（exit 0）。
- `AC2 negative — the SAME load WITHOUT --main-repo-priority stays WAIT`：同负载不带标志 ⇒ exit 1。
- `AC2 negative — a WORKTREE caller ... stays WAIT`：worktree 调用者不获主仓 override ⇒ exit 1。
- `AC2 negative — CPU above the priority ceiling (>=85) stays WAIT`：cpu=90 ⇒ exit 1。
- `AC2 negative — mem_wait is NEVER overridden`：mem=1000MB ⇒ exit 1（OOM 悬崖不因 priority 放行）。
- `AC1 — a real git-worktree run writes scope=worktree to its OWN .quay/full-suite-state.json`：真实 git
  worktree（tmpdir 自建）跑完，worktree 自身状态文件存在、`scope:"worktree"`、`state:"green"`。
- `AC1 unit — isGitWorktree distinguishes the main repo (false) from a linked worktree (true)`：主仓 false、
  linked worktree true、非 git 目录 false。
- `AC3 — the worktree load is OBSERVABLE via the gate even when the worktree writes no state file`：gate
  report 报 `worktree_node_tests=12 caller_scope=main`，无需任何 full-suite-state.json。

**活系统快照**：当前 `worktree_node_tests=4`（/tmp/quay-suite-int 的 4 个 node --test 属 linked worktree）、
`caller_scope=worktree`（本 worktree 内调用）——与 `ps` 实测一致（cwd 判定比 args grep 更全：args 版只捕 3）。
