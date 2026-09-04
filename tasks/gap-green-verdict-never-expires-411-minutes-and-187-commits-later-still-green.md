---
id: gap-green-verdict-never-expires-411-minutes-and-187-commits-later-still-green
title: the suite GREEN verdict has no expiry and no commit-delta awareness —
  .quay/full-suite-state .json still reads state:green from a run that finished
  2026-08-06T07:07:00Z, measured 411 minutes and 187 commits later, and it is
  still the authoritative dispatch signal; suite-state-trigger.ts routes purely
  on state TRANSITIONS (red -> stop-dispatch+triage, running -> optimistic
  dispatch) and touches finishedAt only as a type declaration at :78, while
  full-suite-runner.ts uses finishedAt solely to compute durationMs (how long
  the RUN took, never how long ago it ENDED); grep across plugin/scripts for any
  age/staleness computation on the verdict = zero, so GREEN answers 'safe to
  dispatch' with no basis about whether it still describes the current tree —
  and this particular green is itself a hand-documented 'EFFECTIVE GREEN
  (documented deviation)' with reason:aborted, so a human-annotated deviation
  has been aging into an automatic dispatch authorization for ~7h;
  field-vs-consumer lens, manager 2026-08-06
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**GREEN 没有有效期，也不知道自己覆盖的是哪一版树。411 分钟、187 个提交之后，它仍然是权威派发信号。**

### 实测（可复算）

| 项 | 值 |
|---|---|
| `.quay/full-suite-state.json` 的 `state` | **green** |
| 该 green 的 `finishedAt` | **2026-08-06T07:07:00Z** |
| 测量时刻 | 2026-08-06T13:58:17Z ⇒ **411 分钟前** |
| 此后落地的提交（develop + integration 去重） | **187** |
| 该 green 的 `reason` | **`aborted`** |
| 该 green 的 `note` | 原文 **"EFFECTIVE GREEN (documented deviation)"** ——人工判定 |
| 任何地方对 verdict 做时效/新鲜度计算 | **0**（见下） |

### 消费者侧核查（本轮 字段/消费者 使用视角提问）

先问「`reason` 字段谁在读」——**它有真实消费者**，不是缺口：
`full-suite-runner.ts` 写入 `reason`，其 fail-fast-check 在 `:636-637` 断言
`redEv.state?.reason !== "failed"`。**这一半是健康的，如实记录。**

真正的缺口在 `finishedAt`：

- `suite-state-trigger.ts`（红窗规则的自动执行者）**只按状态跃迁路由**——
  `red ⇒ stop-dispatch + 分诊`、`running ⇒ 乐观派发`（其头注 `:6` 原话）。
  它引用 `finishedAt` 仅在 `:78` 的**类型声明**里，从不参与判定。
- `full-suite-runner.ts` 用 `finishedAt` **只为算 `durationMs = finishedAt - startedAt`**——
  那是「这次跑了多久」，**不是「它跑完多久了」**。
- `grep` 全 `plugin/scripts` 找 verdict 的时效/陈旧度计算 = **0**。

⇒ **GREEN 在"它是否仍然描述当前这棵树"这件事上没有任何依据，却照样回答"可以派发"。**

### 性质

1. **升级形态（判据在没有依据时仍然给出答案）的干净实例**：
   绿是对 07:07Z 那棵树的陈述，被当作对 13:58Z 这棵树的授权。
2. **假死判据**：它测的是「上一次跑完时是绿的」，不测「现在还绿不绿」。心跳记录，不是心跳。
3. **额外一层**：这个 green 本身是 `reason: aborted` + 人工标注 "EFFECTIVE GREEN (documented
   deviation)"。**一条人工判定的偏离，正在自动老化成机器的派发授权**——
   人当时的判断是针对当时那棵树的，没有人授权它覆盖之后的 187 个提交。

### 选定机制（方向，接法留执行时）

**不预设"绿必须每 N 分钟过期"**——那会退化成定时全量，本仓已有成本模型反对
（全量 38 分钟，`gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 明确反对在成本结构未知时定阈值）。
要修的是**绿必须携带它所覆盖的范围，且消费者必须能判断该范围是否仍然成立**，两条候选：

1. **绿绑定 commit**：verdict 记录它跑的那个 tree/commit；消费者比较当前 HEAD 与该 commit，
   报出 delta（"这条绿覆盖 187 个提交之前的树"），由派发方决定是否仍然采信；
2. **陈旧度作为一个可读字段而非硬闸**：先让 delta 可见（本仓反复出现的"能测但不看"，先解决"不可见"），
   阈值留到有成本数据之后再定。

**明确不做的**：一见陈旧就 stop-dispatch——那会用一条新噪声换一条旧噪声，
重复 `IDLE 60s 即报` 的过报错误。

## Contract

```
measure verdict_age_min = `node --experimental-strip-types plugin/scripts/suite-state-trigger.ts --json` 输出的 finishedAt 距今分钟数字段
measure verdict_commit_delta = `git rev-list --count <verdict-commit>..HEAD` stdout 数字段
band verdict_commit_delta 可读（存在=1，缺失=0）
invariant 一条 GREEN 被用作派发授权时，其覆盖范围必须可被消费者读出；"上一次跑完是绿的" 不等于 "现在是绿的"
invoke `node --experimental-strip-types plugin/scripts/suite-state-trigger.ts --json`
control 人为把 verdict 的 finishedAt 往前推 8 小时并让 HEAD 前进若干提交 ⇒ delta/age 必须随之变化并被报出；若输出不变，说明消费者仍然没在读这两个量
resume 若中断，先跑 measure 读当前 age 与 delta，不要假设绿仍然成立
```

## Acceptance Criteria

- [x] AC1: verdict 记录它所覆盖的 commit/tree；贴出一次真实 verdict 的该字段
- [x] AC2: 存在一条命令报出 `verdict_age_min` 与 `verdict_commit_delta`，对当前状态实跑并贴出
      （当前预期会报出类似 411 分钟 / 187 提交这样的数）
- [x] AC3: **负控制（承重条）**——按 `control` 伪造陈旧 verdict + 前进 HEAD，两个量必须变化；
      若不变说明消费者没读，本任务无效，不得以 AC1/AC2 通过为由结案
- [x] AC4: **不加硬闸**——本任务不得引入"陈旧即 stop-dispatch"；任务体记录该决定与理由
      （避免重演 IDLE 60s 即报的过报错误），阈值待成本数据
- [x] AC5: 与 `gap-suite-state-has-no-reason-axis-failed-aborted-infra`（reason 轴）交叉标注——
      那条开的是「为什么没成」这根轴，本条开的是「这条结论覆盖哪棵树」这根轴
- [x] AC6: 任务体如实记录：`reason` 字段**有**真实消费者（full-suite-runner fail-fast-check
      `:636-637`），本任务的缺口只在 `finishedAt`／覆盖范围，不得把 reason 一并说成没人读

## Definition of Done

- [ ] AC1-AC6 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- plugin/scripts/suite-state-trigger.ts
- plugin/scripts/full-suite-runner.ts
- plugin/loop/orchestrator-loop-tick.md

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务在飞（dispatch 记账 0d6e98b7 补晋）。

