---
id: gap-fan-in-suite-time-file-cross-relaunch-reuse
title: fan-in-execute.js cpu_s 计算缺 full_suite_ran 守卫——isolate-rerun 读陈旧 .time 文件 → per-task-suite-record HARD FAIL（time-file 变体，未落地，阻 gap-ac148）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`fan-in-execute.js` 的 wait 块 cpu_s 计算（~:460-478）只被 `if [ -f "$suite_time_file" ]` 守卫，**缺相邻 lane_count 计算（:456）那个 `full_suite_ran=true` 守卫**（worker 对 develop 核实，两份 byte-identical，我读码复核确认）。isolate-rerun（`full_suite_ran=false`）时读到上一轮全量 run 遗留的陈旧 `/tmp/fan-in-suite-<task>.time` → 非 null cpu_s → per-task-suite-record 因 `--cpu-time-s` 与 `--full-suite-ran=false` 冲突（AC6）拒写 → HARD FAIL → 不 flip、不 ff。

**已核实（读码）**：`:455-458` `lane_count=1` + `if [ "$full_suite_ran" = "true" ]` 守卫；`:460-464` `cpu_s=null` + `if [ -f "$suite_time_file" ]`（**缺 full_suite_ran 守卫**）。`:196`（SUITE_LAUNCH）`rm -f "$suite_exit_marker" "$suite_time_file"`；`:263`（ISOLATE_LAUNCH）只 `rm -f "$suite_exit_marker"`，**缺 rm suite_time_file**。sibling `gap-fan-in-suite-log-cross-relaunch-reuse`（log 变体）已 done，本任务是 time 变体、memory 自 08-24 起标记「未落地」。

**影响（worker 报，实测）**：每次 isolate-rerun fan-in 必复发；当前 4+ 套件并发（15min load 22.67）主动阻塞。gap-ac148 本身 doc-only 且已完成（mapping 落在分支、AC1/AC2 已勾），纯粹被此 harness bug 挡住。

## Plan

两行修（worker 已定位，落笔方复核）：
1. cpu_s 计算包进 `full_suite_ran=true` 守卫（对齐 lane_count:456）；
2. ISOLATE_LAUNCH `rm -f "$suite_time_file"`（对齐 SUITE_LAUNCH:196）。

同步两份（`.claude/workflows/` + `plugin/workflows/`，`packages/quay/plugin/workflows/` 是 sync-vendor 生成的快照、非手改）+ `plugin/test/fan-in-execute-paths.test.mjs` wait-block group 补覆盖。

## Acceptance Criteria

- [x] AC1（能取假，cpu_s 守卫对齐）：cpu_s 计算加 `full_suite_ran=true` 守卫；isolate-rerun（full_suite_ran=false）不再读陈旧 `.time` 文件 → cpu_s=null；（⛔ 仍读陈旧非 null ⇒ 假）。
- [x] AC2（能取假，ISOLATE_LAUNCH rm 对齐）：ISOLATE_LAUNCH `rm -f "$suite_time_file"`（对齐 SUITE_LAUNCH:196）；（⛔ 不 rm ⇒ 假）。
- [x] AC3（能取假，负控制回放）：回放 gap-ac148 的 isolate-rerun fan-in（full_suite_ran=false + 陈旧 `.time` 存在），修复后不再 per-task-suite-record HARD FAIL、能正常 flip/ff；（⛔ 仍 HARD FAIL ⇒ 假）。
- [x] AC4（能取假，多份同步）：`.claude/workflows/` + `plugin/workflows/` 两份 byte-identical 同步 + `fan-in-execute-paths.test.mjs` wait-block group 覆盖；（⛔ 两份不一致/无测试 ⇒ 假）。

## Definition of Done

cpu_s 加 full_suite_ran 守卫 + ISOLATE_LAUNCH rm 对齐；AC1-AC4 全勾；gap-ac148 的 isolate-rerun fan-in 不再 HARD FAIL、能 flip/ff。

## Touches

- .claude/workflows/fan-in-execute.js（cpu_s full_suite_ran 守卫 + ISOLATE_LAUNCH rm suite_time_file）
- plugin/workflows/fan-in-execute.js（同上，byte-identical 同步）
- plugin/test/fan-in-execute-paths.test.mjs（wait-block group 覆盖）
- tasks/gap-fan-in-suite-time-file-cross-relaunch-reuse.md（自身）
