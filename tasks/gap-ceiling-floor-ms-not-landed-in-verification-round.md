---
id: gap-ceiling-floor-ms-not-landed-in-verification-round
title: __CEILING__/floor_ms 每轮在报但没人读——落进 verification-round
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12）**：`plugin/scripts/measure-suite-reporter.mjs:96` 每轮输出 `__CEILING__ <path> duration_ms=<dur> floor_ms=<floor> 封顶者/该拆`——**已经逐轮点名哪个文件是封顶者、该拆**。但全仓库消费它的只有 `plugin/test/measure-suite.test.mjs`（测试自己）；`verification-round.jsonl` 无任何 ceiling/floor 字段（逐字段查了最近 5 轮）。

⇒ **仪器每轮都在报，结果既不落盘也无人消费**——同族：A15 收件箱缺陷（判据写在正本、执行点不含它 ⇒ 沉默失效）、gap-inbox-counter-disconnected-from-files（计数器与源断开报零不报错）。

**长期价值**：`floor_ms`（各相最长单文件）落盘后，「该拆哪个文件」变成逐轮可见读数，不需要专门去算——对套件耗时优化的持续监控。

**选定机制**：`full-suite-runner.ts` 解析流里的 `__CEILING__` 行，把 `floor_ms`/`ceiling` 字段写进 `verification-round.jsonl` 记录。

**验证锚**：(a) round 记录含 `floor_ms`/`ceiling` 字段；(b) 与 measure-suite-reporter 输出一致；(c) `--for-task` scoped 门绿。

## Plan

1. 读 runner 的 onLine 流处理（已有 __OVERHEAD__/__PERFILE__ 解析——同族累加）。
2. 加 `__CEILING__` 解析 → 记录 floor_ms + ceiling 文件清单。
3. 写进 verification-round 记录 + 测试（构造 __CEILING__ 行 ⇒ 记录含字段）。
4. 回归：full-suite-runner 测试 + `--for-task` scoped。

## AC

- [ ] AC1: round 记录含 `floor_ms`（各相）+ `ceiling`（封顶者清单）
- [ ] AC2: 与 measure-suite-reporter 的 `__CEILING__` 输出一致（无漂移）
- [ ] AC3: 无 __CEILING__ 行的轮次记录缺省字段（不造空值）
- [ ] AC4: 新测试覆盖 (a)(b)(c)；`--for-task` scoped 门绿
- [ ] AC5: 既有 full-suite-runner 测试全绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：round 记录含 floor_ms + ceiling 贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（解析流加 __CEILING__ → 写 floor_ms/ceiling 到 verification-round 记录）
- plugin/test/full-suite-runner.test.mjs（__CEILING__ 解析用例）
- tasks/gap-ceiling-floor-ms-not-landed-in-verification-round.md（自身：勾 AC + 贴证据）
