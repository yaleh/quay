---
id: gap-web-tests-three-sections-round-drift
title: web tests 页三板块显示三个不同 round（负载曲线=当前 runId vs 时间线静默回退带 perFile 的旧轮 vs 历史表
  runs[0]）——静默回退制造数据假象
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**现象（manager 2026-08-24 报，人裁定立案；人直接发现）**：web tests 页三个板块本轮显示三个不同的 round：
| 板块 | 引用的 round | 状态 |
|---|---|---|
| 负载曲线 | round 480（当前 runId，03:54Z 起） | running，仅 60s 样本 |
| 测试时间线 | round 478（03:14Z 起，517s，green） | 完成，有 perFile |
| 历史运行表最新行 | round 479（03:33Z 起，645s，red） | 完成，**无 perFile** |

用户看到「负载曲线 60s 对不上时间线 645s」的根因即此：645s 是历史表 round 479 的数字，但时间线因 round 479 无 perFile 静默换成了 round 478（517s）。

**代码核实（packages/quay/src/serve-handlers.ts）**：
- **负载曲线**（`:2830-2831`）：数据源锁定 `readCurrentSuiteRunId()`——当前/最新一轮 runId。
- **测试时间线**（`:2790`）：`tests.runs.find(r => r.perFile && r.perFile.length > 0)`——从最新往回找第一个带 perFile 的 round；最新 round 无 perFile（红轮/静态检查早失败/reporter 未到那步）时**静默**回退到更早一轮。
- **历史运行表**：直接显示 `tests.runs[0]`，不管有无 perFile。

**影响**：三板块同挂「最近一轮」标签但引用不同 round ⇒ 用户无法交叉核对数据；红轮（无 perFile）时时间线静默显示旧轮数据，制造假象。

## Plan

1. **AC1（止损，成本低）**：三板块各自显式标注引用的 round 号/起始时刻（如「round 478 · 03:14Z」）。
2. **AC2（根治）**：测试时间线找不到最新 round 的 perFile 时，显式提示「最新一轮无 perFile 数据」而非静默换成旧 round（保留可回退但注明回退来源）。

## Acceptance Criteria

- [x] AC1（能取假）：web tests 页三个板块各自渲染出引用的 round 号/起始时刻（页面文本可查）。
- [x] AC2（能取假）：最新一轮无 perFile 时，测试时间线显示「最新一轮无 perFile 数据」的明确提示（而非静默回退；⛔ 仍静默显示旧轮 ⇒ 假）。
- [x] AC3（负控制）：三板块引用同一 round 时（正常情况），三者显示一致，不受标注改动影响。

## Definition of Done

- [x] AC1-3 全勾；serve-handlers.ts 改动落地到 develop；页面实测三板块各自标注 round。

## Retires

- 无

## Touches

- packages/quay/src/serve-handlers.ts（三板块 round 标注 + 无 perFile 提示）
- packages/quay/src/observation.ts（TestRunRecord 增 runId 字段 + parseVerificationRound 解析，供负载曲线 runId→round 映射）
- packages/quay/test/observation.test.mjs
- packages/quay/test/serve-handlers.test.mjs
- tasks/gap-web-tests-three-sections-round-drift.md（自身）