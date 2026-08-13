---
id: gap-delivery-critical-label-at-promote-not-after-dispatch
title: delivery-critical 标签在派发后才打 ⇒ AC36 排序轴永不被行使（标签应在 todo→ready 晋级时确定 + 判据语义修正）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，guard 任务）**：guard 于 21:21:10 派发（subagent fork），delivery-critical 标签
21:26:17 才打（晚 5min7s）——**标签的作用点在派发前（排序键），打完已在飞 ⇒ 被自己挤出 ranking**
（`touches-overlap-in-flight` 正确排除）。**今天这根轴两次无法测、原因同源**：
今晨 45 标签 0 ready（无候选）/ 现在 1 ready 有标签但在飞（被自己挤出）。
**共同点：打标签发生在它能起作用的那一刻之后。** 这比「没人打标签」严重——即使人人记得打，
只要时机在派发后，轴就永不被行使。**AC36 缺的不是纪律，是时机**——即使每个人都记得打，
只要打的时机仍在派发后，这根轴就永远不被行使。

**第二处缺陷（manager 指出）**：AC36 端到端判据「打了 label 的任务在 `recommended` 里位次严格前移」
与机制语义冲突——**已在飞任务本就不该出现在 `recommended` 里**（被 touches-overlap-in-flight 排除）。
判据与机制的语义对不上，本身就是要修的缺陷。

## Plan（manager 2026-08-12 裁定 ① + ②）

1. **delivery-critical 在 todo→ready 晋级时确定**（promote 闸或 promote 动作含该判定）——标签与 ready 同现，
   派发时排序键在位，轴在【下一次挑选】时被行使。
2. **AC36 判据语义修正**：改为「在 ready 池内比较两条同族任务，delivery-critical 者在 `recommended` 位次严格前移」——
   影响下一次挑选，不要求当前已在飞的那条出现在 recommended。
3. 负控制：重现本次时序——派发后补标签不被误记为 AC36 已触发（建成零触发 ≠ 已达成）。

## AC

- [x] AC1: delivery-critical 在 promote 时确定（标签与 ready 同现，负控：派发后补标签不改变排序）
- [x] AC2: AC36 判据改为 ready 池内同族比较（已在飞任务不要求出现在 recommended）
- [x] AC3: 负控制——派发后补标签不被误记为 AC36 已触发
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控制样例贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/ready-pool-check.ts（promote 闸加 delivery-critical 判定）
- plugin/scripts/slot-refill.ts（排序键消费 delivery-critical）
- plugin/test/（AC36 端到端判据修正的测试）
- tasks/gap-delivery-critical-label-at-promote-not-after-dispatch.md（自身）

## Evidence

**标签决定点（修复后）**：delivery-critical 在 **promote（todo→ready）时确定**，不再在派发后补。

- `plugin/scripts/ready-pool-check.ts`：`buildCandidate` 新增 `deliveryCritical`（读 frontmatter `labels`，
  与派发侧 parseCandidate 同一来源）；`setTaskStatus` 新增 `{ ensureDeliveryCritical }`，promote 时把
  `delivery-critical` 标签写进 frontmatter（"标签与 ready 同现"）；`applyPromotions`（`--apply` 心跳 promote 闸）
  对每个被晋级的候选按 `deliveryCritical` 判定并落标签，applied 记录暴露该判定。
- `plugin/scripts/slot-refill.ts`：排序键已消费 `deliveryCritical`（第二轴）；新增
  `delivery_critical_in_flight` 输出——**因在飞被 touches-overlap-in-flight 排除的 DC 任务**（被自己挤出 ranking
  的负控制形态，不在 `recommended`/`ranking` 里）。

**AC1 负控**：非 delivery-critical 候选 promote 时不发明标签（`applyPromotions` 负控测试）；派发后补标签不改变排序
（在飞 DC 任务被 self-exclusion 挡在 `recommended` 外，见 AC3 负控）。

**AC2 判据语义**：`recommended`/`ranking` 只含可派发集合——在飞任务**本就不要求出现在 recommended**；
e2e 测试改为 promote-then-dispatch 时序（todo 带 label → promote → 下一次 refill 取它）。

**AC3 负控样例（派发后补标签）**：
```
before  (ready, 无 label): recommended = [ac36-aaa, ac36-e2e]
派发 ac36-e2e（在飞）后补 delivery-critical label
after   (在飞 ac36-e2e):   recommended = [ac36-aaa]（ac36-e2e 被 touches-overlap-in-flight self-exclude）
                            delivery_critical_in_flight = [ac36-e2e]
                            ranking 只含 ac36-aaa ⇒ 不误记为 AC36 已触发
```

**scoped 门（worktree 根 `bash scripts/test.sh --for-task gap-delivery-critical-label-at-promote-not-after-dispatch`）**：
```
tests 147 · pass 147 · fail 0 · duration ~25.8s
```
（ready-pool-check.test.mjs 92 绿 + slot-refill.test.mjs 55 绿，含新增 11 个 delivery-critical-at-promote 测试；
既有 load-sensitive CLI smoke 测试按既有 `QUAY_TELEMETRY_SUBAGENTS=0` 约定 hermetic 化，使 scoped 门在全量套件并发下确定可绿。）
commit sha: 见分支 `task/gap-delivery-critical-label-at-promote-not-after-dispatch`（本工作树 HEAD）。
