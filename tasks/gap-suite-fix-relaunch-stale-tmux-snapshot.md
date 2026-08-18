---
id: gap-suite-fix-relaunch-stale-tmux-snapshot
title: suite-fix 重跑（execute-suite-fix.js）走 launch 不生成 tmux-leak before-run 快照——陈旧快照（25h）使 tmux-leak-scan 报「无快照」RED，directory-lock 第 4 轮 suite 实证
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（inner 报 + outer 独立核实，2026-08-18 02:0xZ）**：`gap-directory-level-tasks-touch-global-lock` fan-in 第 4 轮 suite RED，失败项 `tmux-leak-scan: FAIL — no before-run snapshot at <worktree>/.quay/tmux-leak…`。**独立核实**：worktree 的 `.quay/tmux-leak-scan.snapshot` 是 **Aug 17 01:13 陈旧快照（~25h）**——不是缺失，是**没被重跑更新**。

**根因（机制，非 flake）**：suite-fix 重跑走 `execute-suite-fix.js` 的 relaunch 路径，该路径**不经过标准 SUITE_LAUNCH 的 before-run 快照生成步骤**——首次 fan-in 的 SUITE_LAUNCH 会生成快照，但 suite-fix 的 relaunch（round 3/4）用的是另一条启动脚本，跳过了快照生成 ⇒ tmux-leak-scan 在 suite 收尾时用陈旧快照做 delta ⇒ 报「无 before-run 快照」（fail-closed）⇒ RED。

**与 directory-lock 的关系**：非 directory-lock 回归（其 Touches = slot-refill.ts + touches-one-path，与 tmux-leak/快照零交集）。是**suite-fix 重跑机制的缺陷**——任何需要 suite-fix 迭代的任务在重跑轮都会撞它。

**影响**：suite 红后 suite-fix 重跑 ≥1 轮即可能撞「无 before-run 快照」RED（fail-closed）⇒ 任务 land 被 launch 机制缺陷挡（今晚 directory-lock 已烧 4 轮，r4 即此因）。与「suite 不并行」「ff 判据」同属 fan-in 收敛性机制族。

**能取假（⊢ 对照）**：修复后，一次 suite-fix 重跑（relaunch）在 suite 开始前生成**新鲜** tmux-leak before-run 快照（或复用标准 SUITE_LAUNCH 的启动路径）——tmux-leak-scan 不再报「无快照」；重复 suite-fix 迭代不再因陈旧快照 RED。

## Plan

1. 读 `execute-suite-fix.js` 的 relaunch 路径（round 3/4 用的启动脚本）与标准 `SUITE_LAUNCH`（fan-in-execute.js）——确认 relaunch 缺 before-run 快照生成。
2. 修法（二选一）：
   - ① **relaunch 复用标准 SUITE_LAUNCH 路径**（含 tmux-leak before-run 快照生成）——消除两条启动路径的漂移；
   - ② **relaunch 启动前显式生成快照**（独立调用 tmux-leak-scan 的 before-run 步骤）。
   倾向 ①（单一路径，避免再出现「两条启动路径行为不一致」）。
3. 确认 suite 收尾的 tmux-leak-scan 用新鲜快照做 delta。
4. 对照实测：一次 suite-fix 重跑 → 新鲜快照 → 不再「无快照」RED。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: suite-fix 重跑（relaunch）在 suite 开始前生成新鲜 tmux-leak before-run 快照（或复用标准 SUITE_LAUNCH 启动路径）。
- [ ] AC2: suite 收尾 tmux-leak-scan 用新鲜快照做 delta，不再报「no before-run snapshot」RED。
- [ ] AC3: 首次 fan-in 与 suite-fix 重跑行为一致（单一路径，不漂移）。
- [ ] AC4: 对照实测：一次 suite-fix 重跑（≥1 轮迭代）→ 无陈旧快照 RED。
- [ ] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] suite-fix 重跑生成新鲜 before-run 快照（单一路径），tmux-leak 不再因陈旧快照 RED，重复迭代可收敛，scoped + 全量绿。

## Touches

- plugin/workflows/execute-suite-fix.js（relaunch 路径复用标准 SUITE_LAUNCH 或补 before-run 快照生成；双拷贝）
- .claude/workflows/execute-suite-fix.js（同 dual-copy 的 landed 副本，与 plugin/workflows 逐字节一致）
- plugin/scripts/tmux-leak-scan（若需独立 before-run 调用面）
- plugin/test/（relaunch 快照生成测试 + tmux-leak-scan 回归）
- tasks/gap-suite-fix-relaunch-stale-tmux-snapshot.md（自身）
