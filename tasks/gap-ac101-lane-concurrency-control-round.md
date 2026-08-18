---
id: gap-ac101-lane-concurrency-control-round
title: AC101 600s 根因对照轮——QUAY_MAX_CONCURRENT_SUITES=1 的 lane 对照实验（serial+main 556s=93% 预算，S=2 默认砍半并发与裁定方向相反）
status: ready
labels:
  - gap
  - experiment
  - performance
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**背景（manager 实测 + outer 独立核实，2026-08-17 23:5xZ）**：AC101 600s 目标（人裁定「绝不接受 suite >600s」，宁可不并发多 suite）当前未达标——末 4 次干净单跑真墙钟 738/682/728/609s。609s 的相分解：serial 301.0s(49.7%) + main 255.2s(42.2%) = **556s = 93% 预算**。main 相打包效率 94.4%（sum_ms=1928255 floor=241032 在 concurrency=8 下）——不是调度浪费，是 **lane 数封顶**。

**根因（读代码核实）**：`full-suite-runner.ts:1561 defaultLaneCount()` 与 `scripts/test.sh:999 serial_lowconc_host_default()` 共用 `max(1, floor(nproc × oversub / S))`，`S = QUAY_MAX_CONCURRENT_SUITES` **默认 2**。本机 nproc=16 ⇒ 三相全部 concurrency=8（日志实证）。**即使只跑一个 suite，也永久按「要给第二个 suite 留一半机器」收税**——与人「用并发换时长」的裁定方向相反。

**⚠️ 不投递结论**（硬规则④推论四）：「S 改 1 就能进 600s」需要**对照轮**验证——同 commit、`QUAY_MAX_CONCURRENT_SUITES=1` 跑一次，对比 serial/main 两相。这正是 `gap-fan-in-turn-budget-suite-timeout` 原本要做的 lane 对照实验，而该任务实际落的是回合预算承载（9327056a），**对照轮从未跑过**。

**执行路径（必须，2026-08-18 00:2xZ manager 反向意见采纳）**：**对照轮与基线两侧均须经 `full-suite-runner` 直调**（不走 fan-in 写入路径）。依据：
- `full-suite-runner.ts:3293` 的 `durationMs = Date.parse(finishedAtIso) - Date.parse(startedAt)`，`finishedAtIso = new Date()` 在 suite 结束当场取——**自己的钟，全程无轮询** ⇒ `gap-fan-in-suite-duration-poll-granularity-inflation`（fan-in 分支 0-60s 虚高）对直调路径**不适用**；
- 富字段（相耗时 + nproc/concurrentSuiteSlots/concurrentSuitesRunning）本就是 `full-suite-runner.ts:3632` 写的 ⇒ `gap-fan-in-verification-round-thin-schema-phase-gap` 对直调路径**不适用**。
⇒ **两条前置缺陷都只存在于 fan-in 写入路径；两侧直调则两条都不碰，对照轮不依赖它们**。`gap-fan-in-suite-duration-poll-granularity-inflation` 与 `gap-fan-in-verification-round-thin-schema-phase-gap` 作为**独立机制缺陷**照常修（修的是常态 fan-in 轮的可观测性，与对照轮解耦），但**不是本任务的 depends_on 前置**（原 depends_on 会被 slot-refill step-4 deps-ready 压在池里，AC3 的「两侧直调」出口根本走不到——判据写了出口，派发机制不认它）。

**能取假（⊢ 对照）**：对照轮跑完，若 `QUAY_MAX_CONCURRENT_SUITES=1` 的 serial+main 两相墙钟 + 前置 ≤ 600s（对照 609s 基线），则结论成立 ⇒ 改默认值（S=2→1）+ 落地；若不成立 ⇒ S 不是主因，回 manager 的候选清单继续（serial 301s 整族/文件级清单）。两种结果都是有效产出。

**补强判据（manager 08-18 更正——单轮墙钟易被「这轮恰好慢」解释掉，吞吐反事实更难）**：同天实测真实独跑 n=11 墙钟中位 **823s** / 4.14 轮/h vs 真实重叠 n=8 墙钟 **1421s** / 3.72 轮/h；那 8 轮按独跑中位串行=110min vs 实际并发=129min（**并发比串行慢 18%**）。对照轮应同时记录两口径**吞吐（rounds/h）**——S=1 若串行吞吐 ≥ 并发吞吐即证成，不单靠单轮墙钟。⚠️ **823s 真值离 600s 差 37%，S=1 单独达不到 600s**——需 lock_wait 消除（`gap-verification-round-observability-holes` AC1）+ serial phase 并发 8→16 一起上；对照轮的「≤600s」判据应据此重述（S=1 的产出=吞吐证成 + 墙钟接近，600s 是组合目标非 S=1 单独目标）。

**稳定性阈值判据（manager 08-18 6h 吞吐分析——比吞吐更强的判据）**：6h 实测 **15 suite → 2 land = 7.5 轮/任务**（正常应 1–2），绝大部分 suite 为重试服务。根因 ff-only 协议 + 千秒级 suite ⇒ `P(ff失败)=1-exp(-λT)`（λ=6.2 提交/h，T=suite 时长）：1065s⇒P=84%（期望 6.2 次尝试）、600s⇒64%（2.8 次）、300s⇒40%（1.7 次）。**正反馈环**：suite 慢→ff 失败率高→同任务多轮 suite→并发争抢→suite 更慢→回起点（活例：suite-fix-relaunch 三次翻 done 两次 revert，一任务烧 3 轮完整 suite）。当前 84% 在曲线悬崖边——再多一个并发（λ↑）即可能进入不收敛态。**⇒ 600s 不是性能优化、是稳定性阈值**：低于它 fan-in 收敛、高于它靠重试空转（「5 槽满却只 2 land」的机制解释）。**对照轮判据**：除墙钟外记录 **ff 成功率 / revert done→ready 次数**——它测「系统收敛」而非单轮墙钟，与吞吐反事实互补（吞吐测产能、ff 成功率测收敛）。

**⚠️ 执行顺序前置（2026-08-18 注记，gap-suite-concurrency-ff-gate-and-slot-ssot 落地后）**：本任务设 S=1 的对照轮**必须先等** `gap-suite-concurrency-ff-gate-and-slot-ssot` 的层 2（槽数由 S 生成）落地——**否则设 S=1 得到的仍是「2 槽 × 16 lane = 32 lane 超订」**（槽文件写死 `.0/.1`、lane 除数按 S 算但槽不联动），对照轮测错对象。层 2 落地后 S=1 才真正单槽单 lane 集（仅 `.0`、lane=nproc×oversub/1）。

## Plan

1. **对照轮（两侧直调 full-suite-runner，不依赖 fan-in 路径）**：同当前 develop commit，`QUAY_MAX_CONCURRENT_SUITES=1` 直调 `full-suite-runner` 跑一次全量 suite（单 suite，无并发，S=1）；同 commit、`S=2`（默认）直调跑**基线对照**。两侧各自记录 serial/main 两相墙钟 + 总墙钟 + verification-round durationMs（rich-schema）。
2. **同 commit 同负载**：对照轮与基线必须同 commit、同负载（nproc/load 记录在案）——「同口径」（同一 writer）与「同负载」是两条独立轴，都须满足。
3. 对比基线（609s 分解：serial 301 + main 255 + 前置 47-68，同口径 S=2 直调复核）：S=1 ⇒ concurrency=16 ⇒ main floor 减半（240→120s 理论）。**⚠️ 但须控制 overlap 变量（manager 08-18 指出）**：「concurrency=16 真并行」假设在 QUAY_PHASE_OVERLAP 开启时不成立——serial 与 lowconc 并行各拿 16 时重叠窗口 16+16=32 lane，超订反而比现在更严重。对照轮必须**两侧固定 `QUAY_PHASE_OVERLAP` 同值并记录**（建议 off，隔离出 S 的单一效应），或做 S×overlap 2×2；否则测的是两变量叠加、归因不了（`gap-lane-formula-ignores-phase-overlap-concurrency` 是这条的独立修复，但对照轮不能等它 land 才跑）。
4. 判定：总墙钟 ≤600s ⇒ 改默认 S=2→1 + 落地；否则回 manager 候选清单（serial 相文件级耗时清单是下一候选）。
5. scoped 门（`--for-task`）+ 全量验证，fan-in（改默认时）。

## Acceptance Criteria

- [x] AC1: 对照轮跑完——同 commit、`QUAY_MAX_CONCURRENT_SUITES=1` 的单 suite 全量，serial/main 两相墙钟 + 总墙钟 + verification-round durationMs 记录在案。
- [x] AC2: 判定有产出：≤600s ⇒ 改默认 S=2→1 并落地；>600s ⇒ 记录 serial 301s 的候选路径（文件级清单）为下一候选，不空转。
- [x] AC3: **对照轮与基线两侧均经 `full-suite-runner` 直调**（同一 writer/同口径——rich-schema 相字段 + nproc/concurrentSuiteSlots 两侧都有）；**不依赖** `gap-fan-in-suite-duration-poll-granularity-inflation` / `gap-fan-in-verification-round-thin-schema-phase-gap`（两者只影响 fan-in 写入路径，对直调路径不适用）；不用 fan-in 落地行做基线（round227 落噪声带）。
- [x] AC4: 对照轮不误伤正常 fan-in（单次实验轮，不并发；与在飞 fan-in suite 不并行）。
- [ ] AC5: 测试全绿 + `--for-task` scoped 门绿（若改默认）。**N/A — 判定 >600s，未改默认，条件「若改默认」不触发。**

## Definition of Done

- [x] S=1 对照轮跑完并给出判定（改默认或转 serial 候选），AC101 600s 目标有真实数据支撑的下一步，scoped + 全量绿（若改默认）。

## Evidence

对照轮两侧均经 `full-suite-runner` 直调（同 commit `d5d4835c`、同 nproc=16、`QUAY_PHASE_OVERLAP=0` 两侧固定同值），verification-round.jsonl rich-schema 记录（`<worktree>/.quay/verification-round.jsonl`）：

| | S=2 基线 | S=1 对照 |
|---|---|---|
| durationMs | 1750753 (1750.8s) | **872413 (872.4s)** |
| laneCount / concurrentSuiteSlots / concurrentSuitesRunning | 8 / 2 / 1 | 16 / 1 / 1 |
| static / serial / lowconc / main phase_ms | 85617 / 590264 / 427767 / 598388 | 50615 / 281044 / 183617 / 312178 |
| tests | 5214 (fail 1) | 5214 (fail 5) |

**判定（AC2）**：S=1 总墙钟 872.4s **>600s** ⇒ 不落 S=2→1 默认，记录 serial 候选路径为下一候选（文件级清单在 `experiments/quay-perpetual-stream/lane-concurrency-control-round.md`）。S=1 提供 50.2% 总提速（三相全提速：serial 590→281、main 598→312、lowconc 428→184），证实「S=2 默认砍半并发与裁定方向相反」的根因判断，但单靠 S 不够 600s（manager 08-18 补强判据「S=1 单独达不到 600s」获证）。

**失败均为 environmental 非 develop 代码缺陷**：S=2 基线 fail 1 = `tmux-leak-scan.test.mjs`（环境 tmux 残留）；S=1 对照 fail 5 = 5 个测试 fixture 硬编码 S=2 期望，在 `QUAY_MAX_CONCURRENT_SUITES=1` 下断言 S=2 行为（TS 侧 `suiteLockSlotCount()` 不 honor `RESOURCE_GATE_CONCURRENT_SUITES` seam——改默认前必须先补，见记录文件「附加发现」）。

## Touches

- scripts/test.sh（若 AC2 判定改默认：`QUAY_MAX_CONCURRENT_SUITES` 默认 2→1；serial_lowconc_host_default / RESOURCE_GATE_CONCURRENT_SUITES 语义）
- plugin/scripts/full-suite-runner.ts（若 AC2 判定改默认：defaultLaneCount 的 S 默认值）
- plugin/test/full-suite-runner.test.mjs（默认值变化回归）
- experiments/quay-perpetual-stream/lane-concurrency-control-round.md（对照轮记录——实验产出，证据段；具体文件，非 `**`，避免命中 SHARED_STATE_PATHS 被 assembleBatch 序列化）
- tasks/gap-ac101-lane-concurrency-control-round.md（自身）
