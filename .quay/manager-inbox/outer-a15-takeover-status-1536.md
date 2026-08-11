## outer A15 ④ takeover — step-2 workflow fulfilled + round now workflow-governed (2026-08-10 15:3x)

**裁定:按你 15:3x 的建议,本轮兑现第二步——先写 workflow,再用它跑,不再裸跑。** 已执行:

**(A) `.claude/workflows/execute-suite-fix.js` 已写并提交(e6de2b36,含语法修正 amend)。** 结构照你给的三段骨架:
- `phase('Fix')`:agent 读全部 failures[] → 修根因 → worktree 内 commit → 启动全量 suite(env 放宽)
- `phase('Verify')`:脚本 `setTimeout(60s)` + agent 轮询 state.json 直到终态,等待完全由脚本控制流决定,不存在需要自己决定等待机制的 agent(ab380c5e 结构上不可复现)
- `phase('Merge')`:fan-in(worktree branch 合回 integration)+ batch-merge develop 到 verifiedCommit
- 内置 15:3x 五闸:①`QUAY_TEST_SUITE_MAX_RUNTIME_MS=7200000`(120min,默认 45min 会截断最坏 77min 的轮次)②`_SILENCE_MS=3600000` ③`_RED_GRACE_MS=180000`;④`isRealRedRound`(reason=failed ∧ tests≥2900)才当真实红轮迭代;⑤`isNonVerificationTerminal`(static-check/aborted/timeout/截断)⇒ 不算迭代,修阻塞后重跑。**轮询结果同时做验证轮判据分类(你 15:3x 建议写进 A15 ④ 的那条)。**

**(B) 15:3x 裁定已写进 A15 ④**(orchestrator-tick-core.md:37,同一提交):完整跑 suite、禁止部分执行/提前中止,五闸全枚举;验证轮判据 = `tests ≥ 2900` 或 `reason∈{static-check,aborted,timeout}` 标注「非验证轮,需重跑」;一轮 tick 若报「suite 已跑」必须同时给出该轮 `tests` 数。`state-worded-clause-check: 0` 绿。

**(C) 本轮状态(workflow 接管中):** runId=**新**(非 3939cf1c——那轮已 SIGTERM 中止,按 design onSignal 不 append 记录,非缺陷),被测 commit=**e6de2b36**(integration 顶 = 含全部 fan-in + 修复 + workflow + A15 ④ 规则),worktree=verify-suite-243 **冻结**(起跑前记 HEAD,workflow 的 Merge 前会再验 HEAD,不一致 ⇒ infra-error 不判绿)。workflow task id=whslz045g。

**若 workflow 出绿** → 它自行 fan-in + batch-merge,我核验后清 `.halt`;**若红** → 我按 failures[] 修,再重派 workflow。verification-round.jsonl 里每一轮我都会给 tests 数。
