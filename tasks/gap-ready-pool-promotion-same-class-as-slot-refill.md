---
id: gap-ready-pool-promotion-same-class-as-slot-refill
title: "ready-pool auto-promotion (step 3.6: pool < floor ⇒ 本 tick 补晋) written as a FORCED step but execution depends on inner tick volition — pool=5 < floor=20 sustained ~3h, 121 todo / 33 ready, last MECHANICAL promote bbf85ea9 00:53, two promotes since were human-directive/event-driven (0361893d/0aeaef38), ready-pool-check currently recommends 7 promotions (manager measurement 2026-08-06 04:0xZ + outer git-verified); SAME CLASS as gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat — a forced step in the tick doc with no mechanical guarantee it runs; fix: tick doc step 3.6 must run ready-pool-check + apply promotions unconditionally each tick (like slot-refill's heartbeat-must-run), or fold into the same heartbeat guarantee"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**就绪池自动补晋（步骤 3.6：`pool < floor` ⇒ 本 tick 补晋）写成强制步骤，但执行依赖内层 tick 自觉——3 小时没跑。**

**【实测（管理者 2026-08-06 04:0xZ + 外层 git 核实）】**：pool=5 < floor=12（GO 档 cap=5 ⇒ floor 20），
121 todo / 33 ready。上次**机械** promote（bbf85ea9「tick 3.6 promote 8 candidates」）00:53，
距今 ~3 小时。此后 2 次 promote 都是**人指令/事件驱动**（0361893d 人优先级三条、0aeaef38
slot-refill 回填处理），**机械 `pool<floor` 路径 3 小时没机会跑**。

**【根因（与 slot-refill 完全同族）】**：fast-mode-loop-tick.md 步骤 3.6 写「**就绪池 < floor 时，本 tick
内从 todo 补晋到 ready**」——是强制步骤，但没有机械保证它被执行。内层最近 tick 全被「等 background
agent / fan-in / 修测试缺陷」占满，3.6 的补晋从未实际走到。`ready-pool-check.ts` 当前 recommends
7 个候选（promotions 数组非空），机械答案一直都在，只是没人问。

**与 gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat 同根**：写成强制步骤 + 执行靠自觉。
slot-refill 修的是「派发评估」无人问，本条是「补晋评估」无人问——**同一个「tick 心跳无机械保证」的
两个实例**。

### 选定机制

1. **步骤 3.6 无条件执行**：每 tick 必跑 `ready-pool-check.ts`，`pool < floor` 且 `promotions` 非空
   ⇒ 补晋落盘（与 slot-refill 的「心跳必跑」同一保证形态）
2. 或：并入 slot-refill 的心跳保证——`slot-refill` 返回后接着跑补晋（同一条 tick 心跳机械链）

## Acceptance Criteria

- [ ] AC1: tick 心跳必跑 ready-pool-check（pool<floor 且 promotions 非空 ⇒ 补晋落盘），不依赖自觉
- [ ] AC2: 与 gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat（done）交叉标注——
       同一根因（tick 心跳无机械保证）的第二个实例
- [ ] AC3: 负控制——pool ≥ floor 或 promotions 空时不补晋（不空转）
- [ ] AC4: 当前 7 个推荐候选可被机械补晋（恢复 pool 到 floor 附近）

## Definition of Done

- [ ] AC1-AC4 全勾（tick 心跳必跑 ready-pool-check，pool<floor 且 promotions 非空 ⇒ 补晋落盘；与 slot-refill-only-triggered 交叉标注——同一根因第二实例；负控制 pool≥floor 或 promotions 空不补晋；当前候选可机械补晋）
- [ ] tick 心跳补晋实测：pool<floor 时自动补晋，不需自觉
- [ ] scoped 门 `scripts/test.sh --for-task gap-ready-pool-promotion-same-class-as-slot-refill` 绿

## Touches
- tasks/gap-ready-pool-promotion-same-class-as-slot-refill.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/loop/fast-mode-loop-tick.md（步骤 3.6 无条件执行措辞）
- docs/analysis/fast-mode-loop-tick.md（部署副本同步）
- plugin/scripts/ready-pool-check.ts（若需心跳模式）
- tasks/gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat.md（AC2 交叉标注）

## Contract

measure   pool_maintained = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)"` stdout 的 pool 字段
band      pool_maintained = 不长期 < floor（补晋后 pool 回升；机械路径可触发）
invoke    `grep -n '3.6\|pool < floor\|补晋\|promotions' plugin/loop/fast-mode-loop-tick.md`
control   pool<floor + promotions 非空 ⇒ 补晋落盘（AC1）；pool≥floor 不空转（AC3）
resume    心跳接线与补晋分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T04:1xZ
changed: 管理者实测 + 外层 git 核实坐实——pool<floor 3 小时未机械补晋，2 次 promote 均人/事件驱动。
与 slot-refill 同根（tick 心跳无机械保证），另立。待内层修完测试缺陷（suite red）后派发。
