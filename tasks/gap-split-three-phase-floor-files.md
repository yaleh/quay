---
id: gap-split-three-phase-floor-files
title: 拆三相 floor 文件（最长单文件）——下界 267s → 200s
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12，measure-history.jsonl 353 文件实测）**：各相串行下界 = 最长单文件之和（一个文件不能拆到两个 worker）：

| 相 | 文件数 | floor(最长单文件) | 当前 |
|---|---|---|---|
| serial | 27 | **107.0s** install-config-driven-e2e.test.mjs | 152s |
| lowconc | 22 | **88.2s** session-liveness-signals-thresholds | 143s |
| main | 304 | **72.0s** select-preflight.test.mjs | 118s |
| | | **floor 合计 267s** | 448s |

拆后下一档（74/59/65s）⇒ floor ≈ 200s。

**选定机制**：把三个 floor 文件拆小（每个拆成多个测试文件，单文件 wall-clock < 下一档）。前提：**measure-suite-reporter 的 `__CEILING__` 已逐轮点名这些文件**（任务 gap-ceiling-floor-ms-not-landed-in-verification-round 落盘后成为逐轮可见读数）。**拆前先确认拆分不影响隔离语义**（ac36-sortkey 唯一真敏感项需低并发环境——floor 文件若属此类则不能简单拆）。

**验证锚**：(a) 拆后 floor 文件单文件 wall-clock 降到下一档以下；(b) 测试结果不变（无回归）；(c) 全量套件总耗时下降；(d) `--for-task` scoped 门绿。

## Plan

1. 读三个 floor 文件的测试结构（哪些 test() 可独立成文件）。
2. 拆（保持断言/隔离语义）。
3. 用 `__CEILING__`/floor_ms 验证拆后 floor 下降。
4. 回归：`--for-task` scoped + 全量套件。

## AC

- [ ] AC1: 三个 floor 文件拆后单文件 wall-clock 降到下一档（107→<74 / 88→<59 / 72→<65）
- [ ] AC2: 测试结果不变（无回归——断言/隔离语义保留）
- [ ] AC3: 全量套件总耗时下降（verification-round 对比）
- [ ] AC4: 新测试/现有测试覆盖；`--for-task` scoped 门绿
- [ ] AC5: 隔离语义保留（真敏感项不受影响）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 拆后 floor 下降 + 总耗时贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证
