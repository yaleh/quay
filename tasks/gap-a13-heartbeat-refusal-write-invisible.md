---
id: gap-a13-heartbeat-refusal-write-invisible
title: "A13 结构修复——AC53 拒写只进旁路、主心跳不更新 ⇒ 活跃 inner 恒被判 DEAD；(甲) 判据取 max(主心跳, refusal ts) + (乙) 拒写也写主快照带 written:false"
status: todo
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

**来源**：outer 2026-08-16 relay 的 A13 结构问题——「拒因恒『可派活』⇒ 主心跳永不更新 ⇒ A13 必 DEAD」。

**现状（三文件行为，实测 2026-08-16 21:3xZ）**：
```
writer inner-wakeup-heartbeat.ts：AC53 END-INVARIANT 闸在 should_refill=true + slots_free>0 +
  dispatchable_disjoint>0 时 REFUSE（exit 1）——拒写只 append {written:false, ts, refuse_reason}
  到旁路 inner-wakeup-heartbeat-refusals.jsonl（主 jsonl/json 保持纯净，不被污染）。
judge inner-wakeup-heartbeat-check.ts：只读主 .json 的 ts 判新鲜（age > 5400s ⇒ DEAD），
  不读 refusals 旁路。
```
**实证（21:30:10Z 实测）**：主 json ts=1786905010（=18:30:10Z，3h 前）⇒ age=10800s > 5400s ⇒ **A13 报 DEAD**；
refusals 末条 ts=1786911043（=20:10:43Z，79min 前）⇒ 若判据取 max ⇒ age=4770s < 5400s ⇒ **ALIVE**。
inner 该时段全程活跃（fan-in AC97/round8/派发）⇒ **A13 的 DEAD 是结构误报**——活跃但被闸拒写的工作
状态在主心跳上不可见（与 3b「读不懂伪装成通过」镜像：这里是「被拒写伪装成死了」）。

**根因**：AC53 拒写是【合法且频繁】的活跃信号（dispatchable work waits = inner 正忙），但该信号只落在
judge 不读的旁路 ⇒ 判据把「活跃拒写」误读成「死」。

**修复（两条，互为补充）**：
- **(甲) judge 侧（最小，零写入语义变更）**：`inner-wakeup-heartbeat-check.ts` 判新鲜改用
  `max(主 json ts, refusals jsonl 最新 ts)`——最近一次拒写也证 inner 活跃（拒写 = 想睡但被闸拦下继续干）。
- **(乙) writer 侧（更完整）**：`inner-wakeup-heartbeat.ts` 拒写时**也更新主 .json 快照**，带
  `written:false + refuse_reason`（jsonl 仍保持纯净；只动 legacy .json，其消费者 semantic-observer judge
  需兼容新字段）。使主心跳本身反映「活跃但被拒」而非「无声」。

**⛔ 不设数值阈值**：5400s（=3×1800s 心跳周期）是既有判据，不改。只改「取哪个 ts」。

**边界**：不改 AC53 闸逻辑（闸本身正确——「无合法出口睡在可派活之上」）；不改 jsonl 写入语义；
不给 A13 造第二个心跳载体（沿用既有 refusals 旁路）。

## Acceptance Criteria

- [ ] AC1: **judge 判新鲜取 max(主 json ts, refusals 最新 ts)**——`inner-wakeup-heartbeat-check.ts` 读 refusals 旁路，
      两者取大。读生产载体（refusals jsonl 真实行），非 fixture。
- [ ] AC2: **负控制（读真实数据）**：21:30:10Z 快照下（主 json 18:30 / refusals 末条 20:10），
      修复前判 DEAD、修复后判 ALIVE——同一输入两读数可区分。
- [ ] AC3: **writer 拒写也更新主 .json 快照（带 written:false）**——`inner-wakeup-heartbeat.ts` 拒写路径
      写 `{ts, ..., written:false, refuse_reason}` 到主 .json（jsonl 不写）；semantic-observer judge 兼容新字段。
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿；judge/writer 的既有单测（
      inner-wakeup-heartbeat-check.test.mjs 98 项 / inner-wakeup-heartbeat.test.mjs 22 项）不回归。

## Definition of Done

- [ ] A13 在「inner 活跃但 AC53 拒写」状态下不再误报 DEAD（judge 取 max 生效）；拒写留痕到主心跳
      （written:false）；测试全绿。（待外部：A13 判据经外层跑一轮确认 ALIVE）

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（judge 判新鲜取 max(主 json, refusals)）
- plugin/scripts/inner-wakeup-heartbeat.ts（拒写也更新主 .json 快照，带 written:false）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（judge 新判据单测，负控制）
- plugin/test/inner-wakeup-heartbeat.test.mjs（writer 拒写留痕单测）
- tasks/gap-a13-heartbeat-refusal-write-invisible.md（自身）

## Test-Files

- plugin/test/inner-wakeup-heartbeat-check.test.mjs（98 项既有 + 新负控制）
- plugin/test/inner-wakeup-heartbeat.test.mjs（22 项既有 + 拒写留痕）
