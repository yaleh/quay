---
id: gap-fan-in-verification-round-thin-schema-phase-gap
title: fan-in 落地行（瘦 writer）无相字段——serial/main/static 耗时与 nproc/concurrentSuiteSlots 全缺，趋势账本对主落地路径持续产出无相行（round228-233 全瘦，227 是最后富行）
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-fan-in-suite-duration-poll-granularity-inflation
---
**type:** execution

## Proposal

**现象（manager 实测 + outer 独立核实，2026-08-18 00:1xZ）**：`verification-round.jsonl` 两个写入器字段面**不对等**：
- **富 schema**：`full-suite-runner.ts:3632 appendVerificationRound()`——带 `serial_phase_ms/lowconc_phase_ms/main_phase_ms/static_phase_ms/phases`、`nproc/concurrentSuiteSlots/concurrentSuitesRunning`、`pass/fail/tests/per_test_ms`、`ceiling`、`mem_peak_mb`。
- **瘦 schema**：`pre-verified-round-record.ts:176` record 字面量——**恰 12 字段**：`round/startedAt/durationMs/laneCount/load/state/runner/scope/commit/preverified/taskId/runId`（+CLI 传 `cpu_time_s/cpu_source`）。**无任何相字段，也无 nproc/concurrentSuiteSlots/concurrentSuitesRunning、无 pass/fail/tests、无 ceiling**。

**直接量（outer 独立核读）**：`verification-round.jsonl` 逐行按字段存在性核：最后一条带相数据 = **round 227 @ 2026-08-17T04:13:31Z**（has_phase=True, has_nproc=True）；**228/229/230/231/232/233 六行全瘦**（has_phase=False, has_nproc=False）——228-230 是 preverified:true、231-233 是 preverified:false（真跑）。233 是 23:51 刚落轮仍无相。⇒ **缺口不是历史窗口，是现行常态**——fan-in 落地是当前主路径，每次落地都产出无相行。

**影响**：
① **直接卡 `gap-ac101-lane-concurrency-control-round`（lane 对照轮）**：对照轮判「S=1 是否主因」必须用相耗时 + concurrentSuiteSlots/concurrentSuitesRunning。若对照轮直调 full-suite-runner ⇒ 富 schema、自己有这些字段；**但基线没有**——常态 fan-in 轮全是瘦 schema ⇒ 对照轮与基线**不同口径无法直接比**；唯一同口径基线 round 227 距今 ~20h、不同代码/负载 ⇒ 落噪声带（与「同负载」是不同轴：那条管【同负载】，这条管【同口径】，两条都不满足 ⇒ ② 得不出可判定结论）。
② **趋势账本继续结构性盲**：serial/main 相耗时是 AC101 600s 的最大单块（serial 301s 49.7%），账本若无相字段，「serial 是不是主因」永远只能从 /tmp 日志现拼（manager 的 6 轮相分解正是这么来的）。

**数据没丢，修复成本低**：相数据当下就在 suite 日志末尾 `__OVERHEAD__` 段（`run_static_checks_ms=/gap_ms_pre_to_serial_ms=/serial_phase_ms=/lowconc_phase_ms=/main_phase_ms=`）与 `__GROUP__` 段（`concurrency=/files=/sum_ms=/floor_ms=`）。瘦 writer 解析该日志段补字段即可。

**⚠️ 两分支分别对待**（manager 明确不下结论，我也如实记录）：`preverified=0`（真跑）日志路径确定（fan-in suite log），可直接解析；`preverified=1`（复用调用方 capture）的日志由调用方在别处产生，**路径不一定确定**——该支需要单独定案（capture 里带日志路径，或明确记为无相数据）。**不把两分支一概而论**。

**能取假（⊢ 对照）**：修复后，一次 fan-in 落地（真跑分支）的 verification-round 行带 serial/main/static 相字段 + nproc/concurrentSuiteSlots/concurrentSuitesRunning（与 full-suite-runner 同构或至少同口径），`/tests` 与 lane 对照轮能读到；不再需要从 /tmp 日志现拼。

## Plan

1. 读 pre-verified-round-record.ts 的 record 构建（:176）与 full-suite-runner.ts 的 appendVerificationRound 富字段（:3632）——确认差异清单。
2. 修法：瘦 writer 解析 suite 日志 `__OVERHEAD__`/`__GROUP__` 段补相字段 + 并发变量（日志路径：fan-in suite log，`/tmp/fan-in-suite-${task}.log`）；`preverified=0` 分支直接解析。
3. **`preverified=1` 分支单独定案**：capture 里带日志路径（调用方写 capture 时记下 log 路径），或该支明确记为无相数据（不伪造）。manager 对该支路径确定性无读数 ⇒ 实现时实测再定，不预断。
4. 确认与 full-suite-runner 富 schema 同构或至少同口径（lane 对照轮要能直接比）。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: 真跑分支（preverified=0）fan-in 落地的 verification-round 行带 serial/main/static 相字段 + nproc/concurrentSuiteSlots/concurrentSuitesRunning（与 full-suite-runner 同构或同口径）。
- [x] AC2: preverified=1 分支单独定案（capture 带日志路径或明确无相），不伪造、不两分支一概而论。
- [x] AC3: `gap-ac101-lane-concurrency-control-round` 能用修复后的行与基线同口径比较（对照轮判定前提满足）。
- [x] AC4: 对照实测：一次 fan-in 落地 → 行带相字段；`/tests` 与 lane 对照轮读得到。
- [x] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] fan-in 落地行带相字段与并发变量（真跑分支），preverified 分支单独定案，趋势账本对主落地路径恢复相级可见，lane 对照轮同口径可比，scoped + 全量绿。

## Touches

- plugin/scripts/pre-verified-round-record.ts（瘦 writer 补相字段 + 并发变量——解析 suite 日志 `__OVERHEAD__` 段；preverified=1 分支单独定案；本地复刻 full-suite-runner 并发口径）
- plugin/test/pre-verified-round-record.test.mjs（相字段解析测试 + preverified 分支定案回归 + 并发变量口径；原 Touches 误写 plugin/scripts/ 路径，已修正为 plugin/test/）
- plugin/workflows/fan-in-execute.js（SUITE_LAUNCH capture 记 suite_log_file；step 4.5 preverified-round-block 传 --suite-log）
- .claude/workflows/fan-in-execute.js（同上——workflows 双份拷贝同步，workflows-dual-copy-drift-check 要求两拷贝一致）
- plugin/test/fan-in-execute-paths.test.mjs（fan-in 落地行带相字段断言 + preverified 分支单独定案回归）
- packages/quay/src/observation.ts（/tests 读取相字段 + 并发变量，TestRunRecord 扩展）
- packages/quay/test/serve-ac95-views.test.mjs（/tests 读取相字段回归）
- tasks/gap-fan-in-verification-round-thin-schema-phase-gap.md（自身）
