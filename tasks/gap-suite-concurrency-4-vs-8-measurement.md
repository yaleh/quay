---
id: gap-suite-concurrency-4-vs-8-measurement
status: todo
labels:
  - gap
  - measurement
  - milestone-candidate
parent: null
children: []
extra: {}
---
---
id: gap-suite-concurrency-4-vs-8-measurement
title: "nproc=4 while --test-concurrency=8 is 2x oversubscription — measure 4 vs 8, don't guess"
status: todo
labels:
  - gap
  - measurement
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

本机 `nproc=4`（4 物理核、每核 1 线程，外层 2026-08-02 独立核实），而 `scripts/test.sh` 默认
`--test-concurrency=8`——**8 个并发进程是 2 倍过订**。这不是新发现，但今天有了第一个**可归因的故障**：

- B6-1（`gap-suite-cost-model-is-wrong-optimizations-buy-nothing`）测出 `Σ duration_ms / 墙钟 ≈ 7.14`，
  并发度 8。但本机 4 核，比值 ≈8 只是「调度占位」，不能区分 CPU 吞吐受限 vs 延迟受限
  （`orchestration/throughput-decomposition.md` §163-165）。
- 2026-08-02 18:43，M243 合并后全量套件崩溃两次（127 文件 / 237 文件 'Promise pending'）——当时
  load1=16.62、两个 test.sh 并跑 = 4 倍过载（`throughput-decomposition.md` §194-217）。
- 2026-08-02 ~20:14，M136 合并后单套件 c8 全量又崩（253 文件）、c4 全量也崩（8037 文件 / 4013
  'Promise pending'）。隔离测试全绿、资源充足（内存/句柄/OOM 均正常）——崩溃集中在重型测试
  （experiments/* 的 proposal-convergence、it0-dod-check 等），这些测试隔离跑全绿、c4 子集 332/332 绿。

**待答问题**：并发度 4 与 8 对套件墙钟和稳定性的真实影响是什么？过订对 IO 密集测试可能有利、
对 CPU 密集不利，本套件两者都有——**必须实测，不要按直觉设**。

**不做**：不在没测过的情况下把 `--test-concurrency=4` 设为本机默认（那是 416s 上限那个错误的翻版——
在未知成本结构时改全局参数）。**不做任何优化**——这是测量任务，结论由数据定。

## Chosen mechanism

同一 commit 上，`--test-concurrency=4` 与 `=8` 各跑若干次，对照已测出的噪声带宽（20–63 s）
判定差异是否可测：

1. **锁定 commit**：在 master 当前 HEAD 上跑（记录 commit hash）。
2. **每个并发度至少 3 次**：`scripts/test.sh --test-concurrency=4` ×3、`=8` ×3（或更多，取中位数）。
3. **严格单套件、干净环境**：每次只跑一个 test.sh，load1 < 2 时启动，两次之间确认无残留测试进程。
   这是今天「双套件并跑 = 4 倍过载」教训的直接应用。
4. **记录每次**：墙钟、tests/pass/fail/skip、是否有 'Promise pending' 崩溃、失败文件数。
5. **对照判定**：6 次的墙钟中位数极差 vs 20–63s 噪声带宽——差异落在带内则「不可判定」，
   带外且一致方向才可断言「4 更慢/更快/更稳」。
6. **稳定性是第二维度**：崩溃次数本身是数据——如果 c8 频繁 'Promise pending' 而 c4 稳定，
   那即使墙钟不可判定，「c4 更稳」也是可测的结论。

**明确不做**：不基于本次结果**立即**改 test.sh 默认（那是另一个决策，需要本任务的数据 + 外层裁定）。

## Acceptance Criteria

- [ ] AC1: 同一 commit 上 `--test-concurrency=4` 与 `=8` 各至少 3 次全量跑，墙钟全部记录
- [ ] AC2: 每次严格单套件、load1<2 启动、无残留进程；跑完确认无 test.sh/node --test 残留
- [ ] AC3: 6+ 次的墙钟中位数、极差对照 20–63s 噪声带宽，判定「可测差异 / 不可判定」
- [ ] AC4: 崩溃频率单独记录（c8 vs c4 各几次 'Promise pending'、失败文件数）——稳定性是独立维度
- [ ] AC5: 结果写入任务体：每次的墙钟/崩溃数、中位数对照、判定结论
- [ ] AC6: 明确记录对「是否把 c4 设为本机默认」的建议（由数据支持，非直觉；最终决策在外层）
- [ ] AC7: 引用 `orchestration/throughput-decomposition.md` §194-217 的故障证据链
- [ ] AC8: 测试带 `// @test-group engine` 声明（若产出脚本/测试）

## Definition of Done

- [ ] 6+ 次全量的完整墙钟/崩溃数据贴进任务体
- [ ] 判定结论明确：并发度对墙钟和稳定性的可测影响（或「在噪声内不可判定」如实写）
- [ ] 对「c4 是否应为本机默认」给出数据支持的倾向（不是决策本身）
- [ ] 记录与 `--test-concurrency=8` 全量崩溃历史的关联（M243 后 127/237、M136 后 253/8037）

## Touches

- scripts/test.sh（只读：确认 concurrency 参数机制，不改默认）
- orchestration/throughput-decomposition.md（引用，可能补充结果）
- measurements/（若复用 measure-suite 工具）
- 无产品代码改动
