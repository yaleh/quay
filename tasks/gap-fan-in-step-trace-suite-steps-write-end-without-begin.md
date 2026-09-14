---
id: gap-fan-in-step-trace-suite-steps-write-end-without-begin
title: fan-in-step-trace 的 4 个 suite 步骤只写 step-end 不写 step-begin——最贵的 suite
  步骤在该载体里结构上不可测时长
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`.quay/fan-in-step-trace.jsonl`（12,308 条，09-04 起）里有 **2,097 / 7,204 = 29%** 的
`step-end` 配不上 `step-begin`，且孤儿 **100% 集中在 4 个 step 名**：

| step | 配对 | 孤儿 end | 孤儿率 |
|---|---|---|---|
| `ac-precheck` | 0 | 697 | 100% |
| `suite-start` | 0 | 697 | 100% |
| `suite-end` | 0 | 695 | 100% |
| `suite-skip` | 0 | 15 | 100% |
| 其余 8 步（`merge-develop`/`anti-drift`/`typecheck`/`doc-check`/`scoped-gate`/`anti-drift-land`/`ac-gate`/`ff`） | 4,908 | 0 | **0%** |

根因方向：这 4 个 suite 决策步骤的 `step-begin` 自 2026-08-28 起改写到 per-run 日志文件，
而 `step-end` **仍在写共享载体**——半拉状态。

**⚠️ 与已有任务的关系（不是重复立案）**：`tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md`
已 `status: done`，其标题声称这批步骤在共享载体上「永久停写」，**但盘上实际是 `step-end`
仍在写**（2,104 条）。这是那次修复的残留，且与该任务的结论不符。

**后果（要点）**：fan-in 里**最贵的一步（suite，中位 3–17 分钟）在该载体里结构上无法测出时长**。
实测 8 个可配对步骤合计中位仅约 2 分钟，而单次 fan-in 端到端中位 9.7 分钟、p90 154.6 分钟、
最大 693 分钟——缺口里既有排队也有 suite，**但因为 suite 不在载体里，二者无法拆开**。
本次定量复核因此把「75% 是等待」这个结论收回，见
`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §5 错误一。

## Touches

- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver-fan-in.test.mjs`
- `tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md`
- `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
- `tasks/gap-fan-in-step-trace-suite-steps-write-end-without-begin.md`

## Acceptance Criteria

- [ ] 定位并贴出 4 个 suite 步骤的 `step-begin` 与 `step-end` 各自的写入点（文件:行号），
      说明为何一半改了载体一半没改。
- [ ] 让 suite 步骤的**时长**在某一个载体里可测，三选一并落地：①恢复 `step-begin` 写共享载体；
      ②`step-end` 自带 `durationMs` 字段（不依赖配对）；③明确记录 per-run 文件路径并让消费者
      可联结。⛔ 不接受「两个文件各写一半、谁也测不出 suite 时长」的现状。
- [ ] 修复后 ≥3 天的真实生产记录里，孤儿 `step-end` 占比 <5%（当前 29%），或
      suite 步骤时长可从载体直接算出（给出实际算出的中位/p90 读数）。
- [ ] 回写 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §5 错误一：
      用修复后能拆开的真实读数，给出「端到端时长里 suite 占多少、排队占多少」的实际拆分。
- [ ] 更正 `tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md` 的结论表述
      （它声称整体停写，与盘上实际不符），或在本任务体里说明为何不改它。

## Definition of Done

读数取自**生产载体**，不接受 fixture：把注入 seam 关掉后，孤儿率与 suite 时长 AC 仍应成立。
修复后必须实际跑过 ≥3 天真实 fan-in 并给出落地后时间窗内的读数（硬规则 4 推论三：
实现了、测试绿了、但生产没跑过 ⇒ 与没实现同形）。
