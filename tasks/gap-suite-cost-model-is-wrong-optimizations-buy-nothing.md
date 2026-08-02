---
id: gap-suite-cost-model-is-wrong-optimizations-buy-nothing
title: "118s of per-file savings bought 2s of suite wall-clock — the cost model
  both speedup tasks were built on is wrong"
status: todo
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

1. **每文件耗时的完整分布**：跑一次全量套件，采集全部 157 个文件各自的 `duration_ms`，
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

同一份分析还给出一个待验证的估算：396 次进程边界 × ~1.4s ≈ 550s CPU，若总 CPU 确为 ~3,900s，
则进程边界只占 ~14%——**AC2 的比值实测正是用来证实或推翻这一点的**。

## Acceptance Criteria

- [ ] AC1: 全量套件 157 个文件各自的 `duration_ms` 被采集并按降序输出（最慢 20 个贴进任务体）
- [ ] AC2: `Σ duration_ms / 墙钟` 的比值被算出并记录；与并发度 8 对比，明确判定吞吐受限 / 串行受限
- [ ] AC3: 同一 commit 上连续 3 次全量运行的墙钟被记录；**噪声带宽**（极差、标准差）被算出
- [ ] AC4: 给出「可测的最小改善」= 噪声带宽的量级，并写明这对提速任务的 AC 意味着什么
- [ ] AC5: 若发现串行段（比值远小于 8），定位到具体是什么造成的（`before`/`after` 钩子、
      共享 fixture、`--test-concurrency` 未生效的文件等），证据是数据不是推测
- [ ] AC6: `gap-test-suite-has-no-layer-grouping` 的 AC9（≤416 s）按本任务结果**重写为可验证的形式**
      或明确记录为不可验证并撤销
- [ ] AC7: 两个提速任务体里「墙钟由最慢单文件决定」的表述被更正，并写明是什么数据推翻了它
- [ ] AC8: 测试带 `// @test-group engine` 声明（若本任务产出脚本）

## Definition of Done

- [ ] 三次运行的原始墙钟、每文件耗时分布、总 CPU/墙钟比值都在任务体里
- [ ] 判定结论明确：吞吐受限还是串行受限，依据是哪个数
- [ ] 明确回答：**B5-1 与 B5-2 到底有没有改善套件墙钟？** 若答案是「在噪声内不可判定」，
      就如实这么写——这比一个好看的数字有用
- [ ] 后续提速工作的方向由本任务的数据决定，不由模型决定

## Touches

- scripts/test.sh
- plugin/scripts/
- plugin/test/
- tasks/gap-tests-spawn-cli-from-ts-source.md
- tasks/gap-tests-use-cli-where-module-import-suffices.md
- tasks/gap-test-suite-has-no-layer-grouping.md
