---
id: gap-test-detail-timeline
title: Test 详情 ①——测试时间线（perFile 加结束时刻 + 甘特图）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-test-detail-perfile-duration-failed
---

**type:** execution

## Proposal

**来源**：manager 需求分析投立案（人产品要求 Test 详情页看测试时间线）。数据现状：`__PERFILE__` 行无时间戳，且 16 路并发（`laneCount:16`）下光有 duration 重建不出真实时间线（不知哪个文件何时开始）。

**修法**：reporter 收到 `test:complete` 事件时记 `Date.now()`（结束时刻），配合 duration 反推起始（起始=结束-duration，误差仅事件回调延迟 ms 级可接受）——近似时间线足够画甘特图。

## Plan

1. reporter 的 perFile 记录加结束时刻（`startedAt` 由结束-时长反推）。
2. Test 详情页渲染甘特图/条形图（每文件一条横条，起止时刻），服务端算坐标点直接吐 `<svg>`（⛔ 零客户端 JS，延续现有风格）。

## Acceptance Criteria

- [x] AC1：perFile 记录含起始/结束时刻（⛔ 仅 duration 无时刻 ⇒ 假）。
- [x] AC2：详情页渲染时间线图（每文件一条横条），服务端渲染 SVG（⛔ 客户端图表库 ⇒ 假）。

## Definition of Done

- [x] perFile 时间戳 + 甘特图渲染落地；AC1-2 全勾；land 到 develop。

## Retires

- 无（perFile 字段追加时刻）

## Touches

- plugin/scripts/measure-suite-reporter.mjs（perFile 加结束时刻）
- plugin/scripts/measure-suite.mjs（__PERFILE__ 行解析正则向后兼容 end_ms）
- plugin/scripts/measure-trend-check.ts（PerFileRecord/parsePerFileLines 解析 end_ms → 起止时刻）
- packages/quay/src/observation.ts（parseVerificationRound 提取 perFile 起止时刻）
- packages/quay/src/serve-handlers.ts（时间线 SVG 渲染）
- plugin/test/measure-suite.test.mjs（reporter end_ms 时刻测试 + parsePerFile 正则）
- plugin/test/measure-trend-check.test.mjs（parsePerFileLines 起止时刻测试）
- packages/quay/test/observation.test.mjs（perFile 起止时刻解析测试）
- packages/quay/test/serve-handlers.test.mjs（时间线渲染测试）
- plugin/workflows/fan-in-execute.js（__PERFILE__ 失败文件提取正则向后兼容 end_ms 后缀）
- .claude/workflows/fan-in-execute.js（同上，两份字节一致镜像）
- tasks/gap-test-detail-timeline.md（自身）
