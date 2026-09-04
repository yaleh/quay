---
id: gap-outer-bg-job-migration-proposal
title: 提案：Outer 迁移到 Claude Code Background Job Session 以消除 tmux 依赖
status: ready
role: compound
labels:
  - migration
  - architecture
  - outer-loop
  - tmux-elimination
created: 2026-09-03T02:30Z
---

## Proposal

本提案分析逐步退役 outer（当前基于 tmux 的外层循环），通过迁移到 Claude Code background job session 完全消除项目对 tmux 的依赖。

**背景：**
- 人于 2026-08-12 要求减少 tmux 依赖（SendMessage 代替 tmux 投递）
- OUTER-LOOP.md 于 2026-08-03 标记 RETIRED（ADR-022），但人 2026-09-01 裁定暂不退役
- 当前三层仍存在 tmux 交互点：`quay-0:outer` 和 `quay-0:inner` 窗口

**目标：**
1. 将 outer 迁移到后台 job session（与 manager 同模式）
2. 消除所有 tmux 依赖（除控制面 `/clear` 等命令外）
3. 提高系统可靠性和可观测性

**人 2026-09-03 裁定**（详见下方 Resolved Decisions 段，全文已据此更新）：
频率保持原 outer cadence；`/quay-directive` 退役（SendMessage+task 代替）；outer 单次运行
一次性完整跑完再提交；outer 不需要独立 CronCreate 锚；**不保留 VT 机制**；**不保留
"milestone"这个编排颗粒度**（第二次追加裁定，回应并解决 Open Question #2）；**原则上，
一切依赖 VT 的机制都取消**（第三次追加裁定，见下方 §依赖 VT 的机制清单——过去 7 天核查
确认全部零真实输出）；**`waiting-for-human` 状态取消**（同批第三次裁定，状态机定稿两态）。

**⚠️ 架构定性变化（milestone 去掉后）**：原提案（含更早版本）假设 outer job = "选一个
milestone → 编排它的执行（build/audit/land）→ 等完成"。**milestone 去掉后，outer 不再编排
执行**——执行已完全是两层 fast-mode 的职责（`gap-*` 任务由 manager/inner 派发到 worktree，
走既有的 fan-in 流程）。Outer job 收窄为纯粹的**发现/立案**层：drain directives → 跑发现
逻辑（扫描代码/架构/测试覆盖缺口，§4.4 "systematic-explore channels" 的机械部分）→
用 `task_write` 立案若干 `gap-*` 任务 → 退出。**不再有"选一个来跑、等它跑完"这种跨越
数小时的编排语义**——下方状态机、伪代码、Phase 划分已按此重写；但"outer 具体该跑什么发现
逻辑"本身未经人确认，标注为新的 Open Question。

**⚠️ VT 机制核查结果（2026-09-03，直接量而非文档自述——硬规则 4b）**：VT 的唯一状态载体
`dashboard.md` 最后一次真实修改是 **2026-08-02**（距今 32 天）；`milestone_counter`
定格于 206（2026-07-31 写入后无新记录）；`checkpoints/` 目录最新文件是 cp-95
（2026-08-11），与 counter=206 之间约 111 个 milestone 的 checkpoint 完全缺失；`quay-0`
tmux 会话内**没有独立的 outer 窗口**存在。最近 3 天涉及 `experiments/quay-perpetual-stream/`
的全部 3 个提交均与 VT/milestone 机制无关（是两层 fast-mode 任务顺带同步的技术文件）。
**结论：VT 机制在生产意义上已停摆 32 天以上，事实已被两层 fast-mode 取代**——不是"运行但
产出慢"，而是唯一状态载体完全没有新记录。**人 2026-09-03 裁定：迁移不保留 VT，本提案下方
所有 VT 相关设计已移除**；outer job 的核心职能收窄为「drain directives → 发现/立案 gap-*
任务候选」，不再维护数值化价值追踪、也不再编排 milestone 执行（见下一段）。发现/立案的
判据是**未解决的开放问题**，见下方 Open Questions。

---

## Challenges

### 1. 会话生命周期管理
- 当前 outer 通过 tmux 窗口持久存在
- 背景 job 完成即退出，无持久上下文
- CronCreate 锚有 7 天硬过期（CLAUDE.md A19）
- **风险：** tmpfs 清理 → 锚消失 → CronList 空 → 循环死

### 2. 状态持久化
- Outer 需要维护的状态：运行中/空闲标志、决策历史（**不含 VT**、**不含 milestone** —
  人 2026-09-03 两次裁定移除；VT 已核实停摆 32 天，milestone 编排颗粒度合并入两层 fast-mode
  的 `gap-*` 任务）
- 背景 job 无会话级内存，需显式序列化到磁盘
- 需定义清晰的状态机：`idle → running → idle`（人 2026-09-03 第三次裁定：`waiting-for-human`
  第三态取消，定案为纯两态；发现逻辑若产生需要人判断的候选，走**立案任务**这个既有出口，
  不需要 outer job 自身挂起等待）

### 3. 跨层协调
- 当前：manager 定期读 outer 的文件产物，通过 tmux 投递行动
- 迁移后：outer job 从 `.quay/outer-state.json` 启动，完成后写回状态 + git commits
- 需明确定义 outer ↔ manager 的消息合约

### 4. 可观测性
- 当前：`capture-pane` 看实时输出，`meta-cc` 查历史
- 迁移后：无实时观测，全依赖 transcript + 文件产物
- 需建立清晰的故障信号（exit code / `.halt` 写入）

---

## Recommended Approach: Async Outer Job Loop

### Architecture

```
┌─────────────────────────────────────────┐
│  Outer Job Loop (Background Job)        │
├─────────────────────────────────────────┤
│  Input:  .quay/outer-state.json         │
│  Process: drain directives → discovery  │
│           → file gap-* task candidates  │
│  Output: new tasks/*.md + state + exit   │
└─────────────────────────────────────────┘
                  ↓
        (git commits to develop)
                  ↓
┌─────────────────────────────────────────┐
│  Manager Tick Loop (Background Job)     │
├─────────────────────────────────────────┤
│  Read: outer-state.json                 │
│  Dispatch: inner jobs if needed         │
│  Record: tick-log                        │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Inner / Fast-Mode Loop (Background Job)│
├─────────────────────────────────────────┤
│  Receive: task dispatch from manager    │
│  Execute: worktree-isolated tasks       │
│  Report: results via git commits        │
└─────────────────────────────────────────┘
```

### Key Properties

1. **Independent cycles**: 三层各自周期（outer: manager 每 tick ~20min 检查一次是否 idle → 派发, manager: ~17-20 分钟, inner: 连续）
2. **Explicit state**: 所有长期状态序列化到 git + `.quay/outer-state.json`
3. **Clear contracts**: outer 输出 = **新的 `tasks/gap-*.md` 候选**（不再是"milestone 完成
   通知"）；manager/inner 用既有的两层 fast-mode 派发机制去执行这些任务——outer 不再是
   manager 的执行编排上游，只是它的**任务候选来源之一**（与人工立案、其它 gap 发现渠道并列）
4. **Failure signals**: exit code + transcript 完整，调试信息可溯源
5. **No independent CronCreate anchor for outer**（人 2026-09-03 裁定）: outer job 完全被动，由 manager 按其自身 tick 节奏派发；manager 现有的 A19 锚续期逻辑天然覆盖整条链路，outer 不需要重复实现
6. **No execution orchestration**（milestone 移除后新增，人 2026-09-03 第二次裁定）: outer
   不再编排 build/audit/land 这类执行步骤——那是两层 fast-mode 已有能力的重复。Outer job
   的产出终点是"合规的 `gap-*` 任务落盘"，不是"该任务被执行完成"

---

## Implementation Path (4 Phases)

### Phase 0: Define Outer State Machine (前置)

**Deliverable:** `orchestration/outer-state-machine.md`

**人 2026-09-03 两次裁定简化**：① milestone 一次性完整运行再提交；② milestone 编排颗粒度
整体移除。二者叠加后，状态机比原设计更薄——不再有"in-flight 横跨数小时等待 build/audit/
land"这种语义（那已是两层 fast-mode 的职责），outer job 单次运行是"drain directives → 跑
发现逻辑 → 立案若干 gap-* 任务 → 退出"，预期耗时数量级是分钟而非小时：

```typescript
type OuterState = {
  version: "1.0";
  jobStatus: 'idle' | 'running';  // 定案两态（人 2026-09-03 第三次裁定，取消
                                    // 'waiting-for-human'）——需要人判断的候选走既有的
                                    // 立案出口，outer job 自身不挂起等待
  currentRun?: {
    startedAt: timestamp;
  };  // 只在 running 时有值；job 失败 = 未提交，状态直接回落 idle（无残留部分产物需清理）
  lastCompletedAt: timestamp;
  lastAction?: {
    type: string;        // 例如 'filed-tasks' / 'no-op' / 'drained-directive'
    filedTaskIds?: string[];  // 本次运行立案的 gap-* 任务 id 列表（可空）
    reason: string;
    timestamp: timestamp;
  };
  errorLog?: string[];
};
```

**⚠️ 不含 `vt` 字段**（人 2026-09-03 裁定）：VT 已核实停摆 32 天,详见 Resolved Decision #3。
**⚠️ 不含 `currentMilestone`/milestone 相关字段**（人 2026-09-03 第二次裁定）：outer 不再
编排"一个 milestone 的执行"，`currentRun` 只是"本次发现/立案动作是否在跑"的标志，其内容
远比原 milestone 状态薄——不携带候选选择结果、不携带执行进度。

Persist to: `.quay/outer-state.json` (git-ignored, ephemeral)

**AC:**
- [ ] State schema typed and documented
- [ ] State schema review + manager/outer-preview sign-off
- [ ] Backward-compatibility plan (upgrade from no-state → versioned state)
- [ ] 状态机文档需注明：无 `vt` 字段是设计决策（人 2026-09-03 裁定，VT 已核实停摆 32 天），
      不是遗漏——避免下一个读者以为忘了加
- [ ] 状态机文档需注明：无 milestone 相关字段是设计决策（人 2026-09-03 第二次裁定，编排
      颗粒度已合并入两层 fast-mode 的 gap 任务），不是遗漏
- [ ] 状态机文档需注明：两态（无 `waiting-for-human`）是人 2026-09-03 第三次裁定的
      明确取消，不是遗漏

### Phase 1: Outer Background Job Executor (Core)

**Deliverable:** `.claude/workflows/outer-job-executor.js`

Key functions（**milestone 编排移除后大幅变薄**——不再有 select/prepare/dispatch/land 这一整条
执行链，outer job 的产出终点是"立案任务"，不是"任务被执行完成"）：
```javascript
async function executeOuterJob(config) {
  // 0. Guard: refuse to start if already running (manager should not double-dispatch,
  //    but the job itself fails closed as a second line of defense)
  const state = loadOuterState() || initOuterState();
  if (state.jobStatus === 'running') { exit(2); }

  state.jobStatus = 'running';
  state.currentRun = { startedAt: now() };
  saveOuterState(state);  // mark running BEFORE work, so a crashed job is visible to the
                           // watchdog (Phase 3) rather than silently vanishing

  // 1. Drain pending directives (label:directive tasks) — replaces /quay-directive skill;
  //    human writes/edits the task directly via task_write, or SendMessage → manager relays
  const directives = drainDirectiveTasks();

  // 2. Run discovery logic — SCOPE UNDEFINED, see Open Questions #1: what does outer actually
  //    scan for? (candidates: it0-style systematic gap checks, architecture drift, coverage
  //    gaps, directive-driven exploration — none of this is decided by this proposal)
  const findings = await runDiscovery(directives, config);

  // 3. File new gap-* tasks for each finding that clears the filing bar (see Open Questions #2:
  //    filing judgment/threshold — replaces both VT's Δv̂ hypothesis AND milestone selection)
  const filedTaskIds = findings
    .filter((f) => shouldFile(f))   // judgment TBD — see Open Questions
    .map((f) => fileTaskFor(f));    // task_write, same as any manual filing

  // 4. Update state — no VT bookkeeping, no milestone bookkeeping (both removed per 人裁定)
  state.jobStatus = 'idle';
  state.currentRun = undefined;
  state.lastCompletedAt = now();
  state.lastAction = {
    type: filedTaskIds.length > 0 ? 'filed-tasks' : 'no-op',
    filedTaskIds,
    reason: summarize(findings, directives),
    timestamp: now(),
  };

  // 5. Write state back
  saveOuterState(state);

  // 6. Exit with signal
  exit(0);  // discovery/filing failures are logged in errorLog, not a hard reject —
            // TBD whether any failure mode here warrants exit 1/2 (Open Questions #3)
}
```

**AC:**
- [ ] Job executor can start, run one discovery cycle, and exit cleanly
- [ ] State correctly persisted to `.quay/outer-state.json`
- [ ] Exit code semantics defined (see Open Questions #3 — currently undecided whether
      discovery/filing failures should differ from success in exit code)
- [ ] Job transcript complete and queryable
- [ ] Test: dry-run in read-only mode (discovery runs, no `task_write` calls actually made)
- [ ] `drainDirectiveTasks()` reads `label:directive` tasks and consumes them before discovery
- [ ] Running guard: job refuses to start a second run while one is already running
- [ ] `runDiscovery()`/`shouldFile()` 的判据必须先由人裁定（VT 与 milestone 选择判据均已
      移除,不能沿用两者的旧逻辑）——**Phase 1 不得在没有替代判据的情况下臆造一个新逻辑**；
      实施前必须先解决 Open Questions 里的"outer 该扫描什么"与"立案门槛"两项

### Phase 2: Manager Integration (Dispatch Outer Jobs)

**Deliverable:** Manager tick 新增行动 + state 观测

**人 2026-09-03 裁定**：outer job 频率 = 保持原 outer 频率（`routine-scheduler.ts:17` 记录的经典
架构节奏是 `inner tick 1200-1800s / outer cron */20`）。**这是检查/决策的轮询频率**——milestone
去掉后，这也是单次 outer job（发现+立案）的预期耗时数量级参考上限（分钟级，不再是数小时级）。
迁移后不需要 outer 自己的 cron：manager 现有的 ~20 分钟节奏（`13,33,53 * * * *`）天然覆盖这个
检查点。

Modify `manager-tick-core.md`:
- Add new step: "Read outer-state.json and check if idle"
- If idle: dispatch outer job via Workflow（**不再需要"ready-milestone-exists"这个前置判断**——
  milestone 去掉后，outer job 本身就是"检查一次该不该发现/立案新任务"，触发条件比原来更简单）
- If running: skip (unexpected if discovery is fast; see Phase 3 watchdog for the "stuck" case)
- If outer job fails / stuck: write to `.halt` and alert (see Phase 3 watchdog)

```javascript
// Inside manager tick — runs every ~20min, same cadence as the classic outer cron
if (outerState.jobStatus === 'idle') {
  await Workflow({
    scriptPath: '.claude/workflows/outer-job-executor.js',
    args: { config }
  });
} else if (outerState.jobStatus === 'running') {
  // milestone 去掉后这应是罕见态（discovery 预期分钟级完成）——若持续出现，是 Phase 3
  // watchdog 该报的信号，不是稳态
  logTick('outer still running (unexpected if discovery is fast)', outerState.currentRun);
}
```

**AC:**
- [ ] Manager reads and validates `outer-state.json` each tick
- [ ] Manager correctly identifies idle → running transition
- [ ] Manager correctly SKIPS dispatch when already running (no double-dispatch)
- [ ] Dispatch decision logged in tick-log
- [ ] Failed outer job triggers `.halt` write
- [ ] Manager can observe outer state via `.quay/outer-state.json` (not tmux)

### Phase 3: Safety Nets and Monitoring

**Deliverables:**
1. `plugin/scripts/outer-state-consistency-check.sh` — validates state JSON + git consistency
2. `plugin/scripts/outer-job-watchdog.sh` — detects stuck job。**milestone 去掉后阈值需要
   重新校准**：原设计的"4h"是按 milestone 编排（build/audit/land 数小时）估的，**已不适用**——
   若 outer job 只做 drain+discovery+file（预期分钟级），watchdog 的合理超时应显著更短（具体
   数字未定，需实测第一批真实 discovery 运行耗时后再定，不得凭空写一个数字，硬规则 4 推论）。
   watchdog 唯一能查的直接量是**`running` 持续时长**（`now - currentRun.startedAt`）+
   **关联进程是否仍活着**（同 CLAUDE.md 硬规则 4b：不用 outer 自己的心跳，用外部可核的量）。
   超阈值 → 强制把状态改写为 `idle`（并标记 `lastAction.type = 'watchdog-forced-recovery'`）+
   写 `.halt` 供人核查，而不是无限期挂起
3. `plugin/scripts/outer-transcript-check.sh` — verifies failure logs are complete

Add to `manager-tick-core.md` (new section in A: checks):
- A11: Call outer-state-consistency-check
- A12: Call outer-job-watchdog

**AC:**
- [ ] Consistency check catches malformed state
- [ ] Watchdog detects and signals hung job (running 超时 + 关联进程是否仍活着的组合判据，
      不是单一心跳；超时阈值需先实测第一批真实 discovery 运行耗时后再定，不得凭空写死)
- [ ] Watchdog 的强制恢复本身留痕（`lastAction.type` 可查，不静默清空 running）
- [ ] Transcript check confirms error logs saved
- [ ] All three checks run in manager tick, results recorded

### Phase 4: Migration from tmux

**Steps:**
1. Remove `quay-0:outer` window from setup/launcher scripts
2. Remove `session-liveness.sh` references to outer window
3. Update `outer-session-check.sh` to read outer state from disk, not tmux
4. **Retire `/quay-directive`**（人 2026-09-03 裁定）：
   - `OUTER-LOOP.md:379` 显示该 skill 从来只是一层薄包装——`/quay-directive → label:directive task
     → drained at step 0`。既然现在有 `task_write`（MCP，直接创建/编辑任务）+ `SendMessage`
     （原生跨会话投递），这层包装可以退役
   - 迁移后的人工干预路径：人直接用 `task_write` 创建/编辑 `label:directive` 任务，或
     `SendMessage` 给 manager（manager 下一 tick 转成 directive task）
   - Outer job Step 1（`drainDirectiveTasks()`，见 Phase 1）保持"仅在每次运行开头吸收一次"
     的既有语义不变——退役的只是**吸收入口**，不是**吸收时机**（milestone 边界这个概念
     本身也随 milestone 一起去掉了；现在的边界就是"每次 outer job 运行"）
   - 标记 `plugin/skills/quay-directive` 为 deprecated（或物理移除，视 skill 依赖面而定）
5. **评估 `experiments/quay-perpetual-stream/` 目录里 milestone 编排专用的产物**
   （人 2026-09-03 第二次裁定新增）：`OUTER-LOOP.md` 的 SELECT/prepare/dispatch/land 章节、
   `milestones/`、`checkpoints/` 目录均是 milestone 编排颗粒度的产物，现已不再是迁移目标——
   评估归档或标注"已停用"（同 VT 遗留产物的处理，见风险矩阵），不在本提案 DoD 强制删除
6. Update documentation (ADR, CLAUDE.md, runbooks)

**AC:**
- [ ] No tmux dependencies remain (except for `/clear` control path)
- [ ] `outer-session-check.sh` operates on state files, not tmux sockets
- [ ] `/quay-directive` skill marked deprecated or removed; docs point to `task_write` directly
- [ ] Documentation updated to reflect background-job model（含 milestone 编排颗粒度已移除
      的说明，不只是 tmux → background job 这一层变化）
- [ ] No behavioral regressions **on the parts that ARE kept**（drain-directive 语义、
      fan-in 派发路径）——milestone 完成通知/build-audit-land 编排已按设计移除，不在
      回归范围内

---

## Resolved Decisions（人 2026-09-03 裁定，供实施参考——不再是开放问题）

1. **Outer job frequency = 保持原 outer 频率**。经典架构记录在 `routine-scheduler.ts:17`：
   `inner tick 1200-1800s / outer cron */20`。这是**检查/决策的轮询频率**。迁移后不需要
   outer 独立 cron——manager 现有 ~20 分钟 tick 节奏（`13,33,53 * * * *`）每次检查
   `outer-state.json.jobStatus`，`idle` 才派发。（milestone 移除后，这个频率也约等于单次
   outer job 预期耗时的参考上限——见决策 6）

2. **`/quay-directive` 应退役**，用 `SendMessage` + `task_write` 机制代替。`OUTER-LOOP.md:379`
   显示该 skill 本来就只是"生成一个 `label:directive` 任务"的包装。退役的是**入口层**（skill 本身），
   **不是**"人工指令必须以 task 形式表达、只在每次运行开头被吸收"这个底层语义——那个继续保留，
   由 outer job Step 1 的 `drainDirectiveTasks()` 承接。见 Phase 1 / Phase 4 的实施细节。

3. **VT 机制不迁移，彻底移除**（2026-09-03 裁定，推翻本提案更早版本"VT batch-friendly 可保留"
   的分析）。核查（`git log` + 文件系统直接量，非文档自述）显示：`dashboard.md`（VT 唯一状态
   载体）已 32 天无更新（末次 2026-08-02）；`milestone_counter` 定格 206（末次写入 2026-07-31）；
   `checkpoints/` 目录最新 cp-95，与 counter=206 之间 ~111 个 milestone 的 checkpoint 完全
   缺失；`quay-0` tmux 会话内无独立 outer 窗口存在；最近 3 天涉及
   `experiments/quay-perpetual-stream/` 的全部提交均与 VT/milestone 机制无关。**结论：VT 在
   生产意义上已停摆 32 天以上，事实已被两层 fast-mode 取代**——迁移不复活它。Phase 0 状态机
   不含 `vt` 字段，Phase 1 job executor 不做 `Δv`/斜率/chart transition 相关任何计算。
   §4.1/§6.2 的 VT 定义作为历史背景保留在 References，仅供理解原 outer 设计意图，不作为
   迁移目标。

4. **Outer 单次运行应一次性完整跑完再提交**（无中途检查点）。job 失败 = 未提交、状态直接
   回落 `idle`，不留残余产物需要清理。与 inner 层"worktree 隔离 + 失败即弃"的既有惯例一致。
   （原表述"milestone 应一次性完整运行"随决策 6 的 milestone 移除而改写为此更一般的说法）

5. **Outer 不需要自己的 CronCreate 锚，因此不受 7 天硬过期影响**。因为 outer job 完全被动，
   由 manager 按其自身节奏派发（决策 1），manager 现有 A19 锚续期逻辑天然覆盖整条链路——
   不需要重复实现。**风险矩阵中原「CronCreate 7 天过期」条目已删除**（见下方风险表）。

6. **"Milestone"作为 outer 的编排颗粒度彻底移除**（2026-09-03 第二次追加裁定，解决原
   Open Question #2）。VT 移除后，milestone 唯一剩下的作用是"一批工作的执行编排单位
   （build/audit/land）"，而这与两层 fast-mode 已有的 `gap-*` 任务派发/fan-in 机制职能
   重复。**Outer 的核心职能进一步收窄**为：drain directives → 跑发现逻辑 → 立案 `gap-*`
   任务候选 → 退出——不再编排任何任务的执行,执行完全交给两层 fast-mode 的既有路径。
   Phase 0-4 的状态机、伪代码、AC 已按此重写（`currentMilestone` → `currentRun`，
   `jobStatus` 从三态简化为两态，`runMilestoneCycle`/`selectMilestone` 被
   `runDiscovery`/`shouldFile` 取代）。**"outer 具体该扫描什么、立案门槛是什么"未经人
   确认**，见下方 Open Questions #1/#2（新增，取代原 VT-only 的 Open Questions #1）。

7. **原则上，一切依赖 VT 的机制都取消**（2026-09-03 第三次追加裁定）。逐一核实（按位置
   判定,非关键词匹配）出 15 个纯 VT/milestone-only 脚本（`outward-vt-check.ts`、
   `rolling-slope-check.ts`、`termination-delta-v-check.ts`、`chart-headroom.ts`、
   `chart2-s1/s2/s3-*.ts`、`deliverable-governor.ts`、`governance-product-ratio-check.ts`、
   `explore-exploit-cadence.ts`、`milestones-since-transition.ts`、
   `experiments/.../it0-dod-check.ts`、`experiments/.../concurrent-batch-scheduler.ts`
   milestone-only 原版、`serial-fanin-absorb.ts`、`golden-replay-dir044.ts`），全部纳入
   停用范围——过去 7 天（2026-08-27~09-03）git 提交历史核实全部为 0（除一次与 VT 执行无关
   的技术性维护）。**同时核实排除了 5 个因名称/历史渊源被最初 grep 命中、但已独立于 VT
   服务两层 fast-mode 的脚本**（`concurrent-batch-scheduler.ts`/`it0-split-or-commit-
   check.ts`/`vmeta-lag-check.ts` 的 `plugin/scripts/` 独立副本、`loadbearing-test-gate.ts`、
   `workflow-baseline-metrics.ts`）——它们继续保留，不受本次裁定影响。**完整清单、每个
   脚本的调用点核实、过去 7 天证据表格，见新建的独立文档**
   `experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md`（同时是 VT 机制的
   完整历史归档 + 给未来可能新建的探索机制的设计参考）。

8. **`waiting-for-human` 状态取消**（2026-09-03 第三次追加裁定，同批）。Outer job 状态机
   定案为纯 `idle`/`running` 两态（不再是"待人裁定的开放问题"）。需要人判断的候选走既有的
   "立案任务"出口，不由 outer job 自身挂起等待——这与决策 6 的"outer 不编排执行"是同一个
   简化方向的延伸。

---

## Open Questions（VT + milestone 双重移除后新产生，需人裁定，Phase 1 实施前必须解决）

**上一版的 Open Question #2（"outer 是否还需要 milestone 颗粒度"）已由本次裁定直接解决
（移除）——不再列出。以下是移除后新产生的、更根本的问题：**

1. **`runDiscovery()` 该扫描什么？** Outer 的核心价值主张（§4.4 "systematic-explore
   channels"）此前部分靠 milestone 的 it0 诊断步骤承接；milestone 去掉后需要一个独立的
   发现逻辑。候选方向（供讨论，非提案——本提案不擅自替 outer 决定）：
   - 复用/移植 `experiments/quay-perpetual-stream/scripts/it0-*.ts` 里与 milestone 编排
     无关的纯诊断部分（ceiling/floor arithmetic、gate-hash/transclusion、domain-misfit audit
     等，§4.4 原文列举的 4 项系统性探索检查）
   - 直接调用 `archguard`（MCP，L_D/L_G 依赖结构/重复抽象分析）产出候选
   - 纯粹只做 drain directives（人指哪打哪），不做任何自主发现——outer 退化为"人工指令
     的执行入口"，这也是一个合法但需要明确承认的选项

2. **`shouldFile()` 的立案门槛是什么？** 取代了 VT 的 `Δv̂` 假设与 milestone 选择判据，
   现在的问题变成"一次 discovery 找到 N 个候选,该立案几个、依据什么阈值"。这直接关系到
   与两层 fast-mode 现有立案节奏（人工/其它 gap 发现渠道）的资源竞争——若无节制,outer
   自主发现可能持续制造任务淹没现有 backlog（参考硬规则 12 的"净增 32 条条件"实证）。

~~3. `waiting-for-human` 第三态是否需要~~ —— **已由人 2026-09-03 第三次裁定解决：取消**。
   需要人判断的候选走既有的"立案任务，交由人/两层 fast-mode 后续处理"这个出口，不由
   outer job 自身挂起等待。

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Outer decision logic lost in migration | High | Keep OUTER-LOOP.md as reference; unit-test state transitions |
| State serialization race conditions | Low | 无 partial 态可写坏；仍用原子写（write-temp + rename）防止 idle↔running 翻转过程中的半写 |
| Job crashes mid-run, `running` never clears | Medium | Phase 3 watchdog 检测 `running` 超过合理时长（无进度）→ 强制回落 `idle` + 记录到 `.halt`；见 Phase 3 |
| Outer still needs tmux for some edge case | Low | Keep old scripts in "archive" for fallback; surface as tech debt |
| Manager double-dispatches while outer running | Low（已在 Phase 1/2 用 running guard 双重防护） | Job 自身拒绝在 `running` 时重复启动（Phase 1 Step 0）+ manager 侧 `jobStatus==='idle'` 才派发（Phase 2） |
| `/quay-directive` 退役后遗留引用（skill/文档/心智模型） | Low | Phase 4 grep 全仓 `quay-directive` 引用，逐一改指 `task_write`；标 deprecated 不物理删（保留过渡期） |
| `runDiscovery()`/`shouldFile()` 无判据，实施被迫臆造一个未经验证的替代逻辑 | **High** | Phase 1 AC 已明确阻塞：判据必须先由人裁定，不得在提案里凭空发明（见 Open Questions #1/#2） |
| Outer 自主发现无节制，持续制造任务淹没现有 backlog | **Medium（新增，milestone 移除后特有）** | `shouldFile()` 门槛需考虑与现有立案节奏的资源竞争（见 Open Questions #2）；不在本提案自行设阈值 |
| `dashboard.md`/`checkpoints/`/`milestones/` 等 VT+milestone 遗留产物无人处理，长期占据仓库空间且误导后来者 | Low | Phase 4 增补：评估是否归档/删除这些遗留目录，或至少在其顶部加"已停用"横幅（不在本提案 DoD 强制，留作后续小任务） |

**已移除的风险**（人 2026-09-03 两次裁定使其不再适用）：
- ~~7-day CronCreate expiry kills loop~~ — outer 不持有独立锚（决策 5）
- ~~mid-cycle checkpoint complexity~~ — 单次运行原子性裁定（决策 4）消除了这类状态
- ~~VT calibration/serialization complexity~~ — VT 机制整体移除（决策 3）
- ~~Milestone build/audit/land 编排复杂度~~ — milestone 编排颗粒度整体移除（决策 6，
  第二次追加裁定）——outer 不再编排执行，这类风险随编排职能一起消失

---

## Success Criteria

- ✅ Outer runs as background job (no tmux window needed)
- ✅ State survives across job cycles (persisted correctly)
- ✅ Manager correctly dispatches and observes outer
- ✅ Failures are explicit (exit code + `.halt` + transcript)
- ✅ No behavioral regression on the parts that ARE kept (drain-directive semantics, task filing
  path, fan-in dispatch of filed tasks) — **VT and milestone execution orchestration explicitly
  excluded from equivalence scope** (both removed by design, see Resolved Decisions #3 and #6)
- ✅ Zero tmux dependencies (except control path)
- ✅ Documented and tested (runbooks updated, tests added)

---

## Definition of Done

- [ ] Open Questions #1（`runDiscovery()` 扫描范围）与 #2（`shouldFile()` 立案门槛）已由
      人裁定，且落地为实际实现——**这是 Phase 1 的硬前置，不满足则 Phase 1 不得开工**
- [x] `waiting-for-human` 第三态：已由人 2026-09-03 第三次裁定取消,状态机定稿为两态
- [ ] All 4 phases complete + merged to develop
- [ ] No known tmux dependencies for outer loop
- [ ] Outer job successfully completed at least one full discovery-and-file cycle
- [ ] Manager correctly observed and dispatched outer in production
- [ ] Runbooks and ADRs updated
- [ ] Test coverage ≥ 80% for new state machine logic
- [ ] Team sign-off on behavioral equivalence（scope 已明确排除 VT 与 milestone 编排，
      见 Success Criteria）
- [ ] State schema/代码/文档中不残留任何 `vt`/`Δv`/`chart` 字段或注释（grep 自查）
- [ ] State schema/代码/文档中不残留任何 `currentMilestone`/`selectMilestone`/
      `runMilestoneCycle` 字段或函数名（grep 自查，milestone 编排颗粒度已移除）

---

## Touches

- `experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md` — **new file, already
  landed as part of this proposal's investigation**（VT 机制归档 + 依赖清单 + 停摆证据 +
  未来探索机制设计参考）
- `.claude/workflows/outer-job-executor.js` — new file
- `.quay/outer-state.json` — new ephemeral state file (git-ignored)
- `plugin/scripts/outer-*-check.sh` — new safety-net scripts
- `orchestration/outer-state-machine.md` — new state schema doc
- `orchestration/manager-tick-core.md` — integration + monitoring additions
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — refactor for background mode; SELECT/
  prepare/dispatch/land 章节随 milestone 编排移除而整体删除或标记历史
- `experiments/quay-perpetual-stream/{dashboard.md,checkpoints/,milestones/}` — 评估归档/
  停用横幅（Phase 4 Step 5，不在 DoD 强制范围）
- **A 类 15 个纯 VT/milestone-only 脚本**（完整清单见
  `VT-MECHANISM-RETROSPECTIVE.md` §2.1）— 评估归档/停用横幅，同 Phase 4 Step 5
- `plugin/test/outer-*.test.mjs` — new unit tests
- `adr/ADR-*.md` — new ADR documenting the change（含 VT + milestone 双重移除的说明）

---

## References

- **`experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md`**（新建,本次调查产物）：
  VT 机制完整历史归档 + 依赖 VT 的机制完整清单（A 类停用/B 类保留的核实分类）+ 过去 7 天
  停摆证据表格 + 给未来探索机制的设计参考。**Resolved Decision #7 的详细依据在此文档，
  不在本提案重复**。
- **CLAUDE.md**: A19 (CronCreate lifecycle), C10 (SendMessage defaults)
- **manager-tick-core.md**: Architecture + state observation patterns
- **OUTER-LOOP.md**: Current (retired) outer driver logic；`:379` human_steer 语义；`:314-317` halt 语义
- **routine-scheduler.ts:17**: 经典架构的 outer cadence 记录（`outer cron */20`）
- **docs/proposals/quay-perpetual-stream-experiment-v5.md**: §4.1 VT 定义, §6.2 VT value scale
  —— **历史背景 only，非迁移目标**（VT 已于 2026-09-03 裁定不迁移，见 Resolved Decision #3）
- **VT 停摆核查证据（2026-09-03，直接量）**：`git log -1 -- experiments/quay-perpetual-stream/
  dashboard.md`（末次 2026-08-02）；`git log -1 -S "milestone_counter: 206" -- .../dashboard.md`
  （末次写入 2026-07-31）；`ls experiments/quay-perpetual-stream/checkpoints/`（最新 cp-95）；
  `tmux list-windows -t quay-0`（无 outer 窗口）；`git log --since="2026-08-31" -- experiments/
  quay-perpetual-stream/`（3 个提交，均与 VT 无关）
- **proposals/claude-p-streaming-2026-08-04.md**: Background context on tmux elimination goal
- **PROPOSAL-liveness-by-purpose-2026-08-12.md**: Liveness detection refactoring
