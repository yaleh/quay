---
id: gap-wiring-A-fan-in-execute-suite-poller-impl-complete
title: 接线任务 A（根因①+③）：死工作流 execute-suite-fix.js 清接线 + suite-poller/firstDelay 撤线
  + impl-complete 无生产调用者
status: ready
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 4 路并行接线审计（72 条去重 done 任务，64 WIRED / 8 NOT-WIRED）。本任务合并根因①+③，Touches 与任务 B、C 零交集（manager 按 Touches 交集算过）。

**根因① 死工作流 execute-suite-fix.js（2 条未接线）**：
- `gap-suite-fix-relaunch-stale-tmux-snapshot`
- `gap-suite-fix-workflow-no-load-sensitive-branch`
- 已核实：该文件全库仅测试引用（checker-mutation-case / sync.sh 复制 / dual-copy-drift-check 维护），**零生产调用者**；真实 suite-fix 路径是 `fan-in-execute.js` 的内联 prompt。
- 先例：`gap-fix-scope-gate-wired-to-wrong-path`（08-18 21:47Z）正是把闸从死路径挪进 fan-in-execute.js 内联 prompt，同形修法照搬。

**根因③ fan-in/dispatch 机制（2 条）**：
- `gap-fan-in-execute-poll-cost-firstdelay-agenttype`：`agentType:'suite-poller'` 落地同批即被 `7b917cd1` 撤销，`.claude/agents/suite-poller.md` 现为零消费者孤儿；`firstDelayMs` 曾真接入 `6d531530`，被架构重写 `d1338f95` 整段删除。任务 done 未随变动重核。
- `gap-impl-complete-event-written-by-fan-in-not-build`：**无生产调用者**。给 fast-mode-telemetry.ts --impl-complete 加自动解析 runId，但全库非测试唯一实际调用者仍为 fan-in 第 4.4 步，与修复前一样；无 dispatch brief 要求 Build 调。落地后 3/3 真实样本时序仍是「suite-green 前几十秒才写」——正是该任务本要修的问题。**连带**：gap-inflight-states-missing-impl-complete-event（本身 WIRED）的字段语义被上游污染——"impl 完成"实为"suite 完成"。

**⛔ 本任务 Touches 边界**：`plugin/workflows/fan-in-execute.js` + `.claude/workflows/fan-in-execute.js` + `plugin/workflows/execute-suite-fix.js`(+`.claude/` 镜像) + `plugin/scripts/fast-mode-telemetry.ts` + `.claude/agents/suite-poller.md` + dispatch brief 文档。**⛔ 不列 slot-refill.ts**（impl-complete 任务体核实过无需调整，列了会与任务 C 冲突）。

## Plan

1. **execute-suite-fix.js 处置**：确认死工作流（零生产调用者已核实），把两条任务（stale-tmux-snapshot + no-load-sensitive-branch）的修复语义并入 fan-in-execute.js 内联 prompt（照 gap-fix-scope-gate-wired-to-wrong-path 先例）。
2. **suite-poller/firstDelay 处置**：确认 `7b917cd1` 撤销 agentType 与 `d1338f95` 删 firstDelay——决定是恢复接线还是显式标记任务体"后续撤销，重新评估"（不能 done 状态不重核）。
3. **impl-complete 处置**：核实无生产调用者（已核），决定：①让 Build 阶段真的调 --impl-complete，或②显式把字段语义改成"suite 完成"并让上游消费方知情（gap-inflight-states 字段污染）。**⛔ 不得让"impl 完成"实为"suite 完成"继续污染语义。**
4. **suite-poller.md 处置**：零消费者孤儿——删除或恢复接线二选一，不留孤儿。
5. **通用接线判据**（manager 强调）：每个改动都有读生产载体的 AC（载体中满足 X 的记录数 ≥ N，N 只计实现落地后窗口）。

## Acceptance Criteria

- [x] AC1: execute-suite-fix.js 两条任务的修复语义已并入 fan-in-execute.js 内联 prompt（照 gap-fix-scope-gate-wired-to-wrong-path 先例），死工作流不再承载未接线修复。
- [x] AC2: suite-poller.md 不再零消费者（恢复接线或删除孤儿，二选一不留孤儿）；firstDelayMs/agentType 处置有明确结论（恢复或显式重核）。
- [ ] AC3: impl-complete 语义修正——字段不再"impl 完成"实为"suite 完成"污染；gap-inflight-states 消费方知情并适配；生产载体验证（落地后记录中字段语义正确）。（待外部）
- [x] AC4: 每个改动有读生产载体的 AC（载体中满足 X 的记录数 ≥ N，N 只计落地后窗口）。
- [ ] AC5: 全量 suite 绿。（待外部）

## Definition of Done

- [ ] 4 项根因处置完成 + 生产载体验证（AC4）+ 全量 suite 绿；无死工作流/孤儿文件残留。commit sha: 884b219b（待外部）

## Touches

- plugin/workflows/fan-in-execute.js（内联 prompt 并入：SUITE_LAUNCH tmux 快照 + step 4.4 诚实报告）
- .claude/workflows/fan-in-execute.js（双拷贝同步，与 plugin/workflows 逐字节一致）
- plugin/workflows/execute-suite-fix.js（死工作流处置：标 SUPERSEDED，双拷贝）
- .claude/workflows/execute-suite-fix.js（同上，双拷贝一致）
- plugin/scripts/fast-mode-telemetry.ts（impl-complete 语义——本轮核实机制已完整，无需改码）
- .claude/agents/suite-poller.md（孤儿处置：删除）
- plugin/loop/fast-mode-loop-tick.md（派发 brief：Build 完成时写 impl-complete）
- docs/analysis/fast-mode-loop-tick.md（派发 brief 活副本，同一句同步）
- plugin/test/fan-in-execute-paths.test.mjs（必要测试：suite-poller 孤儿删除 + step 4.4 诚实报告）
- tasks/gap-wiring-A-fan-in-execute-suite-poller-impl-complete.md（自身）

## Evidence（impl 实跑，scoped 门 + 直接测试）

**处置① execute-suite-fix.js（死工作流，根因①）**：
- 零生产调用者核实：全库非测试引用仅 `plugin/sync.sh`（dual-copy 铺出）/ `workflows-dual-copy-drift-check` / `quay-init.sh`（交付）/ 测试。真实 suite-fix 路径 = fan-in-execute.js 内联 prompt。
- 两条任务修复语义并入 fan-in-execute.js：① no-load-sensitive-branch → FIX_SCOPE_GATE 常量（本已存在，:200-275 注释点明 gap-suite-fix-workflow-no-load-sensitive-branch）；② stale-tmux-snapshot → SUITE_LAUNCH 块新增显式 `bash ${worktree}/plugin/scripts/tmux-leak-scan.sh --snapshot ${worktree} || true`（launch/relaunch 前落新鲜 before-run 快照，fail-open；生产 suite-fix 的 relaunch 复用本 SUITE_LAUNCH ⇒ 修复语义活在生产路径）。
- 死工作流处置：**标 SUPERSEDED**（升级原 DEAD 头注，列出两条语义的活路径指针）。**未删除**——删除会破坏非 Touches 依赖（sync.sh 的 cp、workflows-dual-copy-drift-check 的成对校验、quay-init.sh 交付、plugin-packaging.test.mjs 断言其 shipped）；保留但明确「不再是任何修复的承载路径」。

**处置② suite-poller/firstDelay（根因③）**：
- 核实：`7b917cd1` revert agentType suite-poller（.claude/agents 新目录 watcher 不加载、fan-in bootstrap 当场 crash）；`d1338f95` 重写删 firstDelayMs（去短命轮询 agent，改阶段 2 单 agent 循环 <600s Bash 等 suite）。
- 结论：**firstDelayMs 与 agentType 均被架构重写 SUPERSEDE**——新设计零轮询 agent，firstDelayMs 无挂载点；阶段 2 agent 承担机械步骤（入账/flip/ff/bracket），套 Bash-only 的 suite-poller 会砍掉其必需工具 ⇒ 恢复接线架构上不成立。
- 处置：**删除 `.claude/agents/suite-poller.md` 孤儿**（不留零消费者孤儿）。旧任务 `gap-fan-in-execute-poll-cost-firstdelay-agenttype`（done 未随变动重核）需要重核——AC1/AC2 均已不反映现实（AC1 firstDelayMs 被删、AC2 自标「暂缓」后 agentType 永远不落地），交由外层按 wiring 审计重核。

**处置③ impl-complete（根因③）**：
- 核实：`fast-mode-telemetry.ts --impl-complete` 的自动解析 runId 机制完整（省略 --runId 时从开括号解析、无开括号 fail-closed、hasImplCompleteEvent 幂等）；全库非测试唯一调用者 = fan-in step 4.4（suite-green 后）⇒「impl 完成」实为「suite 完成」的字段污染成立。
- 决定：**选项①——让 Build 阶段真的调 --impl-complete**（派发 brief 接线）。`plugin/loop/fast-mode-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md` 的派发词约定新增：Build 完成（提交后）调用 `fast-mode-telemetry.ts --impl-complete --taskId <id> --root <root>`（--runId 省略自动解析）。fast-mode-telemetry.ts 机制已完整，无需改码（核实）。
- 语义诚实：fan-in step 4.4 幂等回退块改为**报告写入路径**——`IMPL-COMPLETE=build-wrote`（Build 已写，正常）/ `IMPL-COMPLETE=backstop-wrote`（Build 漏写，⚠️ 事件在 suite-green 时刻写入的异常路径，字段语义退化为「suite 完成」）/ `IMPL-COMPLETE=unknown`。异常路径不再无声。
- 消费方：gap-inflight-states / slot-refill 的 `implementing` 段（start 无 impl-complete）读法不变——Build 完成即写 impl-complete ⇒ 排队待 fan-in 任务自动移出 implementing、释放 Build 槽（gap-impl-complete-event-written-by-fan-in-not-build 已核实 slot-refill 无需调整）。

**通用接线判据（AC4）——每改动的生产载体验证方法（N 只计落地后窗口）**：
- 处置①（SUITE_LAUNCH 快照 + SUPERSEDED）：全量 suite 绿（AC5）+ 后续真实 fan-in 的 suite 日志无「no before-run snapshot」RED（计数载体 = /tmp/fan-in-suite-*.log 的 tmux-leak-scan 行）；死工作流零生产调用者（grep 载体 = 代码库本身，审计已核实）。
- 处置②（suite-poller 删除）：`.claude/agents/suite-poller.md` 不存在 + fan-in-execute.js 无 `agentType: 'suite-poller'`（结构载体）；旧任务重核由外层跟进。
- 处置③（dispatch brief + step 4.4 诚实）：**落地后真实派发样本**的 runId 事件文件（`.workflow-events/*.jsonl`）中，`eventKind: impl-complete` 的 recordedAtMs 应早于对应任务 suite-green 时刻（per-task-suite-record / verification-round 的 suite_exit 时刻）——「impl-complete 先于 suite-green 写」的样本数 ≥ 1 即证字段语义恢复（AC3 生产载体验证，待落地后窗口）。

**测试证据（真实输出）**：
- `node --test plugin/test/fan-in-execute-paths.test.mjs` → 87/87 pass（含 ⑩c suite-poller 孤儿删除新断言 + ⑨ impl-complete step 4.4 诚实报告回归 + fix-scope 组）。
- `node --test fast-mode-telemetry.test.mjs execute-suite-fix-relaunch-snapshot.test.mjs execute-suite-fix-scope-gate.test.mjs workflows-dual-copy-drift-check.test.mjs` → 100/100 pass（telemetry 85 + 其余）。
- `bash scripts/test.sh --for-task gap-wiring-A-fan-in-execute-suite-poller-impl-complete --allow-thin` → scoped 门绿：task-contract / malformed-task / touches-one-entry-one-path / concurrency-literal / suite-slot-ssot / landing-target / workflows-dual-copy-drift 全 PASS；所选测试 85/85 pass。
