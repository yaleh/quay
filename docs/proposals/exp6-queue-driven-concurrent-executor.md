---
name: exp6-queue-driven-concurrent-executor
description: Experiment 6 — queue-driven, event-reactive concurrent milestone executor; loop retained as cross-session stabilization layer
status: draft
provenance: session-history analysis of fce11849 + bae4f03c + b67a225f (Aug 1 2026)
supersedes: experiments/quay-perpetual-stream/OUTER-LOOP.md (Experiment 5, retained as behavioral specification — see §9)
---

# Experiment 6: Queue-Driven Concurrent Executor

## 0. 交付范围（2026-08-02 确认）

Exp6 交付**两样东西，分两个阶段**：

| 阶段 | 交付物 | 当前状态 |
|---|---|---|
| **阶段 1（现在）** | 方法论引擎本身——队列、并发、worktree 隔离、计量、机械确认 | 进行中 |
| **阶段 2（引擎稳定后）** | 用该引擎交付 quay 产品，**并把双层驱动机制本身作为 quay 的交付物之一** | 未开始 |

这不是「二选一」，是有序的两段。记录于此是因为它是若干判定的**判据**，而此前从未写下。

**阶段 2 的第二项（2026-08-02 人确认）**：外层编排 + 内层执行这套双层机制，不只是建造 quay 的
脚手架，要随 quay 一起交付。当前它是「两个散文文件 + 人操作的 tmux」，其中**队列、并发资格
（`checkTouchesPair`）、计量（`fast-mode-telemetry`）、`.halt` 哨兵已是通用机制**，而**层间通信
（读 TUI，ADR-016 已判定为权宜）与排程（会话内 `CronCreate`）不可产品化**，是阶段 2 的真实设计题。
缺口清单见 `orchestration/exp6-phase1-sustained-unattended-operation.md` §D。

**层间通信缺口已有解法提案**（2026-08-03）：[`quay-web-observation-surface.md`](./quay-web-observation-surface.md) —— 在现有 `serve` 上增量做一个三源 join（任务库/遥测/git）的只读观察面，零推理成本，同时供人、外层、以及未来的产品用户使用。它替代当前的 TUI 读屏（ADR-016 判定的权宜手段）。

### 裁剪判据（2026-08-03 实测得出）

`docs/analysis/instrument-failure-mode.md` 从无人值守窗口的实测归纳出一条比「元机制应比对象机制
简单一个数量级」更可操作的判据。

**触发它的数字**：窗口内收尾 8 个任务——**5 个是修仪器、3 个是找回几天前已完成的滞留工作、
真正的新功能 0 个**。而执行引擎整晚没出过问题（三路并发、worktree、三次合并、`orphaned` 归零）。
外层介入 21 次，**没有一次是因为调度、并发资格或合并出错**。

**主导失效模式**：*仪器的名字与它测量的东西不符*。六个实例：`tasksPerHour` 名为吞吐实为
`60/均耗时`；`sync-vendor` 的 DRIFT 标签指向一个不存在的文件；`test-coverage-check` 匹配到空数组
声明后返回 `[]` 并 exit 0；`test.sh <flag>` 静默换掉整个测试集；`duration_ms` 被读作 Σ 每文件耗时；
M136 被定性为 flaky 而实为确定性。

**判据**：

> **它能不能安静地说谎？**

能安静说谎的机制，无论多便宜，要么加契约要么删掉；会大声失败的机制，即使贵也值得留。

**已建裁剪任务**：[[gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion]]（1.1G / 21 worktree）、
[[gap-retire-the-prepare-execute-pipeline-cluster]]（约 14,658 行 + 25 个测试文件）。

**按此判据**：prepare 管线可裁（18 个任务零 `## Plan`、零 prepare-epoch，且失败无一是计划失败；
审查工作转移到派发闸口，见 `gap-dispatch-gate-has-no-checklist-and-no-trace`）；
`tasksPerHour` 可裁（`meanMinutes` 的确定性变换）。
**不可裁**：对抗审查、负控制、`checkTouchesPair`、「连跑 2 次」——四者的共同点是**都会大声失败**，
且今晚各自抓到了真东西（其中「连跑 2 次」推翻了 AC1）。

### 判据为什么重要：三组实测数字（2026-08-02）

| 维度 | 产品层 | 方法论层 | 比值 |
|---|---|---|---|
| 源码行数 | 7,903（`packages/*/src`） | ~29,000（`experiments/` + `plugin/scripts` 去重） | **3.7×** |
| 已完成任务 | 13 | 493 | **38×** |
| 待执行任务（`todo`/`ready` 且 `milestone-candidate`） | **0** | 29 | — |

方法论层是它所服务的产品的 3.7 倍，且当前队列中零个产品任务。

在阶段 1 这是**预期的**——引擎正在被建造。但它使 ADR-021 原则 1（元机制应比它管理的对象机制简单一个数量级）在仓库尺度上是反的。该原则在**单机制**尺度仍然成立且必须坚持；仓库尺度的倒挂是阶段 1 的临时特征，阶段 2 开始后应当收敛。

### 对现存机制的处置含义

- **exp5 的 VT / chart2 / portfolio / git-lens 度量机器**：测的是产品交付进度。阶段 1 期间它测的是一个几乎不动的量，因此**不删、不进 CI 默认组，封存待阶段 2 启用**。删掉它等于在阶段 2 重建。
- **测试分组**：必须能区分「产品」「方法论引擎」「方法论治理（封存）」三组，否则无法机械回答「这个测试现在该不该跑」。
- **exp6 的 7 条成功标准（§8）全部关于执行吞吐**，没有一条关于产品交付。这对阶段 1 是正确的；阶段 2 启动时必须补充产品侧标准，否则引擎会持续优化自己而没有交付压力。

---

## 1. 问题陈述

Experiment 5 的 `OUTER-LOOP.md` 定义了一个**固定顺序周期**：

```
drain → select → prepare* → execute* → gate* → land*
```

其中 `*` 阶段按 batch 批量执行，但每个阶段必须在所有前置阶段完成全部 batch 成员后才推进。

实际会话分析（fce11849, Aug 1 2026, 17.8h; bae4f03c, Aug 1 2026, 1.1h; b67a225f, Aug 1 2026, 当前）揭示了以下结构性缺陷：

### 缺陷 1：串行瓶颈

33+ 次 `prepare-milestone` Workflow 调用全部以 `bg=False` 串行执行，累计耗时 ~5.5h。每个任务独立（无共享状态冲突），完全可以并发——如果 4-6 路并发，同等工作量可压缩到 ~1h。

**根因不是调用者的选择，而是模型本身的约束**：OUTER-LOOP 的 `select` 阶段产生一个 batch，然后 `∀c∈batch: prepare(c)` 在同一循环体内串行遍历。并发需要调用者显式突破模型。

### 缺陷 2：阶段耦合阻断流水线

`prepare` → `execute` 之间是硬 barrier：所有 batch 成员的 prepare 必须全部完成，execute 才能开始。但 prepare 和 execute 操作的是**不同资源**（prepare 是 LLM 密集型，execute 是 I/O + shell 密集型），完全可以流水线化——第一个完成 prepare 的任务立即进入 execute，同时其他任务继续 prepare。

### 缺陷 3：跨 compact 行为断裂

OUTER-LOOP 的 `concurrent_execute` 分发了 N 个后台 Workflow，然后 `wait ∀ N complete`。但在这 N 个任务运行期间，主循环**完全空闲**——不能启动新的 prepare、不能处理已完成任务的 Land、不能响应人类指令。

更严重的是，一次 compact（会话上下文截断）后，下一会话**没有结构性机制**恢复上一会话的异步完成状态。会话 fce11849 在 07:11 UTC 分发了 6 个并发任务（M242-M246 prepare-milestone + DIR-124-C split）后 compact。下一个会话 bae4f03c 偏离到 meta-analysis，从未检查这 6 个任务的结果。这不是偶发的人为错误——**固定周期模型没有"检查上一周期遗留任务"的语义**，compact 后遗留状态只能靠 agent 自行"想起"去查询。

### 缺陷 4：散文驱动的流程控制

当前以下决策完全依赖 LLM agent 的散文推理，没有机械化的决策路径：

| 决策 | 当前方式 | 会话证据 |
|------|----------|----------|
| **拆分 vs 重试** | Agent 阅读 ProposalReview finding list，自行判断 | fce11849 中 DIR-099 被重试 8 次，每次都得到相同的 split-multi-mechanism 建议 |
| **手工接管** | Agent 检测到 epoch cap 耗尽后手动接管 | 7 个任务需要手工接管（M230/M231/M224/M225/M221/M228/M223） |
| **Batch 组成** | select-preflight 产生 shortlist，agent 决定批处理策略 | 始终串行（concurrency=1），从不并发 dispatch |
| **依赖分析** | Agent 阅读任务 body 推断依赖关系 | DIR-123 的虚假依赖链被手动发现并移除 |
| **Worktree 清理** | Agent 手动检测残留 worktree 并清理 | 当前会话清理了 13 个 stale worktrees |
| **重启恢复** | Agent 通过 meta-cc 查询上一会话状态 | 每次 compact 后人工重建上下文 |

---

## 2. 核心洞察：已被证明有效的机制

会话分析揭示了一个**与 OUTER-LOOP 固定周期正交的执行模式**，它实际上驱动了大量工作：

```
┌──────────────────────────────────────────────────────┐
│                   Task Queue                          │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐      │
│  │ pending │→│ ready  │→│running │→│  done  │      │
│  └────────┘  └────────┘  └────────┘  └────────┘      │
│                    ↓                       ↓          │
│              Dispatch              Land / next stage   │
└──────────────────────────────────────────────────────┘
```

关键特征：

1. **任务队列是核心原语**——不是固定的循环阶段。任务进入队列，按依赖关系排序，就绪即分发。
2. **后台 subagent 是真并发**——`Agent(run_in_background: true)` 和 `Workflow(run_in_background: true)` 提供真正的并行执行。
3. **事件驱动**——主会话通过 `<task-notification>` 接收完成事件，而非轮询等待。
4. **自适应路由**——根据任务特征（class、highRisk、touches 冲突）决定串行/并发/推迟。

---

## 3. 新实验规格

### 3.1 核心架构：事件驱动队列 + Loop 作为稳定层

```
┌─────────────────────────────────────────────────────┐
│              Exp6 Queue Executor                      │
│                                                       │
│  queue = TaskQueue(stateFile: ".quay/queue/state.json")
│                                                       │
│  queue.onReady(task =>                                │
│    dispatch(Workflow({                                │
│      scriptPath: ".claude/workflows/...",             │
│      run_in_background: true                          │
│    }))                                                │
│  )                                                    │
│                                                       │
│  queue.onCompleted(task =>                            │
│    if task.ok: enqueueNextStage(task)                 │
│    else: routeToDiagnosis(task)                       │
│  )                                                    │
│                                                       │
│  queue.onIdle(() => {                                 │
│    selectPreflight()                                  │
│    enqueueReadyCandidates()                           │
│  })                                                   │
│                                                       │
│  // Loop is NOT retired — it is the stabilization     │
│  // layer that ensures continuity across compacts     │
│  loop.run(queue)  // §9                               │
└─────────────────────────────────────────────────────┘
```

**关键差异**：Exp5 中 loop 是主驱动机制（cycle → drain → select → …）。Exp6 中 loop 降级为稳定层——它不在每个周期执行阶段序列，而是确保跨 compact/clear 的行为一致性：恢复队列状态、验证合约、检查 halt 哨兵。

### 3.2 阶段解耦：每任务状态机

Exp5 的阶段是**全局 barrier**——所有 prepare 完成才进入 execute。Exp6 的阶段是**每任务独立状态转换**：

```
Task A: queued→prepare(running)→prepare(done)→execute(running)→execute(done)→land(running)→land(done)
Task B: queued→prepare(running)→prepare(done)→execute(running)→execute(done)→land(running)→land(done)
Task C: queued→            prepare(running)→prepare(done)→execute(running)→...
              ↑                                              ↑
         A 完成 prepare 后立即进入 execute           B 同时进入 execute
         同时 C 开始 prepare                         A 可能已经 landing
```

### 3.3 并发策略：默认并发，例外串行

Exp5 的并发是 **opt-in**（`loop:.concurrency` 配置默认为 1，必须显式 > 1）。

Exp6 的并发是 **opt-out**——所有 ready 任务默认并发分发，仅以下情况串行：

| 条件 | 行为 |
|------|------|
| `touches` 有共享文件 | 串行化（共享状态冲突） |
| `learning` 类型任务 | 串行（探索类任务需要人类观察） |
| 同一 `parent` 的子任务 | 按依赖顺序串行 |
| 显式 `serial: true` 标记 | 串行 |

### 3.4 资源感知调度

Exp5 没有资源模型——batch 大小仅由 `loop:.concurrency` 静态配置。

Exp6 引入资源模型：

```
resources = {
  llm: {maxConcurrent: 4},      // LLM 密集型 (prepare, ProposalReview)
  shell: {maxConcurrent: 8},    // Shell 密集型 (execute build, gate)
  git: {maxConcurrent: 1},      // 互斥资源 (Land merge)
  worktree: {maxConcurrent: 6}, // Worktree 槽位
}
```

调度器在分发前检查资源可用性，而非仅按固定的 concurrency 数截断。

### 3.5 持久化任务状态

Exp5 的任务状态完全在会话上下文中（compact 后丢失）。

Exp6 在 `.quay/queue/` 下维护持久化任务状态文件：

```
.quay/queue/
  state.json          # {tasks: {id: {status, stage, dispatchedAt, sessionId, worktreePath, ...}}, epoch: ...}
  history.jsonl       # append-only event log (任务入队/完成/失败/重试)
```

会话启动时读取 `state.json` 恢复未完成任务的状态，而非从零开始或依赖 agent 散文推理。

### 3.6 人类交互面

Exp5 的人类交互是 **边界式的**——`.halt` 在循环边界暂停，`/quay-directive` 在 drain 阶段消费。

Exp6 的人类交互是 **队列优先级的**：

```
queue.prioritize(taskId, priority: "next")   // 插队到下一个
queue.pause(taskId)                           // 暂停特定任务
queue.redirect(taskId, newStage)              // 重新路由（如跳过 execute 直接 land）
queue.inject(newTask)                         // 动态注入新任务
```

---

## 4. 与 OUTER-LOOP.md 的关键差异对照表

| 维度 | Exp5 (OUTER-LOOP.md) | Exp6 (Queue Executor) |
|------|---------------------|----------------------|
| **驱动模型** | 固定时间周期 | 事件驱动（任务完成事件） |
| **Loop 角色** | 主驱动机制 | 稳定层（跨 compact/clear 行为保持，见 §9） |
| **阶段耦合** | 全局 barrier（所有任务必须完成同一阶段才推进） | 每任务独立状态机（不同任务可处于不同阶段） |
| **并发模式** | Opt-in（`loop:.concurrency`，默认 1） | Opt-out（默认并发，仅冲突时串行） |
| **资源模型** | 无（固定 concurrency 截断） | 有（llm/shell/git/worktree 槽位） |
| **任务状态** | 会话上下文（compact 后丢失） | 持久化文件（`.quay/queue/state.json`） |
| **失败处理** | 全局阻塞（一个任务失败阻塞整个 batch） | 每任务独立（失败任务 needsHuman，其他继续） |
| **人类交互** | 边界式（`.halt` 暂停循环，drain 消费指令） | 队列操作（插队、暂停、重路由、注入） |
| **Batch 语义** | SELECT 产生固定 batch，整批推进 | 队列动态出队，无固定 batch 概念 |
| **Retry 策略** | LLM 散文推理决策（重跑整个 `prepare(c)`） | 机械化：repairable→自动重试，！repairable→needsHuman |
| **遗留任务** | 无恢复机制（compact 后丢失） | 启动时读取 `state.json` 恢复 |
| **可观测性** | dashboard.md（循环级粒度） | 每任务状态可查询 + append-only event log |

---

## 5. 需固化的散文驱动部分

以下是从会话历史中识别出的、当前完全依赖 LLM agent 散文推理的流程控制点。每个都需要固化为机械化 workflow 或脚本。

### 5.1 拆分决策（当前：agent 阅读 finding list → 自行判断）

**证据**：fce11849 中 DIR-099 被重试 8 次，每次都收到相同的 split-multi-mechanism ProposalReview 建议。第 1 次的结果和第 8 次的结果语义等价，但 agent 每次都重新阅读 finding 并做出相同判断。

**机械化方案**：`scripts/dispatch-router.ts`

```
输入：ProposalReview finding ledger (proposal-ledger.json)
输出：{action: "split"|"retry"|"manual-takeover", reason: string, splitPlan?: ...}

规则：
- ledger 中有 repairable:true 的发现 → retry（自动修复后重试）
- ledger 中全为 repairable:false 且 >=3 个 BLOCKING → split
- ledger 中全为 repairable:false 且 <3 个 BLOCKING → manual-takeover
- 已重试 2 次且 ledger 未改善 → 退化为 manual-takeover
```

### 5.2 手工接管流程（当前：agent 手动绕过 epoch cap 完成 plan）

**证据**：fce11849 中 7 个任务（M230/M231/M224/M225/M221/M228/M223）的 epoch full-review cap 耗尽后，agent 执行"手工接管"——直接写入 plan 和 receipt 文件而不走 prepare-milestone workflow。每次接管的步骤是相似的（读取任务 → 验证 Proposal → 写入 plan → 生成 receipt），但没有脚本化。

**机械化方案**：`scripts/manual-takeover.ts` + `workflows/manual-takeover.js`

```
输入：taskId, reason
输出：{planFile, receiptFile, disposition}

步骤（全部机械化，零 LLM 参与）：
1. 从 task body 提取 ## Plan 段
2. 验证 plan 文件引用存在且可读
3. 生成 receipt（与 prepare-milestone 输出相同格式）
4. 写入 milestones/M<NN>/preparation.json
5. 在 epoch record 中标记 takeover
```

### 5.3 依赖分析（当前：agent 阅读任务 body 推断依赖）

**证据**：DIR-123 被发现有三条虚假依赖链（→ DIR-122 → DIR-119-D → DIR-119），agent 通过阅读任务 body 和 Touches 段手动推断出这些依赖不是代码级的。

**机械化方案**：`scripts/dependency-resolver.ts`

```
输入：taskId[]
输出：{deps: {taskId → taskId[]}, blocking: {taskId → reason[]}}

规则：
- 读取每个任务的 ## Touches 段
- 计算文件级交集（touches-orthogonality-check.ts 已有此能力）
- 检查 child-parent 链接（child-link-symmetry 已有此能力）
- 仅文件共享 + 显式 parent/child 产生真正的 block 边
- 其他所有"依赖"标记为 informational（不阻塞）
```

### 5.4 Worktree 清理（当前：agent 手动检测并清理）

**证据**：b67a225f 会话清理了 13 个 stale worktrees——6 个 `.claude/worktrees/wf_*` + 7 个 `milestones/*/worktrees/iteration-0`。这不是一次性事件——每个长会话都需要做一次。

**机械化方案**：将 `scripts/milestone-worktree.ts --clean-stale` 集成到队列管理器的启动健康检查中，自动运行。

### 5.5 重启恢复（当前：agent 通过 meta-cc 重建上下文）

**证据**：每次 compact 后的会话开始时，agent 都需要运行 meta-cc 查询来重建"上一会话做了什么"。这在 bae4f03c 和 b67a225f 中都重复发生了。

**机械化方案**：`scripts/session-restore.ts`

```
输入：.quay/queue/state.json, meta-cc session history
输出：{recovered: taskId[], orphaned: taskId[], recommendation: "continue"|"needs-human"}

步骤：
1. 读取 state.json → 找到所有 status != "done" 的任务
2. 对每个非完成任务：
   - 检查 dispatchedAt + 超时（Workflow 通常 <2h）
   - 检查对应的 task output 文件是否存在
   - 检查 git log 确认是否已 commit（可能已完成但 state 未更新）
3. 分类：recovered（可继续）/ orphaned（超时且无 output）/ completed-but-stale（已 commit 但 state 未更新）
4. 输出恢复建议
```

### 5.6 流水线调度决策（当前：agent 手动选择串行/并发）

**证据**：fce11849 中 agent 始终使用 `bg=False` 和串行 dispatch，即使任务之间没有 touches 冲突。并发决策完全依赖 agent 的判断（或缺乏判断）。

**机械化方案**：`scripts/pipeline-router.ts`

```
输入：readyQueue: Task[]
输出：dispatchPlan: {parallel: Task[][], serial: Task[]}

规则：
- 按 touches-orthogonality-check.ts 分组（共享文件的 → 同一组内串行）
- 不同组之间 → 并发
- learning 类型 → 单独串行
- 按资源可用性裁剪并行度
```

---

## 6. 嵌套 Subagent 机制分析

### 6.1 发现

bae4f03c 会话中存在明确的嵌套 subagent 行为，由 `meta.json` 中的 `spawnDepth` 字段记录：

```
主会话 (spawnDepth: 未记录)
├─ agent-a6527b474816bde0c  spawnDepth:1  (name-vs-scriptPath 分析)
├─ agent-a8329c34eba4459c2  spawnDepth:1  (split-decision 分析)
└─ agent-a8aa1b48bd8d121ad  spawnDepth:1  (cache/resume 分析)
   ├─ agent-a826f59706d5c1aee  spawnDepth:2  (Meta-cc resumeFromRunId search)
   ├─ agent-a7be0bba6e316eb85  spawnDepth:2  (Find M144 task and references)
   ├─ agent-a0f39c5927f8a4e8f  spawnDepth:2  (Analyze prepare-milestone resume code)
   └─ agent-a4c651e239a4a9ff7  spawnDepth:2  (Analyze M208 workflow runs)
```

**关键事实**：

1. Claude Code 当前版本**确实支持嵌套 subagent**——depth-1 subagent 可以 spawn depth-2 sub-subagent
2. `spawnDepth` 由系统自动追踪，记录在 `meta.json` 中
3. depth-2 subagent **没有再 spawn** depth-3（4 个 depth-2 的 Agent() 调用数均为 0）
4. 嵌套 subagent 的 transcript 独立存储（`subagents/agent-*.jsonl`）
5. `parentAgentId` 字段记录父子关系

### 6.2 对 Audit 机制的影响

当前审计机制的限制（来自 DIR-092）：

> "Workflow-internal dispatch is broken" — Workflow DSL 不能从内部 dispatch 另一个 Workflow

但 **`agent()` 调用在 Workflow DSL 内部是有效的**——`execute-milestone.js` 的 Audit 阶段正是通过 `agent()` 实现的。此外，主会话的 `Agent()` 调用已证明可以 spawn 嵌套 subagent。

这意味着存在一个**此前未被利用的能力**：多维度独立审计。

**当前模式**（单 agent 审计）：
```
execute-milestone.js (Workflow DSL)
  └─ Audit phase: agent("ADVERSARIAL ACCEPTANCE AUDIT...")  // 单一 agent，单一视角
```

**嵌套 subagent 增强模式**（多维度独立审计）：
```
主会话
  └─ Agent({description: "Multi-perspective audit for task X", run_in_background: true})
       ├─ Agent({description: "Correctness audit", prompt: "Check AC satisfaction..."})     depth:2
       ├─ Agent({description: "Security audit", prompt: "Check for injection, auth..."})    depth:2
       ├─ Agent({description: "Architecture audit", prompt: "Check anti-drift, coupling..."}) depth:2
       └─ Agent({description: "Test coverage audit", prompt: "Check test adequacy..."})     depth:2
       → 4 路并行审计完成后，depth-1 agent 合成 verdict
```

或者更直接地，在 execute-milestone.js 的 Audit phase 中使用多个并行 `agent()` 调用（Workflow DSL 支持 `parallel()`）：

```
// execute-milestone.js Audit phase
const auditResults = await parallel([
  () => agent(correctnessAuditPrompt, {label: 'audit-correctness', schema: AUDIT_SCHEMA}),
  () => agent(securityAuditPrompt,    {label: 'audit-security',    schema: AUDIT_SCHEMA}),
  () => agent(architectureAuditPrompt,{label: 'audit-arch',        schema: AUDIT_SCHEMA}),
  () => agent(testCoverageAuditPrompt,{label: 'audit-tests',       schema: AUDIT_SCHEMA}),
])
// 合成：多数投票或全票通过
```

### 6.3 嵌套深度限制

从 bae4f03c 的证据来看：

- depth-2 subagent 没有 spawn depth-3
- depth-1 subagent a8aa1b48bd8d121ad 发出了 8 次 `Agent()` 调用，但只有 4 个 depth-2 实际生成（4 个重复调用）
- 4 个 depth-2 中没有一个发出新的 `Agent()` 调用

**推断**：当前版本 Claude Code 的嵌套深度上限可能是 2。需要进一步测试确认这是硬限制还是这些特定 subagent 自行停止的。

### 6.4 对 Exp6 的建议

1. **执行层并发审计**：execute-milestone.js 的 Audit phase 应使用 `parallel()` 分发 3-4 个审计子 agent（correctness/security/architecture），而非当前的单个 agent。

2. **审计独立性的新定义**：当前 `audit-independence` gate 检查 "audit session ID ≠ build session ID"。嵌套模式下，审计 session ID 应验证为**不同于 build session ID**（主会话），而审计子 agent 之间的 session ID 相同是可以接受的（它们在同一审计上下文中运行）。

3. **深度限制**：审计子 agent 的 prompt 应包含明确指令 "do NOT spawn additional subagents" 以防止级联。每个审计子 agent 做它被分配的一个视角即可。

---

## 7. 迁移策略

### 阶段 0：协议层——定义状态机和持久化格式

不修改任何现有 workflow，先定义：
1. 任务状态机 schema（`queued → ready → prepare → execute → gate → land → done`）
2. `.quay/queue/state.json` 格式
3. 资源模型 schema
4. 事件日志格式（`history.jsonl`）

### 阶段 1：机械化散文决策——固化 §5 的六个决策点

按优先级：

| 优先级 | 决策点 | 理由 |
|--------|--------|------|
| P0 | 重启恢复 (`session-restore.ts`) | 没有它，Exp6 无法跨 compact 运行 |
| P0 | Worktree 清理（自动化） | 不自动化会累积并阻塞 Land |
| P1 | 拆分决策 (`dispatch-router.ts`) | 消除 8 次重复重试的浪费 |
| P1 | 流水线调度 (`pipeline-router.ts`) | 实现 §3.3 的并发策略 |
| P2 | 手工接管 (`manual-takeover.ts`) | 仍必要时才需要，频率因 M233 bodyScopeHash 已降低 |
| P2 | 依赖分析 (`dependency-resolver.ts`) | 已有 touches-orthogonality-check.ts 基础 |

### 阶段 2：适配层——将现有 Workflow 包装为队列阶段

保持 `prepare-milestone.js` 和 `execute-milestone.js` 不变，新增 `queue-dispatcher.js`：
1. 读取 `state.json`
2. 对每个 ready 任务，调用现有 Workflow（`run_in_background: true`）
3. 监听 `<task-notification>`，更新 `state.json`
4. 触发下一阶段入队

### 阶段 3：嵌套审计——实现 §6 的多维度审计

在 execute-milestone.js 的 Audit phase 中，将单个 `agent()` 替换为 3-4 个并行审计子 agent。

### 阶段 4：原生实现——将阶段解耦内化到 Workflow 内部

将 `execute-milestone.js` 的 Build/Audit/Gate/Land 拆分为独立可入队的阶段。

### 阶段 5：切换——OUTER-LOOP.md 保留为行为规范

Exp6 稳定运行 N 个里程碑后，`OUTER-LOOP.md` 从驱动程序降级为行为规范参考文档（见 §9）。

---

## 8. 成功标准

1. **并发度**：4+ 个独立任务可真正并发执行（会话日志中 `run_in_background: true` 的 Workflow 调用 ≥ 并行任务数）
2. **流水线效率**：任务 A 在 execute 时任务 B 可同时 prepare（会话日志中两个不同阶段的 agent 同时运行）
3. **故障隔离**：一个任务 prepare 失败不阻塞其他已就绪的 execute（需实际故障场景验证）
4. **重启恢复**：compact 后新会话自动恢复未完成任务（需实际 compact 重启验证）
5. **拆分决策机械化**：split-multi-mechanism 建议在 ≤1 次重试后被路由到正确的处理路径（而非 8 次）
6. **嵌套审计质量**：3-4 视角审计的误报率 ≤ 单 agent 审计（需实际对比验证）
7. **总吞吐**：同等任务量下 wall-clock 时间 ≤ Exp5 的 40%

---

## 9. Loop 的新角色：跨会话行为稳定层

**Loop 不退役。** 它降级为稳定层，不再作为主驱动机制。

### 9.1 Loop 的新职责

| 职责 | 触发时机 | 机制 |
|------|----------|------|
| **队列恢复** | 会话启动 | 读取 `state.json`，重建未完成任务状态 |
| **合约验证** | 会话启动 | 运行 C₁-C₉ 合约检查（与 Exp5 相同） |
| **Halt 哨兵检查** | 会话启动 + 任务边界 | 读取 `.halt`，存在 → 暂停新任务分发 |
| **队列空闲检测** | 队列变空时 | 触发 select-preflight 注入新任务 |
| **健康检查** | 每 N 分钟 | QC-T1 liveness probe |
| **Dashboard 一致性** | 每个任务 Land 后 | 写入 dashboard.md（保持 Exp5 兼容） |
| **Routine 调度** | 队列空闲时 | 运行 run-routines（与 Exp5 相同） |
| **指令消费** | 队列空闲时 | 运行 drain-directives（与 Exp5 相同） |

### 9.2 Loop 不再做的事

| 原 Exp5 职责 | Exp6 中的替代 |
|-------------|-------------|
| 固定阶段序列（drain→select→prepare→execute→gate→land） | 队列事件驱动 |
| 全局 barrier 等待 | 每任务独立状态机 |
| Batch 组成和并发决策 | pipeline-router.ts（机械化） |
| 失败任务的散文式重试决策 | dispatch-router.ts（机械化） |
| Worktree 清理 | 启动健康检查自动运行 |

### 9.3 OUTER-LOOP.md 的保留价值

OUTER-LOOP.md 仍然作为**行为规范文档**保留，定义：

- **合约**（C₁-C₉）：会话启动时的文件存在性检查
- **不变量**（I₁-I₁₆）：所有 queue-dispatcher 操作必须遵守的约束
- **状态机语义**：drain/select/prepare/execute/gate/land 之间的合法转换
- **Halt 条件**：halt_human 和 halt_self 的语义
- **人类交互面**：/quay-directive、.halt、checkpoint review

这些是 Exp6 的 queue-dispatcher 必须遵守的行为规范——queue-dispatcher 是 OUTER-LOOP 的一个**符合规范的实现**，而非其替代品。

---

## 10. 风险

| 风险 | 缓解 |
|------|------|
| Git 冲突（多个 Land 同时 merge） | Land 阶段始终串行（git 资源互斥），通过 Land lock 保护 |
| LLM 资源争抢（过多 prepare 并发） | llm 槽位上限（默认 4），超出排队 |
| 状态文件损坏 | append-only event log 可重建完整状态 |
| 队列饥饿（高优先级任务不断插队） | 老化提升（age-based priority boost） |
| 与现有 OUTER-LOOP 的过渡期混乱 | 双轨运行 N 个周期，Exp6 的 Land 仍写入 dashboard.md 保持兼容 |
| 嵌套审计深度失控 | 审计子 agent prompt 明确指令 "do NOT spawn subagents"；depth 上限硬编码 |
| cross-compact 恢复不完整 | state.json + history.jsonl 双重记录；session-restore.ts 交叉验证 git log |
