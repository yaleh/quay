---
id: gap-outer-tick-core-b9-coverage-blind-spot
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**外层执行核 B9 的「队列空 ⇒ 补充」只在队列空时触发——队列不空但在飞=0（空槽存在且 recommended 非空）是覆盖盲区。实证：2026-08-10 05:00–06:44 连续 ~8 轮，pool=32 / dispatchable_disjoint=13 / slots_free=5 / slot-refill.sh `should_refill=True, no_refill_reason=None`，outer 对 inner 投递 0 次。manager A14 甲（空槽成立）连续 5 轮成立，升级由人第三次发起——不是任何核/检查器拦截的。**

### 实证（manager 2026-08-10 逐条核实 + outer 复核）

- **B9 原文**（orchestrator-tick-core.md:47）：「队列空 ⇒ 按候选/依赖/checkTouchesPair/优先级补充」——**触发条件是「队列空」**。
- **B3 甲原文**（src:709 系）：「`in_flight < cap` 且 `recommended` 非空 ⇒ 空槽必须处置」——这是**强制动作**，但**不在执行核 B 产出清单里**（grep `slots_free|should_refill|空槽|B3 甲|甲成立` 在 core 零命中）。
- **机制断裂**：slot-refill.sh 是探针（报 `should_refill`/`recommended`），B9 是「队列空」补充触发——**「探针说该派发 + 队列不空 + 空槽存在」三者同时成立时，没有任何一条核强制 outer 派发**。派发成了「outer 想做才做」的意志行为，不是「空槽必须处置」的机械动作。
- **实测**：2026-08-10 05:00 起 meta-cc 读 outer 会话 tool_use，含 `quay-0:inner` 的投递命令 0 条；同期 outer 做了 fan-in suite-fix/01、resolve 裁定2 上限、闭账 30 翻、retreat 4 个过早 done-flip——**全是收尾与治理，零派发**。
- **后果**：inner 在飞=0、pool 32 ready 全部空等；inner 侧「Agent budget exhausted (200/200) — dispatch resumes next session」是 inner 自报的预算耗尽（inner-side），但 outer 也从未投递——两个独立缺口叠加。

**为什么重要**：这是「机制存在但触发条件错位」的又一处——探针（slot-refill）与动作（派发）之间缺一条「recommended 非空 ⇒ 必须派」的强制链。A14 甲被设计成连续 K 轮升级的阶梯，但「甲成立」的观测（空槽）从不驱动任何 outer 动作，所以阶梯只在 manager 侧记录、从不开火。

### 选定机制方向（实现归 inner，判定归 outer）

1. **B9 加「空槽强制派发」分支**：`should_refill=true`（slot-refill 输出）且 in_flight=0 且 recommended 非空 ⇒ 从 recommended 取 1-2 条派给 inner（不填满 cap，人 01:15 收窄规则④：被红卡住时不填满但 ≠ 零派发）。
2. **判据机械化**：执行核 B 产出清单加一行「派发检查」——`slot-refill.ts --json` 的 `should_refill`/`recommended` 进 tick 必读；`should_refill=true` 且未派发 ⇒ B8 记 `no-action` 不合法（同 B13 五条不等式的强制举证）。
3. **交叉标注**：与 gap-b3-arbitration-inflight-vs-backlog（B3 甲冲突仲裁）、gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release（派发评估时机）、gap-slot-refill-* 同族。

**验证锚**：修后 (a) 执行核出现「should_refill=true 且 recommended 非空 ⇒ 派发」的强制行；(b) tick 必读含 slot-refill 输出；(c) 实证场景（pool 32/dd 13/in_flight 0）下 core 强制派发而非靠意志。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 05:00–06:44 零派发实证（meta-cc 0 投递 + B9 队列空触发 + should_refill=true 无动作）（本任务 Proposal 已含）
- [ ] AC2: **B9 加空槽强制派发分支**——should_refill=true 且 recommended 非空 ⇒ 从 recommended 取 1-2 条派给 inner
- [ ] AC3: **判据机械化**——执行核 B 产出清单加派发检查；should_refill=true 未派发 ⇒ B8 no-action 不合法
- [ ] AC4: **tick 必读加 slot-refill**——`slot-refill.ts --json` 的 should_refill/recommended 进 A 段必读
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造 pool 非空 + in_flight=0 + recommended 非空场景 ⇒ core 强制派发（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（B9 加空槽强制派发分支 + A 段必读加 slot-refill + B8 no-action 判据）
- plugin/scripts/slot-refill.ts（若需：should_refill 语义补充「recommended 非空」独立可读）
- plugin/test/slot-refill.test.mjs（AC2/AC3 测试）
- tasks/gap-b3-arbitration-inflight-vs-backlog.md（交叉标注——B3 甲冲突仲裁）
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（交叉标注——派发评估时机）
- tasks/gap-outer-tick-core-b9-coverage-blind-spot.md（自身：勾 AC + 贴证据）

## Contract

measure   core_forces_dispatch = `grep -c "should_refill.*recommended\|recommended 非空" orchestration/orchestrator-tick-core.md` 的 stdout 数字
band      core_forces_dispatch >= 1（执行核出现空槽强制派发行）
invariant b8_no_action_requires_refill = 1（should_refill=true 未派发 ⇒ B8 no-action 不合法）
invariant tick_reads_slot_refill = 1（A 段必读含 slot-refill 输出）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root . --cap 5 --json`（贴 should_refill/recommended）
control   pool 非空 + in_flight 0 + recommended 非空 ⇒ core 强制派发；无此场景不误报
resume    B9 分支 / 判据机械化 / tick 必读分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager A14 甲连续 5 轮成立、升级由人第三次发起——outer 核实：B9 只在队列空触发、core 无「should_refill=true 且 recommended 非空 ⇒ 派发」强制行、slot-refill 探针与派发动作之间断裂。立案。实现归 inner
