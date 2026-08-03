---
id: gap-suite-sigma-distribution-stale-after-retirement
title: "Re-measure the suite's Σ distribution after retirement removed 18 files —
  the only recorded distribution predates it"
status: done
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

- [x] AC1: 两次以上运行，每次的 `filesCaptured` **等于** `filesTotal`（155/155）；少一个即该次作废并说明原因
      ——**3 次**当前套件运行（run A/B/A2）全部 155/155；退役前 run C 173/173
- [x] AC2: 每次运行前**记录** dist 的 mtime 与 `resource-gate.sh` 的输出，证明两条前置都满足
      ——dist 每 run 前 `find -newer` 0 命中；gate 每 run 前 GO（记录在 JSON 的 gateBefore 字段）
- [~] AC3: **负控制**——额外在高压力下跑一次（或人为制造压力），证明 `filesCaptured < 155`
      或 `cancelled > 0`，据此说明为什么低压力窗口是前置而非建议
      ——**部分达成（如实记录）**：run D 在 8 个 CPU hog（gate WAIT 41→99）下跑了全量套件，
      **filesCaptured 仍 = 155、cancelled = 0**——CPU 压力**没有**杀掉测试，而是把每个文件拖慢
      （墙钟 896.6s +67%、Σ 5930.8s +59%，均为系统性**高估**）。这修正了任务体「cancelled → Σ 偏低」
      的前提（复现 cancelled 需内存压力/OOM，本任务未制造以免干扰外层）。**结论不变**：低压力窗口是
      前置而非建议——压力下测量偏移 +59~140%，不可用。见 Measured 负控制节
- [x] AC4: 输出 Σ、墙钟、比值、前 20 名分布，落盘为 `docs/analysis/suite-sigma-2026-08-03.json`
      与一份 Markdown 摘要（见 Measured + 两份交付物）
- [x] AC5: 与旧测量（159 文件、Σ/wall ≈ 7.1）**逐项对照**：比值、Σ、前 10 名的构成变化
      （见 Measured 对照表）
- [x] AC6: 明确回答「删掉 18 个文件让 Σ 降了多少」，并与墙钟实测 **+1.2%** 并列——
      两者的差就是本任务最有价值的一个数（见 Measured AC6 节：ΔΣ ≈ −230s（−6%，中位口径）在
      噪音 ±1000s+ 内不可判定；墙钟 +1.2% 也没降——两者都未降）
- [x] AC7: **不优化任何东西**；diff 里不得出现对 `*.test.mjs` 的修改
      ——工作树 diff 仅含两份分析交付物 + 本任务体；`git status` 无任何 `*.test.mjs`
- [x] AC8: 测试带 `// @test-group governance` 声明
      ——N/A（本任务不新增测试文件；AC7 禁止改动测试。交付物为分析文档，无测试声明要求）

## Definition of Done

- [x] AC4 的分布与 AC5 的逐项对照贴进任务体（见下方 Measured）
- [x] AC3 的负控制输出贴进任务体（见下方 Measured 负控制节）
- [x] `scripts/test.sh` 连跑 2 次全绿（**在 gate 报 GO 的窗口里**）——**2 次全绿**：
  - 第 1 次（agent 原始 test.sh）：**全绿**（2034 tests / 2015 pass / 0 fail / 0 cancelled / 19 skipped，
    exit 0，`/tmp/testsh-run-1.log`）
  - 第 2 次（协调方 fan-in 重跑，master @ 3bf2479e+，2026-08-03）：**全绿**（2052 tests / 2033 pass /
    0 fail / 0 cancelled / 19 skipped，exit 0，`/tmp/sigma-fanin-fullsuite2.log`）
  - 早前 run #2 的 2 失败是 worktree 内过期 `resource-gate.test.mjs`（断言旧派生公式默认、与临时
    hardcoded-8 矛盾）——master 上该测试已同步为「公式 + 钉 8」双断言，fan-in 重跑确认全绿，
    阻塞已解除（AC7 禁止本任务改测试，是协调方修的主检出）
- [x] 明确记录：**一个文件的耗时要拿 Σ 做分母，不是墙钟**。
      外层 2026-08-03 正是因为用错分母，把一个 4.9% 的目标说成了 34.8%，
      并据此提出了三个收益被高估约 7 倍的优化方案（见下方 Measured 关键记录）

## Measured (2026-08-03)

**测量环境**：worktree `/tmp/quay-wt-sigma` @ f1ab5c21（155 文件）；退役前对照 `/tmp/quay-wt-preretire`
@ 1802a70d（173 文件，retire merge `8cc5efd3` 第一父；与当前差异恰为 18 个删除文件，`comm` 验证
0 新增 18 删除）。dist 预构建且比所有 .ts 新（每 run `find -newer` 0 命中）。每 run 前
`resource-gate.sh --for full-suite` GO。工具 `measure-suite.mjs --json`（未改）。node v26.5.0,
`--test-concurrency=8`, nproc=4。详细数据落盘 `docs/analysis/suite-sigma-2026-08-03.{json,md}`。

### 当前套件（155 文件，3 次运行，全部 155/155 捕获）

| run | 墙钟 (s) | Σ (s) | ratio Σ/wall | node --test exit | 起动前 gate |
|---|---|---|---|---|---|
| A | 402.9 | 2470.9 | 6.13 | 1 | GO (5.57) |
| B | 700.5 | 4836.0 | 6.90 | 1 | GO |
| A2 | 533.6 | 3734.2 | 7.00 | 1 | GO (10.46) |

### 退役前套件（173 文件）

| run | 墙钟 (s) | Σ (s) | ratio | exit | 起动前 gate |
|---|---|---|---|---|---|
| C | 563.4 | 3964.2 | 7.04 | 1 | GO (6.61) |

### 负控制（8 CPU hog，gate WAIT 41→99）

| run | 墙钟 (s) | Σ (s) | ratio | filesCaptured |
|---|---|---|---|---|
| D | 896.6 | 5930.8 | 6.61 | 155/155 |

**负控制发现**：CPU 压力下 filesCaptured 仍 = 155（**没有「杀掉测试」**）——文件被拖慢而非杀掉，
Σ 被系统性**高估**（+59% vs run A2），与任务体「cancelled → Σ 偏低」的前提相反。结论不变：低压力
窗口是前置而非建议（压力下测量偏移 +59~140% 不可用）；复现 cancelled 需内存压力（OOM）而非 CPU。

### AC4/AC5 —— 分布与旧测量对照

**前 20 名（run A, 155 文件）**：proposal-convergence 180.0、delivery-standalone-smoke-gate 175.5、
runner-grouping 165.0、acceptance 133.0、cli 110.7、it0-dod-check 103.6、ts-typecheck-gate 101.0、
fast-mode-telemetry 79.0、cli-adr 72.5、dir032-audit-independence 67.4、dir022-remaining-gates 63.7、
codex-stage1-adapter 61.6、init 53.5、resource-gate 50.1、prepare-admission-check 48.2、select-preflight
47.0、acceptance-env 41.1、cli-migrate 40.8、runtime-usage-inventory 39.7、driver 38.7（s）。
**前 10 名占 Σ 48.1%**（旧 run3 口径 44.8%，基本持平）。

**与旧测量（159 文件, run3/4）逐项对照**：

| 量 | 旧 run3/run4 | 新 run A/A2/B | 变化 |
|---|---|---|---|
| Σ | 3266.5 / 3433.8 s | 2470.9 / 3734.2 / 4836.0 s | 范围覆盖旧值两侧 |
| 墙钟 | 460.9 / 477.7 s | 402.9 / 533.6 / 700.5 s | 范围覆盖旧值两侧 |
| ratio Σ/wall | 7.09 / 7.19 | 6.13 / 7.00 / 6.90 | 略降但仍 ≈7 |
| 最慢文件 | cli 201.5 s | run A: proposal-convergence 180.0 s | 榜首易主 |
| 前 10 名占 Σ | 44.8% | 48.1% | 持平 |

**前 10 名构成变化**：cli.test.mjs 从 #1（201.5s）掉到 #5（110.7s）——B5 系列 + dist 路由 + 退役的
累积效应；runner-grouping 冲进 #3（165.0s，旧 #18 50.5s）；prepare-milestone-convergence（旧 #8
111.3s）被删除。

### AC6 —— 删掉 18 个文件让 Σ 降了多少（受控 back-to-back）

**受控 back-to-back（A3 then C2，均 clean GO 窗口、时间相近）：**

| run | 套件 | Σ (s) | 墙钟 (s) | ratio |
|---|---|---|---|---|
| A3 | 当前 155 | 3467.0 | 498.8 | 6.95 |
| C2 | 退役前 173 | 3775.7 | 535.1 | 7.06 |
| ΔΣ | | **−308.6 s（−8.2%）** | −36.3 s（−6.8%） | |

**最佳估计：18 个删文件让 Σ 降 ≈ −309 s（−8.2%），边缘可判定**（受控噪声 ~167–267 s，ΔΣ 约
1.2–1.9×）。早前 ±1000 s+ 是 3 次混条件运行（run B 内存退化）的原始极差一半，是上界非受控噪声。

与墙钟并列：外层 scripts/test.sh 墙钟 562.3 → 569.1 s（**+1.2% 即没降**）；本任务 node --test 墙钟
A3 vs C2 降 ~6.8%。**Σ 降 8.2% 没有买到同比例的墙钟降**（外层测的墙钟甚至没降）——18 个文件 /
402 测试不在 8-lane 饱和套件的关键路径上。**「Σ 降 ≠ 墙钟降」直接证据：Σ 降 8.2%，墙钟降 0–7%。**
外层用错分母的修正仍成立：cli.test.mjs 是 Σ 的 ~4.9%，不是墙钟的 34.8%。

18 个删文件自身的 Σ 贡献（run C 顶 20 可见）：prepare-milestone-convergence 137.7 s +
execute-milestone-worktree 69.2 s = **≥207 s**；其余 16 个各 < 56.6 s。

### 关键记录（DoD）

**一个文件的耗时要拿 Σ 做分母，不是墙钟。** 外层 2026-08-03 用错分母，把 cli.test.mjs 198.1 s
说成「占套件墙钟 34.8%」，实为 Σ 的 ~4.9%（198.1/4040）。本任务 run C 顶 20 里 cli 175.9 s，占
run C Σ 3964.2 的 4.4%——独立复现该量级。

**Σ 噪音带宽（实证）**：同一 commit 三次运行 Σ 横跨 2471–4836 s（n=3 极差 2365 s），远超旧任务
n=2 的 ±168 s（±5%）。任何优化 AC 需 ≥5 次同状态采样。

**外层更正（ff5f69ba，2026-08-03）——墙钟头条**：上文「Σ 降 8.2% 没有买到同比例墙钟降（外层测的墙钟
甚至 +1.2%）」的 +1.2% 是**两次非受控运行**（562.3 vs 569.1 s，同一 commit 同套件 run 间极差实测
297.6 s，无分辨率）。**受控 back-to-back 才是真值**：A3 498.8 s vs C2 535.1 s = **−36.3 s（−6.8%）**，
与 Σ −308.6 s（−8.2%）成比例——正是 lane 饱和套件的预测（wall ≈ Σ / 7）。**套件确实变快了**。
另：cli.test.mjs 已非最慢（#1 201.5 s → #5 110.7 s，榜首易主 proposal-convergence 180.0 s），
拆分 cli 的建议基于过期数字；12 核投影按受控数据重算：拆分 top-3 只值 ~14 s。

## Touches

- docs/analysis/suite-sigma-2026-08-03.json
- docs/analysis/suite-sigma-2026-08-03.md

## Dispatch review

reviewer: outer
at: 2026-08-03T06:05:00Z
changed: 范围收紧为**纯测量**——初始想法是「重测并据此提优化方案」，改为只出分布不提方案，因为旧任务已经记录「设阈值前先知道成本结构」是 416s 那个错误；并把外层自己用错分母（198.1/569.1 = 34.8% 应为 198.1/4040 = 4.9%）写进 DoD，因为这次测量的目的正是让下一个人不必再靠单文件除墙钟去推理
