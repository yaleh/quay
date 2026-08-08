---
id: gap-ready-pool-promotion-same-class-as-slot-refill
title: "ready-pool auto-promotion (step 3.6: pool < floor ⇒ 本 tick 补晋) written as a FORCED step but execution depends on inner tick volition — pool=5 < floor=20 sustained ~3h, 121 todo / 33 ready, last MECHANICAL promote bbf85ea9 00:53, two promotes since were human-directive/event-driven (0361893d/0aeaef38), ready-pool-check currently recommends 7 promotions (manager measurement 2026-08-06 04:0xZ + outer git-verified); SAME CLASS as gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat — a forced step in the tick doc with no mechanical guarantee it runs; fix: tick doc step 3.6 must run ready-pool-check + apply promotions unconditionally each tick (like slot-refill's heartbeat-must-run), or fold into the same heartbeat guarantee"
status: todo
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

- [x] AC1: tick 心跳必跑 ready-pool-check（pool<floor 且 promotions 非空 ⇒ 补晋落盘），不依赖自觉 —
      fast-mode-loop-tick.md 步骤 3.6 新增「tick 心跳必跑：每 tick（含轻触）无条件跑
      `ready-pool-check.ts --apply`」+ ready-pool-check.ts 新增 `--apply` 心跳模式
      （pool<floor 且 promotions 非空 ⇒ 写 status: todo → ready，无需自觉）+
      plugin/test/ready-pool-check.test.mjs「--apply heartbeat」测试 + ready-pool-heartbeat.test.mjs 文档契约
- [x] AC2: 与 gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat（done）交叉标注——
      同一根因（tick 心跳无机械保证）的第二个实例 — 已在其任务体加「第二实例」交叉标注注
      （2026-08-08，grep `第二实例` 命中）+ fast-mode-loop-tick.md 步骤 3.6 交叉引用 slot-refill
- [x] AC3: 负控制——pool ≥ floor 或 promotions 空时不补晋（不空转）—
      ready-pool-check.test.mjs「pool >= floor ⇒ zero writes」+「promotions empty ⇒ zero writes」两个负控制测试
- [x] AC4: 当前 7 个推荐候选可被机械补晋（恢复 pool 到 floor 附近）— 真实 store 临时 worktree 实跑
      `--apply`（见 ## Invoke evidence）：7/7 候选 status:todo→ready 落盘（should_apply=true），机械无需自觉；
      补晋后 re-read pool 5→6——6/7 是 work 已落地的 not-yet-flipped 任务被派发池排除（task-status-drift 族），
      故「可被机械补晋」成立，「恢复 pool 到 floor」受既有 not-yet-flipped 排除影响（诚实标注）

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

## Test-Files
- plugin/test/ready-pool-check.test.mjs（既有：apply 心跳模式逻辑测试——池<floor 落盘 / 负控制零写入 / setTaskStatus / 默认纯读不写）
- plugin/test/ready-pool-heartbeat.test.mjs（新增：AC1/AC3 文档契约测试——模板与部署副本必含 --apply 心跳措辞）

## Invoke evidence（scoped 实跑 + 心跳补晋实测，2026-08-08）

**Contract invoke**（`grep -n '3.6\|pool < floor\|补晋\|promotions' plugin/loop/fast-mode-loop-tick.md`）：

```text
638:### 3.6 就绪池维护（晋级节奏是机制，不是角色自觉——强制）
646:**tick 心跳必跑：每 tick（含轻触）无条件跑 `ready-pool-check.ts --apply`**
676:# tick 心跳必跑（gap-ready-pool-promotion-same-class-as-slot-refill——与 slot-refill 同一根因的第二个
679:# promotions 非空 ⇒ 补晋机械落盘（status: todo → ready），不靠自觉；pool ≥ floor 或 promotions 空 ⇒
680:# 零写入（负控制 AC3，不空转）。stdout 的 applied_promotions 列出本次落盘的候选
682:node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --cap "${effective_cap:-3}" --apply
703:- **`pool < floor` ⇒ 按 `promotions` 数组补晋**…**落盘由上面命令的 `--apply` 心跳模式机械完成**
```

**Contract measure / band**（补晋后 pool 回升，机械路径可触发）：`--apply` 心跳模式在真实 store 临时
worktree 实跑（见 AC4）把 7 个 todo 候选机械落盘为 ready——pool 由 5 回升（其中 6/7 是 work 已落地的
not-yet-flipped 任务被派发池排除，见 AC4 诚实标注）。

**AC4 实测（真实 store 临时 git worktree，复制本分支 ready-pool-check.ts 后实跑）**：

```text
=== BEFORE --apply (read mode) ===
pool: 5  floor: 12  deficit: 7  promotions: 7
=== RUN --apply (heartbeat mode) ===
should_apply: True
applied_promotions (7): 全部 ok — status:todo → ready 落盘
=== AFTER --apply (re-read) ===
pool: 6  floor: 12  deficit: 6   (6/7 落盘候选 work 已落地 → not-yet-flipped 排除出派发池)
```

**scoped 门**（`bash scripts/test.sh --for-task gap-ready-pool-promotion-same-class-as-slot-refill --allow-thin`，exit 0）：

```text
== scoped static checks ==
  task-contract-check: no violations.
  drive-contract-check: PASS — 0 violations
  instrument-failure-check --gate: PASS
== build dist/quay.js + quay-native.js == 成功（esbuild）
== 测试 ==
ℹ tests 58 · pass 58 · fail 0 · cancelled 0  (ready-pool-check.test.mjs 55 + ready-pool-heartbeat.test.mjs 3)
```

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
