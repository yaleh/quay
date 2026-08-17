---
id: gap-fan-in-fix-commit-delta-escapes-touches-coverage
title: fan-in fix-agent 提交在 anti-drift-touches 检查之后——fix commit 触碰的越界文件不被 Touches 覆盖（实测 c2917261 漏 1 文件）
status: ready
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

**现象（inner 报 + outer 独立核实，2026-08-17 22:1xZ）**：`gap-worktree-remove-orphans-probes` fan-in 中，fix agent 提交 `c2917261`（修 scoped 门跨测试干扰，hermetic seam）改了 **`plugin/test/full-suite-runner.test.mjs`（+9 行）——不在任务 Touches**。fan-in 正常 land（04da39fc），anti-drift 没拦住。

**根因（读 fan-in-execute.js 核实）**：anti-drift-touches 守卫（`gap-anti-drift-touches-zero-coverage-fast-mode` 的产物）在 **step 1（merge develop 后立即）** 跑一次：`anti-drift-touches-check.ts` 用 `git diff --name-only ${mergeTarget}...HEAD` 对照声明 Touches。**fix-agent 的修复提交发生在 step 1 之后**（suite 红 → suite-fix 补丁 commit → 重跑）——该提交新增的文件 diff 从没被 re-check。⇒ **anti-drift 对「fix commit 之后引入的文件」结构性盲**。

**与既有任务的关系**：`gap-anti-drift-touches-zero-coverage-fast-mode`（done）把 anti-drift 接进 fan-in，但只覆盖「merge 后一次」。`gap-worktree-remove-orphans-probes`（done）的 impl 本身 11 文件全覆盖 Touches，**缺口在 fix commit 这条旁路**。与今日「suite-fix 代理误改错误 worktree」同族（anti-drift 该拦形态的又一实例）。

**影响**：fix commit 可携带未声明文件越界触碰（尤其 fan-in 编排文件自身、test 文件），既没进 Touches 也没进 anti-drift 判定 ⇒ Touches 覆盖率数据（0/11 vs 11/11）失真；fix 补丁与任务声明的触碰边界脱节。

**能取假（⊢ 对照）**：修复后，一个在 anti-drift 检查之后引入的 fix commit 触碰未声明文件 ⇒ anti-drift HARD FAIL（不翻 done、不 ff），或至少被显式标出；正常 fix（全在 Touches 内）不误伤。

## Plan

1. 读 anti-drift-touches-check.ts 与 fan-in-execute.js step 1（现检查点）与 suite-fix 重跑路径（fix commit 插入点）。
2. 决定修法：
   ① **在 land 前重跑 anti-drift**（持锁段 step 4.5/5，suite 绿后、ff 前，`git diff --name-only ${mergeTarget}...HEAD` 已含 fix commit）——一处在 land 前兜底全部 delta（含 fix commit）；或
   ② **fix commit 后立即增量 re-check**（suite-fix 分支跑一次）。
   倾向 ①：land 前重跑一次，覆盖 merge + fix 全 delta，且位置在持锁段、与既有 HARD FAIL 语义一致（`exit 2` 不翻 done、不 ff）。
3. 确认不误伤：正常 fan-in（无 fix commit）重跑 anti-drift 幂等；`anti-drift-touches-check.ts` 判定逻辑不动，只挪/增调用点。
4. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: fix-agent 提交（anti-drift 首次检查之后引入）触碰未声明文件 ⇒ land 前重跑 anti-drift HARD FAIL（不翻 done、不 ff），或被显式标出。
- [ ] AC2: 正常 fan-in（无 fix commit 或 fix 全在 Touches 内）不误伤——重跑幂等。
- [ ] AC3: 判定逻辑（anti-drift-touches-check.ts）不变或最小变，只挪/增调用点。
- [ ] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] land 前（或 fix commit 后）anti-drift 覆盖全 delta（含 fix commit），越界触碰 HARD FAIL，正常 fan-in 幂等，scoped + 全量绿。

## Touches

- plugin/workflows/fan-in-execute.js（anti-drift 调用点增补——land 前重跑或 fix commit 后 re-check；双拷贝）
- .claude/workflows/fan-in-execute.js（同 dual-copy 的 landed 副本，与 plugin/workflows 逐字节一致）
- plugin/scripts/anti-drift-touches-check.ts（如需支持「fix commit 后增量」的输入形态；否则不动）
- plugin/test/fan-in-execute-paths.test.mjs（fix commit 越界触碰 HARD FAIL 路径测试 + 幂等回归）
- plugin/test/anti-drift-touches-check.test.mjs（判定逻辑回归）
- capability-catalog.sh（变更脚本的能力声明，如需）
- tasks/gap-fan-in-fix-commit-delta-escapes-touches-coverage.md（自身）
