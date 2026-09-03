---
id: gap-outer-bg-job-migration-proposal
title: 提案：Outer 迁移到 Claude Code Background Job Session 以消除 tmux 依赖
status: todo
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

---

## Challenges

### 1. 会话生命周期管理
- 当前 outer 通过 tmux 窗口持久存在
- 背景 job 完成即退出，无持久上下文
- CronCreate 锚有 7 天硬过期（CLAUDE.md A19）
- **风险：** tmpfs 清理 → 锚消失 → CronList 空 → 循环死

### 2. 状态持久化
- Outer 当前维护的隐含状态：当前 milestone、候选队列、VT 指标、决策历史
- 背景 job 无会话级内存，需显式序列化到磁盘
- 需定义清晰的状态机：`INIT → RUNNING → IDLE → HALTED / ERROR`

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

1. **Independent cycles**: 三层各自周期（outer: ~N 分钟, manager: ~17 分钟, inner: 连续）
2. **Explicit state**: 所有长期状态序列化到 git + `.quay/outer-state.json`
3. **Clear contracts**: outer 输出 = manager 输入，manager 输出 = inner 输入
4. **Failure signals**: exit code + transcript 完整，调试信息可溯源

---

## Implementation Path (4 Phases)

### Phase 0: Define Outer State Machine (前置)

**Deliverable:** `orchestration/outer-state-machine.md`

Define state schema:
```typescript
type OuterState = {
  version: "1.0";
  phase: 'INIT' | 'RUNNING' | 'HALTED' | 'ERROR';
  currentMilestone?: string;
  nextCandidates: string[];  // milestone IDs
  vt: {
    score: number;
    slope: number;
    lastUpdated: timestamp;
  };
  lastJobAt: timestamp;
  jobStatus: 'idle' | 'in-flight' | 'waiting-for-human';
  lastAction?: {
    type: string;
    reason: string;
    timestamp: timestamp;
  };
  errorLog?: string[];
};
```

Persist to: `.quay/outer-state.json` (git-ignored, ephemeral)

**AC:**
- [ ] State schema typed and documented
- [ ] State schema review + manager/outer-preview sign-off
- [ ] Backward-compatibility plan (upgrade from no-state → versioned state)

### Phase 1: Outer Background Job Executor (Core)

**Deliverable:** `.claude/workflows/outer-job-executor.js`

Key functions:
```javascript
async function executeOuterJob(config) {
  // 1. Load prior state
  const state = loadOuterState() || initOuterState();
  
  // 2. Read candidates (from backlog.md + task list)
  const candidates = readCandidates();
  
  // 3. Select next milestone
  const selected = selectMilestone(candidates, state.vt);
  
  // 4. Run milestone cycle
  const result = await runMilestoneCycle(selected);
  
  // 5. Update state
  state.currentMilestone = selected.id;
  state.jobStatus = result.outcome; // idle | waiting-for-human | error
  state.lastJobAt = now();
  
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

### Phase 2: Manager Integration (Dispatch Outer Jobs)

**Deliverable:** Manager tick 新增行动 + state 观测

Modify `manager-tick-core.md`:
- Add new step: "Read outer-state.json and check if idle"
- If idle and ready-milestone-exists: dispatch outer job via Workflow
- If outer job fails: write to `.halt` and alert

```javascript
// Inside manager tick
if (shouldDispatchOuterJob(outerState)) {
  await Workflow({
    scriptPath: '.claude/workflows/outer-job-executor.js',
    args: { config }
  });
}
```

**AC:**
- [ ] Manager reads and validates `outer-state.json` each tick
- [ ] Manager correctly identifies idle → in-flight transition
- [ ] Dispatch decision logged in tick-log
- [ ] Failed outer job triggers `.halt` write
- [ ] Manager can observe outer state via `.quay/outer-state.json` (not tmux)

### Phase 3: Safety Nets and Monitoring

**Deliverables:**
1. `plugin/scripts/outer-state-consistency-check.sh` — validates state JSON + git consistency
2. `plugin/scripts/outer-job-watchdog.sh` — detects stuck job (no progress > 4h)
3. `plugin/scripts/outer-transcript-check.sh` — verifies failure logs are complete

Add to `manager-tick-core.md` (new section in A: checks):
- A11: Call outer-state-consistency-check
- A12: Call outer-job-watchdog

**AC:**
- [ ] Consistency check catches malformed state
- [ ] Watchdog detects and signals hung job
- [ ] Transcript check confirms error logs saved
- [ ] All three checks run in manager tick, results recorded

### Phase 4: Migration from tmux

**Steps:**
1. Remove `quay-0:outer` window from setup/launcher scripts
2. Remove `session-liveness.sh` references to outer window
3. Update `outer-session-check.sh` to read outer state from disk, not tmux
4. Update documentation (ADR, CLAUDE.md, runbooks)

**AC:**
- [ ] No tmux dependencies remain (except for `/clear` control path)
- [ ] `outer-session-check.sh` operates on state files, not tmux sockets
- [ ] Documentation updated to reflect background-job model
- [ ] No behavioral regressions (outer still produces same milestones, commits, state)

---

## Open Questions

1. **Outer job frequency**: How often should we dispatch outer jobs?
   - Current: unclear from OUTER-LOOP.md (once per milestone?)
   - Proposal: manager checks every N ticks (e.g., every 10 ticks = ~170 min)

2. **Human steering via /quay-directive**: How to ensure directives are absorbed timely?
   - Current: outer reads at next cycle
   - Risk: job might not run for hours after directive written
   - Mitigation: outer job checks for pending directives at start

3. **VT calculation**: Is it real-time sensitive or batch-friendly?
   - If real-time: might conflict with background-job model
   - If batch-friendly: can compute once per job cycle

4. **Milestone atomicity**: Can a job complete a full milestone before exiting?
   - If yes: simpler (each job = one clear output)
   - If no: needs mid-cycle checkpoints (more complex state)

5. **CronCreate 7-day expiry**: How do we prevent lockout?
   - Manager already handles this (A19 logic)
   - Outer job should inherit the same "anchor renewal" pattern
   - Document this as a shared risk (both outer + manager vulnerable)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Outer decision logic lost in migration | High | Keep OUTER-LOOP.md as reference; unit-test state transitions |
| State serialization race conditions | Medium | Use atomic writes (write-temp + rename); git ensures consistency |
| Job failure leaves system in invalid state | Medium | Write `.halt` + maintain transaction log in transcript |
| 7-day CronCreate expiry kills loop | High | Implement anchor renewal logic (same as manager); document in runbook |
| Outer still needs tmux for some edge case | Low | Keep old scripts in "archive" for fallback; surface as tech debt |
| Manager-outer cycle timing conflicts | Medium | Set outer dispatch interval >> outer job duration to avoid queue buildup |

---

## Success Criteria

- ✅ Outer runs as background job (no tmux window needed)
- ✅ State survives across job cycles (persisted correctly)
- ✅ Manager correctly dispatches and observes outer
- ✅ Failures are explicit (exit code + `.halt` + transcript)
- ✅ No behavioral regression (same milestones, commits, VT as before)
- ✅ Zero tmux dependencies (except control path)
- ✅ Documented and tested (runbooks updated, tests added)

---

## Definition of Done

- [ ] All 4 phases complete + merged to develop
- [ ] No known tmux dependencies for outer loop
- [ ] Outer job successfully completed at least one full milestone cycle
- [ ] Manager correctly observed and dispatched outer in production
- [ ] Runbooks and ADRs updated
- [ ] Test coverage ≥ 80% for new state machine logic
- [ ] Team sign-off on behavioral equivalence

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
- **OUTER-LOOP.md**: Current (retired) outer driver logic
- **proposals/claude-p-streaming-2026-08-04.md**: Background context on tmux elimination goal
- **PROPOSAL-liveness-by-purpose-2026-08-12.md**: Liveness detection refactoring
