---
id: gap-workflows-dual-copy-drift-unchecked
title: .claude/workflows/ 与 plugin/workflows/ 双副本漂移未检——三文件两处存在无 drift check（manager 11:0xZ 报）
status: ready
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

**（workflows 双副本漂移未检——manager 2026-08-14 11:0xZ 报）**。

**现状（实测）**：`.claude/workflows/` 与 `plugin/workflows/` 有 **3 个文件两处存在**：
```
drain-directives.js · fan-in-execute.js · run-routines.js   （两个目录都有）
execute-suite-fix.js · manager-tick-core.js · pool-quality-judge.js · select-preflight.js（仅 .claude/，单处）
```
**无 drift check**（对比：执行核双副本有 `tick-core-drift-check`；本仓库对「同一文件两处」的默认纪律是双副本同改 + drift 检查——AC73 判据4 的执行核版）。**三文件若单边改（只改 .claude/ 或只改 plugin/），无任何机制报**——与 tick-core 双副本漂移同族，且对象是刚落地的 fan-in-execute.js（工作流协议正身）——**改了正本而落地副本不跟，A6 检查的 workflow 脚本是旧的**。

**判据1**：三个双副本文件的 drift 检查落地（.claude/ vs plugin/ 逐文件 diff，漂移 ⇒ 红）——产物复用 tick-core-drift-check 的形态，不是新增打卡。
**判据2（能取假）**：单边改其中一个副本（如只改 .claude/workflows/fan-in-execute.js）⇒ 检查必须红；双改 ⇒ 绿。真样本=现状两份逐字同（回放绿）+ 单边改（构造红，D2 或真实单边样本）。
**判据3**：与 tick-core-drift-check 一致——执行核双副本的判据4 覆盖是否延伸到 workflows 双副本（AC73 判据4 的边界）。

**不覆盖**：不规定哪些文件该双副本（是产品的落在 plugin/，实例在 .claude/ 还是反之——由现结构推定）；不改 workflow 本体。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 实测三个双副本文件的现状（diff，应逐字同）。
2. 判据1：drift check（复用 tick-core-drift-check 形态或并入）。
3. 判据2 能取假：单边改回放红 + 现状回放绿。
4. 判据3：与 AC73 判据4 的边界对齐（workflows 是否纳入双副本可见性）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：三双副本文件（drain-directives / fan-in-execute / run-routines）的 drift 检查落地（漂移 ⇒ 红）。
- [ ] AC2 判据2 能取假：单边改回放红；现状（逐字同）回放绿。
- [ ] AC3 判据3：与执行核双副本（AC73 判据4）边界对齐说明。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] workflows 三双副本文件 drift 检查落地 + 能取假 + 与 AC73 判据4 对齐。

## Touches

- plugin/scripts/workflows-dual-copy-drift-check.ts (new)
- plugin/test/workflows-dual-copy-drift-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh（新脚本声明）
- scripts/test.sh（接入 run_static_checks）
- tasks/gap-workflows-dual-copy-drift-unchecked.md（自身）

## Evidence

（落地后回填）
