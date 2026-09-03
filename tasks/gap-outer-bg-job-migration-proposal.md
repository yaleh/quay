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

**人 2026-09-03 五项裁定**（详见下方 Resolved Decisions 段，全文已据此更新）：
频率保持原 outer cadence；`/quay-directive` 退役（SendMessage+task 代替）；milestone 一次性
完整运行再提交；outer 不需要独立 CronCreate 锚；**不保留 VT 机制**。

**⚠️ VT 机制核查结果（2026-09-03，直接量而非文档自述——硬规则 4b）**：VT 的唯一状态载体
`dashboard.md` 最后一次真实修改是 **2026-08-02**（距今 32 天）；`milestone_counter`
定格于 206（2026-07-31 写入后无新记录）；`checkpoints/` 目录最新文件是 cp-95
（2026-08-11），与 counter=206 之间约 111 个 milestone 的 checkpoint 完全缺失；`quay-0`
tmux 会话内**没有独立的 outer 窗口**存在。最近 3 天涉及 `experiments/quay-perpetual-stream/`
的全部 3 个提交均与 VT/milestone 机制无关（是两层 fast-mode 任务顺带同步的技术文件）。
**结论：VT 机制在生产意义上已停摆 32 天以上，事实已被两层 fast-mode 取代**——不是"运行但
产出慢"，而是唯一状态载体完全没有新记录。**人 2026-09-03 裁定：迁移不保留 VT，本提案下方
所有 VT 相关设计已移除**；outer job 的核心职能收窄为「drain directives → 选择/生成候选
→ dispatch」，不再维护数值化价值追踪。milestone 选择的新判据（不再是 VT 斜率）是一个
**未解决的开放问题**，见下方 Open Questions。

---

## Challenges

### 1. 会话生命周期管理
- 当前 outer 通过 tmux 窗口持久存在
- 背景 job 完成即退出，无持久上下文
- CronCreate 锚有 7 天硬过期（CLAUDE.md A19）
- **风险：** tmpfs 清理 → 锚消失 → CronList 空 → 循环死

### 2. 状态持久化
- Outer 需要维护的状态：当前 milestone、候选队列、决策历史（**不含 VT** — 人 2026-09-03
  裁定不迁移；该机制已核实停摆 32 天，事实已被两层 fast-mode 取代）
- 背景 job 无会话级内存，需显式序列化到磁盘
- 需定义清晰的状态机：`idle → in-flight → idle/waiting-for-human`（简化版，见 Phase 0）

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
│  Process: milestone cycle                │
│  Output: commits + state update + exit   │
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
3. **Clear contracts**: outer 输出 = manager 输入，manager 输出 = inner 输入
4. **Failure signals**: exit code + transcript 完整，调试信息可溯源
5. **No independent CronCreate anchor for outer**（人 2026-09-03 裁定）: outer job 完全被动，由 manager 按其自身 tick 节奏派发；manager 现有的 A19 锚续期逻辑天然覆盖整条链路，outer 不需要重复实现

---

## Implementation Path (4 Phases)

### Phase 0: Define Outer State Machine (前置)

**Deliverable:** `orchestration/outer-state-machine.md`

**人 2026-09-03 裁定简化**：milestone 一次性完整运行再提交（Open Question #4 已解决）——
不需要 mid-milestone 检查点/恢复逻辑，状态机只有三态，无"partial"态：

```typescript
type OuterState = {
  version: "1.0";
  jobStatus: 'idle' | 'in-flight' | 'waiting-for-human';  // 三态，无 partial
  currentMilestone?: {
    id: string;
    startedAt: timestamp;
  };  // 只在 in-flight 时有值；job 失败 = 未提交，状态直接回落 idle（无残留部分产物需清理）
  lastCompletedAt: timestamp;
  lastAction?: {
    type: string;
    reason: string;
    timestamp: timestamp;
  };
  errorLog?: string[];
};
```

**⚠️ 不含 `vt` 字段**（人 2026-09-03 裁定）：原设计曾有 `vt: {score, slope, chart}`，
用于承接 §4.1/§6.2 定义的数值化价值追踪。2026-09-03 核查（`git log` + 文件系统直接量）
发现 VT 的唯一状态载体 `dashboard.md` 已 32 天无更新、`checkpoints/` 断层 111 个
milestone、outer tmux 窗口不存在——机制事实上已停摆，不是"运行但产出慢"。**迁移不复活
这套追踪**；outer job 不再承诺/measure `Δv`、不再算斜率、不再做 chart transition。

Persist to: `.quay/outer-state.json` (git-ignored, ephemeral)

**AC:**
- [ ] State schema typed and documented
- [ ] State schema review + manager/outer-preview sign-off
- [ ] Backward-compatibility plan (upgrade from no-state → versioned state)
- [ ] 状态机文档需注明：无 partial/mid-milestone 态是设计决策（人 2026-09-03 裁定），不是遗漏
- [ ] 状态机文档需注明：无 `vt` 字段是设计决策（人 2026-09-03 裁定，VT 已核实停摆 32 天），
      不是遗漏——避免下一个读者以为忘了加

### Phase 1: Outer Background Job Executor (Core)

**Deliverable:** `.claude/workflows/outer-job-executor.js`

Key functions（**Step 1 新增 drain directives**——`/quay-directive` 退役后，人工指令直接落在
`label:directive` 任务上，outer job 启动时读取，语义与原 `OUTER-LOOP.md:379`
`human_steer() → drained at step 0; never mid-milestone` 完全一致）：
```javascript
async function executeOuterJob(config) {
  // 0. Guard: refuse to start if already in-flight (manager should not double-dispatch,
  //    but the job itself fails closed as a second line of defense)
  const state = loadOuterState() || initOuterState();
  if (state.jobStatus === 'in-flight') { exit(2); }

  // 1. Drain pending directives (label:directive tasks) — replaces /quay-directive skill;
  //    human writes/edits the task directly via task_write, or SendMessage → manager relays
  const directives = drainDirectiveTasks();  // never mid-milestone; only at this boundary

  // 2. Read candidates (from backlog.md + task list — selection judgment TBD, see Open Questions:
  //    VT no longer drives this; a replacement judgment must be decided before Phase 1 lands)
  const candidates = readCandidates();

  // 3. Select next milestone (directives take precedence when present; NO vt input — removed)
  const selected = selectMilestone(candidates, directives);

  state.jobStatus = 'in-flight';
  state.currentMilestone = { id: selected.id, startedAt: now() };
  saveOuterState(state);  // mark in-flight BEFORE the long-running cycle, so a crashed job is
                           // visible to the watchdog (Phase 3) rather than silently vanishing

  // 4. Run the FULL milestone cycle to completion — no mid-cycle checkpoint (atomicity, 人裁定)
  const result = await runMilestoneCycle(selected);

  // 5. Update state — job either fully lands or falls back to idle; no partial state persists
  //    (no VT bookkeeping — removed per 人 2026-09-03 裁定)
  state.jobStatus = result.success ? 'idle' : (result.needsHuman ? 'waiting-for-human' : 'idle');
  state.currentMilestone = undefined;
  state.lastCompletedAt = now();
  state.lastAction = { type: selected.id, reason: result.summary, timestamp: now() };

  // 6. Write state back
  saveOuterState(state);

  // 7. Exit with signal
  exit(result.success ? 0 : 1);
}
```

**AC:**
- [ ] Job executor can start, run one milestone, and exit cleanly
- [ ] State correctly persisted to `.quay/outer-state.json`
- [ ] Exit code reflects outcome (0=success, 1=recoverable error, 2=critical error)
- [ ] Job transcript complete and queryable
- [ ] Test: dry-run on a known-safe milestone (read-only mode)
- [ ] `drainDirectiveTasks()` reads `label:directive` tasks and consumes them before milestone selection
- [ ] In-flight guard: job refuses to start a second milestone while one is already in-flight
- [ ] `selectMilestone()` 的判据必须先由人裁定（VT 已移除，不能沿用原斜率判据）——**Phase 1
      不得在没有替代判据的情况下臆造一个新数值公式**；实施前必须先解决 Open Questions 里的
      "milestone 选择新判据"这一项

### Phase 2: Manager Integration (Dispatch Outer Jobs)

**Deliverable:** Manager tick 新增行动 + state 观测

**人 2026-09-03 裁定**：outer job 频率 = 保持原 outer 频率（`routine-scheduler.ts:17` 记录的经典
架构节奏是 `inner tick 1200-1800s / outer cron */20`）。**这是检查/决策的轮询频率，不是单个
milestone 的耗时**——一个 milestone 本身可能持续数小时。迁移后不需要 outer 自己的 cron
（Open Question #5 已解决）：manager 现有的 ~20 分钟节奏（`13,33,53 * * * *`）天然覆盖这个检查点。

Modify `manager-tick-core.md`:
- Add new step: "Read outer-state.json and check if idle"
- If idle and ready-milestone-exists: dispatch outer job via Workflow
- If in-flight: skip (do not double-dispatch — a milestone may span many manager ticks)
- If outer job fails / stuck: write to `.halt` and alert (see Phase 3 watchdog)

```javascript
// Inside manager tick — runs every ~20min, same cadence as the classic outer cron
if (outerState.jobStatus === 'idle' && hasReadyMilestoneOrDirective()) {
  await Workflow({
    scriptPath: '.claude/workflows/outer-job-executor.js',
    args: { config }
  });
} else if (outerState.jobStatus === 'in-flight') {
  // expected steady state while a milestone runs — log and skip, not an error
  logTick('outer in-flight, skipping dispatch', outerState.currentMilestone);
}
```

**AC:**
- [ ] Manager reads and validates `outer-state.json` each tick
- [ ] Manager correctly identifies idle → in-flight transition
- [ ] Manager correctly SKIPS dispatch when already in-flight (no double-dispatch)
- [ ] Dispatch decision logged in tick-log
- [ ] Failed outer job triggers `.halt` write
- [ ] Manager can observe outer state via `.quay/outer-state.json` (not tmux)

### Phase 3: Safety Nets and Monitoring

**Deliverables:**
1. `plugin/scripts/outer-state-consistency-check.sh` — validates state JSON + git consistency
2. `plugin/scripts/outer-job-watchdog.sh` — detects stuck job (no progress > 4h)。
   **因决策 4（milestone 原子性）而更关键**：由于失败=状态整体回落 `idle`（无中间进度可读），
   watchdog 唯一能查的直接量是**`in-flight` 持续时长**（`now - currentMilestone.startedAt`）+
   **该 milestone 对应 worktree/进程是否仍活着**（同 CLAUDE.md 硬规则 4b：不用 outer 自己的
   心跳，用外部可核的量——worktree mtime / 关联进程存在性）。超阈值 → 强制把状态改写为
   `idle`（并标记 `lastAction.type = 'watchdog-forced-recovery'`）+ 写 `.halt` 供人核查，
   而不是无限期挂起
3. `plugin/scripts/outer-transcript-check.sh` — verifies failure logs are complete

Add to `manager-tick-core.md` (new section in A: checks):
- A11: Call outer-state-consistency-check
- A12: Call outer-job-watchdog

**AC:**
- [ ] Consistency check catches malformed state
- [ ] Watchdog detects and signals hung job (in-flight 超时 + 关联进程/worktree 已死的组合判据，
      不是单一心跳)
- [ ] Watchdog 的强制恢复本身留痕（`lastAction.type` 可查，不静默清空 in-flight）
- [ ] Transcript check confirms error logs saved
- [ ] All three checks run in manager tick, results recorded

### Phase 4: Migration from tmux

**Steps:**
1. Remove `quay-0:outer` window from setup/launcher scripts
2. Remove `session-liveness.sh` references to outer window
3. Update `outer-session-check.sh` to read outer state from disk, not tmux
4. **Retire `/quay-directive`**（人 2026-09-03 裁定，回应 Open Question #2）：
   - `OUTER-LOOP.md:379` 显示该 skill 从来只是一层薄包装——`/quay-directive → label:directive task
     → drained at step 0`。既然现在有 `task_write`（MCP，直接创建/编辑任务）+ `SendMessage`
     （原生跨会话投递），这层包装可以退役
   - 迁移后的人工干预路径：人直接用 `task_write` 创建/编辑 `label:directive` 任务，或
     `SendMessage` 给 manager（manager 下一 tick 转成 directive task）
   - Outer job Step 1（`drainDirectiveTasks()`，见 Phase 1）保持"仅在 milestone 边界吸收，
     never mid-milestone"的既有语义不变——退役的只是**吸收入口**，不是**吸收时机**
   - 标记 `plugin/skills/quay-directive` 为 deprecated（或物理移除，视 skill 依赖面而定）
5. Update documentation (ADR, CLAUDE.md, runbooks)

**AC:**
- [ ] No tmux dependencies remain (except for `/clear` control path)
- [ ] `outer-session-check.sh` operates on state files, not tmux sockets
- [ ] `/quay-directive` skill marked deprecated or removed; docs point to `task_write` directly
- [ ] Documentation updated to reflect background-job model
- [ ] No behavioral regressions (outer still produces same milestones, commits, state)

---

## Resolved Decisions（人 2026-09-03 裁定，供实施参考——不再是开放问题）

1. **Outer job frequency = 保持原 outer 频率**。经典架构记录在 `routine-scheduler.ts:17`：
   `inner tick 1200-1800s / outer cron */20`。这是**检查/决策的轮询频率**，不是单个 milestone
   的耗时。迁移后不需要 outer 独立 cron——manager 现有 ~20 分钟 tick 节奏（`13,33,53 * * * *`）
   每次检查 `outer-state.json.jobStatus`，`idle` 才派发，`in-flight` 则跳过（milestone 可能横跨
   多个 manager tick，这是预期稳态，非异常）。

2. **`/quay-directive` 应退役**，用 `SendMessage` + `task_write` 机制代替。`OUTER-LOOP.md:379`
   显示该 skill 本来就只是"生成一个 `label:directive` 任务"的包装。退役的是**入口层**（skill 本身），
   **不是**"人工指令必须以 task 形式表达、只在 milestone 边界被吸收"这个底层语义——那个继续保留，
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

4. **Milestone 应一次性完整运行再提交**（无 mid-milestone 检查点）。这大幅简化了状态机——
   Phase 0 的 `OuterState` 只需三态（`idle`/`in-flight`/`waiting-for-human`），无 `partial`
   态；job 失败 = milestone 未提交、状态直接回落 `idle`，不留残余产物需要清理。与 inner 层
   "worktree 隔离 + 失败即弃"的既有惯例一致。

5. **Outer 不需要自己的 CronCreate 锚，因此不受 7 天硬过期影响**。因为 outer job 完全被动，
   由 manager 按其自身节奏派发（决策 1），manager 现有 A19 锚续期逻辑天然覆盖整条链路——
   不需要重复实现。**风险矩阵中原「CronCreate 7 天过期」条目已删除**（见下方风险表）。

---

## Open Questions（VT 移除后新产生，需人裁定，Phase 1 实施前必须解决）

1. **Milestone/候选选择的新判据是什么？** VT 斜率曾是"该选哪个候选、该不该继续"的健康度
   信号；移除后 `selectMilestone()` 需要一个替代判据。候选方向（供讨论，非提案）：
   - 纯粹沿用 backlog.md 的人工优先级排序（不做自动价值评估）
   - 复用两层 fast-mode 已有的 `ready-pool-check`/candidate 排序机制（如果语义相容）
   - 简化为"只读 `label:milestone-candidate` 任务，按 staleness/依赖关系排序，不做数值打分"
   **本提案不擅自替 outer 决定这件事**——按硬规则 4 推论（成本结构未知前不设数值阈值），
   一个从未被验证的新判据不应该在这份提案里凭空发明。

2. **Outer 层是否还需要"milestone"这个颗粒度？** VT 存在时，"milestone"是价值追踪的计量
   单位（每个 milestone 承诺 `Δv̂`）。移除 VT 后，outer 的核心职能收窄为「drain directives →
   生成/挑选候选 → dispatch」，这与两层 fast-mode 的"gap 任务"颗粒度是否应该合并，还是保留
   "milestone = 一批 gap 任务的更高层分组"这个中间层，是一个尚未讨论的架构问题——本提案的
   Phase 1-4 假设"milestone"概念保留（仅去掉 VT 追踪），但这个假设本身未经人确认。

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Outer decision logic lost in migration | High | Keep OUTER-LOOP.md as reference; unit-test state transitions |
| State serialization race conditions | Low（原 Medium，因原子性裁定而降级） | 无 partial 态可写坏；仍用原子写（write-temp + rename）防止 idle↔in-flight 翻转过程中的半写 |
| Job crashes mid-milestone, `in-flight` never clears | Medium（新增，因裁定 4 引入） | Phase 3 watchdog 检测 `in-flight` 超过合理 milestone 时长（无进度）→ 强制回落 `idle` + 记录到 `.halt`；见 Phase 3 |
| Outer still needs tmux for some edge case | Low | Keep old scripts in "archive" for fallback; surface as tech debt |
| Manager double-dispatches while outer in-flight | Low（已在 Phase 1/2 用 in-flight guard 双重防护） | Job 自身拒绝在 `in-flight` 时重复启动（Phase 1 Step 0）+ manager 侧 `jobStatus==='idle'` 才派发（Phase 2） |
| `/quay-directive` 退役后遗留引用（skill/文档/心智模型） | Low | Phase 4 grep 全仓 `quay-directive` 引用，逐一改指 `task_write`；标 deprecated 不物理删（保留过渡期） |
| Milestone 选择无判据，实施被迫臆造一个未经验证的替代公式 | **High（新增）** | Phase 1 AC 已明确阻塞：`selectMilestone()` 判据必须先由人裁定，不得在提案里凭空发明（见 Open Questions #1） |
| `dashboard.md`/`checkpoints/`/`milestones/` 等 VT 遗留产物无人处理，长期占据仓库空间且误导后来者 | Low | Phase 4 增补：评估是否归档/删除这些遗留目录，或至少在其顶部加"已停用"横幅（不在本提案 DoD 强制，留作后续小任务） |

**已移除的风险**（人 2026-09-03 裁定使其不再适用）：
- ~~7-day CronCreate expiry kills loop~~ — outer 不持有独立锚（决策 5）
- ~~mid-cycle checkpoint complexity~~ — milestone 原子性裁定（决策 4）消除了这类状态
- ~~VT calibration/serialization complexity~~ — VT 机制整体移除（决策 3 已反转，2026-09-03 二次裁定）

---

## Success Criteria

- ✅ Outer runs as background job (no tmux window needed)
- ✅ State survives across job cycles (persisted correctly)
- ✅ Manager correctly dispatches and observes outer
- ✅ Failures are explicit (exit code + `.halt` + transcript)
- ✅ No behavioral regression on the parts that ARE kept (same milestone/candidate generation
  shape, same commits) — **VT explicitly excluded from equivalence scope** (removed by design,
  see Resolved Decision #3)
- ✅ Zero tmux dependencies (except control path)
- ✅ Documented and tested (runbooks updated, tests added)

---

## Definition of Done

- [ ] Open Questions #1（milestone 选择新判据）已由人裁定，且落地为 `selectMilestone()` 的
      实际实现——**这是 Phase 1 的硬前置，不满足则 Phase 1 不得开工**
- [ ] All 4 phases complete + merged to develop
- [ ] No known tmux dependencies for outer loop
- [ ] Outer job successfully completed at least one full milestone cycle
- [ ] Manager correctly observed and dispatched outer in production
- [ ] Runbooks and ADRs updated
- [ ] Test coverage ≥ 80% for new state machine logic
- [ ] Team sign-off on behavioral equivalence（scope 已明确排除 VT，见 Success Criteria）
- [ ] State schema/代码/文档中不残留任何 `vt`/`Δv`/`chart` 字段或注释（grep 自查）

---

## Touches

- `.claude/workflows/outer-job-executor.js` — new file
- `.quay/outer-state.json` — new ephemeral state file (git-ignored)
- `plugin/scripts/outer-*-check.sh` — new safety-net scripts
- `orchestration/outer-state-machine.md` — new state schema doc
- `orchestration/manager-tick-core.md` — integration + monitoring additions
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — refactor for background mode
- `plugin/test/outer-*.test.mjs` — new unit tests
- `adr/ADR-*.md` — new ADR documenting the change

---

## References

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
