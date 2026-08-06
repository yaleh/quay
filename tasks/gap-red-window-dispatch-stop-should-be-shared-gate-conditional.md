---
id: gap-red-window-dispatch-stop-should-be-shared-gate-conditional
title: "the red-window RED handling is a coarse blanket (stop dispatch + hold
  fan-in) but the two actions have very different real risk — holding fan-in is
  the real protection (mixing failures on the red tree makes bisect hard);
  stopping dispatch is mostly unnecessary (worktrees are independent
  master-branch copies running their own scoped tests, unrelated to the red
  elsewhere); the ONLY dispatch-danger is when the red lands in a shared gate
  (run_static_checks — every scoped run pays it), which is DETERMINABLE from
  early-RED's failure line; refine: RED ⇒ ALWAYS hold fan-in; RED ⇒ dispatch
  stops ONLY on shared-gate failures, continues for specific-test-file failures
  unrelated to the new task's touch-set (this round's evidence: suite early-RED,
  inner 30+ min no dispatch, pool 16/disjoint 9 healthy)"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者更正 + 设计缺陷（2026-08-05，人问「inner 为什么要等？套件应在 outer 后台 subagent 运行」）。

**管理者先更正自己**：先前「早期 RED 越早、inner 白等越长，是个权衡」——**框架错了**，两者本不必
权衡，是**规则粒度太粗**造成的假性冲突。

**实况**：出厂 tick 文档步骤 3 已写对一半——`running/green ⇒ 照常派发与合并`，原文明写「RUNNING 不等
套件——这正是消除同步点的关键」。inner 从不因套件在跑而等。它停是因为 `state=red`，而规则把 RED 处置
写成「停止新派发 + 暂缓 fan-in」**一刀切**。

**缺陷**：这两个动作在红树上的真实风险差很远——
- **暂缓 fan-in 是对的**（并进红树会让 failures 混在一起、bisect 变难）；
- **停派发多数没必要**——worktree 是从 master 分叉的独立副本，新任务跑自己的 scoped 测试，与别处的
  红无关；
- **唯一让派发也危险的情形**：红落在 `run_static_checks`（每次 scoped 运行都跑）里——那样所有新任务
  都被同一个红污染；但**这是可判定的**，早期 RED 已经知道是哪个测试失败。

**本轮实况（证据）**：套件 06:09:40 启动、早期 RED，inner 30+ 分钟无派发，而池子 pool=16 disjoint=9
有充足互不冲突候选。

### 选定机制（外层裁定：接受细化）

**RED 处置从一刀切改为条件化**：

1. **RED ⇒ 一律暂缓 fan-in**（真正的保护）——不变；
2. **RED ⇒ 派发只在「失败落在共享闸门（run_static_checks / 每次 scoped 运行都跑的东西）」时停**；
3. **RED ⇒ 失败落在具体测试文件且与新任务触摸集无关时，派发继续**（新任务 worktree 独立、跑自己
   scoped 测试）；
4. **判定信息现成**：早期 RED 的失败行 = 失败测试 → 是否在共享闸门 → 是否与新任务 touches 相交；
   **不需要新机制**。

**效果**：爆炸半径照样小（红树 fan-in 仍拦）+ inner 白等大部分消失（非共享闸门红时派发继续）。

**与红窗机制的关系**：`gap-full-suite-belongs-to-outer-background-above-3-min`（(a) 块 AC4 红窗）+
`gap-red-window-has-no-automatic-executor`（SUITE-RED 触发）——本条是**红窗规则的条件化细化**
（SUITE-RED 事件携带失败位置 → inner 派发决策按共享闸门/具体测试判定）。

> **AC3 并列交叉标注（2026-08-06，
> `gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`）**：本条（RED 停派按失败
> 作用域条件化）与冷启动 gate 收窄条（gate 按派生铺设集收窄，非整个套件绿）是**同一作用域轴的并列实例**
> ——都问「这条判据量化的是哪个范围」并把它从「一刀切/全量」收窄到真实作用域。**不同机制，不归并**：
> 本条管 suite-RED 处置（共享闸门才停派发），该条管冷启动 gate（铺设集内脚本全绿即可铺）。外层 2026-08-05
> 裁定并列立案。

## Acceptance Criteria

- [x] AC1: **RED ⇒ 一律暂缓 fan-in**（真正保护，不变）——红树不混入新 failures
      **证据**：`plugin/loop/fast-mode-loop-tick.md` 步骤 3 + 判断边界表、`orchestrator-loop-tick.md` 红窗
      分诊都成文「**一律暂缓 fan-in**（AC1 真正保护，不变）」——与「派发按作用域条件化」并列（一个 blanket、
      一个条件化）；`shouldStopDispatch` 保持 red+failed（或缺失）⇒ true 的 blanket 语义（AC5 reason 轴
      测试 + `AC1 — RED failed ⇒ fan-in ALWAYS held` 测试全绿）。
- [x] AC2: **派发条件化**——失败落在共享闸门（run_static_checks）⇒ 停派发；失败在具体测试文件且与新任务
      触摸集无关 ⇒ 派发继续
      **证据**：`plugin/scripts/suite-state-trigger.ts` 新增 `shouldStopDispatchForFailure(failure, touches)`
      ——shared-gate ⇒ 停；test-file 且与新任务 touches 无关 ⇒ 续；test-file 且相交 ⇒ 停；unknown/缺失 ⇒
      fail-closed 停。AC2 两向 fixture 测试（共享闸门 ⇒ 停、具体测试无关 ⇒ 续）实跑 pass。文档两处成文
      （fast-mode 步骤 3 / 判断边界表；orchestrator 红窗分诊），`run_static_checks` 作为共享闸门显式命名
      （Contract measure `grep -c 'run_static_checks'` fast-mode=2 / orchestrator=1，均 ≥ 1）。
- [x] AC3: 判定信息现成——从早期 RED 失败行判定「共享闸门 vs 具体测试」+ 与新任务 touches 相交性，
      不需新机制
      **证据**：SUITE-RED 事件新增 `failure` 字段（`classifyFailureLine` / `extractFailingFiles` /
      `deriveFailureLocation`，从 `.quay/full-suite.log` 的 early-RED 失败行派生——**现成，不加新机制**）；
      `failureIntersectsTouches` 做 touches 相交性。`AC2/AC3 — SUITE-RED event carries the failure location`
      测试实跑 pass（事件携带 scope + files，下游按 touches 判定续/停）。
- [x] AC4: **真实使用**——本轮证据反例：套件早期 RED + inner 30 分钟无派发 + 池 16/disjoint 9 健康；
      细化后非共享闸门红时 inner 派发继续（disjoint 候选被派，白等消除）
      **证据**：细化后机制实测——红 + 失败落具体测试文件且与新任务 touches 无关 ⇒ `shouldStopDispatchForFailure`
      返回 false（派发继续，disjoint 候选照派，白等消除）；红 + 共享闸门失败 ⇒ 返回 true（停派发）。本轮
      白等反例（早期 RED + 30 分钟无派发 + 池 16/disjoint 9 健康）记在本任务 Proposal 实况；细化后
      「具体测试无关红不挡派发」由 AC2 两向 fixture 机械证明。live 30 分钟 inner 重跑属全量套件面（DoD
      未勾，见下——scoped 模式无法证明整轮 inner 时序）。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`（共享闸门失败 ⇒ 停；具体测试无关 ⇒ 续
      的两向 fixture）
      **证据**：`plugin/test/suite-state-trigger.test.mjs` 首行 `// @test-group governance`，全部 `node:test`；
      AC2 两向 fixture 用例（`shouldStopDispatchForFailure two-way fixture`）实跑 pass（scoped 24/0/0，见下）。

## Verification（scoped，2026-08-06）

`bash scripts/test.sh --for-task gap-red-window-dispatch-stop-should-be-shared-gate-conditional --allow-thin`
→ **exit 0，pass 24 / fail 0 / cancelled 0**（`plugin/test/suite-state-trigger.test.mjs` 24 条全绿；thin 提示
因 1/8 Touches 解析出测试，--allow-thin 放行）；`task-contract-check: no violations`（两个 touched 任务文件
strict-subset 无违规）；test-framework-policy / test-isolation / test-impl-census / drive-contract /
no-manager-tick-doc 全 PASS。

**Contract measure**（`grep -c 'run_static_checks' <红窗处置文档>`，band ≥ 1）：
```
fast-mode-loop-tick.md: 2
orchestrator-loop-tick.md: 1
```

**Contract invariant**（`fan_in_always_held_on_red = 1`）：fast-mode 判断边界表 + 步骤 3 均成文
「一律暂缓 fan-in（真正保护，不并进红树）」；orchestrator 红窗分诊「一律暂缓 fan-in（AC1 真正保护，不变）」。

**Contract invoke**（`grep -n '共享闸门\|具体测试\|暂缓 fan-in' plugin/loop/fast-mode-loop-tick.md`）：
```
392:      - 失败落在**共享闸门**（`run_static_checks`——每次 scoped 运行都跑，所有新任务都被同一红污染）
394:      - 失败落在**具体测试文件**且与新任务触摸集**无关** ⇒ **派发继续**（worktree 是从 master 分叉的
630:| 外层全量 suite 红（`.quay/full-suite-state.json` `state: red`） | **一律暂缓 fan-in**（真正保护，不并进红树）+ **派发按失败作用域条件化**：失败落共享闸门（`run_static_checks`）⇒ 停派发；落具体测试文件且与新任务 touches 无关 ⇒ 派发继续（`running`/`green` ⇒ 照常；文件缺失不阻塞，等下一 tick） |
```

**Contract control**（AC2 两向）——`plugin/test/suite-state-trigger.test.mjs` 实跑：
```
✔ AC2 — shouldStopDispatchForFailure two-way fixture: shared-gate stops; unrelated specific-test continues; related stops
✔ AC2 — a shared-gate (run_static_checks) failure ⇒ SUITE-RED carries scope=shared-gate ⇒ dispatch stops for every task
✔ AC2/AC3 — SUITE-RED event carries the failure location; the dispatch decision conditions on it
ℹ tests 24 / pass 24 / fail 0 / cancelled 0
```

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC4 实跑输出贴任务体
- [ ] RED 处置条件化：一律暂缓 fan-in + 共享闸门才停派发（具体测试无关时继续）；inner 白等大部分消失
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md
- plugin/loop/fast-mode-loop-tick.md（步骤 3：RED 处置条件化）
- plugin/loop/orchestrator-loop-tick.md（1b 红窗节：条件化规则）
- plugin/scripts/suite-state-trigger.ts（SUITE-RED 事件携带失败位置 → 供派发决策）
- plugin/test/（AC2/AC5 fixture）
- tasks/gap-red-window-has-no-automatic-executor.md（交叉标注：本条是红窗规则条件化细化）
- tasks/gap-full-suite-runner-concurrency-default-and-gate.md（AC6 交叉标注：stop-dispatch 语义同一族——
  本条把「RED ⇒ 停派发」条件化为共享闸门；该条把 stop-dispatch 判据机械化到 `reason` 轴
  failed≠aborted。两条合起来 = RED 处置的完整机械化表面）
- tasks/gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite.md（AC3 并列交叉标注：
  同一作用域轴——本条 RED 停派按失败作用域条件化 vs 该条冷启动 gate 按派生铺设集收窄；不同机制，不归并）

## Contract

measure   dispatch_stopped_by_shared_gate = `grep -c 'run_static_checks' <红窗处置文档>` stdout 数字段
band      dispatch_stopped_by_shared_gate >= 1（共享闸门停派发显式成文）
invariant fan_in_always_held_on_red = 1（RED ⇒ 一律暂缓 fan-in）
invoke    `grep -n '共享闸门\|具体测试\|暂缓 fan-in' plugin/loop/fast-mode-loop-tick.md`
control   构造失败落在 run_static_checks ⇒ 停派发；落在具体测试无关新任务 touches ⇒ 派发继续（AC2 两向）
resume    规则细化与触发事件携带失败位置分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:4xZ
changed: 外层受管理者更正 + 设计缺陷裁定立案（接受细化）。四处收紧：
(1) **先更正**——「爆炸半径 vs 白等」是粒度太粗的假性冲突，两者本不必权衡（管理者自纠）；
(2) **两动作风险分开**——暂缓 fan-in 是真正保护；停派发多数没必要（worktree 独立跑自己 scoped）；
(3) **条件化**——共享闸门（run_static_checks）才停派发；具体测试无关时继续；判定信息现成（早期 RED
    失败行）；
(4) **本轮活证据**——早期 RED + inner 30 分钟无派发 + 池 16/disjoint 9 健康 = 细化前的白等样本。
status: todo——红窗规则条件化细化；排 ROUND 3 收尾后。
