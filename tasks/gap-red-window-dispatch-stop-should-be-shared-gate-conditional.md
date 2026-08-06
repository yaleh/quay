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
status: done
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

- [x] AC1: **RED ⇒ 一律暂缓 fan-in**（真正保护，不变）——红树不混入新 failures（两份 tick 文档成文：
      inner 步骤 3「一律暂缓 fan-in」/ 判断边界表「一律暂缓已完成 agent 的 fan-in」；outer 红窗分诊
      「fan-in 一律暂缓」）
- [x] AC2: **派发条件化**——失败落在共享闸门（run_static_checks）⇒ 停派发；失败在具体测试文件且与新任务
      触摸集无关 ⇒ 派发继续（`shouldDispatchOnRed` 可执行化 + 两份文档同一条规则 + 两向 fixture）
- [x] AC3: 判定信息现成——从早期 RED 失败行判定「共享闸门 vs 具体测试」+ 与新任务 touches 相交性，
      不需新机制（runner 记 `state.failures` = 失败行 + 文件上下文；SUITE-RED 事件携带 `failureLocation`
      分类；相交性用既有 `parseTouches`/`matchGlob`）
- [x] AC4: **真实使用**——本轮证据反例：套件早期 RED + inner 30 分钟无派发 + 池 16/disjoint 9 健康；
      细化后非共享闸门红时 inner 派发继续（disjoint 候选被派，白等消除）（两向 fixture 机械证明：
      「具体测试无关 ⇒ dispatch CONTINUES」正是该反例的 disjoint 候选形状）
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`（共享闸门失败 ⇒ 停；具体测试无关 ⇒ 续
      的两向 fixture）——`plugin/test/red-window-shared-gate.test.mjs`

## 落地证据（invoke 实跑，2026-08-05，worktree `task/gap-red-window-dispatch-stop-should-be-shared-gate-conditional`）

**Contract invoke**（`grep -n '共享闸门\|具体测试\|暂缓 fan-in' plugin/loop/fast-mode-loop-tick.md`）：
```
337:  - `state: red` 且 `reason: failed`（或缺失——兼容旧记录，fail-closed 当失败）⇒ **一律暂缓 fan-in**
342:    - 失败落在**共享闸门（`run_static_checks`——每次 scoped 运行都跑的静态检查）** ⇒ **停新派发**
344:    - 失败落在**具体测试文件**且与新任务触摸集**无关** ⇒ **派发继续**（新任务 worktree 是独立
533:| 外层全量 suite 红（`.quay/full-suite-state.json` `state: red`） | **一律暂缓已完成 agent 的 fan-in**（真正保护）+ 新派发按失败位置条件化：共享闸门（`run_static_checks`）⇒ 停派发；具体测试文件且与新任务触摸集无关 ⇒ 派发继续（`running`/`green` ⇒ 照常；文件缺失不阻塞，等下一 tick） |
```

**Contract measure**（`grep -c 'run_static_checks' plugin/loop/fast-mode-loop-tick.md`）= 2 ≥ 1 ✓；
outer 文档同样 2。

**Scoped 验证**（`bash scripts/test.sh --for-task gap-red-window-dispatch-stop-should-be-shared-gate-conditional --allow-thin`）：
```
ℹ tests 45
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
EXIT=0
```
覆盖三份测试文件（`## Test-Files` 声明）：
- `red-window-shared-gate.test.mjs`（本条 fixture）——`classifyFailure` 两向、`shouldDispatchOnRed`
  共享闸门⇒停/具体无关⇒续/相交⇒停/fail-closed 边界、SUITE-RED 事件携带 `failureLocation`、两份文档
  一致性、`extractFailureFile` 双扩展名回归；
- `suite-state-trigger.test.mjs`（既有红窗触发者回归，含 Contract invoke `--fail-fast-check`）；
- `full-suite-runner.test.mjs`（runner 写 `state.failures` + AC6 交叉标注回归）。

## Definition of Done

- [x] AC1–AC5 全部勾上；AC4 实跑输出贴任务体
- [x] RED 处置条件化：一律暂缓 fan-in + 共享闸门才停派发（具体测试无关时继续）；inner 白等大部分消失
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md（自身文件：勾 AC + 贴 invoke 证据授权）


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

## Test-Files

- plugin/test/red-window-shared-gate.test.mjs（AC2/AC5 两向 fixture）
- plugin/test/suite-state-trigger.test.mjs（SUITE-RED 事件 + 既有红窗触发者回归）
- plugin/test/full-suite-runner.test.mjs（失败位置写入 state.failures + AC6 交叉标注回归）

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
