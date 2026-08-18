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

- [ ] AC1: 真实 fan-in 轮（默认 QUAY_PHASE_OVERLAP=1）的 verification-round 记录带 `phase_overlap:true`（或 field 与真实 overlap 状态一致），不再恒假阴性。
- [ ] AC2: 手工 QUAY_PHASE_OVERLAP=0 的轮仍不写（field 真实反映关闭状态）。
- [ ] AC3: 对照实测：修复后一轮真实 fan-in → field 正确。
- [ ] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] phase_overlap 字段对真实 fan-in 轮正确写入（不再恒假），overlap 轮与 baseline 轮可区分，scoped + 全量绿。

## Touches

- scripts/test.sh（PHASE_OVERLAP 显式 export，runner 子进程可见）
- plugin/scripts/full-suite-runner.ts（若走修法②则改为自判；否则仅确认读点）
- plugin/test/full-suite-runner.test.mjs（phase_overlap 写入测试）
- plugin/test/（fan-in 真实轮 phase_overlap 断言）
- tasks/gap-phase-overlap-field-always-false-negative.md（自身）
