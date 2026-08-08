---
id: gap-targeted-promotion-operation-does-not-exist
title: "定向晋级（targeted promotion）操作不存在——2026-08-04 裁定被超额执行：外层候选集构造规则整体搬进 ready-pool-check.ts（kind 排序 gap→DIR→other，无阶段目标输入），且 pool<floor（=cap×4）门把阶段目标要的任务挡在 todo；补充 refill（维持数量）与定向晋级 targeted（维持对齐）是两个操作，后者必须不受 floor 约束、由外层选择；实测 gap-ac16c3-... 永远停在 todo（pool=24>floor=20，生产值 cap=5）"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**「定向晋级」不是一个操作——阶段目标要的任务无法离开 todo。**

> **AC 交叉标注（2026-08-08，`gap-closure-detection-reads-symbols-not-checkboxes` 落地时写）**：
> ready-pool 池机制三件套——**收尾信号 / 退回排除 / 定向晋级**。本条 = 退回排除（AC6b）+ 定向晋级
> （AC1-AC2）；收尾信号那条 = 池子里 AC 全勾未翻转被误当可派发（ready 池 61% 空转）。两条共同收窄
> 「真实可派发」口径：本条把被退回任务移出池、把阶段目标任务从 todo 定向提出来；那条把已完成未翻转的
> 任务从 ready 移到收尾。互不重叠、同属 ready-pool-check 机制族。

### 人的裁定（2026-08-08 10:1xZ，职责切分）

> 「inner 不应该知道 AC19 → AC16 ∥ reporter 这样的要求。这样的要求应仅作用于 outer 选择 todo 任务。」

⇒ **晋级 todo→ready（选择，需要阶段目标）= 外层**；**派发 ready→in-flight（机械，只需 touches/cap/停止条件）= 内层**。内层不需要任何改动（它现在就不知道阶段目标，这是对的）。

### 实况：上面第一行现在【没有主人】

- `orchestrator-loop-tick.md:985-986`：「外层只引用它，不独立维护候选集构造规则」——晋级被整体搬进 inner 的 `ready-pool-check.ts`。
- 该脚本结构上**不含阶段目标**（排序判据是任务【种类】：`gap-*` → `DIR-*` → `other`，`:27`）。

### 2026-08-04 裁定被超额执行（范围核对）

`gap-promotion-cadence-is-role-volition-not-product-mechanism`（done）要解决的问题：「现行做法是外层的一条自愿 AC-queue（角色自愿）」⇒ 要的是「机制默认存在、不靠角色自愿」。**不是「外层不得提供优先级输入」**。实现时把后者一并砍了。与今晚多次形态同族：**退役一个东西时，连它承载的另一半职责一起退役，而那一半没有新主人。**

### 缺的是【操作】不是【输入】（最要紧）

| 操作 | 判据 | 目标 |
|---|---|---|
| 补充 refill | pool < floor（=cap×4；**cap 资源自适应 5/2/1，floor 随之 20/8/4**——见下更正） | 维持【数量】 |
| **定向晋级 targeted** | **阶段目标要它** | 维持【对齐】 |

实测：pool=24 > floor=20 ⇒ 补充永不触发 ⇒ `gap-ac16c3-bc-release-install-verification-not-done` 永远停在 todo ⇒ 池子里 24 个 ready 一个都不是阶段目标第 2 位要的那个。
**即使给 checker 加一个优先级输入也不够——`pool < floor` 这道门先把它挡在外面。定向晋级必须是不受 floor 约束的独立操作。**

**2026-08-08 11:5x 数值更正（manager 更正供给）**：cap=3/floor=12 是 **ready-pool-check 手动跑的兜底默认**（`CONCURRENCY_CAP_DEFAULT=3`，注释「manual runs」），**非生产值**。生产 cap 来自 `cap-from-gate.sh`（avg300 bands go<40/wait<70/extreme≥70 ⇒ 5/2/1，当前 GO ⇒ 5），floor=cap×4=20。**引用 floor 判据时必须先跑 cap-from-gate 拿 effective_cap 再作 --cap 传入**（ready-pool-check 的 tick 调用形态）。结论不变（24>20），余量比 12 小。

### 修法方向（机制决定归外层，设计不预设）

- **立即修复（外层执行，已做）**：外层按阶段目标直接 promote 目标任务（`gap-ac16c3-...` 已 todo→ready）。
- **机制落位**：定向晋级需要一条**不受 pool<floor 约束**的路径——外层可见的阶段目标→任务映射，能在 todo 里按目标挑出并 promote。形态（outer 手 promote / checker 加 `--targeted <id>` 入口 / tick 文档加定向晋级步骤）执行时定。

## Contract

```
measure targeted_promote_path = `grep -cE "定向晋级|--targeted|targeted.*promote" plugin/scripts/ready-pool-check.ts plugin/loop/fast-mode-loop-tick.md orchestration/orchestrator-loop-tick.md` stdout 数字段
band targeted_promote_path = ≥1（修复后存在定向晋级路径；当前=0）
measure floor_independent = `grep -c "pool < floor" plugin/scripts/ready-pool-check.ts` 是否只约束补充不约束定向（判定：定向晋级不走 pool<floor 门）
invoke 对某个 todo 任务（阶段目标第 2 位要的）执行定向晋级 → status 变 ready（`quay promote <id>`，不受 pool<floor 门约束）
control 负控制：pool ≥ floor 时（当前 24>20，floor 用生产 cap=5 计算），定向晋级仍能发生（不受补充门约束）
resume 若中断，先跑 measure 确认当前定向晋级路径是否存在，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **定向晋级路径存在**——外层按阶段目标 promote todo→ready 有机械承载（非临时手动作）
- [ ] AC2: **不受 floor 约束**——pool ≥ floor 时定向晋级仍能发生（与补充 refill 解耦）
- [ ] AC3: **内层不改**——ready-pool-check 仍只按机械判据（touches/cap/停止条件），不掺阶段目标
- [ ] AC4: **职责边界落文档**——晋级（选择）= 外层、派发（机械）= 内层，写进 orchestrator-loop-tick 的
      晋级节；修正 :985-986 的「外层只引用」表述
- [ ] AC5: 与 gap-promotion-cadence-is-role-volition-not-product-mechanism（done）交叉标注——那条要
      「机制默认存在」，本条补被超额执行砍掉的「外层提供优先级输入」职责
- [ ] AC6: **生命周期池机制三件套（manager 2026-08-08 11:0x 提案，外层裁定支持）**——
      (a) **「作废」终态**：生命周期加 `voided`（前提已失效的任务如实标记，标 done 说谎且 AC18 空跑——
      DIR-124 现成实例：touch 指 ADR-022 已退役的 execute-milestone.js）；
      (b) **ready-pool-check 加 `rejected` 排除理由**：被退回的任务不得原样留可派发集待再派
      （reporter 那次是外层当场兜住非机制兜住）——**移出池子的机制不能依赖会忘的一方**
      （inner 不写任务状态 ⇒ 它写非状态退回记录、pool-check 读，最省落点）；
      (c) **判据写「同一任务不得被退回两次」而非「退回次数为零」**——退回本身是发现
      （reporter 退回产出了真实 per-file 计时数据），压制的是重复不是退回

## Definition of Done

- [ ] AC1-AC6 实跑输出贴任务体（pool≥floor 时定向晋级成功 + 内层不含阶段目标 + 职责边界落文档 + 池机制三件套）

## Touches
- plugin/scripts/ready-pool-check.ts（若加 --targeted 入口；补充逻辑不动）
- orchestration/orchestrator-loop-tick.md（晋级节：职责边界 + 修正 :985-986 表述）
- plugin/loop/fast-mode-loop-tick.md（同步）
- tasks/gap-ac16c3-bc-release-install-verification-not-done.md（AC5 交叉标注——本条的现场受害例）
- tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism.md（AC5 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T10:1xZ
changed: 管理者 2026-08-08 定位（定向晋级操作不存在；2026-08-04 裁定被超额执行——外层候选集规则整体搬进
  kind-only checker，pool<floor 门挡阶段目标任务）+ 人裁定职责切分（晋级=外层选择、派发=内层机械）。
  外层独立复核：ready-pool-check 排序 = kindOrder（gap→DIR→other，无阶段目标）、pool=24>floor=20（生产 cap=5）、
  gap-ac16c3-... 停在 todo、orchestrator-loop-tick:985-986「外层只引用」——成立，立案。
