---
id: gap-suite-state-has-no-reason-axis-failed-aborted-infra
title: "full-suite-state.json's state has NO REASON AXIS — state=red carries
  'this round didn't succeed' but nothing about WHY: a real test failure (has
  correctness info, stop-dispatch on code risk) vs a deliberate abort to save
  the machine (no correctness info, stop by resource state) vs infra-error look
  IDENTICAL downstream because suite-state-trigger.ts consumes only
  state==='red' and cannot read note; the outer was FORCED to hand-write a note
  field ('ABORTED by outer — resource safety') to distinguish — the escape hatch
  appearing IS the criterion: when the schema is insufficient, a human invents a
  workaround, and its location marks the missing dimension; generator question:
  what range does state quantify? 'this round didn't succeed' — the missing
  range is REASON; fix: add an outcome/reason enum (failed|aborted|infra-error)
  to the state file, suite-state-trigger.ts routes by reason — aborted does NOT
  stop-dispatch on code-risk (the red-window rule's stop is driven by
  resource-gate.sh's GO/WAIT instead); NOW-live: this round's red carries zero
  correctness info (suite never finished, durationMs=null) yet the red-window
  stops dispatch anyway — currently CORRECT only by coincidence (machine just
  recovered from load 31.7), and that coincidence breaks the moment load
  recovers while red lingers with no evidence supporting continued stop; AC10:
  +1 => 5->6, pre-friction (nothing hurting — ABORT handled well, machine
  recovered, downstream behavior happens to be right), found by asking the
  generator question"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者第 5 条（2026-08-05 07:40Z）——**full-suite-state.json 的 state 缺原因轴**，且现在正在影响派发。

**【触发】外层被迫手写 note 逃生舱**：07:26Z 为救机器中止套件后，state 只有 `red` 一个值表达「这轮
没成」，于是只能在 note 里手写 `ABORTED by outer ... resource safety` 来区分。而 suite-state-trigger.ts
消费的是 `state === 'red'`，**读不到 note** ⇒ 对下游而言，「测试真失败」和「为救机器主动中止」完全
一样。

**【为什么现在就有影响】本轮 red 不携带任何正确性信息**——套件根本没跑完，durationMs 是 null。但
红窗规则照样停派，而池子里有 24 个就绪、10 个互不相交。**现在停派其实是对的，但理由是错的**：真正
的理由是机器刚从 load 31.7 恢复、不该马上压 3 个并发任务，不是「代码可能坏了」。这个巧合会在 load
恢复后立刻破裂——那时 red 还在、派发还停着、而**没有任何证据支持继续停**。

**【生成器问句】state 量化的是什么范围？** 答「这一轮没成」。缺的是**原因轴**：
- **failed**（真失败，有正确性信息，该按代码风险停派）
- **aborted**（主动中止，无正确性信息，该按资源状态决定——resource-gate GO/WAIT）
- **infra-error**（环境问题，两者都不是）

三者对下游的正确反应完全不同，现在被压成一个标量。

**【自我作废（管理者）】**：原想报「note 字段历史上出现 0 次，说明这是第一次绕过 schema」——查了
`git ls-files`，该文件**未受跟踪**，这个统计无效，已作废，不要采信。

**【核心判据】**：**你手写 note 这个动作本身就是判据——schema 不够用时，人会发明一个逃生舱；那个
逃生舱出现的位置，就是缺失维度的位置。** 这是「schema 缺口 → 人发明 workaround」的可观测信号。

### 选定机制（外层裁定：立案 + 与 checker-cost 并列）

1. **state 加 reason 枚举**：`{state: running|green|red, reason?: failed|aborted|infra-error}`——
   runner 早标 RED 时写 `reason: failed`（有正确性信息）；外层中止时写 `reason: aborted`；环境问题
   写 `reason: infra-error`。
2. **suite-state-trigger.ts 按 reason 路由**：`state=red + reason=aborted` ⇒ **不按代码风险停派**，
   恢复由 resource-gate.sh 的 GO/WAIT 决定（resource-gate 是「现在能不能压」的判据）；`reason=failed`
   ⇒ 红窗规则照旧停派 + 分诊（bisect 定位）。
3. **note 逃生舱收编为字段**——`reason` 是 note 的合法化：逃过 schema 的语义进 schema，不再手写。
4. **AC10 记账：+1 ⇒ 5 → 6**——pre-friction（ABORT 处置得当、机器已恢复、下游行为恰好正确，没有任何
   东西在疼），照生成器问句问出来，且那个巧合尚未破裂。

## Acceptance Criteria

- [ ] AC1: **state 加 reason 枚举**——`{state, reason?: failed|aborted|infra-error}`；runner 早标 RED
      写 `reason: failed`，外层中止写 `reason: aborted`（可机械区分，不再手写 note）
- [ ] AC2: **trigger 按 reason 路由**——`red + aborted` ⇒ 不按代码风险停派，恢复由 resource-gate 的
      GO/WAIT 决定；`red + failed` ⇒ 红窗照旧停派 + 分诊（bisect）
- [ ] AC3: **巧合破裂场景消除**——load 恢复后 red+aborted 不再无限期停派（资源 GO 即恢复，不靠
      「red 还在所以继续停」的错误理由）；failed 无此放宽
- [ ] AC4: **note 逃生舱收编**——reason 字段使手写 note 不再必要（ABORT 场景实跑输出贴任务体：
      reason=aborted + trigger 读它路由而非只读 state=red）
- [ ] AC5: **真实使用**——本轮 ABORT（07:26Z）作为回归基：修复后同场景 reason=aborted、trigger 按
      资源路由（实测输出贴任务体）
- [ ] AC6: **AC10 诚实记账**——pre-friction（无东西在疼），计 +1 ⇒ 5 → 6
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4/AC5 实跑输出贴任务体
- [ ] state 有原因轴（failed/aborted/infra-error 可区分）；trigger 按 reason 路由（aborted 由资源门
      决定恢复）；note 逃生舱收编
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-suite-state-has-no-reason-axis-failed-aborted-infra.md
- plugin/scripts/full-suite-runner.ts（state schema + reason 枚举 + 早标 RED 写 failed）
- plugin/scripts/suite-state-trigger.ts（按 reason 路由：aborted → 资源门 / failed → 红窗分诊）
- plugin/test/suite-state-trigger.test.mjs（AC2/AC3 fixture）
- plugin/test/full-suite-runner.test.mjs（AC1/AC5 fixture）
- tasks/gap-no-criterion-records-its-own-cost-checker-cost-jsonl.md（AC6 记账引用，同 schema 演进轴）

## Contract

measure   reason_routes = `grep -c "aborted\|infra-error\|failed" plugin/scripts/suite-state-trigger.ts` stdout 的数字段
band      reason_routes >= 2（aborted→资源门、failed→红窗分诊，至少两路可区分）
invariant no_handwritten_escape_hatch = 1（ABORT 场景 reason=aborted 字段承载，无手写 note）
invoke    `grep -n "reason\|aborted" plugin/scripts/full-suite-runner.ts plugin/scripts/suite-state-trigger.ts`
control   构造 state=red+aborted ⇒ trigger 不按代码风险停派、由资源门决定（AC2）；state=red+failed ⇒ 照旧停派分诊（AC2 负向）
resume    schema 扩展与 trigger 路由分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:45Z
changed: 外层受管理者第 5 条裁定立案（生成器问出 + 正在影响派发）。四处收紧：
(1) **原因轴缺失**——state 只一个 red 值承载「没成」，failed/aborted/infra-error 对下游反应完全不同
    被压成标量；trigger 只读 state=red 读不到 note；
(2) **逃生舱判据**——我被迫手写 note = schema 不够时人发明 workaround，其位置就是缺失维度的位置；
(3) **aborted 路由**——不按代码风险停派，恢复由 resource-gate GO/WAIT 决定；failed 照旧分诊；
(4) **AC10 5→6**——pre-friction（无东西在疼，巧合尚未破裂）。
status: todo——schema 缺原因轴、正在影响派发；**优先级提到与 laneCount 同级**（管理者 07:52Z：同一
次事故的两半——laneCount 让机器崩、reason 让机器恢复后仍然停摆；此刻 load 5.86/资源门 GO/机器完全
空闲而 state 仍是 ABORTED 的 red、红窗照旧停派 = 正在发生的白等）。**最小止血已由外层执行**（07:53Z
手工把 state 改回 running + 用 --lane-count 1 重跑，下游解冻）；schema 修复仍归内层，与
gap-no-resource-awareness AC12/AC13 一并落地。
