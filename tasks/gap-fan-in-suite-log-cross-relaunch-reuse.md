---
id: gap-fan-in-suite-log-cross-relaunch-reuse
title: "suite 日志 `/tmp/fan-in-suite-<task>.log` 跨 relaunch 复用不轮转——历史/当前内容混杂，读者误读旧轮数据"
status: done
labels:
  - gap
  - observability
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`/tmp/fan-in-suite-<task>.log` 路径跨 relaunch/跨任务复用，每轮 relaunch 不清空（同路径覆盖），历史内容和当前内容在文件交界处混杂。读者线性 `grep` 整份文件会读到【上一轮被覆盖前的旧内容】，误判为当前轮状态。2026-08-19 一晚两次独立命中：a8 查轮询 grep 到 `FINAL durationMs=2955ms` 历史噪声；outer 查 git-history-route 把「上一轮 quay-init-loop passed=false 269s」误读为「当前轮失败」，追了 45min。

这是「判据落在被污染的产物上」——suite 日志这个观测载体不可靠，让读它的判定（绿/红、失败文件、耗时）都不可信。

## Acceptance Criteria

- [x] AC1: 每轮 relaunch 时真正轮转/清空日志（或打当前轮起始标记：时间戳/round id），读者和判定代码按标记切片，不再整份文件线性 grep。
- [x] AC2: 负控制落在生产载体——一次多轮 relaunch 后，按标记切片能区分「当前轮 vs 历史轮」（读真实日志，非 fixture）。
- [x] AC3: scoped 绿 + 读日志的判定代码（full-suite-runner / measure-suite-reporter / fan-in gate）不红。

## Definition of Done

- [x] 多轮 relaunch 后日志可区分当前轮/历史轮，误读旧轮数据的现象消除（真实输出）。

## Touches

- tasks/gap-fan-in-suite-log-cross-relaunch-reuse.md（自身）
- plugin/workflows/fan-in-execute.js（SUITE_LAUNCH / ISOLATE_LAUNCH / doc-only 轮：轮转日志 → .prev + 打 __FANIN_SUITE_START__ 起始标记；fix-scope gate 按标记切片）
- .claude/workflows/fan-in-execute.js（fan-in-execute.js 双拷贝，byte-identical）
- plugin/scripts/measure-trend-check.ts（parsePerFileLines 按起始标记切片，只读当前轮）
- plugin/scripts/pre-verified-round-record.ts（parseSuitePhases / detectPhaseOverlap 按起始标记切片）
- plugin/scripts/measure-suite-reporter.mjs（产出行日志的 reporter——读者切片的契约对照方，本任务未改其逻辑）
- plugin/test/fan-in-execute-paths.test.mjs（REAL 多轮 relaunch 轮转 + 按标记切片测试）
- plugin/test/measure-trend-check.test.mjs（parsePerFileLines 切片单测）
- plugin/test/pre-verified-round-record.test.mjs（parseSuitePhases 切片单测）
