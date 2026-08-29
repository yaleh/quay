---
id: gap-scoped-static-check-red-no-fail-machine-line
title: scoped 静态检查 fail-closed 非零退出无 FAIL 行——同步 run_checker 不吐
  STATIC_CHECK_FAILED 机器行（仅并行路径有）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

scoped 门（`bash scripts/test.sh --for-task <task> --allow-thin`）里一个 fail-closed checker 失败时，脚本非零退出但**输出里没有任何 `STATIC_CHECK_FAILED` 机器行**。机制：

`plugin/scripts/checker-cost-lib.sh` 的 `run_checker` 有两条路径——
- **并行路径**（`run_checker_parallel_wait:195`，全量 suite 的 `run_static_checks` 用）：为每个失败 checker 发射 `STATIC_CHECK_FAILED: <name> exit=<rc>`（`gap-static-check-red-failures-capture-only-task-contract-shape` 加，done）。
- **同步路径**（`run_checker:134-149`，scoped 层 `run_scoped_static_checks_sel` 与 doc 检查用）：走到最后只是 `return "$_rc"`，**exit 1（RED）/ exit 2（usage）都无机器行**——只有 exit 3（NOT-EVALUATED）有独立行 `STATIC_CHECK_NOT_EVALUATED`（`:145`）。

scoped 层为什么走同步路径：`scripts/test.sh:414-418` 的 `while … eval "${cmd}"` 循环，`RUN_CHECKER_PARALLEL` 未设（只有全量 `run_static_checks` 在 `runner-static-gate.ts:73` 设成 1）。于是 checker 失败 → `eval` 返回非零 → `set -e` 中止 → **非零退出、零 FAIL 行**。

**实证规模（worker-outcome.jsonl）**：`mechanical_fan_in.step=scoped-gate` 的红记录 26 条，其中 25 条的 `reason` 全是良性 preamble（`refresh-worktree-quay: copied N file(s)` + `MODULE_TYPELESS_PACKAGE_JSON` 警告），零失败详情。D6 的 `extractFailureSummary`（worker-driver.ts:1634）已合并 stdout+stderr 并按 FAIL 正则抓信号行，但**门自身的输出里没有 FAIL 行可抓** ⇒ summary 回退到「非噪声行」= 良性 preamble。即：一个 fail-closed checker 的身份从载体上消失（硬规则 3b/4b/9 同族）。

**与既有任务的边界（不重复）**：
- `gap-scoped-gate-reason-stderr-drops-stdout`（ready）讲 worker-driver `fail` 的 `||` stderr 短路，已被 D6 合并流取代——是「载体失真」半边；
- `gap-static-check-red-failures-capture-only-task-contract-shape`（done）加的机器行只落在**并行**路径，scoped 层当时不在范围。
- 本条是另一半：「**门自身的 scoped 静态检查路径不产生机器行**」——同步 `run_checker` 缺发射，与载体失真正交。

## Plan

`checker-cost-lib.sh` 同步 `run_checker` 分支（`:144-149`）在 `return "$_rc"` 前，对非零且非 NOT-EVALUATED(3) 的退出码发射 `STATIC_CHECK_FAILED: ${_name} exit=${_rc}`（stderr），与 `run_checker_parallel_wait:195` 同形。exit 3 仍走 `STATIC_CHECK_NOT_EVALUATED`，exit 0 不发射——不混淆第三态（硬规则 3b）。这样 worker-driver 的 `extractFailureSummary` 能抓到该行（命中 `\bFAIL\b` 与 `\bexit=\d+`），scoped-gate 红的 reason 从良性 preamble 变成「失败 checker 名 + 退出码」。

## Acceptance Criteria

- [x] AC1（能取假·scoped 层机器行）：scoped 门里一个 fail-closed checker（exit 1）⇒ `bash scripts/test.sh --for-task <task> --allow-thin` 的 stdout+stderr 合并输出含 `STATIC_CHECK_FAILED: <checker名> exit=<rc>`；（⛔ 仍只有良性 preamble / 无该行 ⇒ 假）。——同步 `run_checker` 已发射；scoped 门 eval 循环走同步路径（`run_scoped_static_checks_sel` test.sh:414-418 未设 RUN_CHECKER_PARALLEL，`--commands` 发射 `run_checker "<name>" …`），AC2 单测直接钉住该行。
- [x] AC2（能取假·单测钉死）：`plugin/test/checker-cost.test.mjs` 断言同步 `run_checker`（RUN_CHECKER_PARALLEL 未设）在 checker exit 1 时向 stderr 发射 `STATIC_CHECK_FAILED: <name> exit=1` 且返回该退出码；（⛔ 删掉发射 ⇒ 测试红）。——新测 `AC2 — synchronous run_checker … exit 1` 断言 `^STATIC_CHECK_FAILED: sync-red exit=1$` 且 status=1；直跑 17/17 绿。
- [x] AC3（第三态不混淆·硬规则 3b）：exit 3（NOT-EVALUATED）仍发射 `STATIC_CHECK_NOT_EVALUATED: <name>` 而非 `STATIC_CHECK_FAILED`；exit 0 不发射任何 `STATIC_CHECK_*` 行；（⛔ 第三态被当 RED / 通过被当失败 ⇒ 假）。——exit 0 负控（`doesNotMatch /STATIC_CHECK_/`）+ exit 3 负控（`doesNotMatch /STATIC_CHECK_FAILED/`，仍 NOT_EVALUATED）两测通过。
- [x] AC4（并行路径不回归·无重复发射）：全量 suite 的 `run_checker_parallel_wait` 仍每个失败 checker 恰一条 `STATIC_CHECK_FAILED`，full-suite-runner 的 failures[] 捕获不受同步路径新发射影响；（⛔ 并行路径双发射或漏捕获 ⇒ 假）。——并行路径 3 测（fail-closed/并发/bound）全绿；同步与并行分支互斥（`RUN_CHECKER_PARALLEL` 判定），无重复发射。

## Definition of Done

同步 `run_checker` 对非零非 NOT-EVALUATED 退出码发射 `STATIC_CHECK_FAILED: <name> exit=<rc>`；AC1–AC4 全勾；scoped-gate 红时 worker-outcome 的 `mechanical_fan_in.reason` 含失败 checker 名（非良性 preamble）。

## Touches

- plugin/scripts/checker-cost-lib.sh（同步 run_checker 发射 STATIC_CHECK_FAILED 机器行）
- plugin/test/checker-cost.test.mjs（同步路径机器行断言 + 第三态/通过负控）
- tasks/gap-scoped-static-check-red-no-fail-machine-line.md（自身）
