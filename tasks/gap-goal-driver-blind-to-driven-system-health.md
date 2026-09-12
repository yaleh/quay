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

- [x] AC1 能取假：构造一个存在 fan-in 失败的目标项目状态，该 fact 必须报出失败计数 >0；健康状态下报 0。**两态输出逐字贴出做对照**。
- [x] AC2 不阻塞：健康度为红时，goal 的达成判定与改动前**逐字一致**（打印改前/改后 `goalFlipDecision` 的输入与输出）。
- [x] AC3 未评估可区分：目标项目不可达/载体缺失时输出独立取值，⛔ 既非 0 也非「健康」；贴出三态（健康/不健康/未评估）的实际输出。
- [x] AC4 版本一致性读数：`pluginVersion` 与交付物 plugin 版本**并排出现**，不等时可机械检出。**负控制现成**：archguard 于 2026-09-12 补跑 quay-init 前为 `0.4.0` vs `0.6.1`（不等态），补跑后为相等态。

## Definition of Done

- 四条 AC 满足，AC1/AC3 的多态输出有实际留档（⛔ 不是「我认为它会这样」）。
- ⛔ 不得把健康度做成阻塞条件（AC2 是这条的守卫）。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## 验证证据（2026-09-12 本任务 worktree 实跑，⛔ 非「我认为它会这样」）

**AC1 两态对照**（真实夹具 + 真实探针进程，窗口 7200s）：

```
[不健康] unhealthy — fan-in 2 failed / 2 steps [ff×1 scoped-gate×1] (window 7200s)
         fanIn={"windowSec":7200,"steps":2,"ok":0,"failed":2,"failedByStep":{"ff":1,"scoped-gate":1},"failedTasks":["TASK-89"],"skipped":0,"truncated":false}
[健  康] healthy — fan-in 0 failed / 1 steps (window 7200s)
         fanIn={"windowSec":7200,"steps":1,"ok":1,"failed":0,"failedByStep":{},"failedTasks":[],"skipped":0,"truncated":false}
负控制：窗口外 3 小时前那条 merge-develop 不进 failedByStep（窗口是有效作用域，⛔ 不是装饰）；
       把窗口放大到覆盖它 ⇒ 计数变 1（同一条行，只改作用域）
```

**AC2 不阻塞**（`goalFlipDecision` 逐字未改：`diff <(git show develop:plugin/scripts/goal-driver.ts) <(HEAD)` 该函数段为空 diff）：

```
输入: records=[{GOAL-001,active},{AC-001,achieved}] goalId=GOAL-001 sufficiency={"verdict":"covered"}
改前输出: true
改后输出: true      （同一份输入 + 健康度=unhealthy）
目标为红时 fact.state = verified（⛔ 不取 failed ⇒ 不把整轮标成失败）
端到端：目标为红的那一轮里 GOAL-001 照样被机械 flip achieved，且该轮 failed fact 数 = 0
```

**AC3 三态 + 五成因**（⛔ not-evaluated 时 fanIn 恒 null —— 0 会与「窗口内零失败」同形）：

```
[healthy]       healthy — fan-in 0 failed / 1 steps (window 7200s)
[unhealthy]     unhealthy — fan-in 2 failed / 2 steps [ff×1 scoped-gate×1]
[not-evaluated/probe-failed]          causeDetail=["exit=255"]                 fanIn=null
[not-evaluated/probe-unparseable]     causeDetail=["stdout head: garbage"]     fanIn=null
[not-evaluated/target-root-absent]    causeDetail=["/tmp/no-such-proj-xyz"]    fanIn=null
[not-evaluated/no-target-configured]  causeDetail=[]                           fanIn=null
[not-evaluated/carrier-missing]       causeDetail=["fan-in-step-trace.jsonl"]  fanIn=null
活性是独立字段（⛔ 不压进 verdict）：夹具无进程 ⇒ liveness=idle(0)；探针没跑成 ⇒ unknown（⛔ 不是 idle）
```

**AC4 版本并排**（不等态取真机 = 负控制现成的那个不相等；相等态取夹具——真机本轮未被补跑 quay-init，仍 0.4.0）：

```
[不等态·真机 ad-arm1:/home/yale/work/archguard] {"target":"0.4.0","delivered":"0.6.1","equal":false,"initStatePresent":true,"targetAgeSec":2760612}
[相等态·夹具]                                   {"target":"0.6.1","delivered":"0.6.1","equal":true,"initStatePresent":true,"targetAgeSec":120}
[读不到·夹具]                                   {"target":null,"delivered":"0.6.1","equal":null,"initStatePresent":false,"targetAgeSec":null}
```

**生产路径**（drivers.yml 绑定 `kinds.goal.target_host/target_root`，无 CLI 覆盖）：

```
ad-arm1:/home/yale/work/archguard: unhealthy — fan-in 6 failed / 91 steps [ff×4 scoped-gate×2] (window 7200s),
liveness=driving(4), roundRecords=3(newest 5s) pluginVersion MISMATCH 0.4.0≠0.6.1(陈旧度 2760616s)
```

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/drivers.yml
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-driver-blind-to-driven-system-health.md
