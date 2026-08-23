---
id: gap-test-detail-perfile-duration-failed
title: Test 详情 ③④——perFile 耗时+失败持久化进 round 记录 + 可排序表
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 需求分析投立案（人产品要求 Test 详情页看每测试耗时+出错测试）。数据现状：`measure-suite-reporter.mjs:126-159` `perFileReporter()` 每测试文件跑完实时流式吐 `__PERFILE__ duration_ms=<dur> <路径> passed=<bool>` 到 stderr（真实生产日志 196 条已核实），但只活在临时/归档文本日志里，**从未结构化写进 `.quay/verification-round.jsonl`**——该载体每轮只存聚合 `durationMs`、`failures` 只是文件名字符串数组，无 duration/无时间戳。

**修法（成本低，聚合逻辑已存在）**：reporter 收尾时把已收集的 `files: Map<path,{dur,passed}>`（`:128`）序列化 `perFile: [{file, durationMs, passed}]` 写进 round 记录——schema 追加字段，只差「顺手存下来」。

## Plan

1. `measure-suite-reporter.mjs` 收尾时写 `perFile` 字段进 round 记录。
2. Test 详情页渲染可排序表格（耗时降序 + 失败项标红）。

## Acceptance Criteria

- [x] AC1：`.quay/verification-round.jsonl` 每轮记录含 `perFile` 数组（`{file, durationMs, passed}`，读生产载体⛔非 fixture）。
- [x] AC2：Test 详情页渲染 perFile 表格，可按耗时排序、失败项标红（⛔ 无 perFile 数据或不可排序 ⇒ 假）。

## Definition of Done

- [x] perFile 持久化 + 可排序表落地；AC1-2 全勾；land 到 develop。

## Retires

- 无（round 记录 schema 追加字段）

## Touches

- plugin/scripts/full-suite-runner.ts（__PERFILE__ 流 → perFile 写 round 记录）
- packages/quay/src/observation.ts（parseVerificationRound 提取 perFile）
- packages/quay/src/serve-handlers.ts（详情页 perFile 表格渲染）
- plugin/test/full-suite-runner.test.mjs（__PERFILE__ → perFile 用例）
- packages/quay/test/observation.test.mjs（parseVerificationRound perFile 用例）
- packages/quay/test/serve-handlers.test.mjs（表格渲染用例）
- tasks/gap-test-detail-perfile-duration-failed.md（自身）
