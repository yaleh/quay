---
id: gap-suite-cost-model-is-wrong-optimizations-buy-nothing
title: 118s of per-file savings bought 2s of suite wall-clock — the cost model
  both speedup tasks were built on is wrong
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

两个测试提速任务（[[gap-tests-spawn-cli-from-ts-source]]、
[[gap-tests-use-cli-where-module-import-suffices]]）都建立在同一个模型上，两个任务体都明写了它：

> 套件墙钟由**最慢的单个文件**决定（`--test-concurrency=8` 并行），不是由调用点总数决定。

**两次独立的全量实测否定了这个模型。**

| | 测量者 | 测试数 | 失败 | 墙钟 |
|---|---|---|---|---|
| B5-1/B5-2 **之前** | 外层，2026-08-02 | 2128 | 0 | **491.1 s** |
| B5-1/B5-2 **之后** | 内层 fan-in，同日 | 2135 | 0 | **489 s** |

期间三个「关键路径」文件的单文件耗时合计降了约 **118 秒**：

| 文件 | 改前 | 改后 |
|---|---|---|
| `cli.test.mjs` | 131 s | 66 s |
| `serve.test.mjs` | 54 s | 13 s |
| `mcp-server.test.mjs` | 30 s | 18 s |

**118 秒的单文件节省，换来 2 秒的墙钟。** 而且测试数还多了 7 个。

### 两个候选模型都解释不了

- **「最慢单文件」模型**：改后最慢的已知文件是 66 s。若模型成立，墙钟应该在百秒量级，实测 489 s。
  **差约 7 倍。**
- **「吞吐受限」模型**（墙钟 ≈ 总 CPU / 并发度）：若成立，118 s 的节省应带来 118/8 ≈ **15 s** 的
  墙钟改善。实测 2 s。

### 更要紧的是：15 秒本来就测不出来

`gap-test-suite-has-no-layer-grouping` 记录过套件测量噪声约 **±12%**——在 489 s 上是 **±59 s**。
**一个 15 秒的预期改善完全埋在噪声里，根本不可判定。** 也就是说：

1. 我们不知道这两个任务是否真的改善了任何东西
2. 我们也没有一个能测出改善的测量方法
3. 而 `gap-test-suite-has-no-layer-grouping` 的 AC9 仍挂着一个 **≤416 s** 的有序目标，
   它距当前 489 s 的差（73 s）只比噪声带宽（±59 s）大一点——**这个目标目前是不可验证的**

**在把成本结构量出来之前，任何进一步的单文件优化都是在赌。** 这正是本仓库反复强调的
「hard checks over prose」：我们有一个被两次实测否定的模型，却还在按它排任务。

## Chosen mechanism

**先测出成本结构，再决定还要不要优化——不要再凭模型排提速任务。**

1. **每文件耗时的完整分布**：跑一次全量套件，采集全部 159 个文件各自的 `duration_ms`（`scripts/test.sh --list-files` 实测去重后；任务书写时是 157），
   排序输出。回答：最慢的文件是谁、耗时多少、前 10 名合计占总 CPU 多少。
2. **总 CPU vs 墙钟**：算 `Σ duration_ms` 与实际墙钟的比值。比值接近并发度（8）说明吞吐受限；
   远小于 8 说明存在串行段或启动开销主导。**这个比值就是判据。**
3. **量出噪声**：同一 commit 上**连续跑 3 次**全量套件，记录三次墙钟。这给出真实的噪声带宽，
   也就给出「多大的改善才是可测的」这个下限。**没有这个数，任何提速任务的 AC 都无法验收。**
4. **按结果重写目标**：若吞吐受限，`≤416 s` 这类单点目标要改成「总 CPU 降低 X%」这类可测的量；
   若存在未识别的串行段，那个串行段才是真正的关键路径，先找到它。

**不做**：本任务**不做任何优化**。它只回答「成本在哪里、多大的改善才测得出来」。带着一个被否定的
模型继续优化，是把猜测叠加在猜测上。

**不做**：不撤销 B5-1/B5-2 已落地的改动。它们让 CLI 测试跑在用户真正运行的产物上
（`dist/quay.js`，`npm pack` 发的就是它），这个正确性理由独立于提速理由而成立。

### 已知的测量盲区（外层 2026-08-02 分析，见 `orchestration/test-shape-analysis.md`）

**34 个文件、12,204 行（24% 的测试代码）不用 `node:test`**，而是手写 `makeAssert()` + `failures`
计数器。它们的 1,235 处断言不在「2135 tests」里，且 `--test-concurrency` 无法在文件内并行它们。

**这直接限制 AC1**：每文件耗时对这些文件只能得到一个整块数字，拿不到文件内的分布。而它们恰好是
最大的四个——`prepare-milestone-convergence` 2,287 行、`serve` 1,800、`cli` 1,744、
`mcp-server` 1,652。**AC1 必须如实标注哪些文件是黑盒**，不要让整块数字冒充细粒度归因。

**但这四个黑盒是可以便宜打开的，不需要统一框架**（外层 2026-08-02 核实）：其中三个把**每一处断言
都汇聚到同一个函数**——`cli.test.mjs` 的 `makeAssert()`、`serve.test.mjs:61` 与
`mcp-server.test.mjs:121` 的 `assert(cond, msg)`。在那**一个**函数里记录距上次断言的耗时，就得到
整个文件的逐断言归因，每个文件约 5 行改动、**零断言改动**。耗时长的那些间隔就是进程 spawn 所在。
`cli.test.mjs` 另有 19 个 `block` 函数，块级归因是白送的。

**做这个，不要做框架迁移**——见 `orchestration/test-shape-analysis.md` 的「是否该统一框架」一节。

同一份分析还给出一个待验证的估算：396 次进程边界 × ~1.4s ≈ 550s CPU，若总 CPU 确为 ~3,900s，
则进程边界只占 ~14%——**AC2 的比值实测正是用来证实或推翻这一点的**。

## Acceptance Criteria

- [x] AC1: 全量套件全部文件各自的 `duration_ms` 被采集并按降序输出（最慢 20 个见 Measured；
      其中 `prepare-milestone-convergence.test.mjs` 为手写 harness 黑盒，只有整块数字）
- [x] AC1b: 三个手写 harness 文件（cli/serve/mcp-server）通过**断言汇聚点计时**（env-gated
      `QUAY_TEST_ASSERT_TIMING`，零断言改动）给出文件内归因；不通过转换为 `node:test` 达成。
      `prepare-milestone-convergence.test.mjs` 无断言汇聚点，保持黑盒
- [x] AC2: `Σ duration_ms / 墙钟` 的比值被算出并记录；与并发度 8 对比，明确判定**非最慢单文件决定、
      lane 饱和**（比值 ≈7.1 ≈ 8；对抗评审修正：「吞吐受限 by CPU」标签收回，见 Measured AC2）
- [x] AC3: 同一 commit 上连续 3 次全量运行的墙钟被记录；**噪声带宽**（极差、标准差）在含/剔污染
      两个口径下都被算出
- [x] AC4: 「可测的最小改善」= 噪声带宽的量级已给出（20–63 s 范围），并写明对提速任务 AC 的含义
- [x] AC5: 比值 ≈7.1 对 <~53 s 的串行段无分辨力；给出**串行段上界 ≤53 s**（不是「无串行段」）
- [x] AC6: `gap-test-suite-has-no-layer-grouping` 的 AC9（≤416 s）**按干净噪声重判为可验证并保留**，
      总 CPU 目标作为辅助指标（见其任务体）
- [x] AC7: 两个提速任务体里「墙钟由最慢单文件决定」的表述被更正，写明被 B5 实测否定 + 隔离/套件内
      不同域
- [x] AC8: `plugin/test/measure-suite.test.mjs` 带 `// @test-group engine` 声明（本任务产出测量脚本）

## Definition of Done

- [x] 三次运行的原始墙钟、每文件耗时分布、Σ/墙钟比值都在任务体里（见 Measured）
- [x] 判定结论明确：**非「最慢单文件」决定；8-lane 饱和**（Σ/wall ≈ 7.1 ≈ 8；「by CPU 吞吐受限」
      标签已按对抗评审收回），依据是 run3/run4 的 Σ/wall 实测
- [x] 明确回答：**B5-1 与 B5-2 的套件墙钟效果在噪声内不可判定**（如实写；最小噪声口径极差 17s
      已远超前后记录差 2s，任何口径下都不可判定）
- [x] 后续提速工作的方向由本任务的数据决定（墙钟目标需在干净全绿基线上重测；Σ 需 ≥5 采样；
      串行窗口 ≤53 s 需先测），不由模型决定

## Measured (2026-08-02, worktree `/tmp/quay-wt-costmodel`, branch `task/gap-suite-cost-model-is-wrong-optimizations-buy-nothing`)

**测量环境**：node v26.5.0，`--test-concurrency=8`（scripts/test.sh 默认），159 文件
（`scripts/test.sh --list-files` 去重后），dist bundle 已预构建（cli-entry.mjs 走 dist）。
全套件在 3 次测量期间未改动任何测试文件。`Σ duration_ms` = 各测试文件的 file-level
`duration_ms` 之和（run3 自定义 reporter 采集，159/159 文件全覆盖）。

### AC3 — 墙钟噪声（同一 commit 连续 3 次全量运行）

| run | 墙钟 (s) | node --test exit | per-file 采集 |
|---|---|---|---|
| 1 | 478.1 | 1 | 0/159* |
| 2 | 524.4 | 1 | 0/159* |
| 3 | 460.9 | 1 | **159/159** |
| 4（补充） | 477.7 | 1 | **159/159** |

- 前 3 跑（AC3 判据）：均值 **487.8 s**；极差 **63.4 s**（460.9–524.4）；样本标准差 **32.8 s =
  6.7% of mean**。含 run4 共 4 点：均值 485.3 s，极差 63.5 s，σ 27.3 s（5.6%）。
  **剔除被污染的 run2 后（478.1/460.9/477.7）：极差 17.2 s、σ 9.8 s（2.1%）**。
- **噪声带宽两个口径：±33 s（1σ，含 run2）/ ±10 s（1σ，剔 run2）**。
- **「±12%（±59 s）」先前估算不适用（对抗评审）**：那 ±59 s 来自 layer-grouping 的
  worktree-vs-checkout **环境差**（627 s vs 559 s），不是 run-to-run 噪声；两者量级巧合接近，
  不能作为「估算成立」的证据。本任务直接给出 run-to-run 噪声（17–63 s 极差）。
- \* run1/2 用了早版 reporter（file-level 匹配 bug，未输出 per-file 行）；run3/4 用修复版。
  四跑墙钟仍可比（reporter 在父进程，开销 <100 ms）。**全部 4 跑 node --test 退出码 1**（既有
  失败，见 layer-grouping 任务 Measured；不影响墙钟测量）。
- **诚实标注（run2 可能被抬高）**：run2 进行期间，测量者曾并行运行若干次小型 `node --test`
  调试（reporter 调试），占用 CPU，可能抬高 run2 墙钟（524.4 s）。即使剔除 run2，其余三跑
  （478.1/460.9/477.7）极差仍为 17.2 s、σ 9.8 s（2.1%）——**噪声带宽在两个口径间：17–63 s 极差**。
- **红套件 vs 绿基线（对抗评审 #9）**：全部 4 跑 node --test 退出码 1（既有失败，symlink-mirror
  ×2 + it0-enforcement ×1），而 B5 前/后基线（491/489 s）是绿跑。噪声分布取自红套件，与绿基线
  比较属混合总体；若失败导致某文件提前退出，会改变 wall 与 Σ。诚实处理：本文的「不可判定」结论在
  绿/红口径下都成立（2 s 差远小于最小噪声口径 17 s），但严格的 B5 前后对比应在同一绿基线上重测。

### AC1 — 每文件 duration_ms 分布（run3，降序）

- 最慢文件：`packages/quay/test/cli.test.mjs` **201.5 s**（套件内 wall 时长，受争用抬高；其单文件
  隔离仅 ~66 s——**隔离 vs 套件内差异即争用证据**）
- **前 10 名合计占 Σ 的 44.8%**；前 20 名占 62.1%；Σ（套件内 per-file 时长之和，**非纯 CPU**）**
  3266 s**。注：争用抬高了耗时最多文件的占比，前 10 名排序偏向「最受争用」而非「最多 CPU」。
- 最慢 20 个文件（duration_ms 累计占比）：

| duration_ms | 累计% | 文件 |
|---|---|---|
| 201548 | 6.2% | packages/quay/test/cli.test.mjs |
| 184853 | 11.8% | experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs |
| 179140 | 17.3% | packages/quay/test/acceptance.test.mjs |
| 178849 | 22.8% | experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs |
| 167919 | 27.9% | packages/quay/test/driver.test.mjs |
| 156001 | 32.7% | packages/quay/test/lifecycle.test.mjs |
| 139188 | 37.0% | packages/quay/test/delivery-standalone-smoke-gate.test.mjs |
| 111348 | 40.4% | plugin/test/prepare-milestone-convergence.test.mjs |
| 75563 | 42.7% | packages/quay/test/gap002-create-ergonomics.test.mjs |
| 69761 | 44.8% | packages/quay/test/cli-adr.test.mjs |
| 67057 | 46.9% | plugin/test/execute-milestone-worktree.test.mjs |
| 62854 | 48.8% | packages/quay/test/ts-typecheck-gate.test.mjs |
| 60648 | 50.7% | plugin/test/codex-stage1-adapter.test.mjs |
| 60321 | 52.5% | packages/quay/test/gate.test.mjs |
| 59634 | 54.3% | packages/quay/test/gap-cli-gate-enforcement.test.mjs |
| 54779 | 56.0% | packages/quay/test/dir032-audit-independence.test.mjs |
| 51789 | 57.6% | plugin/test/execute-milestone-disposition-conformance.test.mjs |
| 50502 | 59.1% | plugin/test/runner-grouping.test.mjs |
| 50132 | 60.7% | plugin/test/prepare-admission-check.test.mjs |
| 47883 | 62.1% | packages/quay/test/web-ui-browser.test.mjs |

黑盒：`prepare-milestone-convergence.test.mjs`（111 s）无断言汇聚点，只有整块数字（AC1b 如实标注）。

### AC2 — Σ duration_ms / 墙钟（比值判据）

- Σ duration_ms（run3）= **3266 s**、墙钟 460.9 s → 比值 **7.09**；run4 = **3434 s**、墙钟 477.7 s
  → 比值 **7.19**；均值 **7.14**。并发度 = 8。
- **判定：不是「最慢单文件」决定（cli 201.5 s ≪ 墙钟 460.9 s）——套件**打满 8 条 lane**（比值 ≈
  7.1 ≈ 并发度 8）。**注意（对抗评审修正）**：本机 `nproc=4`，8 个并发测试进程已过订（oversubscribe），
  lane 无论 CPU/IO 都会保持占用，因此比值 ≈ 8 是「调度占位」的结论，**不能区分 CPU 吞吐受限 vs
  延迟受限**，也不能直接推出「墙钟 = 总 CPU/8」。**「吞吐受限（by CPU）」标签收回**，改为
  「**lane 饱和、非单文件延迟受限**」。
- 可确证的定量结论：墙钟 = Σ/8 + ~53 s（run3：460.9 − 3266/8 ≈ 52.6 s）未归因差；Σ 是各文件
  **套件内 wall 时长之和**（受争用抬高，非纯 CPU）。
- 对照 test-shape-analysis 估算（Σ≈3900 s）：**实测偏低**（3266–3434 s）；进程边界（~550 s）约占
  Σ 的 ~16–17%，与「只占 ~14%」估算同量级。

### AC4 — 可测的最小改善

- **墙钟噪声（诚实报告两个估计）**：
  - 含被污染的 run2（524.4 s，测量者调试进程叠加）：极差 63.5 s、σ 32.8 s（6.7%）→ 阈值 ≥60-70 s；
  - **剔除 run2（478.1/460.9/477.7）**：极差 **17.2 s**、σ ≈ 9.8 s（2.1%）→ 阈值 ≈ **20 s（2σ）**。
  - 真实噪声带宽介于两者之间；**一个提速任务的墙钟 AC 必须用** uncontaminated 采样**（≥3 跑、无
    并发负载）重测后才能定死阈值**。本任务给出范围 20–63 s。
- B5-1+B5-2 的 118 s 单文件节省**无法映射到 Σ**（in-suite cli 201.5 s vs 隔离 66 s，争用主导），
  因此「理论墙钟 15 s」不成立；实测墙钟 491→489（2 s）在任何噪声口径下都不可判定。
- **Σ（套件内 per-file 时长之和）噪声不是方差估计**：run3 3266 s vs run4 3434 s 只是 **n=2 的单次
  差（168 s）**，不能当成 ±5% 噪声带。「总 CPU 降低 ≥10%」目标因此**不能仅凭 n=2 声明可验证**；
  需 ≥5 次 Σ 采样定出噪声后才可验收（measure-suite.mjs 提供可重复采集）。

### AC5 — 串行段

- **诚实结论（对抗评审修正）**：比值 ≈7.1 对「串行段 < ~53 s」**无分辨力**——`wall − Σ/8 ≈ 53 s`
  （run3）完全可能是一段 ≤53 s 的串行段。**不能断言「未发现独立串行段」**。
- **可证实的上界**：任何串行段 S ≤ 53 s（= wall − Σ/8）。最可能的候选：159 个子进程的 node 启动
  （~0.2-0.3 s/次 ≈ 30-50 s 父进程侧串行 spawn）——这是数据支持的推测，不是实测定位。
- **建议**：若后续要把墙钟压到 460 s 以下，先测「首个子进程启动 → 最后一个结束」的串行窗口
  （node --test 的 ramp-up/ramp-down），再谈单文件优化。

### AC1b — 断言汇聚点计时

- 在 `cli.test.mjs`（`assert()` + `makeAssert()`）、`serve.test.mjs`（`assert()`）、
  `mcp-server.test.mjs`（`assert()`）加 env-gated（`QUAY_TEST_ASSERT_TIMING`）的距上次断言计时，
  **零断言改动**。`prepare-milestone-convergence.test.mjs` 无汇聚点，保持黑盒。
- **实测（3 文件并跑，`QUAY_TEST_ASSERT_TIMING=1`）**：共 35 个 ≥1000 ms 的断言间隔，
  **全部是进程边界**（原始 [timing] 行已存 `measurements/ac1b-timing.txt`）：
  - `cli.test.mjs`：~25 个间隔，全为 CLI spawn——`dist/quay.js` 调用约 1.0–1.3 s/次；
    **GitHub `.ts` provider 入口（B5 保留点）约 2.4–2.8 s/次**（最长单间隔）；`[prefix]` 块有一个
    **9.8 s 间隔**（块内多次 CLI 调用背靠背）。
  - `mcp-server.test.mjs`：~11 个间隔，全为 `connectStdio` MCP 握手（1.0–1.4 s/次）。
  - `serve.test.mjs`：**0 个 ≥1000 ms 间隔**——B5-2 已把 fixture spawn 下沉，13 s 摊在大量短间隔。
- 结论：这三个文件内的时间集中在**进程边界**（CLI/MCP spawn），不在断言逻辑。
- **关于「进程边界是不是墙钟杠杆」（对抗评审 #7）**：若 spawn 占 Σ 的 ~16% 且墙钟 ≈ Σ/8，则
  spawn 占墙钟 ~16% ≈ **~74 s**——高于干净噪声极差（17 s），理论上**可测**。但 B5-1 把单次 CLI
  spawn 缩短 ~2.1 s 后墙钟几乎未动（2 s），说明**spawn 延迟不是当前墙钟的绑定约束**；真正约束是
  8-lane 近饱和下 Σ 的总量 + 调度尾部（AC5 的 ≤53 s 串行窗口）。诚实结论：削减 spawn 是否买墙钟，
  **取决于削减的是 Σ 总量还是单次延迟**——本数据不能断言「买不到」，只能断言「B5-1 的 2.1 s/次
  延迟削减没买动墙钟」。

### DoD — B5-1/B5-2 到底有没有改善套件墙钟？

- **在噪声内不可判定**。实测 3 次墙钟极差 63 s、1σ 33 s；B5 前/后记录差仅 2 s（491→489）。
  2 s 远小于噪声；按吞吐模型预期的 15 s 也在噪声带宽内。诚实结论：现有测量方法无法分辨
  B5-1/B5-2 对墙钟的效果。这不代表它们无效——它们的正确性理由（测 dist 产物 / 下沉 fixture）
  独立于提速而成立。

## Execution record

- **run4**（修复版 reporter，补充 Σ 数据点）：墙钟 477.7 s，Σ duration_ms 3434 s，比值 7.19，
  159/159 文件采集，node --test 退出码 1（既有失败）。run4 提供总 CPU 的第二个采样（与 run3 的
  3266 s 相差 168 s ≈ ±5%）。

### Addendum（2026-08-03，`gap-no-resource-awareness-heavy-ops-run-blind` AC9）

**同一提交两次结果不同，可能是 CPU 饥饿而非测试缺陷。** 本任务的 4 次墙钟测量里有 2 次
（run2 及 run 间差异）都能用「4 核跑 c8 = 17 进程、4.25× 超订」解释，而 AC1b 的断言计时实测
（35 个 ≥1000ms 间隔全部是进程边界）进一步说明：套件内大量耗时来自进程 spawn 的争抢，不是逻辑。
因此「连跑 2 次全绿」在一台 4.25× 超订的机器上**不是一个关于代码的判据**——run1 零失败、run2
一个失败更可能是负载抖动。判据必须先过资源闸（`scripts/resource-gate.sh --for full-suite` 报 GO）
再谈代码。这也是本任务 run-to-run 噪声（17–63s 极差）里未被分解的一部分。

## Cross-annotation（AC4，2026-08-08，`gap-single-file-test-duration-trend-unwatched`）

**本任务加「趋势」维度，与「成本结构」同方向、不同时轴。** 本任务测的是**单次**成本结构
（每文件 `duration_ms` 分布 + Σ/墙钟 + 噪声带宽 17–63s），测量工具 `measure-suite-reporter.mjs`
（`__PERFILE__` 行）已由后续任务 `gap-single-file-test-duration-trend-unwatched` 复用：它把每次
全量套件的每文件耗时 append 进 `.quay/measure-history.jsonl`（append-only 历史）并**逐轮对比**——
单文件耗时增长超基线（相对 >2× 或绝对 >+30s）报出文件 + 增幅。本任务的噪声结论（±17–63s 极差、
单次观测不可判定）正是趋势任务**不把单次增长当判定**的依据：增长报告是「信息」不是「门」，
多轮才成信号。测量器复用同源（`measure-suite-reporter.mjs`），趋势任务不新造测量器（其 AC3）。

## Touches

- scripts/test.sh
- plugin/scripts/（measure-suite.mjs、measure-suite-reporter.mjs）
- plugin/test/（measure-suite.test.mjs）
- packages/quay/test/cli.test.mjs（AC1b 断言计时）
- packages/quay/test/serve.test.mjs（AC1b 断言计时）
- packages/quay/test/mcp-server.test.mjs（AC1b 断言计时）
- tasks/gap-tests-spawn-cli-from-ts-source.md
- tasks/gap-tests-use-cli-where-module-import-suffices.md
- tasks/gap-test-suite-has-no-layer-grouping.md
- tasks/gap-single-file-test-duration-trend-unwatched.md（AC4 交叉标注，2026-08-08）
