---
id: gap-goal-driver-blind-to-driven-system-health
title: goal-driver 只有内省视角 —— 被驱动系统两小时内 fan-in 失败 9 次，而它 5308 轮一无所知
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-12 实测）**：goal-driver 持续运行 6 天（09-06→09-12）、**5308 轮**、约 2 分钟一轮，每轮只产出**两项 fact**：

```
goal-ring         goalCount 1, criterionCount 21, 各 AC 的 status/verdict/reason
goal-sufficiency  {"goal":"GOAL-016","verdict":"covered"}
```

最近 200 轮的 fact 名称分布 = `{goal-ring: 200, goal-sufficiency: 131}`，**只有这两种**。

**它的视野边界**（对 `plugin/scripts/goal-driver.ts` 全量 grep）：读 `drivers.yml`、goal store 目录、自己的 sufficiency 缓存。**不读**——`worker-outcome` 命中 0、`promotion-outcome` 0、`verification-round` 0、`full-suite-state` 0、`ssh|remoteHost|targetHost` 0。

**代价（同日实证，非假想）**：GOAL-016 的靶子项目（ad-arm1 的 archguard）在两小时内 **fan-in 失败 9 次**（ff 5 次、scoped-gate 3 次、merge-develop 1 次）。其中 TASK-89 那一轮：`merge-develop / anti-drift / typecheck / scoped-gate / ac-precheck / suite(277 秒) / ac-gate / flip-done` **全部 ok**，**唯独最后一步 ff 因主检出工作树不干净失败** ⇒ 277 秒全量 suite 白烧、任务判 `exited-not-landed`。**goal-driver 对此全程无感**，直到人来问。

**⛔ 这不是「goal-driver 坏了」**：它的设计职责是「评判据 + 判充分性」，它做到了且很勤（6 天未停）。缺的是**外部视角**——「我驱动的那个系统还好吗」。

**要补的读数全是便宜的直接量，⛔ 不需要任何语义判断**：
- 目标项目 driver 进程数 / round 记录龄
- 最近 N 轮 fan-in 的成败比与失败步骤分布（`fan-in-step-trace` 的 `ok:false`）
- 目标项目配置形状版本（`.quay/quay-init-state.json` 的 `pluginVersion`）vs 交付物 plugin 版本
- 目标项目关键载体存在性（如 `verification-round.jsonl`）

## Plan

1. **先取直接量**：打印 goal-driver 当前 facts 的**全部取值**（⛔ 不只报数量；引用计数前先打印命中内容）。
2. 定义健康度 fact 的字段集，**每个字段写明它的直接量来源**（⛔ 不要代理量：进程存在 ≠ 在干活，参考硬规则 4b）。
3. 实现为**新增的一项 fact**，与 `goal-ring` / `goal-sufficiency` 并列。
4. **⛔ 不得成为阻塞**：健康度为红**不得**阻止 goal 达成或 AC 翻绿——给一个在飞 goal 追加前置就是硬规则 12 的「永远差最后一步」。
5. **未评估必须可区分**：目标项目不可达 / 载体缺失时输出**独立取值**，⛔ 不与「健康」同形（硬规则 3b）。

## Acceptance Criteria

- [ ] AC1 能取假：构造一个存在 fan-in 失败的目标项目状态，该 fact 必须报出失败计数 >0；健康状态下报 0。**两态输出逐字贴出做对照**。
- [ ] AC2 不阻塞：健康度为红时，goal 的达成判定与改动前**逐字一致**（打印改前/改后 `goalFlipDecision` 的输入与输出）。
- [ ] AC3 未评估可区分：目标项目不可达/载体缺失时输出独立取值，⛔ 既非 0 也非「健康」；贴出三态（健康/不健康/未评估）的实际输出。
- [ ] AC4 版本一致性读数：`pluginVersion` 与交付物 plugin 版本**并排出现**，不等时可机械检出。**负控制现成**：archguard 于 2026-09-12 补跑 quay-init 前为 `0.4.0` vs `0.6.1`（不等态），补跑后为相等态。

## Definition of Done

- 四条 AC 满足，AC1/AC3 的多态输出有实际留档（⛔ 不是「我认为它会这样」）。
- ⛔ 不得把健康度做成阻塞条件（AC2 是这条的守卫）。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-driver-blind-to-driven-system-health.md
