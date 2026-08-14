---
id: gap-ac58-retired-clauses-delete-and-archive
title: AC58 通则①·退役即迁出——退役条款从高频文件删除、另存 archive（落点映射强制）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**人裁定（2026-08-14 01:0xZ，推翻原「加退役标注但保留正文」建议）**：「退役规则应从高频读取/使用的文件**删除**，另创建 **archive 文件保存**。」
采纳且理由更强：`CLAUDE.md` 开篇逐字「它的行数是本仓库最稀缺的资源」——**退役标注恰恰堆积在每会话必读的文件里，挤掉的是活指令**。
实测：outer tick-core 2 处 / inner loop 12 处 / CLAUDE.md 4 处退役标注。

**AC58 判据（phase-goal 逐字）**：
- 判据1（位置）：三层执行核 + `CLAUDE.md` + 两份 loop 文档里，**标注为退役/前提已死的条款正文 = 0 条**（只允许留**一行指针**指向 archive）。
- 判据2（硬规则⑤ 强制，不可省）：**每次迁出必须产出【落点映射】**——被删内容的**每一个独有词条 → archive 中的位置**，映射贴进删除提交；**验的是「全部有家」不是「抽查几个有家」**（2026-08-10 实证：抽查 7 个就删了 164 行，3 条无家可归）。
- 判据3（能取假；负控制由落地方产出，manager 不构造）：**一条「删了但没进 archive」的样本 ⇒ 检查必须红。**
- ⚠️ 不覆盖：不规定 archive 路径格式；**不删除仍在生效的条款**——迁出标准是「已标退役/前提已死」，不是「最近没用」。

**注**：outer 的 `B4【RETIRED】` 样板从「正确处理」降为「过渡形态」——它当时对，现在按新裁定要迁出（含 AC48 对 integration-branch-model.ts / integration-batch-merge.sh / SPEC-branching-model 的退役标注）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 枚举三层执行核 + CLAUDE.md + 两份 loop 文档里的退役/前提已死条款（含 AC48 的 integration 三件退役标注）。
2. 创建 archive 文件。
3. 删除高频文件里的退役条款正文，只留一行指针 → archive。
4. **每次迁出产出落点映射**（每个独有词条 → archive 位置），贴进删除提交。
5. 检查器：高频文件里退役条款正文 = 0（只留指针）+ 负控制（「删了但没进 archive」样本 ⇒ 红）。

## Acceptance Criteria

- [x] AC1 三层执行核 + CLAUDE.md + 两份 loop 文档退役条款正文 = 0（只留一行指针）。
- [x] AC2 每次迁出带落点映射（每个独有词条 → archive 位置，贴进删除提交——硬规则⑤）。
- [x] AC3 负控制：一条「删了但没进 archive」的样本 ⇒ 红。
- [x] AC4 不删仍在生效条款（迁出标准=已标退役/前提已死）；archive 路径格式实现面自定。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 退役条款迁出完成（高频文件 0 正文、archive 全有家、落点映射贴删除提交）。
- [x] 负控制红 + 检查器接线。

## Touches

- orchestration/orchestrator-tick-core.md（退役条款删除 + 指针）
- orchestration/orchestrator-loop-tick.md（退役条款删除 + 指针）
- plugin/loop/fast-mode-loop-tick.md（inner loop 12 处退役标注迁出）
- CLAUDE.md（4 处退役提及迁出）
- plugin/scripts/integration-branch-model.ts（AC48 退役标注迁出到 archive）
- plugin/scripts/integration-batch-merge.sh（AC48 退役标注迁出到 archive）
- orchestration/SPEC-branching-model-…（AC48 退役标注迁出到 archive）
- （archive 文件 + 检查器 + 负控制 fixture）
- tasks/gap-ac58-retired-clauses-delete-and-archive.md（自身）

## Evidence

（inner 2026-08-14 落地，见提交信息）

**Archive**：`orchestration/archive/AC58-retired-clauses.md`（24 个 section：R01–R24，每节一个退役条款/退役标注正文 + 来源/退役标注）。路径格式实现面自定（本任务 Touches 范围内唯一 archive 文件）。

**落点映射（每个独有词条 → archive 位置，贴进删除提交——硬规则⑤，验「全部有家」）**：
- R01 B4 批量合 → `#R01`：词条 `批量合【RETIRED — AC48 2026-08-13`、`integration 删除后该命令无目标`
- R02 inner-state.sh 退役 → `#R02`：`inner-state.sh 已退役——它不观测会话`、`它的招牌信号 .quay/inner-blocked.json`
- R03 AC12 收口 → `#R03`：`AC12 已随 inner-state.sh 退役而收口`
- R04 AC48 integration 退役 → `#R04`：`AC48 2026-08-13 退役 integration`、`AC50 已切，AC48 确认 integration 退役`
- R05 `.claude/loop.md` 已删除 → `#R05`：`.claude/loop.md 已删除——exp5 退役`
- R06 heavy-op-token.sh 退休 → `#R06`：`heavy-op-token.sh 已随 2026-08-06 人裁定整体退休`、`约束退役，此放宽实验前提不再存在`
- R07 inner-state.sh 现已退役 → `#R07`：`旧的 inner-state.sh，现已退役`
- R08 inner-state.sh 事件集撤下 → `#R08`：`旧 inner-state.sh 的「在做什么」事件集随其退役而撤下`
- R09 exp5/.halt 语义 → `#R09`：`exp5 已退役（.claude/loop.md 已删除）`、`.halt 从「暂停 exp5 循环」改为`
- R10 旧 fork 判据退役 → `#R10`：`旧「声明依赖 / touches 相交 → integration」的 fork 判据`
- R11 inner-state.sh 已退役(Monitor) → `#R11`：`观测只有一个工具；inner-state.sh 已退役`
- R12 旧 touches 判据 + --force-integration → `#R12`：`旧「touches 与 $MERGE_TARGET 上未验证任务相交 ⇒ $MERGE_TARGET」的 fork 判据与 --force-integration 一并退役`
- R13 旧 --force-integration 已退役 → `#R13`：`旧的 --force-integration（统一 integration HEAD，gap-task-file-develop-integration-drift-fan-in-conflicts AC2）`
- R14 旧 --force-integration 已退役(行内) → `#R14`：`旧 --force-integration 统一 integration 已退役`
- R15 旧 fork 源统一 integration → `#R15`：`旧「fork 源统一 = integration」（--force-integration）已退役`
- R16 inner-state.sh inotifywait 监视 → `#R16`：`旧的 inner-state.sh 曾用 inotifywait 监视它，现随 inner-state.sh 一起退役`
- R17 CLAUDE.md「各 ≤80 行」判据退役 → `#R17`：`该判据已被 AC30(a) 明确退休`、`n=3 placeholder，已 RETIRED`
- R18 classic milestone loop RETIRED → `#R18`：`RETIRED (ADR-022, 2026-08-03): the classic milestone loop`
- R19 classic-loop 工作树隔离历史 → `#R19`：`The loop ran directly on `master``、`Status (RETIRED under ADR-022)`
- R20 prepare-milestone.js worktree 支持 → `#R20`：`prepare-milestone.js also supported the SAME opt-in`、`RETIRED under ADR-022`
- R21 integration-branch-model.ts RETIRED 头注 → `#R21`：`RETIRED (AC48 判据2, 2026-08-13 — tasks/gap-ac48-code-retirement-pool-filter-and-scripts`、`the two-line integration-branch model is retired`
- R22 integration-batch-merge.sh RETIRED 头注 → `#R22`：`every task now forks from develop and the verification-round merges directly to develop`、`the two-line integration-branch model is retired — the branch was deleted and config`
- R23 SPEC-branching-model 🚫 退役块 → `#R23`：`🚫 退役（2026-08-13，AC48 判据2）**：integration 分支已退役——per-task 验证模型`、`退役证据：develop..integration = 0`
- R24 旧「单飞挂载 + 共享事件」设计 → `#R24`：`旧的「单飞挂载 + 共享事件」设计及 heavy-op-token.sh 已随人裁定整体退休`

**迁出计数（退役条款正文从高频文件删除）**：orchestrator-tick-core.md 1 条（B4）；orchestrator-loop-tick.md 3 条（R02/R03/R04）；fast-mode-loop-tick.md 13 条（R05–R16 + R24）；CLAUDE.md 4 条（R17–R20）；integration-branch-model.ts 1 条（R21）；integration-batch-merge.sh 1 条（R22）；SPEC-branching-model 1 条（R23）。合计 24 条迁出，35 个独有词条全部有家。

**检查器**：`plugin/scripts/retired-clause-check.ts`（registry=落点映射；CHECK-A 词条须已从源删除、CHECK-B 词条须在 archive 有家；源里有而 archive 无 ⇒ `DELETED-BUT-NOT-ARCHIVED` RED）。接线 `scripts/test.sh run_static_checks`（`@static-tier change`）。负控制：`plugin/test/retired-clause-check.test.mjs`（RED 判据3/判据1 + GREEN 真仓库 + norm 语义）+ `plugin/scripts/checker-mutation-cases/retired-clause-check.sh`（GREEN→INJECT 删了没进 archive→RED→RESTORE→GREEN）。负控制样本（判据3，测试 fixture）：把 R05 词条从 archive 副本剥掉 ⇒ 检查器必须红。

**scoped 门**：`scripts/test.sh --for-task gap-ac58-retired-clauses-delete-and-archive --allow-thin` 绿（retired-clause-check: OK — 24 entries migrated / 35 unique tokens: all gone from source, all present in archive）。

**不删仍在生效条款（AC4）**：R04 的「工作分支单线 / 外层工作 checkout」实例值保留（只迁出 integration 退役标注）；R19 的 live 规则（path 约定、`git worktree list | grep -c` 在飞读法、默认串行/可选并发、混合模式硬前提）在 CLAUDE.md 保留为浓缩 bullet；fast-mode-loop-tick 的 `--reconcile`（integration-batch-merge.sh）仍是活机制未动。
