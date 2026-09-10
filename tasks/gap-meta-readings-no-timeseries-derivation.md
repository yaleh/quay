---
id: gap-meta-readings-no-timeseries-derivation
title: meta-driver 读数全是快照、无时序派生层 ⇒ 跨轮持续空转（AC-214 连 8 轮零产出）在任何单轮读数里都不存在；实例已修但类未闭
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**缺口（实测）**：`collectReadings` 产出的 `MetaRoundReadings` **全部是快照量**——每条 AC 的 verdict/status、每个 driver 的 running/staleSecs、syncHealth 的窗口统计、metaRecords、inertCheckers、focus。**没有任何跨轮派生量**（streak / 斜率 / 「连续 N 轮某事没发生」）。

**后果的实例**：GOAL-009 的 AC-214 曾连续 **8 轮**（2026-09-09 14:51→15:28）每轮派一个 LLM agent 而**新增任务恒为 0**，轮长从 ~60s 退化到 5–9 分钟。根因（`computeGoalGaps` 牵引口径与立案子代理 dedup 口径不一致）已由 `gap-goal-gap-done-task-not-traction-respawns-every-round`（**done**）修复。

**但那修的是实例，不是类**：任何一轮的快照里都不存在「连续零产出」这个信息，故**别处同形的持续空转依旧不可见**——换一个口径不一致、换一个载体，同样的浪费会重演且同样无人看见（硬规则 5b：在某处修好 X ≠ X 只在那一处）。

**判据侧的旁证**：meta-driver 在 2026-09-10T09:29:42Z 一轮判此条为「已有立案任务覆盖」（见 `meta/META-005` 的 reply）——它把**实例修复**当成了**盲区闭合**。这恰好说明缺的是一个**通用维度**，而不是再来一条实例任务。

**修法**：给读数加一个**通用时序层**——对每个**已在读**的载体自动派生两类量：
(a) 连续 N 轮取值不变；(b) 连续 N 轮「应发生而未发生」（如 spawn 了但产出为 0）。
⛔ 不是给 AC-214 或某个特定载体单独加一个计数器（那又是只修被报出来的那一个）。

**成本约束（必须遵守，否则会把变化检测闸做废）**：只把「**streak 是否越过阈值**」这个**位**进 `readingsDigest`，⛔ **不把 N 本身进**——N 每轮都变 ⇒ 摘要恒不相等 ⇒ 闸恒为真 ⇒ 每轮都烧 LLM。这与现有 `drivers` 只取 `running` 位、注释里显式声明不取 `staleSecs`/记录数是同一条纪律（见 `readingsDigest` 的行内说明）。

## AC

- [x] **读真实历史而非 fixture**：把 `.quay/goal-round.jsonl` 中 AC-214 那一段**真实记录**喂进派生函数 ⇒ 报出该 AC 的零产出 streak ≥ 8（硬规则 4 推论三：只能被构造数据满足的判据不是测量）
- [x] **digest 纪律的双向负控制**：streak 递增但**未越阈**的两轮 ⇒ `readingsDigest` **相同**；**越阈**那一轮 ⇒ digest **改变**。两个方向都要有用例（只测一个方向挡不住「恒变」或「恒不变」这两种相反的失效）
- [x] **未评估独立取值**：载体读不出 / 无历史 ⇒ 返回 `evaluated:false`，⛔ 不与 `streak=0` 同形（硬规则 3b：读不懂不得与合格共用输出）
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs` exit 0
- [ ] `bash scripts/test.sh` exit 0（待外部）

## DoD

- [ ] **生产载体上可见**：实现落地**之后**的时间窗内，`.quay/meta-driver-round.jsonl` 至少一条轮记录携带该时序字段（⛔ 不以单测绿充当完成——硬规则 4 推论三：实现了、测试绿了、但生产没跑过，与「没实现」同形）（待外部）
- [x] **阈值不是拍脑袋**：先给出现有载体上 streak 取值的实测分布再定阈值，或显式声明该阈值是**安全网而非调优值**（硬规则 4 推论一：成本结构未实测前不设数值阈值）
- [x] ⛔ 不因本任务把「实例修复」再做一遍——`gap-goal-gap-done-task-not-traction-respawns-every-round` 已 done，本任务**只加通用维度**，不重改 `computeGoalGaps` 的牵引口径

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-readings-no-timeseries-derivation.md`
