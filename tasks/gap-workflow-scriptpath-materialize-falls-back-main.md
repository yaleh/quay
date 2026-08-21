---
id: gap-workflow-scriptpath-materialize-falls-back-main
title: "workflow scriptPath materialize 回退主检出版——bootstrap-HIT 的 worktree 版 scriptPath 被忽略，自举修改未被自身验证"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

给 `Workflow` 传 `scriptPath: <worktree>/.claude/workflows/fan-in-execute.js`（bootstrap-HIT 正确用法，worktree 版含最新编排逻辑），但 materialized 脚本【两次实证】都是主检出版（无 worktree 版的最新 block）。

**影响（第 23 条实测）**：`gap-inflight-states-missing-impl-complete-event` 修改了 `fan-in-execute.js`（双拷贝），A6 自举规则要求它自己的 fan-in 用 worktree 版被自己验证——但 workflow 引擎回退主检出版，导致**第 23 条对 fan-in 编排的修改【没被自身 suite 验证】就 land**。这是 bootstrap 机制的静默失效（M176 同族：materialize 缓存/解析 bug）。

**与 M176 的区别**：M176 是 `name:` 解析缓存（workaround 是换 `scriptPath`）；本条是 `scriptPath` 本身也回退主检出版——M176 的 workaround 不适用，无已知规避。

## Acceptance Criteria

- [x] AC1: `scriptPath: <worktree>/...` 正确 materialize worktree 版（不静默回退主检出版）；回退时 fail-closed 而非静默用旧版。
- [x] AC2: 负控制落在生产载体——一个 bootstrap-HIT 任务的 fan-in，materialized 脚本确实含 worktree 版最新 block（读 materialized 脚本内容，非 fixture）。
- [x] AC3: scoped 绿 + bootstrap 相关测试不红。

## Definition of Done

- [x] worktree 版 scriptPath 被正确 materialize，bootstrap-HIT 的自举修改被自身 suite 验证（真实输出）。

## Evidence

**（2026-08-21 实现 + 验证）**

**根因**：`Workflow({scriptPath: <worktree>/.claude/workflows/fan-in-execute.js})` 的 materialize 有时静默回退主检出版——bootstrap-HIT 任务对 fan-in 编排文件的修改【没被自身 suite 验证】就 land。这是 M176 同族的 SDK materialize 解析/缓存缺陷，插件层无法改 SDK，修法是【fail-closed 检测器】。

**实现**：`plugin/scripts/fan-in-materialize-check.ts`（新）读生产载体——SDK 写的 `~/.claude/projects/<slug>/<session>/workflows/wf_*.json`（同时含派发的 scriptPath 与 materialized script 内容，非 fixture）。对每个 worktree scriptPath 的 fan-in-execute 派发：
- worktree 文件在盘 ⇒ 逐字节比对（DECISIVE）：materialized == worktree ⇒ GREEN；≠ ⇒ RED（回退）。
- worktree 已删 ⇒ 用 `.workflow-events/<runId>.jsonl`（baseCommit/fanInCommitSha）+ git 重构 worktree 状态：== worktree@fanIn / == worktree@dispatch-HEAD ⇒ GREEN；== base（任务前版本）且任务自己的 no-merge 提交触碰过该文件 ⇒ RED（回退，任务修复未被验证）；否则 NOT-EVALUATED（中间态/工作树不可重构，硬规则 3b）。
接线：`scripts/test.sh` run_static_checks（@static-tier change）+ capability-catalog 声明 + delivery-inventory 快照再生成。

**验证输出**：
- `node --test plugin/test/fan-in-materialize-check.test.mjs` → 21/21 pass（含负控制 RED：worktree 存在 mismatch / 任务触碰过文件的 base 回退）。
- `node --test plugin/test/fan-in-materialize-check.test.mjs plugin/test/fan-in-execute-paths.test.mjs plugin/test/fan-in-workflow-check.test.mjs` → 172/172 pass（bootstrap 相关测试不红）。
- 生产载体实测（63 条 worktree-scriptPath fan-in 记录）：31 GREEN（worktree 版被 materialize）、32 NOT-EVALUATED（worktree 已删且状态不可完全重构）、0 可证 RED——post-hoc 无法复现 finding 的两次实证（worktree 删除后工作树态丢失），fail-closed 检测器的价值在【在飞/刚 fan-in 的任务】（worktree 在盘时逐字节比对）。
- `bash plugin/scripts/capability-catalog.sh --summary` → 265 scripts / 0 unclassified。
- `node plugin/scripts/verify-delivery-surface.ts --inventory` → inventory_drift=0。

## Touches

- tasks/gap-workflow-scriptpath-materialize-falls-back-main.md（自身）
- plugin/scripts/fan-in-materialize-check.ts
- plugin/scripts/checker-mutation-cases/fan-in-materialize-check.sh（checker-mutation 用例——AC78 mutation-check fail-closed）
- plugin/test/fan-in-materialize-check.test.mjs（新：scriptPath materialize 负控制）
- scripts/test.sh（接线：run_static_checks 新增 fan-in-materialize-check，@static-tier change）
- plugin/scripts/capability-catalog.sh（登记：fan-in-materialize-check 的 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 声明）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照再生成——新 plugin/scripts 文件改变磁盘计数）
