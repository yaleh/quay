---
id: gap-cron-registry-global-path-migration
title: cron-registry 双层收据迁移到全局 per-layer 路径（人裁定方案②）——outer/inner 各写
  ~/.quay-global/<slug>/{outer,inner}/loop-registry.txt，退出 git，消除双写碰撞/bypass
  误红/add/add/陈旧快照
status: todo
labels:
  - gap
  - mechanism
parent: gap-cron-registry-shared-file-design-revisit
children: []
extra:
  schema: execution
  depends_on:
    - gap-cron-registry-shared-file-design-revisit
    - gap-direct-to-develop-exclude-cron-registry-receipt
---
**type:** execution

## Proposal

**人裁定（2026-08-17 08:2xZ，manager 转述原话）**：「遵循 manager 的实现，应用到 outer 和 inner。」⇒ 选**方案②（全局 per-layer 路径、不进 git）**。裁定与精确规格见设计复审任务 `gap-cron-registry-shared-file-design-revisit` 的「## 人裁定落盘」段（f7f3234f）。

**要迁移的对象**：`plugin/scripts/outer-cron-registry.json`（AC81 注册表收据，outer+inner 双层共享、git 跟踪）。今天的三个症状全部实发：两层冷启动 cron 重建直写同一收据 ⇒ bypass-check 误红（发生率 3：f9577da1/167b7052/f882ad76）；fan-in add/add 冲突；以及 manager 实测证实的**陈旧快照**（worktree fork 携带 fork 那刻的死 cronId——bootstrap/shell-concat 两层皆死值，JSON 合法但与「合格」同形，硬规则 3b）。共享文件功能价值=0（`checkVerify():295` 只读自己层，两层从不互读）。

**目标形态（照 manager 实现，必须按项目分片）**：
```
manager 先例:  QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
               HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"
               STORE="${STORE:-${HOME_DIR}/loop-registry.txt}"
本任务:        ~/.quay-global/<repo-root-slug>/outer/loop-registry.txt
               ~/.quay-global/<repo-root-slug>/inner/loop-registry.txt
分片算法（现成可抄，session-liveness.sh:1162）:  slug=$(printf '%s' "$root" | tr '/' '-')
```
**⛔ 必须按项目分片**：outer/inner 是按项目的（这台机器上 quay/archguard/meta-cc 各有 outer/inner），照抄 `~/.quay-global/outer/` 字面路径会跨项目互相覆盖（跨项目版双写碰撞）。具体命名归实现方定，但分片是硬约束。

**退出 git 后的审计线**：git 版唯一真实价值 = 收据变更留痕（锚重建审计线）。迁移后由 append-only jsonl（如 `~/.quay-global/<slug>/cron-registry-events.jsonl`，或复用 `.quay/*.jsonl` 形态）保留「cron 随进程消失 → 重建 → 新 id/verifiedAt」的审计行——不为审计线把当前值绑回 git。

**能取假（⊢ 对照）**：迁移完成后，在任一旧 worktree 里读注册表得到的是当前真值（非 fork 快照）；`git ls-files` 中不再有 `outer-cron-registry.json` 的写路径（文件可留作迁移桥或删）。

## Plan

1. 读设计复审任务 `gap-cron-registry-shared-file-design-revisit` 的人裁定落盘段（f7f3234f，含精确规格 + 分片约束 + 支撑事实）。
2. 枚举消费者（DoD 原文要求的迁移清单）：`outer-cron-registry.ts`（判据入口 `checkVerify()` 读层）、`outer-anchor-check.ts`、双层 tick 文档（`orchestration/orchestrator-loop-tick.md` / `orchestration/fast-mode-tick-core.md` 的注册表收据引用）、`plugin/loop/fast-mode-loop-tick.md` AC80-INNER-ANCHOR 段、测试 pin 集（`plugin/test/outer-cron-registry.test.mjs`）、`outer-tick-log-check`。
3. 实现：注册表读写切到全局 per-layer 路径（分片 slug）；各层写自己的 loop-registry.txt；`checkVerify()` 读取路径同步。
4. 审计线：新增 append-only 事件行（锚重建即追加）。
5. 消费面同步改读新路径；bypass-check 排除集（`gap-direct-to-develop-exclude-cron-registry-receipt` 加的 `outer-cron-registry.json` 排除项）可撤。
6. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: 注册表读写迁移到 `~/.quay-global/<slug>/{outer,inner}/loop-registry.txt`（分片 slug，多项目不互相覆盖）；git 版不再被任何层写入。
- [ ] AC2: 在任一 worktree（含 fork 早的旧 worktree）里读注册表得到**当前真值**（非 fork 快照）——与主检出一致。
- [ ] AC3: 冷启动 cron 重建直写全局路径不再触发 bypass-check 误红（`gap-direct-to-develop-exclude-cron-registry-receipt` 的排除项可撤）。
- [ ] AC4: 消费面迁移完成：`outer-cron-registry.ts` 判据读取 / `outer-anchor-check.ts` / 双层 tick 文档 / AC80-INNER-ANCHOR 段 / `outer-tick-log-check` / 测试 pin 集全部读新路径。
- [ ] AC5: 审计线落地（append-only 事件行记录锚重建）；测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] 双层 cron 收据各写全局 per-layer 路径（分片），任何 worktree 读到真值；git 版无写路径；bypass-check 排除项可撤；消费面全部迁移；审计线 jsonl 保留锚重建留痕；scoped + 全量绿。

## Touches

- plugin/scripts/outer-cron-registry.ts（判据读取路径迁移）
- plugin/scripts/outer-anchor-check.ts（消费面迁移）
- plugin/test/outer-cron-registry.test.mjs（测试 pin 集迁移）
- orchestration/orchestrator-loop-tick.md（外层注册表收据引用）
- orchestration/fast-mode-tick-core.md（内层注册表收据引用）
- plugin/loop/fast-mode-loop-tick.md（AC80-INNER-ANCHOR 段）
- tasks/gap-cron-registry-global-path-migration.md（自身）
