# Suite Σ distribution — 2026-08-03 (post-retirement re-measure)

Task: `gap-suite-sigma-distribution-stale-after-retirement`

## 目的

2026-08-02 的成本结构测量（159 文件、Σ/wall ≈ 7.1）在 2026-08-03 退役合并后已过时。
本任务重测**当前 155 文件**套件的 Σ 分布，回答三个问题，并把「删掉 18 个文件后 Σ 降了多少」
与墙钟实测并列。**只测量，不优化。**

## 测量环境

- 当前套件 worktree: `/tmp/quay-wt-sigma` @ `f1ab5c21`（155 文件）
- 退役前对照 worktree: `/tmp/quay-wt-preretire` @ `1802a70d`（retire merge `8cc5efd3` 第一父，173 文件）
  ——两 commit 之间套件文件差异**恰为退役删掉的 18 个文件**（`comm` 验证：0 新增、18 删除）
- 预构建 dist：两 worktree 的 `dist/quay.js` + `dist/quay-native.js`，均比所有 `.ts` 源新
  （每 run 前 `find -newer` 0 命中）——cli-entry 走 dist，避免 913ms/调用
- 每 run 前 `bash plugin/scripts/resource-gate.sh --for full-suite` 必须 GO（cpu_stall < 40）
- 工具：`plugin/scripts/measure-suite.mjs --json`（现成，未改）
- node: v26.5.0, `--test-concurrency=8`；nproc=4

## Runs

### 当前套件（155 文件）——三次，全部 155/155 捕获

| run | 墙钟 (s) | Σ (s) | ratio Σ/wall | filesCaptured | node --test exit | 起动前 gate |
|---|---|---|---|---|---|---|
| A | 402.9 | 2470.9 | 6.13 | 155/155 | 1 | GO (5.57) |
| B | 700.5 | 4836.0 | 6.90 | 155/155 | 1 | GO |
| A2 | 533.6 | 3734.2 | 7.00 | 155/155 | 1 | GO (10.46) |

### 退役前套件（173 文件）

| run | 墙钟 (s) | Σ (s) | ratio | filesCaptured | exit | 起动前 gate |
|---|---|---|---|---|---|---|
| C | 563.4 | 3964.2 | 7.04 | 173/173 | 1 | GO (6.61) |

### 负控制（高压：8 个 CPU hog + 全量套件，gate WAIT 41→99）

| run | 墙钟 (s) | Σ (s) | ratio | filesCaptured | exit |
|---|---|---|---|---|---|
| D | 896.6 | 5930.8 | 6.61 | **155/155** | 1 |

## 三个问题的答案

### 1. Σ/墙钟 比值变了吗？——没变到结论翻转的程度

旧值 7.09–7.19（≈7.1）。新值：当前 6.13 / 6.90 / 7.00，退役前 7.04，负控制 6.61。
**全部仍 ≈7，接近并发度 8**——lane 仍饱和，「非最慢单文件决定、8-lane 打满」的结论保持。
比值未掉到「串行段主导」的量级。

### 2. 前 10 名占 Σ 多少？——见下方分布

run A 前 10 名合计（从慢est 起）：180.0+175.5+165.0+133.0+110.7+103.6+101.0+79.0+72.5+67.4
= 1187.7 s，占 run A Σ（2470.9）的 **48.1%**（旧 run3 口径 44.8%，基本持平）。
**前 3 名（proposal-convergence / delivery-standalone-smoke-gate / runner-grouping）就占 ~21%。**

### 3. 删掉 18 个文件后 Σ 降了多少？——受控 back-to-back 给出 ≈ −8.2%（边缘可判定）

**受控 back-to-back（协调方 2026-08-03 建议，A3 then C2，均 clean GO 窗口、时间相近）：**

| run | 套件 | Σ (s) | 墙钟 (s) | ratio |
|---|---|---|---|---|
| A3 | 当前 155 | 3467.0 | 498.8 | 6.95 |
| C2 | 退役前 173 | 3775.7 | 535.1 | 7.06 |
| **ΔΣ** | | **−308.6 s（−8.2%）** | −36.3 s（−6.8%） | |

**这是「18 个删文件让 Σ 降了多少」的最佳估计：≈ −309 s（−8.2%）。**
显著性：当前套件受控 run-to-run 方差（A2 3734 vs A3 3467，均 GO 起动，差 267 s）与旧同条件噪声
（~167 s）夹住这个值——−309 s 约是噪声的 1.2–1.9×，**边缘可判定**（不再是「±1000 s 内不可判定」）。
早前的 ±1000 s+ 是 3 次运行**混条件**（run B 内存退化 swap ~1.4GB）的原始极差一半——是上界，不是
受控噪声。

与墙钟并列：外层 scripts/test.sh 墙钟 562.3 → 569.1 s（**+1.2% 即没降**）；本任务 node --test 墙钟
A3 vs C2 降了 ~6.8%。**Σ 降 ~8% 并没有买到同比例的墙钟降**（外层测的墙钟甚至没降）——18 个文件 /
402 测试不在 8-lane 饱和套件的关键路径上。**「Σ 降 ≠ 墙钟降」的直接证据：Σ 降 8.2%，墙钟降 0–7%。**

18 个删文件自身的 Σ 贡献（run C 顶 20 可见的）：prepare-milestone-convergence 137.7 s +
execute-milestone-worktree 69.2 s = **≥207 s**；其余 16 个每个 < 56.6 s。

## 与旧测量（2026-08-02, 159 文件）的逐项对照

| 量 | 旧 run3 / run4 | 新 run A / A2 / B | 变化 |
|---|---|---|---|
| Σ duration_ms | 3266.5 / 3433.8 s | 2470.9 / 3734.2 / 4836.0 s | 范围覆盖旧值两侧（中位偏低） |
| 墙钟 (node --test) | 460.9 / 477.7 s | 402.9 / 533.6 / 700.5 s | 范围覆盖旧值两侧 |
| ratio Σ/wall | 7.09 / 7.19 | 6.13 / 7.00 / 6.90 | 略降但仍 ≈7 |
| 最慢文件 | cli.test.mjs 201.5 s | run A: proposal-convergence 180.0 s | 榜首易主（cli 掉到 #5，110.7 s） |
| 前 10 名占 Σ | 44.8% | 48.1% (run A) | 基本持平 |

**前 10 名构成变化**：cli.test.mjs 从 #1（201.5 s）掉到 #5（110.7 s）——B5 系列 + dist 路由 + 退役
的累积效应；`runner-grouping` 冲进 #3（165.0 s，旧 #18 50.5 s）；`prepare-milestone-convergence`
（旧 #8 111.3 s）被删除。

## 负控制发现（AC3 实证，修正任务前提）

在 8 个 CPU hog（压力 41→99）下跑全量套件（run D）：
- **filesCaptured 仍 = 155/155——CPU 压力没有「杀掉测试」**（与任务体「CPU 饥饿杀测试非拖慢」的
  前提相反）。`--test-timeout=0` 且无内存压力时，文件只是被拖慢。
- 拖慢幅度：墙钟 896.6 s（+67% vs run A2）、Σ 5930.8 s（+59% vs run A2）——**Σ 被系统性高估**，
  不是任务体说的「系统性偏低」。
- **结论不变**：低压力窗口是**前置**而非建议——压力下测量值偏移 +59~140%，不可用。只是机制是
  「拖慢/高估」而非「杀掉/低估」。若需复现「cancelled」，需要内存压力（OOM）而非 CPU 压力，
  本任务未制造（避免干扰外层与 MCP 服务）。

## 关键结论

**一个文件的耗时要拿 Σ 做分母，不是墙钟。**
外层 2026-08-03 正是因为用错分母，把 cli.test.mjs 198.1 s 说成「占套件墙钟 34.8%」，
实为 Σ 的 ~4.9%（198.1/4040 ≈ 4.9%），据此提出的三个优化方案收益被高估约 7 倍。
本任务的数据（run C 顶 20 里 cli 175.9 s，占 run C Σ 3964.2 的 4.4%）独立复现了这个量级。

**本任务实测的噪音带宽（算法来源，2026-08-03 外层审计）**：±1000 s+ 是 3 次当前-155 运行 Σ 的
**原始极差的一半**（2471–4836 s，极差 2365 s，中位 3734 s）。但这 3 次**混入了不同外部条件**：
run A 机器全新低 swap、run B 内存退化（swap ~1.4GB，每文件 ~2x）、run A2 中度 swap（~1.1GB）。
**受控噪声**（旧 run3/run4，同条件）是 ~167 s。因此 ±1000 s 是「混合条件下的上界」，不是
「受控 run-to-run 噪声」。若真实受控带宽接近 168 s，则 ΔΣ ≈ −230 s（A2 vs C）**可能可判定**（~1.4σ），
而非「不可判定」。但本数据中 A vs A2（两次都 GO 起动）仍差 1263 s——当前套件的 Σ 方差高于旧套件。
**诚实结论**：ΔΣ 介于 −6%（A2 vs C，中位口径）与 −38%（A vs C）之间；是否可判定取决于「哪次运行
代表当前 Σ」，需要一次受控 back-to-back（clean 窗口 A then C）来收窄。任何优化 AC 需 ≥5 次同状态采样。

## 测量方法注记

- **exitStatus=1 的成因**：measure-suite 不设 `QUAY_TEST_GROUPS`，14 个 `@test-group governance`
  文件会跑完整 body（scripts/test.sh 默认 `QUAY_TEST_GROUPS=product,engine` 让它们 self-skip）。
  但隔离验证 governance-product-ratio-check（11/11）、symlink-mirror（23/23）、it0-enforcement
  （20/20）都通过——全量套件下的 exit=1 是**争用/上下文相关**，不在隔离中复现（scripts/test.sh
  全绿检查见下）。
- **master 移动**：测量期间 master 前进（webobs/stranded 特性提交修改了 serve.test.mjs、
  restart-readiness-check.test.mjs、task-status-drift-check.test.mjs），文件数仍为 155；本表以
  `f1ab5c21` 为准。

## DoD

- [x] AC4 的分布与 AC5 的逐项对照（上表）
- [x] AC3 的负控制输出（run D，见「负控制发现」）
- [~] scripts/test.sh 连跑 2 次全绿（在 gate GO 窗口）——**1 次全绿 + 1 次被并发修复阻塞（如实记录）**：
  - 第 1 次（原始 test.sh，concurrency=1 串行默认）：**全绿**（2034 tests / 2015 pass / 0 fail /
    0 cancelled / 19 skipped，exit 0，`/tmp/testsh-run-1.log`，墙钟 1775.8s）
  - 第 2 次（协调方同步的并发修复 test.sh，concurrency=8）：**2 失败**（`/tmp/testsh-run-2b.log`，
    2034 tests / 2013 pass / 2 fail / 0 cancelled / 19 skipped，exit 1）——2 个失败是
    `plugin/test/resource-gate.test.mjs` 的 **AC5/AC11 元测试**：它们断言「默认并发由 nproc 推导、
    test.sh 无硬编码 8」，与协调方临时的 hardcoded-8 修复直接矛盾。**套件本身的 2013 个 product/engine
    测试全绿**；这 2 个失败是并发修复（in-flight，AC5 tradeoff 实验未完）未同步更新自身测试所致，
    不是本测量任务的套件失败，且 AC7 禁止我改测试。**DoD「2x 全绿」被 in-flight 并发修复阻塞**；
    干净的第二次全绿需并发修复任务先更新 AC5/AC11（或退回 pre-fix test.sh 串行 ~30 分钟，协调方已
    明确「不要再用旧行为跑完」）。
- [x] 明确记录分母规则（见「关键结论」）
