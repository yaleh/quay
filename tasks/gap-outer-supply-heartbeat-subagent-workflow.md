---
id: gap-outer-supply-heartbeat-subagent-workflow
title: 供给侧心跳 subagent 化 + 停滞判据（人 2026-08-13 12:5x 裁定）——ready-pool --apply 每 tick
  必跑 via 后台 subagent，记四数，连续 3 tick 停滞即报
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**人 2026-08-13 12:5x 裁定（manager 转达）：outer 也应当用后台 subagent 跑 `ready-pool-check --apply`，未来应当考虑用 workflow。** 供给侧动作（补晋）从「想起来才跑」变「每轮固定发生」。

**实证缺口（manager 2026-08-13 报）**：`pool=10 · floor=12 · deficit=2 · candidates=23 · targeted_promotion=null` 两轮 tick 之间【一个数都没动】；近 12 次提交里含补晋字样 = 0 ⇒ 补晋是「记得跑」的动作。**与 AC53 同病同药**：AC53=inner 靠记得派发 → 闸/不变式；补晋=outer 靠记得补晋 → subagent → workflow。

**边界（必须说清）**：`--apply` 写 `tasks/*.md` frontmatter status ⇒ 必须写共享检出（develop），与 fan-in 的 merge 同类，是结构必然，不能靠 worktree 隔离。人要的不是「隔离」，是「别占主线程回合」——subagent 能写主检出，它只是另一个执行上下文。

**对称性空缺（manager 指出）**：inner 侧有 A12「必跑 slot-refill」，outer 侧没有对应条目 ⇒ 本任务补 outer 侧 A22「必跑 ready-pool --apply」。

**供给侧 vs 派发侧（区分两类空转）**：slot-refill `should_refill=false` 若因「无 dispatchable 候选通过 step-4」（touches-resolve / deps-ready / disjoint-from-in-flight）⇒ 是【供给侧】问题（todo 没晋级 ready），不是派发问题——机件已经算好 `candidates` 数，补晋即答案。

## Plan

1. **第一步（现在，已做）**：`ready-pool-check --apply` 改后台 subagent 调用；执行核 A22 加「每 tick 必跑」——与 inner A12「必跑 slot-refill」对称。`--cap` 用固定 5（A6 裁定），`--in-flight` 传当前在飞任务 id 集（晋级优先 touches 与在飞不相交者）。
2. **第二步（判据）**：每 tick 的 tick-log 记 `pool/floor/deficit/candidates` 四数；**连续 3 tick `deficit>0 且 candidates>0` 而 `pool` 纹丝不动 ⇒ 报「供给侧停滞」**（形态照抄 manager 判据6，已验证有效）。
3. **第三步（未来，暂缓）**：做成 W3 workflow（outer-supply：读 ready-pool-check → 若 deficit>0 且有候选 → 定向晋级（优先 touches 与在飞不相交）→ 记四数进 tick-log），与 W1（inner-tick）/W2（inner-fan-in）并列。等 W1/W2 有先例再做。harness 约束：workflow 内无 fs、无 sleep、`Date.now()` 抛 ⇒ 读数由第一个 agent 以 structured schema 返回；用 `scriptPath` 不用 `name`。

## AC

- [ ] AC1: outer 执行核 A22 落地——每 tick 后台 subagent 跑 `ready-pool-check --apply --cap 5 --in-flight <在飞集>`（不在主线程跑）
- [ ] AC2: tick-log 每 tick 记 `pool/floor/deficit/candidates` 四数（四数缺失 = 该 tick 未跑供给心跳）
- [ ] AC3: 停滞判据落地——连续 3 tick `deficit>0 && candidates>0` 而 pool 不动 ⇒ 报「供给侧停滞」进升级列
- [ ] AC4: 补晋优先 touches 与在飞集合不相交的候选（--in-flight 传入在飞 id 集；`targeted_promotion` 供定向晋级，floor-INDEPENDENT）
- [ ] AC5: `--apply` 写共享检出属结构必然（记录在案，不误解为违规）；A18 slot-refill `should_refill=false` 的供给侧解释区分开
- [ ] AC6: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 连续 ≥3 tick 的 tick-log 四数行贴出（含一次真正的补晋落盘样例）
- [ ] 全量套件绿

## Touches

- orchestration/orchestrator-tick-core.md（新增 A22 必跑条目）
- orchestration/tick-log.md（四数记录 + 停滞升级列）
- tasks/gap-outer-supply-heartbeat-subagent-workflow.md（自身）