---
to: outer
from: manager
type: 全量 AC 求值（人要求）—— 两条已悄悄达成、两条从未开工
---

## 人 03:4xZ：「检查你当前阶段的目标和 AC，确认还需要做什么，并持续推进。」

我做了一次**全量** §0.5b 求值，**发现自己的盲区**：AC36-AC41 位于 `manager-phase-goal.md:128-231`——**在 2026-08-10 阶段切换段之后、「已暂停」标记（`:249`）之前，即它们是当前阶段的活跃 AC，而我整夜只在跟 AC16。**

### 已达成但无人宣告（我此前没跟，实测确认）

| AC | 依据 |
|---|---|
| **AC36**（交付关键路径能排前面） | `slot-refill.ts:405` `DELIVERY-CRITICAL SECOND AXIS`，排序键已是 `(blocking_suite, delivery_critical, id)`；`:282` 的 `ranking` 数组暴露 sort key。**判据的两条要求都满足** |
| **AC37**（**精简的**执行路径必须随包走） | `plugin/loop/` 三份 tick-core 全部存在（`fast-mode` 13.5K／`manager` 17.8K／`orchestrator` 19.2K）。**它 2026-08-10 09:1x 的实测原文是「三份全部不存在」，现在是 3/3** |

⇒ **这两条建议你复核后正式宣告达成**——AC 达成了却没人翻牌，与 `not-yet-flipped` 是同一种记账滞后，只不过发生在判据层。

### 从未开工（判据明确、可机械验证、**不依赖当前红窗**）

**AC38（outer 双份文档漂移，按 manager 先例切分）**
```
plugin/loop/orchestrator-loop-tick.md   1508 行
orchestration/orchestrator-loop-tick.md 1267 行
共同行                                    727     ⇒ 各有 540–780 行独有 = 漂移仍在
对照 manager（已切分）: plugin 322 / orchestration 1647
```
判据原文：「outer 完成同形切分，切分后两份的独有内容各自可解释（产品行为 / 本层实例状态），并留切分声明」。**manager 的先例现成可照抄。**

**AC39（三层 accounting-emit 按层定制）—— 三层全 `complete=False`，且 manager 侧是 2026-08-10 就发现的老缺陷**
```
manager: complete=False  missing=[mechanism:cap-from-gate.last_run_epoch,
                                  mechanism:slot-refill.last_run_epoch,
                                  occupancy.in_flight]
outer:   complete=False  missing=[mechanism:closure-lag-check.judgement, occupancy.in_flight]
inner:   complete=False  missing=[ready-pool-check --apply, slot-refill,
                                  fast-mode-telemetry --task-start, exec_time_unreadable,
                                  occupancy.in_flight]
```
**manager 那两项正是 AC39 立条时的原始实证**——「默认装的 mechanisms 是 `cap-from-gate` / `slot-refill`，**那是 inner 的机制**」。**从 2026-08-10 09:0x 到现在没修。**
**三层共同缺 `occupancy.in_flight`** ⇒ 那是一个跨层的共性缺口，不是三个独立问题。

### 一条正在反向走的结果量

**AC40③** 判据是「`closure-lag-check` 的积压量**不单调增**」。今晚实测：**`nyf` 9 → 10 → 13 → 14 → 14，一路涨、没回落过**。
你已裁定 r314 绿后一次翻 14 条——那会让它回落。**但这也暴露该判据现在测的是「红窗有多长」，不是「记账有没有跟上」**：只要验证轮红，积压必然单调增，与记账纪律无关。**是否要给它加一个「红窗期间豁免」的限定，归你。**

### AC40 其余三条
① `dead-loop-check: loop_alive=alive` ✅ ② 依赖 AC39 ❌ ④ `.halt` 置→解闭环待测（`halt-check.sh` 需 `--for <layer>`；boheidc 那个 halt 尚未解，解时正好是第二个样本）

### 已取消 / 暂停（避免有人再去推）
**AC15 与 AC17 已被人 2026-08-06 14:2x 整条取消**（目标 2 取消，AC17 四条度量 + AC15 三条一并作废；**但「AC16② 仍需要一个接受方」被显式保留**）。AC28-34 暂停/保持。AC12b 已达成。

---

## 我的判断（归你裁定优先级）

**AC38 与 AC39 是当前唯二「可以立刻开工、判据明确、不堵在静态红后面」的**。其余（AC16①③、AC40②③④、AC27）**全部堵在同一条红后面**——r314 一绿，它们连锁解开。

⇒ **建议：红窗期间把 AC38/AC39 排进去**，它们不与验证链争资源（纯文档切分 + 一个 layer→mechanisms 映射表），而且 AC39 一修，AC40② 跟着转正。**任务体/AC/DoD 归你或 inner，我不写。**
