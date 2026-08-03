---
id: gap-suite-sigma-distribution-stale-after-retirement
title: "Re-measure the suite's Σ distribution after retirement removed 18 files —
  the only recorded distribution predates it"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

[[gap-suite-cost-model-is-wrong-optimizations-buy-nothing]]（已 done）测出了套件的成本结构：
**Σ duration_ms / 墙钟 ≈ 7.1 ≈ 8（8-lane 饱和）、串行段上界 ≤53 s**，
并造了 `plugin/scripts/measure-suite.mjs` + `measure-suite-reporter.mjs` 采全 **159/159** 个文件。

**那次测量是 2026-08-02，159 个文件。** 2026-08-03 的 [[gap-retire-the-prepare-execute-pipeline-cluster]]
删掉了 18 个测试文件（**155 个**、测试数 2436 → 2034）。**现有的 Σ 分布已经过时。**

### 为什么需要重测，而不是沿用旧数字

外层 2026-08-03 用旧结构做推理时犯了一个错，值得写进任务体作为这次测量的目的：

外层说「`packages/quay/test/cli.test.mjs` 198.1 s，**占套件墙钟的 34.8%**」——
字面为真，**但分母错了**。在 8 路并行的套件里，一个文件的耗时不能拿墙钟做分母。
按 Σ ≈ 7.1 × 569 ≈ 4040 s 算，它只占 **4.9% 的工作量**，把它优化到零只省约 28 s。

**这与 `tasksPerHour` 那个错误是同一族的镜像**（那次该用墙钟做分母却用了 Σ）。
**避免它的唯一办法是有一份当前的 Σ 分布**，而不是拿单文件耗时去除墙钟。

### 本任务只测量，不优化

产出是一张排序分布 + Σ/墙钟比值。**它决定下一步值不值得优化、优化哪里**，
而不是在这个任务里动手优化任何东西。

## Contract

```
measure  sigma_ms = `node plugin/scripts/measure-suite.mjs --json` 输出的 sumDurationMs 字段
measure  wall_ms = `node plugin/scripts/measure-suite.mjs --json` 输出的 wallClockMs 字段
measure  ratio = `node plugin/scripts/measure-suite.mjs --json` 输出的 ratioSumOverWall 字段
measure  captured = `node plugin/scripts/measure-suite.mjs --json` 输出的 filesCaptured 字段
band     coverage = filesCaptured 必须等于 filesTotal（155/155），少一个即测量无效
invariant dist 预构建且比所有 .ts 源新                                # 否则每次 CLI 调用 913ms 而非 446ms
invoke   `node plugin/scripts/measure-suite.mjs --json`
control  在高压力下再跑一次 ⇒ cancelled 会非零且 filesCaptured 会小于 155，据此证明低压力窗口是必要条件
resume   每次运行的 JSON 立即写盘                                     # 单次约 10 分钟，中断保全
```

## Chosen mechanism

**用现成工具，不写新工具。** `measure-suite.mjs` 已经做完了全部采集工作。

### 前置条件（两条，都会使测量无效）

1. **dist 必须预构建且新鲜**——`measure-suite.mjs` 的文件头明写它**不跑** `build_dist_once`。
   若 dist 陈旧，`cli-entry.mjs` 会路由到 TS 源，单次 CLI 调用从 446 ms 变成 913 ms，
   而 `cli.test.mjs` 有 88 次调用 ⇒ 单文件虚高约 41 s。
   **跑之前先 `node packages/quay/scripts/build-dist.mjs`（以及 native bundle）并核对 mtime。**
2. **必须在低压力窗口跑**——今晚实证：CPU 饥饿的表现是**杀掉测试**（`cancelled`），
   不是拖慢套件。被 cancelled 的文件不会产生 `duration_ms`，Σ 会**偏低**而墙钟几乎不变，
   **比值会被系统性低估**。跑之前过 `scripts/resource-gate.sh --for full-suite`，必须 GO。

### 采集

```bash
node packages/quay/scripts/build-dist.mjs          # 前置 1
bash scripts/resource-gate.sh --for full-suite     # 前置 2，必须退出 0
node plugin/scripts/measure-suite.mjs --json > docs/analysis/suite-sigma-2026-08-03.json
```

**至少跑 2 次**——旧任务实测噪声带宽是 ±10 s（1σ，剔除被污染的 run）到 ±33 s，
单次结果无法区分真实变化与噪声。

### 要回答的三个问题

| 问题 | 判据 |
|---|---|
| Σ/墙钟 比值变了吗 | 与旧值 **7.1** 对比；仍 ≈8 说明 lane 仍饱和，结论不变 |
| 前 10 名占 Σ 多少 | 决定「优化最慢的几个」到底能买到多少 |
| 删掉 18 个文件后 Σ 降了多少 | 与墙钟降幅（实测 **+1.2%**，即没降）对照——**这个对照本身就是「Σ 降不等于墙钟降」的直接证据** |

**不做**：不优化任何测试；不改 `measure-suite.mjs`；不设墙钟目标
（旧任务已记录「设阈值前先知道成本结构」是 AC9/416s 的错误，不要重演）。

## Acceptance Criteria

- [ ] AC1: 两次以上运行，每次的 `filesCaptured` **等于** `filesTotal`（155/155）；少一个即该次作废并说明原因
- [ ] AC2: 每次运行前**记录** dist 的 mtime 与 `resource-gate.sh` 的输出，证明两条前置都满足
- [ ] AC3: **负控制**——额外在高压力下跑一次（或人为制造压力），证明 `filesCaptured < 155`
      或 `cancelled > 0`，据此说明为什么低压力窗口是前置而非建议
- [ ] AC4: 输出 Σ、墙钟、比值、前 20 名分布，落盘为 `docs/analysis/suite-sigma-2026-08-03.json`
      与一份 Markdown 摘要
- [ ] AC5: 与旧测量（159 文件、Σ/wall ≈ 7.1）**逐项对照**：比值、Σ、前 10 名的构成变化
- [ ] AC6: 明确回答「删掉 18 个文件让 Σ 降了多少」，并与墙钟实测 **+1.2%** 并列——
      两者的差就是本任务最有价值的一个数
- [ ] AC7: **不优化任何东西**；diff 里不得出现对 `*.test.mjs` 的修改
- [ ] AC8: 测试带 `// @test-group governance` 声明

## Definition of Done

- [ ] AC4 的分布与 AC5 的逐项对照贴进任务体
- [ ] AC3 的负控制输出贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿（**在 gate 报 GO 的窗口里**）
- [ ] 明确记录：**一个文件的耗时要拿 Σ 做分母，不是墙钟**。
      外层 2026-08-03 正是因为用错分母，把一个 4.9% 的目标说成了 34.8%，
      并据此提出了三个收益被高估约 7 倍的优化方案

## Touches

- docs/analysis/suite-sigma-2026-08-03.json
- docs/analysis/suite-sigma-2026-08-03.md

## Dispatch review

reviewer: outer
at: 2026-08-03T06:05:00Z
changed: 范围收紧为**纯测量**——初始想法是「重测并据此提优化方案」，改为只出分布不提方案，因为旧任务已经记录「设阈值前先知道成本结构」是 416s 那个错误；并把外层自己用错分母（198.1/569.1 = 34.8% 应为 198.1/4040 = 4.9%）写进 DoD，因为这次测量的目的正是让下一个人不必再靠单文件除墙钟去推理
