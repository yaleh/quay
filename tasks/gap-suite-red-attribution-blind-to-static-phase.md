---
id: gap-suite-red-attribution-blind-to-static-phase
title: worker-driver 的重试归因只看"失败的测试文件"——suite 死在静态相位时真因不可见，可修缺陷被报成"infra suspected"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`worker-driver.ts` 的重试豁免归因只有一条路：`failingTestFilesFromSuiteLog`（`:1847`）只匹配 `passed=false` 行；`judgeRetryExemption:2225` 一旦 `failingTestFiles.length === 0` 即返回 `insufficient-data-fallback`。

而 suite 死在**静态相位**时日志里根本没有 `passed=false` 行（`# tests 0`），真因写在 `STATIC_CHECK_FAILED: <checker>` 行里。于是 `decideExitedNotLandedAction:2404` 给出终局判词：

> infra/contract suspected, **not an implementable defect**（the suite log names nothing a worker could fix）

**这个前提是假的。** 实测（`gap-arch-tsify-checker-mutation-check-sh` 的 fan-in 日志），静态相位逐字点名了一个本任务**新文件**的可修缺陷：

```
checker-mechanical-spine-check — 133 checker(s), 1 violation(s)
FAIL: 1 unexempted violation(s):
  - checker-mutation-check.ts (json): --json claimed but no JSON primitive
```

并且 `grep -c 'STATIC_CHECK_FAILED' plugin/scripts/worker-driver.ts` = **0** ⇒ 该相位对分类器完全不可见。

后果：可修的缺陷被报成不可修，任务被推向 needs-human（`gap-arch-tsify-checker-mutation-check-sh` 自 2026-09-20 起卡在此，判词与真因完全不符）。与硬规则 3b 同源、方向相反：一个"读不懂"的输入不得触发与"已读懂且判为不可修"相同的动作。

## AC

- [ ] AC1（复现固化）贴 `grep -c 'STATIC_CHECK_FAILED' plugin/scripts/worker-driver.ts` = 0，以及上述日志片段逐字 + `# tests 0` 行
- [ ] AC2（读数 ⇒ 动作分叉，硬规则 3b）对一个"只有静态相位红、且 `STATIC_CHECK_FAILED` 点名了本任务 delta 内文件"的 outcome，`judgeRetryExemption` 返回**可区分**的取值（不得再落到 `insufficient-data-fallback`）；贴调用与返回原文
- [ ] AC3（负控制·两个方向）①点名的 checker 在本任务 delta 内 ⇒ 归因到本任务；②点名的 checker 与本任务 delta 无关 ⇒ **不得**归因到本任务（走既有不相关路径）。两次输出都贴
- [ ] AC4（判词不得再说假话）静态相位红且已归因时，`decideExitedNotLandedAction` 的 reason 不得再产出「the suite log names nothing a worker could fix」；贴修后 reason 原文
- [ ] AC5（生产读数）落地后时间窗内，`.quay/worker-round.jsonl` 中存在一条"静态相位红 × 已归因"的 round 记录（贴原文与时间戳，晚于落地提交）
- [ ] AC6 `bash scripts/test.sh --for-task gap-suite-red-attribution-blind-to-static-phase` 绿

## DoD

真实落地：静态相位的红在真实 round 记录里被归因到点名的 checker（AC5），且判词不再声称"日志里没有 worker 能修的东西"（AC4）。⛔ 不以"新增单测通过"代替生产 round 记录。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-suite-red-attribution-blind-to-static-phase.md
