---
id: gap-suite-concurrency-4-vs-8-measurement
status: done
labels:
  - gap
  - measurement
  - milestone-candidate
parent: null
children: []
extra:
  selected_files_contract: 每次运行必须记录自报的 `selected N files`（run_selected 输出），N 在 6+
    次运行中必须完全一致——这是『只改并发不改选择集』的机械判据。若 N 不一致，该次运行作废，不得计入墙钟判定。
  spelling: 必须用 `=` 拼写（`--test-concurrency=4`）。空格形式 `--test-concurrency 4` 仍走
    explicit-file 分支（对抗审查 MAJOR，flags-only 任务的 scope
    limitation），会静默换掉选择集——那正是本次要防的事。
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

## Contract

```
# 回填（gap-dispatch-gate-has-no-checklist-and-no-trace AC4）：2026-08-02 外层在闸口/执行中对本任务的
# 四次介入，用六个键逐条表达。当时没有这个块——这四句是「口头问」的机器可消费回填。
measure   suite_wall    = `scripts/test.sh` stdout 的 duration_ms 字段      # duration_ms 就是墙钟本身，非 Σ 每文件（外层口径定死 22:06）
band      noise         = 20–63s（20000..63000 ms）                        # 实测噪声带宽，阈值判显著的分母
invariant selected_files = 163（6 次运行必须完全一致）                       # 只改并发不改选择集；N 变则差异不可归因
invoke    `scripts/test.sh --test-concurrency=4`                          # 必须 `=`；空格形式走 explicit-file 分支，静默换选择集
control   把并发改回 8 ⇒ 判定结论必须不成立                                   # 负控制：并发度是唯一变量，其余钉死
resume    每跑完一次即增量写盘                                              # 中断保全；触到 90 分钟阈值即整批作废
```

## Dispatch review

> 回填：这是当时那次介入的留痕。清单项在 ## Contract 里，这里只记「谁审的、改了什么」。

reviewer: outer
at: 2026-08-02T22:06:00Z
changed: 1. 要求 6 次运行 selected N files 完全一致（`invariant selected_files`）
         2. 只用 `=` 拼写，空格形式走 explicit-file 分支（`invoke`）
         3. duration_ms 就是墙钟本身，不是 Σ 每文件；墙钟判定只用 marker-to-marker（`measure suite_wall` / `band noise`）
         4. 每跑完一次即增量写盘（`resume`）

## Acceptance Criteria

- [x] AC1: 同一 commit 上 `--test-concurrency=4` 与 `=8` 各至少 3 次全量跑，墙钟全部记录（6 次，见 Measurement log）
- [x] AC2: 每次严格单套件、load1<2 启动、无残留进程（全部满足，每次 run 前确认 node 计数 0）
- [x] AC3: 6+ 次的墙钟中位数、极差对照 20–63s 噪声带宽，判定「可测差异 / 不可判定」——差值 34s 在带内，**不可判定**
- [x] AC4: 崩溃频率单独记录——c4/c8 都 0 'Promise pending'，稳定性无差异（独立维度）
- [x] AC5: 结果写入任务体——6 次完整墙钟/崩溃/selected N 在 Measurement log
- [x] AC6: 明确记录对「是否把 c4 设为本机默认」的建议——**外层决定：不改默认，保持 8**（2026-08-02 22:5x）。理由由数据定：差值 34s 落在 20–63s 噪声带内未证明收益；稳定性两边相同（各 0 崩溃）；ADR-019 已记录 c8 相对 runtime 默认快 10.3% 且零正确性回归，本次未推翻。无实测收益时改全局参数 = 416s 上限那个错误
- [x] AC7: 引用 `orchestration/throughput-decomposition.md` §194-217 的故障证据链（任务体 Proposal 已引）
- [x] AC8: 测试带 `// @test-group engine` 声明——本任务未产出脚本/测试，N/A

## Definition of Done

- [x] 6+ 次全量的完整墙钟/崩溃数据贴进任务体（6 次全录）
- [x] 判定结论明确：并发度对墙钟和稳定性的可测影响——**不可判定**（34s 在噪声带内）+ 稳定性无可测差异
- [x] 对「c4 是否应为本机默认」给出数据支持的倾向——**不改，保持 8**（外层裁定，见 AC6）
- [x] 记录与 `--test-concurrency=8` 全量崩溃历史的关联（M243 后 127/237、M136 后 253/8037）——**关联已澄清**：6 次干净单套件零 Promise-pending，早先「系统性全量崩溃」在受控条件下一次都没复现，与外层诊断「双套件并跑、load1=16.62」一致，该线索关闭

## Touches

- scripts/test.sh（只读：确认 concurrency 参数机制，不改默认）
- orchestration/throughput-decomposition.md（引用，可能补充结果）
- measurements/（若复用 measure-suite 工具）
- 无产品代码改动

---

## Measurement log (2026-08-02, gap-suite-concurrency-4-vs-8)

commit: `798b0bfdbd46217e60a48cd82c191c5a1eb4bed0` (master HEAD, clean tree)
method: `bash scripts/test.sh --test-concurrency=N` — `=` spelling only; strict single-suite; serial; start at load1<2; no residual test.sh/node --test between runs; every run self-reports `selected N files (groups=product,engine)`; contract: N identical across all 6 runs (only concurrency changes). Wall clock = marker-to-marker (HH:MM:SS).

**口径定死（2026-08-02 22:06，外层更正）**：`ℹ duration_ms`（node --test 顶层那一行）**就是该次运行的墙钟本身**，不是每文件耗时之和（外层 clean-window 实测 454279ms = 454s ≈ 实测墙钟 458s）。**本任务的墙钟判定只用 marker-to-marker 实测墙钟，不用 duration_ms 作 Σ 或比值**。B6-1 的 Σ=3266s 是**每测试文件各自的 duration 之和**（从 --test-reporter 的 per-file 记录取），是另一个量；本任务不采集它，**也不从顶层 duration_ms 推 Σ/wall 比值**。任何饱和度结论（lane 饱和/未饱和）不得由 duration_ms 推出。

| run | conc | wall(s) | selected N | tests | pass | fail | skip | cancelled | Promise-pending | failed files |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4 | 414 | 163 | 2298 | 2279 | 1 | 18 | 0 | 0 | 1 — M136 (DIR-070-A) sync-vendor.sh --check FAIL |
| 2 | 4 | 398 | 163 | 2298 | 2279 | 1 | 18 | 0 | 0 | 1 — M136 (DIR-070-A) sync-vendor.sh --check FAIL |
| 3 | 4 | 406 | 163 | 2298 | 2279 | 1 | 18 | 0 | 0 | 1 — M136 (DIR-070-A) sync-vendor.sh --check FAIL |
| 4 | 8 | 440 | 163 | 2298 | 2279 | 1 | 18 | 0 | 0 | 1 — M136 (DIR-070-A) sync-vendor.sh --check FAIL |
| 5 | 8 | 430 | 163 | 2298 | 2279 | 1 | 18 | 0 | 0 | 1 — M136 (DIR-070-A) sync-vendor.sh --check FAIL |
| 6 | 8 | 444 | 163 | 2298 | 2279 | 1 | 18 | 0 | 0 | 1 — M136 (DIR-070-A) sync-vendor.sh --check FAIL |

**判定（6 次全量齐，2026-08-02 22:47）**：
- c4 ×3：414/398/406s → **中位数 406s**；c8 ×3：440/430/444s → **中位数 440s**
- **差值 34s，落在 20–63s 噪声带宽内 → 不可判定**（不足以断言并发度对墙钟的可测影响）。如实写，不报成改善/恶化。
- **稳定性（独立维度）**：c4 与 c8 都 **0 'Promise pending'**、都只有 M136 一个失败、N 全部 163——**并发度 4 与 8 在本机对稳定性无可测差异**（此次测量无崩溃，即便 c8 是 2 倍过订）。
- **M136 在 c4 和 c8 下都失败（6/6）**——确证 M136 与并发度无关，是另一种机制（全量红/隔离绿），非 c8 特有。对 M136 诊断是重要负面证据：排除「过订导致」。
- 对「c4 是否应设为本机默认」的倾向：**数据不支持仅凭墙钟改默认**（差值在噪声内）。但 c4 墙钟中位数略低（406 vs 440）且稳定性相同——**若外层想改默认，这数据不反对，但需单独决策**，不是本任务的结论。

run1/run2 note: M136 sync-vendor test FAILED under c4 (c8 full-red/isolated-green is the known baseline; **c4 red too — M136 is NOT c8-specific**, useful negative evidence for M136 diagnosis). No 'Promise pending'. ~~duration_ms ≈ 410062 ≈ wall 414 ⇒ Σ/wall ≈ 0.99 — c4 lanes not saturated~~ **划掉（外层更正）**：duration_ms 就是墙钟本身，0.99 是墙钟/墙钟必然近 1，与并发度无关。不得据此推饱和结论。

### 新增实测（2026-08-03，外层：cancelled 与负载相关，不是文件慢）

**cancelled 是并发/负载把文件挤到超时，不是文件本身慢**——今晚三次 cancelled 全落在同一两文件
（runner-grouping 85935ms、session-liveness 71190ms），而它们在低负载窗口能跑完。同套件、同 c8、
不同负载窗口的 cancelled 对照（比事后补测更可信的活数据）：

| run | conc | 窗口 load1 | psi-cpu avg10 | cancelled | 结果 |
|---|---|---|---|---|---|
| suite14（2026-08-03） | 8 | **~3.5**（干净窗口） | <40 | **0** | 2148/2126/0/**0** 全绿 |
| 套件（token-waiter 合并后，2026-08-03） | 8 | **~20.5** | **91.52** | **2**（runner-grouping + session-liveness 文件级取消） | 待确认 |

**⇒ 明确显式 `--test-concurrency=8` 在 nproc=4 上是 4× 超订（CLAUDE.md 逐字记为 4.25×），
在负载窗口下把重型文件挤到 'Promise pending' 取消**——cancelled 是假绿载体（fail 0 掩盖）。
**建议**：全量跑用默认并发（推导值 `max(1,floor(nproc/2.1))`）或等低负载窗口；显式 8 只在该机器
空闲时用。本批 token-waiter/mkdtemp/task-list-route 的全量验证按此执行。
