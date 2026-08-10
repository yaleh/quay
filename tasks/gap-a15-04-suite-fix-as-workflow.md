---
id: gap-a15-04-suite-fix-as-workflow
title: 'A15 ④ 的「测试→修复→等绿→fan-in→合并」整条链应从裸 Agent() subagent 改造为 Workflow——ab380c5e 静默悬挂的根因是「诊断+等待被塞进同一个 agent 的一轮对话」,workflow 形态让等待由脚本控制流决定,结构上不可能复现;人 2026-08-10 14:0x 裁定(撤回此前 Monitor 建议的后半)'
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**A15 ④ 的「测试→修复→等绿→fan-in→合并」整条链应从裸 `Agent()` subagent 改造为 `Workflow`。** 人 2026-08-10 14:0x 撤回此前「subagent 自验证必须用 Monitor 武装」建议的后半,换更强方案:用 Workflow 承接整条 suite-fix 链。**理由是机制保证等级不同,不只是「更稳」。**

### 实证(人 2026-08-10 14:0x 裁定 + outer 复核 ab380c5e)

- **ab380c5e 静默悬挂根因**(meta-cc 实证):12:21 用裸 `Bash(run_in_background:true)` 起 full-suite-runner 后,54 秒内 11 次逐字重复「I'll wait for the background task completion notification…let me check back at a longer interval」,`Monitor`/`BashOutput`/`KillShell` 调用 = 0,最后 `stop_reason:end_turn` 后无条目。**不是崩溃、不是超时、不是回合耗尽——是用了错误的等待机制,然后没有人叫醒它。**
- **Monitor 建议的未交代假设**(人 2026-08-10 14:0x 撤回理由):`Monitor` 的 `<task-notification>` 投递目标是**顶层会话**;一个被 `Agent()` 派出去的嵌套 subagent 自己武装 `Monitor`,它自己那一轮对话能不能真被唤醒**没有把握**——这是上一条建议没交代清楚的假设。
- **Workflow 投递机制不同且今晚反复验证**:工具描述「Workflows run in the background — returns immediately with a task ID, and a `<task-notification>` arrives **when the workflow completes**」。每次调 `manager-tick-core.js` 都依赖这条通道且每次都成功收到通知——**顶层投递,不依赖某个嵌套 agent 自己记得做什么**。
- **结构失败点**:`ab380c5e` 把「诊断」和「等待」塞进同一个 agent 的一轮对话——agent 需要自己判断「要不要等、用什么机制等」,判断错了就悬挂。

### 选定机制方向(改造归 inner/outer,裁定归人)

A15 ④ 的整条链改造成一个 Workflow(而非裸 Agent)。结构建议(人):

```js
phase('Fix'); await agent('diagnose + fix root cause, commit in worktree')
phase('Verify')
let state
do {
  await new Promise(r => setTimeout(r, 60_000))
  state = await agent('read .quay/full-suite-state.json, return {state,reason,scope}', {schema:...})
} while (state.state === 'running')
if (state.state !== 'green') return {outcome:'red', state}
phase('Merge'); await agent('fan-in + verify clean + batch-merge')
```

**等待完全由脚本控制流(`setTimeout`+轮询)决定,不由任何 agent 自己判断**——`ab380c5e` 那种失败在结构上不可能发生,因为不存在一个需要自己做等待决策的 agent。

**与今晚已建立判据吻合**:语义判断(诊断/修复/合并安全性)⇒ `agent()`;长时等待 ⇒ 脚本轮询,不是任何一个 agent 的责任。「迭代测试+修复+合并」本身是混合的,workflow 的 phase/agent/脚本结构正好让两类各自落在该在的地方。

**对照验证(人建议)**:对照今晚成功的第一个 subagent(04:11,纯 agent、无 workflow、出绿)与失败的 `ab380c5e`,做一次并行验证,确认 workflow 化后两类场景都不退化。

**验证锚**:修后 (a) suite-fix 链走 Workflow,等待由脚本轮询决定;(b) 不存在「由 agent 自己决定等待机制」的环节;(c) 成功 subagent(04:11 类)与失败 ab380c5e 类场景都不退化。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 ab380c5e 悬挂实证(裸 Bash 起 runner、11 次空等、Monitor/BashOutput 0 调用)+ Monitor 建议撤回理由(嵌套 agent 自武装 Monitor 唤醒不保证)+ Workflow 投递机制差异(本任务 Proposal 已含)
- [ ] AC2: **Workflow 化**——A15 ④ 的「Fix→Verify(轮询等绿)→Merge」整条链改造为 Workflow,等待由脚本 `setTimeout`+轮询决定,不由 agent 判断
- [ ] AC3: **两类场景不退化**——对照验证:成功 subagent 形态(纯 agent 语义判断)与失败形态(诊断+等待同 agent)在 workflow 化后都不退化
- [ ] AC4: **Monitor 撤回落地**——此前加的「subagent 自验证必须用 Monitor」措辞修正为「等待由 workflow 脚本控制流决定」(不依赖嵌套 agent 自武装 Monitor)
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑:suite-fix 走 Workflow,等待由脚本轮询完成(贴 workflow 运行日志,含 phase 边界)
- [ ] 既有测试 + 新增测试全绿(`--for-task` scoped)
- [ ] 全量套件绿(`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`)——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md(A15 ④:裸 Agent → Workflow 形态;Monitor 措辞修正)
- plugin/loop/orchestrator-loop-tick.md(§suite-health 执行体描述)
- .claude/workflows/execute-suite-fix.js(若用命名 workflow;以实际落地文件为准)
- tasks/gap-a15-04-suite-fix-as-workflow.md(自身:勾 AC + 贴证据)

## Contract

measure   suite_fix_is_workflow = `grep -c "Workflow\|phase(" orchestration/orchestrator-tick-core.md` 的 stdout 数字
band      suite_fix_is_workflow = ≥ 1(A15 ④ 描述 workflow 化,含 phase/脚本轮询)
invariant wait_is_script_owned = 1(等待由脚本 setTimeout+轮询决定,不由 agent 判断)
invariant no_agent_decides_wait = 1(不存在「由 agent 自己决定等待机制」的环节)
invoke    `grep -n "phase(\|setTimeout\|等待" orchestration/orchestrator-tick-core.md`(贴命中)
control   workflow 化;等待脚本化;两类场景不退化;既有不回归
resume    Workflow 骨架 / 轮询等待 / 对照验证分步提交,任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人 14:0x 撤回 Monitor 建议后半,换 Workflow 方案。ab380c5e 悬挂 = 诊断+等待同 agent;Monitor 嵌套唤醒不保证;Workflow 顶层投递今晚反复验证。立案:suite-fix 链 Workflow 化,等待脚本控制流。改造归 outer/inner,裁定归人。实现时机:待当前 round-252 完成后(避免中途改 core 使在飞验证失效)
