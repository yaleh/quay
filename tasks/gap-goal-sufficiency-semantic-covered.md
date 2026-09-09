---
id: gap-goal-sufficiency-semantic-covered
title: 充分性闸补语义判定分支——goalSufficiencyVerdict 须能产出 covered（GOAL-010 退出条件②）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-222
---
## Proposal

正本：`goals/AC-222-充分性闸必须能产出-covered-否则-防假达成-就做成了-永不达成-闭环只闭一半.md`（GOAL-010 名下 criterion，status: draft）。

**现状（实测，非主张）**：`plugin/scripts/goal-driver.ts:350-357` 的 `goalSufficiencyVerdict()`：

```ts
export function goalSufficiencyVerdict(
  goal: Record<string, unknown>,
  inScopeAcs: Array<Record<string, unknown>>,
): SufficiencyVerdict {
  if (!hasExitConditions(String(goal.body ?? ""))) return "insufficient";
  if (inScopeAcs.length === 0) return "insufficient";
  return "not-evaluated";
}
```

结构上只有两个返回值 `"insufficient"` / `"not-evaluated"`，永远产不出 `"covered"`。实测：`.quay/gate-events.jsonl` 全账本 `covered` 记录数 = 0（负控制：同一谓词换成 `not-evaluated` 命中 251 条，证明这个零是真零不是谓词写坏）。后果：GOAL 永远无法被机械关闭——GOAL-010 自身正卡在这个状态（10/10 AC achieved 却无法 flip）。

**根因**：GOAL-010 退出条件 2 只写了单向——「GOAL 不会在退出条件未被覆盖时自行关闭」，未要求「覆盖时能关闭」。一个永不判 covered 的实现完美满足它（硬规则 3b 的镜像：「永不通过」与「正确地拒绝」在记录上同形）。

**修法（一处源码 + 一处新测试）**：

1. `plugin/scripts/goal-driver.ts` 的 `goalSufficiencyVerdict()`：在 `insufficient`/`not-evaluated` 之外补一条真正的语义判定分支——判断 GOAL body 的退出条件文本是否已被 `inScopeAcs`（在域 AC 集合）覆盖，三态返回 `covered` / `insufficient` / `not-evaluated`。**⛔ 硬约束**：语义判定路径不可用/超时/读不懂 → 必须返回 `not-evaluated`，绝不允许回落成 `covered`——防止「无条件 return covered」这种放水实现原样重演 AC-212 记录过的三次假 achieved 缺陷。
2. 新建 `plugin/test/goal-sufficiency-semantic-covered.test.mjs`：正向 + 至少两条负控制（见 AC）。

**边界**：⛔ 不碰充分性闸之外的机制——分诊逻辑（AC-210，另有任务 `gap-goal-triage-activate-executed` 在跑）、posture 尊重（AC-215）、needs-human 阻塞（AC-209）均已 done，本任务只接「让 sufficiency 闸能产出 covered」这一条缝。

## AC

- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-semantic-covered.test.mjs` 退出码 0（AC-222 机制半逐字）
- [x] 正向：测试断言语义判定路径存在——判"覆盖"（在域 AC 集合确实覆盖 GOAL body 退出条件）⇒ `goalSufficiencyVerdict` 返回 `covered`
- [x] 负控制 (a)：测试断言判"不覆盖"⇒ 返回 `insufficient`（与 covered 可分）
- [x] 负控制 (b)：测试断言语义判定路径不可用/超时/读不懂 ⇒ 返回 `not-evaluated`，⛔ 不得为 `covered`
- [ ] 生产半判据：`node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-semantic-covered.test.mjs && python3 -c 'import json,sys; ok=[s for l in open(".quay/goal-round.jsonl") for f in (json.loads(l).get("facts") or []) for s in [(f.get("value") or {}).get("sufficiency")] if isinstance(s,dict) and s.get("verdict")=="covered"]; sys.exit(0 if len(ok)>=1 else 1)'` 退出码 0（落地后一轮 driver 跑过，非 fixture 注入）（待外部）
- [x] scoped 门 `bash scripts/test.sh --for-task gap-goal-sufficiency-semantic-covered --allow-thin` 退出码 0

## DoD

AC-222 两半都满足：①机制半 `plugin/test/goal-sufficiency-semantic-covered.test.mjs` 退出码 0，三态（covered/insufficient/not-evaluated）各有一条能取假的负控制路径（硬规则 4 推论三：判据必须能被证否，不能只能被 fixture/注入满足）；②生产半——落地后 `.quay/goal-round.jsonl` 里真实出现 ≥1 条 `sufficiency.verdict=="covered"` 的记录，⛔ 非 fixture 注入。反例判据：把语义判定 seam（如 LLM 调用）关掉后 DoD 仍能通过 ⇒ 说明测的不是真实机制，不算数。改动经 fan-in 落地 develop，`git show develop:plugin/test/goal-sufficiency-semantic-covered.test.mjs` 可见该文件。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-sufficiency-semantic-covered.test.mjs`
- `tasks/gap-goal-sufficiency-semantic-covered.md`
