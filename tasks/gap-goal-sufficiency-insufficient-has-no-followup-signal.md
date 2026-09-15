---
id: gap-goal-sufficiency-insufficient-has-no-followup-signal
title: goal-driver 的充分性判"insufficient"持续多轮也不产出任何可见信号——GOAL 静默卡死，无人会注意到
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
## Finding

**独立确认两次，同一天，两个不同真实工作区——不是假说**：

1. **quay 自己（`/home/yale/work/quay`）GOAL-018**：3 条在域 AC 全部 `verdict: pass`，但 GOAL 卡在 active，因为 `goalSufficiencyVerdict`（机械层）在 body 缺 `## 退出条件` 小节时直接返回 `insufficient`，从不调用语义判官——这次是文档缺失，补一节后恢复正常（已单独修复，不在本任务范围）。

2. **quay-fleet（一个真实第三方项目，`/home/yale/work/quay-fleet`）GOAL-005**：8 条在域 AC（AC-061/063~069）全部真实 achieved（逐条独立核实过 criterion 真跑 pass），GOAL 仍卡在 active。直接读 `.quay/goal-sufficiency-cache.json`（41 条记录，全部 key 互不相同）确认：语义判官（`semanticSufficiencyVerdict`，真的调了 LLM）在某一时刻针对这组 AC 的 `(goal.title, exitConditionsText, scopeSections, acs[].{id,title,expect})` 语义输入算出过一次确定裁决 `insufficient`（缓存最后一条记录 `2026-09-15T07:36:03.123Z`），此后 40+ 分钟、约 30 轮 goal-driver 心跳，该 GOAL 的 `goal-round.jsonl` 每一轮的 `goal-sufficiency` 读数原样都是这同一个 `insufficient`，缓存里也没有新 key 出现过。

**排除了一个方向（重要，避免下一个读者走弯路）**：另一位协作者（quay-fleet 侧）最初怀疑这是"AC 集合变化后缓存没跟上重算"的 bug。**这个怀疑不成立**——直接读 `sufficiencyCacheKey()`（`plugin/scripts/goal-driver.ts`）源码 + 确认它的哈希输入是 AC 的 `(id, title, expect)` 三元组集合，**不包含 AC 的 status（achieved/active）**。这是**故意的设计**：充分性问的是"这组 AC 的定义在语义上是否覆盖了 GOAL 的退出条件"，这个问题的答案不应该因为 AC 从"还没做"变成"做完了"而改变——AC 定义没变,判官没有理由给出不同答案,缓存复用是对的,不是失效检测漏了。真正发生的事是:**这组 AC 的定义,从一开始就没有覆盖到 GOAL-005 的退出条件**（判官的裁决在语义上很可能是对的),而这个"不够"的判决,发出以后就再也没有被任何机制看见过——不是缓存坏了,是**没人去处理它**。

**这正是本任务要补的空白**：`insufficient` 这个持久化裁决,写进缓存以后,**没有任何下游消费者**。它只会在每一轮的 `goal-round.jsonl` 里原样重复出现,不会:
- 升级成一条可见的 finding / 立案（像 `computeGoalGaps` 对"有 active AC 但零任务牵引"做的那样,spawn 一个 gap-filing agent 去处理）；
- 触发任何提醒/通知；
- 在 dashboard 或任何面板上标出来（区别于普通的"还没达成"）。

结果是：一个 GOAL 的全部 AC 都做完了,只差"这组 AC 是否真的覆盖了目标"这一个语义判断,而这个判断已经确定地给出了否定答案——却完全没有人知道要去改 AC 集合或者退出条件描述。这个 GOAL 会**永久卡住**,直到有人碰巧手动去查 `.quay/goal-round.jsonl` 才会发现（正是本任务的两个证据来源）。

## AC（draft，implementer refines）

- [ ] AC1: 设计一个"insufficient 持续 N 轮/M 分钟"的可见信号机制——具体形态可以是 spawn 一个短命的语义 agent（复用 `computeGoalGaps`/`runGapSpawnPass` 已有的"spawn 一个 fix-worker 角色的 agent 去处理"模式,而不是 driver 自己直接改 AC),职责是读 GOAL 的退出条件/范围/在域 AC 集合,**提议**(不直接写)一条候选的新 AC 或者退出条件修订说明,写进一条新立案的普通 gap 任务里供人审核——⛔ 不自动写 goal-store。
- [ ] AC2: 该信号只在"充分性确定裁决为 insufficient 且已经持续超过阈值(轮数或时间,复用与 AC-214 freshness routine 同类的推导方式,不要写死魔数)"时触发一次,不是每轮都触发(避免像 244 次运行零指引价值的旧反例那样变成噪音)——同一个 GOAL 的同一个 insufficient 裁决只 file 一次,裁决变化(判官重判出新结果)才重新计时。
- [ ] AC3: 负控制——GOAL 的充分性是 `covered` 或 `not-evaluated` 时不触发;裁决很快就变化(判官在阈值内给出了不同结果)也不触发。
- [ ] AC4: 生产验证——对 quay-fleet 的 GOAL-005(本任务的真实证据来源之一)跑一次,确认机制真的会为它 file 出一条信号/任务(⛔ 不接受只在 fixture 里验证过,硬规则 4 推论三)。

## DoD

一个持续 insufficient 的 GOAL,在阈值窗口内会产出一条人可见的记录(任务/finding/通知,implementer 选择哪种,但必须是现有巡检/派发链路会看到的形态,不是新增一个没人订阅的日志行)。GOAL-005 本身的具体修复(它的 AC 集合到底该怎么补)不在本任务范围——那是内容判断,留给看到信号后的人或后续任务。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-driver.test.mjs`（implementer 决定是否新增独立测试文件）
- `tasks/gap-goal-sufficiency-insufficient-has-no-followup-signal.md`
