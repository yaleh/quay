---
id: gap-ac77-spawn-limit-detect-harness-error-only
title: AC77 spawn 触顶只检测 harness 报错，不自建计数（人 07:4xZ 裁定）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC77（spawn 触顶只检测 harness 报错，不自建计数 —— 人 2026-08-14 07:4xZ 逐字「agentLimit 的处理仅应包括检测 harness 的报错（报错后的处理暂定由人执行），而不要自己重复计数」）**。

**现状**：`inner-wakeup-heartbeat-check.ts:347/:353` 判据是 `blocked==[] && agentDispatches >= heartbeat.agentLimit`，**而心跳现读 `agentLimit = undefined`（`agentDispatches=15`）⇒ 该判据结构上恒假，从不报。**

**⚠️ 修法不是补写 `agentLimit`**——那正是人禁止的「自己重复计数」，也是 4b：**用我们自己维护的计数去判一个由 harness 掌握的预算**（量由被测对象自产，停摆时跟着停，与「一切正常」同形）。

**⇒ 改为检测 harness 自己的报错串**：`CLAUDE.md:21` 已记识别法逐字——**目标会话 transcript 里搜 `Subagent spawn limit reached`**。

**判据**：
- **判据1**：检测到 harness 报错串（`Subagent spawn limit reached`）即报（进 tick-log 升级列）。
- **判据2**：`agentDispatches >= agentLimit` **按 AC58 退役即迁出**（留着 = 恒假判据，与「一切正常」同形，硬规则 4）。
- **判据3（只报不动）**：人「报错后的处理暂定由人执行」⇒ 明确不自动 `/clear`、不自动降 cap、不自动重启。
- **判据4（3b）**：无真样本时**记为未验证而非勾**（当前 agentLimit=undefined 恒假是现成红样本）。

**不覆盖**：不估上限数值（正本在 `tasks/gap-inner-subagent-budget-invisible.md`，随版本变）。

**与 AC76 是两个不同资源，不合并**：`AC76 = 并发 subagent（cap 管）`；`AC77 = 会话累计 spawn（harness 管，触顶后静默降级为主线程串行）`。**后者触顶的表现与「inner 主线程在跑 fan-in」现象上一模一样**——CLAUDE.md:21 逐字记着上次代价：「三层 + 人共花数小时反复误诊为『outer 不派发』『inner 自锁』『唤醒链断』，全错」。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner-wakeup-heartbeat-check.ts:340-360（agentLimit 判据）+ CLAUDE.md:21（识别法）+ tasks/gap-inner-subagent-budget-invisible.md（正本）。
2. 判据1：改检 harness 报错串（`Subagent spawn limit reached`）。
3. 判据2：`agentDispatches >= agentLimit` 退役迁出（AC58 形态，落点映射）。
4. 判据3：只报不动（不 /clear、不降 cap、不重启）。
5. 判据4：无真样本记未验证（当前恒假是红样本）。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：检测 harness 报错串（`Subagent spawn limit reached`）即报（semanticTriggerHeuristic → spawnLimitDetected；judge STOP_SIGNALS 增该串 ⇒ stopped ⇒ red-on-omission ⇒ tick-log 升级列）。
- [x] AC2 判据2：`agentDispatches >= agentLimit` 退役迁出（R29 落点映射，archive + REGISTRY 双登记，源文件 0 命中）。
- [x] AC3 判据3：只报不动（纯函数触发，无副作用；不 /clear、不降 cap、不重启——处理归人）。
- [x] AC4 判据4：真样本回放（`Subagent spawn limit reached (200 of 200 agents spawned)…` 逐字，来自 gap-inner-subagent-budget-invisible.md:21）＋ 负控制 fixture（agentLimit=undefined 恒假红样本）。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] spawn 触顶检测改为 harness 报错串 + 自建计数退役 + 只报不动 + 无样本记未验证。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（判据1：semanticTriggerHeuristic/evaluateTrigger 改检 harness 报错串 `Subagent spawn limit reached`；判据2：agentLimit 自维护计数判据退役 → R29；判据3 只报不动注释）
- orchestration/archive/AC58-retired-clauses.md（R29——agentLimit 判据退役落点，AC58 形态落点映射）
- plugin/scripts/retired-clause-check.ts（REGISTRY 登记 R29——「删了但没进 archive」负控制可由机械检查抓住）
- plugin/scripts/semantic-observer-judge.ts（STOP_SIGNALS 增 `subagent spawn limit reached`——judge 判 stopped ⇒ red-on-omission ⇒ tick-log 升级列；触发注释更新）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（AC77 判据1-4：负控制 fixture + 真样本回放 + 只报不动）
- plugin/test/semantic-observer-judge.test.mjs（AC3 触发测试改为新判据；判据1 judge 读 spawn-limit 判 stopped）
- tasks/gap-ac77-spawn-limit-detect-harness-error-only.md（自身）

## Test-Files

- plugin/test/inner-wakeup-heartbeat-check.test.mjs（AC77 判据1-4 机械测试——负控制 fixture + 真样本回放 + 只报不动）
- plugin/test/semantic-observer-judge.test.mjs（AC3 触发测试改新判据；judge 读 spawn-limit 串判 stopped ⇒ red-on-omission）
- plugin/test/retired-clause-check.test.mjs（R29 登记后「GREEN: real corpus」仍绿）

## Evidence

（2026-08-14 落地，inner 实跑）

**判据1（检测 harness 报错串）+ 判据2（自建计数退役）——纯函数直测**：

```text
# 真样本回放（逐字来自 tasks/gap-inner-subagent-budget-invisible.md:21 的 05:13:13 tool_result）
$ node --no-warnings --test plugin/test/inner-wakeup-heartbeat-check.test.mjs 2>&1 | grep -E "AC77|tests |pass |fail "
✔ AC77 判据1 — SPAWN_LIMIT_SIGNAL is the harness's own error string
✔ AC77 判据1 — spawnLimitDetected fires on the real harness spawn-limit string (true-sample replay)
✔ AC77 判据1 — spawnLimitDetected is case-insensitive (lowercase transcript grep still matches)
✔ AC77 判据2 — the old count criterion is RETIRED: semanticTriggerHeuristic no longer fires on a self-counted agentDispatches>=agentLimit (hard rule 4b)
✔ AC77 判据1 — semanticTriggerHeuristic fires on the free-text harness string, and reads a heartbeat's reason
✔ AC77 判据3 — report-only: the trigger is a pure boolean; it never /clears, lowers cap, or restarts
✔ AC77 判据1 — evaluateTrigger fires on the spawn-limit string without any hash baseline
ℹ tests 59 · pass 59 · fail 0 · cancelled 0        # exit 0
```

**判据1（judge 读 spawn-limit 判 stopped ⇒ red-on-omission ⇒ tick-log 升级列）**：

```text
$ node --no-warnings --test plugin/test/semantic-observer-judge.test.mjs 2>&1 | grep -E "AC77|AC3|tests |pass |fail "
✔ AC77 判据1 — judge reads the harness spawn-limit string as stopped (→ red-on-omission → tick-log 升级列)
✔ AC3 — semanticTriggerHeuristic (AC77 判据1): fires on the harness's spawn-limit error string, NOT a self-counted agentDispatches/agentLimit (判据2 retired → R29)
✔ AC3 — evaluateTrigger: spawn-limit heuristic fires without any hash baseline
ℹ tests 23 · pass 23 · fail 0 · cancelled 0        # exit 0
```

**判据2（R29 落点映射——archive + REGISTRY 双登记，源文件 0 命中）**：

```text
$ node --no-warnings --experimental-strip-types plugin/scripts/retired-clause-check.ts --root $(pwd)
retired-clause-check: OK — 28 entries migrated (43 unique tokens: all gone from source, all present in archive)   # exit 0
$ node --no-warnings --test plugin/test/retired-clause-check.test.mjs 2>&1 | grep -E "GREEN|RED|tests |pass |fail "
✔ GREEN (判据1+2): real corpus — every registered marker absent from source + present in archive
ℹ tests 5 · pass 5 · fail 0 · cancelled 0          # exit 0
```

**判据4（3b）**：真样本回放 = 上面判据1 的真样本（`Subagent spawn limit reached (200 of 200 agents spawned)…` 逐字）。
负控制 fixture = `{blocked:[], agentDispatches:15, agentLimit:undefined}`（当前恒假红样本）——断言 `semanticTriggerHeuristic` 对其返回 false（旧判据已退役，不再报）。

**AC5（scoped 门绿）**：

```text
$ bash scripts/test.sh --for-task gap-ac77-spawn-limit-detect-harness-error-only --allow-thin   # exit 0
== scoped static checks ==
  test-framework-policy-check PASS · test-isolation-check PASS · tmp-leak-pairing-check PASS
  test-impl-census-check PASS · task-contract-check PASS · malformed-task-check PASS
  retired-clause-check PASS · superseded-capability-check PASS · concurrency-literal-check PASS
  landing-target-check PASS · delivery-inventory-drift-gate PASS · ac61-staleness-disposition-check PASS
== plugin/test/inner-wakeup-heartbeat-check.test.mjs + retired-clause-check.test.mjs + semantic-observer-judge.test.mjs ==
ℹ tests 87 · pass 87 · fail 0 · cancelled 0        # exit 0
```
