---
id: gap-phase-overlap-field-always-false-negative
title: verification-round 的 phase_overlap 字段恒假阴性——full-suite-runner 读 QUAY_PHASE_OVERLAP env 而生产链路从未导出它（3/241 条记录，全部来自 08-16 手工探索轮，从未出现在真实 fan-in 轮）
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（manager 实测 + outer 独立核实，2026-08-18 05:2xZ）**：`verification-round.jsonl` 的 `phase_overlap` 字段**恒假阴性**——全库 241 条记录里 `phase_overlap:true` 只出现 **3 次**，且全部来自 08-16 主检出手工触发的探索轮（taskId:null），**从未出现在任何一次真实 fan-in worktree 轮次**——即便相位重叠（serial+lowconc 并行）明明每轮默认在跑。

**根因（读代码核实）**：`full-suite-runner.ts:3705` 只在 **runner 自己进程**的 `process.env.QUAY_PHASE_OVERLAP === "1"` 为真时写 `phase_overlap:true`；但生产链路（fan-in-execute.js → scripts/test.sh）**从未显式导出这个变量**——默认值只活在 test.sh 内部（`:1024 PHASE_OVERLAP="${QUAY_PHASE_OVERLAP:-1}"`），`PHASE_OVERLAP` 赋值不 export 到子进程，full-suite-runner（test.sh 的子进程）读不到 ⇒ **runner 侧恒 undefined ⇒ 恒不写 phase_overlap:true**。

**影响**：该字段设计意图是「区分这轮开没开相位重叠」（`gap-phase-overlap-two-phase-parallel-exploration` AC1 的产物）——前后对照（serial_phase_ms + lowconc_phase_ms）可借它区分 overlap 轮与 baseline 轮。**字段恒假 ⇒ 该区分能力失效**：读它的人会以为「3 轮开过、238 轮没开」，实际「240+ 轮默认全开」。硬规则 3b：字段名会让人以为它管用，比没有该功能更贵（同 `instrument-failure-check` fixture 形态）。

**能取假（⊢ 对照）**：修复后，一次真实 fan-in 轮（默认 QUAY_PHASE_OVERLAP=1）在 verification-round.jsonl 产生 `phase_overlap:true` 记录（或至少 field 与真实 overlap 状态一致）；不再恒假。

## Plan

1. 读 full-suite-runner.ts:3705（env 读点）与 scripts/test.sh:1024（PHASE_OVERLAP 赋值）——确认 export 缺口。
2. 修法（二选一）：
   - ① **test.sh 显式 export QUAY_PHASE_OVERLAP**（`export QUAY_PHASE_OVERLAP="${QUAY_PHASE_OVERLAP:-1}"`）——runner 子进程可见；
   - ② **full-suite-runner 改为从 test.sh 传递的 phase 数据自判**（已有 serial_phase_ms/lowconc_phase_ms，可推断 overlap）——不依赖 env。
   倾向 ①（最小改动，env 语义与 test.sh 内默认一致）。
3. 对照实测：一次真实 fan-in 轮（默认）→ verification-round 行带 `phase_overlap:true`；或 field 与真实状态一致。
4. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: 真实 fan-in 轮（默认 QUAY_PHASE_OVERLAP=1）的 verification-round 记录带 `phase_overlap:true`（或 field 与真实 overlap 状态一致），不再恒假阴性。
- [x] AC2: 手工 QUAY_PHASE_OVERLAP=0 的轮仍不写（field 真实反映关闭状态）。
- [x] AC3: 对照实测：修复后一轮真实 fan-in → field 正确。
- [x] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] phase_overlap 字段对真实 fan-in 轮正确写入（不再恒假），overlap 轮与 baseline 轮可区分，scoped + 全量绿。

## Touches

- scripts/test.sh（PHASE_OVERLAP 显式 export，runner 子进程可见）
- plugin/scripts/full-suite-runner.ts（若走修法②则改为自判；否则仅确认读点）
- plugin/test/full-suite-runner.test.mjs（phase_overlap 写入测试）
- plugin/test/（fan-in 真实轮 phase_overlap 断言）
- tasks/gap-phase-overlap-field-always-false-negative.md（自身）

## Evidence（invoke 实跑）

**修法选择：②（stream 自判），非 ①。** 读代码确认 Proposal 的「runner 是 test.sh 的子进程」方向写反了：
`full-suite-runner.ts` 是 **父进程**（`spawn("bash", ["-c", command], { env: suiteEnv })`，`:2181 baseCommand = "bash scripts/test.sh"`），
它把 `QUAY_SERIAL_CONCURRENCY`/`QUAY_LOWCONC_CONCURRENCY` 传给子进程 test.sh（`:2176-2178`），而 `process.env.QUAY_PHASE_OVERLAP`
读的是 **runner 自己的 env**（由 fan-in-execute.js 传入，生产从不设置）。默认值 `1` 只活在 test.sh 内部的 shell 变量
`PHASE_OVERLAP="${QUAY_PHASE_OVERLAP:-1}"`（`:1035`，未 export）——对父进程 runner 不可见。故修法①（test.sh export）
不可能修好 runner 的读点（方向反了）。

**实现**（`plugin/scripts/full-suite-runner.ts`）：新增 latch `phaseOverlapRan`（见 `overlap: running` 流标记时置 true、永不复位），
`:3698` 由 `process.env.QUAY_PHASE_OVERLAP === "1"` 改为 `phaseOverlapRan`。`overlap: running` 是 test.sh 唯一在
「PHASE_OVERLAP=1 且 serial+lowconc 均非空」时才发出的真值标记（`:1584-1587`），反映的是**实际调度**而非 env 意图——
AC1 的「field 与真实 overlap 状态一致」语义。

**scoped 测试**（`bash scripts/test.sh --for-task gap-phase-overlap-field-always-false-negative --allow-thin`，thin=0.40 因 Touches 含 3 个非测试文件项，属预期）：
```
ℹ tests 150
ℹ pass 150
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 112581.419334
EXIT=0
```
关键断言（真实 runner 二进制 spawn，写真实 verification-round.jsonl 再读回）：
```
✔ AC2 — PHASE_OVERLAP round: the overlap window closes at the second done-marker and MAIN is NOT swallowed into serial (932ms)
   — 该测试已去掉 env QUAY_PHASE_OVERLAP，仅凭流标记 `overlap: running` 断言 rec.phase_overlap === true（生产恒假阴性形态）
✔ gap-phase-overlap-field-always-false-negative — a SEQUENTIAL round does NOT flag phase_overlap even when QUAY_PHASE_OVERLAP=1 is in the runner env (790ms)
   — 新增反向对照：env=1 但流是顺序路径 ⇒ field 缺省（证明 field 反映实际、不读 env）
```

**AC 映射**：AC1 = overlap 轮不带 env 也写 `phase_overlap:true`（改后的 AC2 测试，去掉 env）；AC2 = 顺序轮带 env=1 仍不写（新增对照测试）；
AC3 = 上述两条构成 overlap-vs-sequential 对照实测（都经真实 runner 二进制 + 真实 round record）。「真实 fan-in 轮」的首个生产
`phase_overlap:true` 记录由外层全量 suite 在 fan-in 时自然产生（full-suite-runner 是唯一写 verification-round 的入口，fan-in 不重复写）；
本 inner 任务 scoped-only 无法产出真实 fan-in 轮，该确认属 fan-in 步骤。AC4 = scoped 150/150 绿 + 静态检查全 PASS。
