---
id: gap-goal-driver-blind-to-driven-system-health
title: goal-driver 只有内省视角 —— 被驱动系统两小时内 fan-in 失败 9 次，而它 5308 轮一无所知
status: todo
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

- [x] AC1 能取假：构造一个存在 fan-in 失败的目标项目状态，该 fact 必须报出失败计数 >0；健康状态下报 0。**两态输出逐字贴出做对照**。〔**已达成 —— 见 `## 阻塞（已裁定，见下）` 节：人 2026-09-12 裁定选项 ①（改 DIR-131 AC6 口径，区分「外部被驱动目标项目自身状态」与「本仓自身落地率」）。`goal-driver-task-boundary-check.ts` 新增结构化 fail-closed 豁免（配对行内标记 `DIR-131-TARGET-PROBE-BEGIN`/`-END` + 字符串字面量成员判定），读取目标项目自身 `fan-in-step-trace.jsonl` 现已合规、判据保持 fail-closed（本仓自身落地率载体仍不可读）。两态实测输出：**〕

  ```
  AC1[fan-in-failing]      unhealthy [fan-in-failing] — ... fan-in 1 failed / 2 steps [ff×1] (window 7200s)
  AC1[fan-in 对照·全绿]     healthy — ... fan-in 0 failed / 1 steps (window 7200s)
  ```
- [x] AC2 不阻塞：健康度为红时，goal 的达成判定与改动前**逐字一致**（打印改前/改后 `goalFlipDecision` 的输入与输出）。
- [x] AC3 未评估可区分：目标项目不可达/载体缺失时输出独立取值，⛔ 既非 0 也非「健康」；贴出三态（健康/不健康/未评估）的实际输出。
- [x] AC4 版本一致性读数：`pluginVersion` 与交付物 plugin 版本**并排出现**，不等时可机械检出。**负控制现成**：archguard 于 2026-09-12 补跑 quay-init 前为 `0.4.0` vs `0.6.1`（不等态），补跑后为相等态。

## Definition of Done

- 四条 AC 满足，AC1/AC3 的多态输出有实际留档（⛔ 不是「我认为它会这样」）。
- ⛔ 不得把健康度做成阻塞条件（AC2 是这条的守卫）。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## 阻塞（已裁定，见下）：AC1 的载体被 DIR-131 禁止 goal 侧读

**实测（本任务 scoped 门）**：`goal-driver-task-boundary-check: RED (4 violation(s))`，四条全是
`[fanin-read] fan-in @ line 1826/1885/2272/2369`。该检查是**人 2026-09-07 DIR-131 裁定的机械化产物**，
其 AC6 原文：「断言 `goal-driver.ts` 非注释位置不引用 fan-in / full-suite-state / 落地率（goal 侧不以
task 落地指标为输入）」；DIR-131 的 `## Resolution` 里 **AC6 的负控制正是拿
`const c = ".quay/fan-in-step-trace.jsonl";` 当红样例**（实测输出 `[fanin-read] fan-in @ line 862`、exit 1）。

⇒ **本任务体「Plan / AC1」点名的「fan-in 失败步骤分布」正是那条裁定禁止 goal 侧读的载体。**
这是 AC 与现行人裁的**实质冲突**，不是形式冲突：换一个语义相同的载体（`worker-outcome` 等）也能数出
「落地失败」，但那正是绕过守卫，已排除（那会造出一个「结构上不可能报红的检查」的反面——检查绿而
被禁行为照旧，硬规则 3b/4 的同一形态）。

**本轮的处理（不越权、不静默）**：
- 把 fact 收窄到**被驱动系统自身**的结构量，⛔ 无任何 task 落地指标 ⇒ 边界检查绿、棘轮未放宽；
- **AC1 如实留未勾**（它没被满足），不以「换了个载体」充当达成；
- 该维度的去向 **三选一，需人裁定**：①改 DIR-131 AC6 口径（把「关于外部被驱动系统的读数」与
  「关于本仓自身落地率的读数」分开——前者不构成 DIR-131 的反例形态）；②把这条观察挪到**非 goal
  组件**（如 quality 例程型 kind 的一条 routine 或独立观测面），goal-driver.ts 不碰；③放弃该维度。
- 同轮已立案 escalation（见 `## 关联`），本任务在裁定前**无法收尾** ⇒ 置 `needs-human`。

**2026-09-12 裁定与解除**：人裁定选项 **①**——见 `tasks/DIR-131.md` `## Resolution`
「### 2026-09-12 补充裁定（AC6 口径澄清）」小节，以及 `tasks/gap-goal-target-health-vs-dir131-boundary.md`
（该升级任务已 `done`）。`goal-driver-task-boundary-check.ts` 新增结构化、fail-closed 的 `exemptSpans`
豁免——由 `goal-driver.ts` 内成对行内标记 `DIR-131-TARGET-PROBE-BEGIN` / `DIR-131-TARGET-PROBE-END`
界定，只豁免标记跨度内的字符串字面量成员；标记不成对时不豁免、fail-closed 回退。该 fact 现新增
`fan-in-failing` 信号（与既有 `not-driving` / `plugin-version-mismatch` 并列），读数源头是**目标项目
自身**的 `fan-in-step-trace.jsonl`（经该豁免探针载荷读取），⛔ 非本仓自身载体。历史阻塞记录保留在
本节之上，不删除，仅在此处闭合。

## 验证证据（2026-09-12 本任务 worktree 实跑，⛔ 非「我认为它会这样」）

**AC1 —— 已达成**（2026-09-12 裁定解除阻塞后）。收窄后的事实新增了 fan-in 失败计数信号（读的是
**目标项目自身**的 `fan-in-step-trace.jsonl`，经 `DIR-131-TARGET-PROBE-BEGIN`/`-END` 结构化豁免，
⛔ 非本仓自身落地率载体）。两态输出逐字对照：

```
AC1[fan-in-failing]      unhealthy [fan-in-failing] — ... fan-in 1 failed / 2 steps [ff×1] (window 7200s)
AC1[fan-in 对照·全绿]     healthy — ... fan-in 0 failed / 1 steps (window 7200s)
```

另附此前收窄阶段（裁定前）已验证的两条**被驱动系统自身**信号，两态输出逐字对照（`not-driving`）：

```
[unhealthy] unhealthy [not-driving] — liveness=idle(0), roundRecords=2(newest .quay/verification-round.jsonl 0s), pluginVersion ok
[对照·有进程] healthy — liveness=driving(1), roundRecords=2(newest .quay/worker-round.jsonl 0s), pluginVersion ok
```
（对照用真进程夹具：cmdline 带 `worker-driver.js --root <目标根>`，探针从**真进程表**读到它。）

**AC2 不阻塞**（`goalFlipDecision` 逐字未改：`diff <(git show develop:plugin/scripts/goal-driver.ts) <(HEAD)` 该函数段为空 diff）：

```
输入: records=[{GOAL-001,active},{AC-001,achieved}] goalId=GOAL-001 sufficiency={"verdict":"covered"}
改前输出: true
改后输出: true      （同一份输入 + 健康度=unhealthy）
目标为红时 fact.state = verified（⛔ 不取 failed ⇒ 不把整轮标成失败）
端到端：目标为红的那一轮里 GOAL-001 照样被机械 flip achieved，且该轮 failed fact 数 = 0
```

**AC3 三态 + 七成因**（⛔ not-evaluated 时 `signals === null` —— `[]` 会与「查过且零信号」同形）：

```
[healthy]       healthy — liveness=driving(1), ... pluginVersion ok
[unhealthy]     unhealthy [not-driving plugin-version-mismatch] — liveness=idle(0), ... pluginVersion MISMATCH 0.0.1-stale≠0.6.1
[not-evaluated] not-evaluated (cause=probe-failed: exit=255)
[载体缺失]      not-evaluated (cause=carrier-missing: verification-round.jsonl)
成因清单（各自独立取值）：no-target-configured / probe-failed / probe-unparseable / target-root-absent /
carrier-missing / process-list-unreadable / init-state-missing —— 七条各有一个夹具，signals 恒 null
活性是独立字段（⛔ 不压进 verdict）：零进程但进程表可读 ⇒ idle(0)；探针没跑成 ⇒ unknown（⛔ 不是 idle）
```

**AC4 版本并排**（不等态取真机 = 负控制现成的那个不相等；相等态取夹具——真机本轮未被补跑 quay-init，仍 0.4.0）：

```
[不等态·真机 ad-arm1:/home/yale/work/archguard] {"target":"0.4.0","delivered":"0.6.1","equal":false,"initStatePresent":true,"targetAgeSec":2761660}
[相等态·夹具]                                   {"target":"0.6.1","delivered":"0.6.1","equal":true,"initStatePresent":true,"targetAgeSec":120}
[读不到·夹具]                                   {"target":null,"delivered":"0.6.1","equal":null,"initStatePresent":false,"targetAgeSec":null}
```

**生产路径**（drivers.yml 绑定 `kinds.goal.target_host/target_root`，无 CLI 覆盖）：

```
ad-arm1:/home/yale/work/archguard: unhealthy [plugin-version-mismatch] — liveness=driving(4),
roundRecords=3(newest .quay/promotion-round.jsonl 13s) pluginVersion MISMATCH 0.4.0≠0.6.1(陈旧度 2761660s)
```

## 关联

- 人 2026-09-07 **DIR-131**（goal/task 职责边界）+ 其机械化产物 `plugin/scripts/goal-driver-task-boundary-check.ts`
- 同轮立案的 escalation：`gap-goal-target-health-vs-dir131-boundary`（三选一的裁定请求，人 2026-09-12 裁定选项 ①，已 `done`）

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/drivers.yml
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-driver-blind-to-driven-system-health.md
