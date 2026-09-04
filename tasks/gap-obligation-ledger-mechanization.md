---
id: gap-obligation-ledger-mechanization
title: 义务台账机械化——三层只有 inner 携带义务；outer/manager
  的账本是日记不携带义务，「漏了就漏了」是结构原因；需义务一等对象+年龄负反馈+阶梯挂最老年龄（推导非作者写，未处置不能
  no-action），第一个适用对象=outer verification-round
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**三层里只有 inner 的工作单元携带义务且不满足不能收（任务带 AC/DoD + task-contract-check/DoD gate 拦 fan-in）。outer 有 verification-round.jsonl（round=170/171）但不携带义务；manager 的 tick-log 是日记（类型/做了什么/内层状态）也不携带义务。日记条目永远不可能「未达成」，只可能「没写」——「漏了就漏了」是结构原因不是品性问题。根使能条件：义务在今天不是对象，每轮从读数重新推导，没有 id 就没有年龄——【一件被跳过的事和一件刚出现的事，在下一轮输入里长得一模一样】。所以每轮都从零重新挑，自然每轮挑最便宜的。需要义务台账机械化（推导义务集、算年龄、升级阶梯、不满足不能收）。**

### 应然（manager 2026-08-09，人已裁定）

**形状·三件缺一不可**：
1. **义务成为一等对象**：`{id, 条件, 真假, first_true_at, ticks_true, discharged_at, discharged_by, defer_reason}`
2. **负反馈=年龄进下一轮输入 + 优先级随年龄单调上升**：tick 读数段必须含「上轮未处置义务按年龄降序」；处置顺序按年龄不按成本；跳过使它下一轮更靠前而不是更容易被忽略
3. **升级阶梯挂在【最老未处置义务的年龄】上**，不挂在内容上（`nyf>5` 那种是实例阈值，写一条只治一条）

**两条硬性质**：
- **义务集必须是【推导】的不是【作者写】的**——否则 cherry-pick 从「漏做」变成「漏写」，一模一样
- **未处置或未显式 defer（带理由+解阻塞条件）则本轮不能判 no-action**

**实例已跑通一轮**：`orchestration/manager-obligation-ledger.jsonl`（13 行，提交 01de6470）。第一轮先咬到 manager 自己：按年龄优先最老未处置是 OB-AC28（11 轮，manager 主判据无可跑判据），manager 处置了自己那条并补上可跑判据（cross_layer_borrow=7，引用完整性 4/4）。台账还拦住了 OB-SLOT「真但读数不可信」（pane=0/worktree=2/budget in_use=0，三源三值）——按 ADR-033 场点#4 不得据它下派发指令。

**第一个适用对象 = outer 自己的 verification-round**：让 round 记录携带【推导出的】义务集，未处置或未显式 defer 则不能闭轮——与 inner「任务带 DoD、不满足不能 fan-in」完全同构。

### 机械化（按 ADR-033：值从哪来定形式）

- **年龄计算/排序/升级阶梯**：普通 JS（确定、无意志）——`obligation-ledger.ts` 或扩展现有账本追加机制
- **「这条义务算不算已处置」**：带 schema 的 `agent()`（语义判断）——与 no-action-check 的 agent₁/₂/₃ 同族
- **台账存储**：已有追加账本机制（jsonl，同 manager-obligation-ledger.jsonl 形状）

### 已知弱点（必须写进任务体，不许藏）

**谁写台账谁就能漏写**——台账由本层写、上层审（manager 审 outer，outer 审 inner）；顶层审计 = 人 + 接进套件静态检查的机械核对。它**不保障难的那件被做了**，只保障：它排在最前、跳过留痕、年龄到阈值自动升级。这是设计的诚实边界，不是可接受的残缺。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录应然（三件形状 + 两条硬性质 + manager 实例 OB-AC28/OB-SLOT）+ 已知弱点（任务体 Proposal 已含；内层补：构造「上轮未处置义务被跳过」复现——见 Evidence 第 1-2 轮：OB-SLOT round-1 live 未处置 ⇒ round-2 同一 id 年龄 1→2、仍在最老未处置位）
- [x] AC2: **义务一等对象 + 推导义务集**——`{id, 条件, 真假, first_true_at, ticks_true, discharged_at, discharged_by, defer_reason}`；义务集由读数推导（非作者写）——同一条件在两轮产生同一 id，漏写即漏记（deriveObligationId 确定；缺读数 ⇒ live:null/未查，fail-closed 拦闭轮）
- [x] AC3: **年龄负反馈**——tick 读数段含「上轮未处置义务按年龄降序」；处置顺序按年龄不按成本；跳过使下一轮更靠前（构造：老义务跳过 ⇒ 下一轮排最前——Evidence：`undischargedByAgeDesc` 把 age=2 的 OB-SLOT 排最前；`--oldest` 输出 `OB-SLOT 2`）
- [x] AC4: **升级阶梯挂最老年龄**——`最老未处置义务的 age ≥ 阈值` ⇒ 升级（不挂内容）；`nyf>5` 类实例阈值不算（写一条只治一条）——Evidence：`--age-threshold 3` 时 oldest_age=3 ⇒ `escalate:true`
- [x] AC5: **不满足不能收**——verification-round 记录携带推导义务集；未处置或未显式 defer（理由+解阻塞条件）⇒ 不能闭轮（与 inner DoD gate 同构，构造「未处置义务 + 强行闭轮」⇒ 拒绝）——Evidence：round-2 未处置 ⇒ `--round-close-check` 输出 `CANNOT-CLOSE` exit 1；defer 后 ⇒ `CAN-CLOSE` exit 0
- [x] AC6: **既有机制不回归**——`--for-task` scoped 门绿（含 ledger / verification-round 契约检查）——`./scripts/test.sh --for-task gap-obligation-ledger-mechanization` EXIT:0，38 测试全绿

## Evidence（inner 2026-08-10，Contract invoke 构造两轮贴回）

`node --no-warnings --experimental-strip-types plugin/scripts/obligation-ledger.ts --report`（两轮 + `--oldest` + `--round-close-check`）：

```
ROUND 1 --report（同一条件 → 推导出 id=OB-SLOT；live=true 未处置 ⇒ canClose=false，exit 1）：
  {"id":"OB-SLOT","key":"SLOT","live":true,"first_true_at":1,"ticks_true":1,
   "discharged_at":null,"defer_reason":null}
  ladder: {"escalate":false,"oldest_age":1,"threshold":3}   canClose: false

ROUND 2 --report（跳过 ⇒ 同一 id，年龄 1→2，仍在最老未处置位）：
  {"id":"OB-SLOT","key":"SLOT","live":true,"first_true_at":1,"ticks_true":2,
   "discharged_at":null,"defer_reason":null}
  ladder: {"escalate":false,"oldest_age":2,"threshold":3}   canClose: false

--oldest（band：age 随轮次单调升 1→2）：OB-SLOT 2
--round-close-check（未处置强行闭轮 ⇒ 拒绝，exit 1）：CANNOT-CLOSE: 1 undischarged undeferred live obligation(s): OB-SLOT(live=true)

--report --round 3 --age-threshold 3（年龄到阈值 ⇒ 升级）：
  ladder: {"escalate":true,"oldest_age":3,"threshold":3}
--defer OB-SLOT --reason "阻塞在人的裁定" --unblock "人裁定"（显式 defer ⇒ 闭轮成功）：
  --round-close-check：CAN-CLOSE  exit 0
```

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 修后实跑：构造跳过老义务 ⇒ 下一轮排最前；未处置强行闭轮 ⇒ 拒绝；年龄到阈值 ⇒ 升级（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- .quay/verification-round.jsonl（verification-round 义务集推导 + 台账——outer 第一个适用对象；gitignored 运行态文件，义务集进记录形状）
- plugin/scripts/obligation-ledger.ts（年龄/排序/阶梯 JS 确定性部分——推导义务集/算年龄/按年龄降序/升级阶梯/闭轮闸）
- plugin/scripts/obligation-discharge-agent.ts（「已处置」语义判定 schema 契约——带 schema，同 no-action-check agent 族；ADR-033）
- plugin/scripts/obligation-ledger-check.ts（顶层完整性审计——接进 scripts/test.sh 静态检查）
- plugin/scripts/checker-mutation-cases/obligation-ledger-check.sh（新 checker 的 mutation case）
- plugin/test/obligation-ledger.test.mjs（AC2/AC3/AC4/AC5 + Contract）
- plugin/test/obligation-ledger-check.test.mjs（顶层审计 checker 的测试）
- plugin/test/obligation-discharge-agent.test.mjs（「已处置」schema 契约测试）
- plugin/test/verification-round.test.mjs（AC5：round 记录携带推导义务集；未处置不能闭轮）
- plugin/test/manager-obligation-ledger.test.mjs（交叉标注——manager 实例形状与机械化推导对齐）
- scripts/test.sh（顶层审计接进静态检查——机械核对台账完整性）
- plugin/scripts/capability-catalog.sh（注册新脚本——catalog 是唯一清单，硬规则 1）
- orchestration/manager-obligation-ledger.jsonl（交叉标注——manager 实例，形状参照）
- tasks/gap-obligation-ledger-mechanization.md（自身：勾 AC + 贴证据）

## Contract

measure   oldest_undischarged_age_visible = `node plugin/scripts/obligation-ledger.ts --oldest` 的 stdout（最老未处置义务 id + age）
band      oldest_undischarged_age_visible = 非空且 age 随轮次单调升（跳过 ⇒ 下一轮更靠前）
invariant obligation_set_derived = 1（同一条件两轮同一 id，非作者写）
invariant round_cannot_close_with_undischarged = 1（未处置/未 defer ⇒ verification-round 不能闭轮）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/obligation-ledger.ts --report`（构造两轮贴回）
control   跳过老义务 ⇒ 下轮排最前；未处置闭轮 ⇒ 拒绝；年龄阈值 ⇒ 升级
resume    ledger 骨架 + 推导义务集 + 阶梯接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（人已裁定：义务台账机械化——义务一等对象/年龄负反馈/阶梯挂最老年龄；硬性质=推导非作者写+未处置不能 no-action；已知弱点=谁写台账谁漏写，本层写上层次审。第一个适用对象=outer verification-round。按 ADR-033：JS 算年龄/排序/阶梯，agent(schema) 判已处置。实现归内层）
