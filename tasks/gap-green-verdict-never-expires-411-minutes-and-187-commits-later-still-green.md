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
status: ready
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
`full-suite-runner.ts` 写入 `reason`，其 fail-fast-check 断言
`redEv.state?.reason !== "failed"`（立案时 `:636-637`；本任务实现后移位至 `:677-678`）。
**这一半是健康的，如实记录。**

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
      **证据——一次真实 verdict**（worktree 内用真实 runner 对真实 git 仓库起跑写出的 state 文件，
      `full-suite-runner.ts` 在起跑时 `git rev-parse HEAD` 写入 `verdictCommit`）：
      ```json
      {
        "state": "green",
        "runner": "outer",
        "startedAt": "2026-08-06T15:09:03.551Z",
        "laneCount": 1,
        "verdictCommit": "0417796d68e7f6058cccb561ce19ca1a1aea1cab",
        "finishedAt": "2026-08-06T15:09:03.633Z",
        "durationMs": 82
      }
      ```
      `verdictCommit` = 起跑时 HEAD = `0417796d…`，与本仓该时刻 HEAD 逐字一致。best-effort 字段：
      非 git 根（hermetic 测试根）缺失——缺失 = 覆盖树未知。
- [x] AC2: 存在一条命令报出 `verdict_age_min` 与 `verdict_commit_delta`，对当前状态实跑并贴出
      （当前预期会报出类似 411 分钟 / 187 提交这样的数）
      **命令**：`node --no-warnings --experimental-strip-types plugin/scripts/suite-state-trigger.ts --json`
      **对 live 当前状态实跑**（`--root /home/yale/work/quay`，2026-08-06）：
      ```json
      {
        "state": "red",
        "verdictCommit": null,
        "verdictAgeMin": 14,
        "verdictCommitDelta": null,
        "verdictCommitDeltaReadable": 0,
        "stopSignal": true,
        "reason": "failed",
        "runner": "outer",
        "startedAt": "2026-08-06T14:21:58.785Z",
        "finishedAt": "2026-08-06T15:00:40.812Z",
        "durationMs": 2322027,
        "laneCount": 1
      }
      ```
      注：立案时那个 411 分钟 / 187 提交的 green 已不在——live 状态已变（现在是 14 分钟前的
      red）。**两个量都能报**：`verdictAgeMin=14`；`verdictCommitDelta` 因 live 状态是**旧 runner**
      写的（无 `verdictCommit` 覆盖锚点）而报不可读（band 0）——这正是本任务要消灭的缺口形态。
      同一命令对本次写入的新 verdict 实跑（worktree 内）：
      ```json
      {
        "state": "green",
        "verdictCommit": "0417796d68e7f6058cccb561ce19ca1a1aea1cab",
        "verdictAgeMin": 0,
        "verdictCommitDelta": 0,
        "verdictCommitDeltaReadable": 1,
        "stopSignal": false,
        "reason": null,
        "runner": "outer",
        "startedAt": "2026-08-06T15:09:03.551Z",
        "finishedAt": "2026-08-06T15:09:03.633Z",
        "durationMs": 82,
        "laneCount": 1
      }
      ```
- [x] AC3: **负控制（承重条）**——按 `control` 伪造陈旧 verdict + 前进 HEAD，两个量必须变化；
      若不变说明消费者没读，本任务无效，不得以 AC1/AC2 通过为由结案
      **hermetic 负控制**（临时 git 仓库 + `--root` 接缝，两个量都实测变化）：
      - Step 1（verdict 覆盖 C1、刚结束）：`verdictAgeMin=0`，`verdictCommitDelta=1`
      - Step 2（把 `finishedAt` 往前推 8 小时 + HEAD 前进 2 个提交）：`verdictAgeMin=480`，
        `verdictCommitDelta=3`
      完整输出见下「执行记录」。两个量都随之变化 ⇒ 消费者在读这两个量（若输出不变本任务无效）。
- [x] AC4: **不加硬闸**——本任务不得引入"陈旧即 stop-dispatch"；任务体记录该决定与理由
      （避免重演 IDLE 60s 即报的过报错误），阈值待成本数据
      **决定（如实记录）**：本任务只加**可读性**——runner 记覆盖 commit（`verdictCommit`），
      `suite-state-trigger.ts --json` 报 `verdictAgeMin` / `verdictCommitDelta`（纯读、不写文件、
      不做判定）。**没有引入任何「陈旧 ⇒ 停派」逻辑**：`shouldStopDispatch`/`routeRed` 逐字未动
      （仍只按 `red + reason=failed` 停派）。理由：一见陈旧就停派 = 用一条新噪声换旧噪声，重复
      `IDLE 60s 即报` 的过报；且 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 反对在
      成本结构未知时定阈值。阈值留到有成本数据之后（候选 2「陈旧度可读字段而非硬闸」）。
- [x] AC5: 与 `gap-suite-state-has-no-reason-axis-failed-aborted-infra`（reason 轴）交叉标注——
      那条开的是「为什么没成」这根轴，本条开的是「这条结论覆盖哪棵树」这根轴
      **本任务侧已如实标注双轴关系**（见本 AC 行 + 「消费者侧核查」段）：reason 轴那条开
      「为什么没成」，本条开「这条结论覆盖哪棵树」。反向标注（在该任务文件里指回本任务）归该任务
      自己的编辑周期——本任务只保证自己这一侧的双轴关系如实记录，不越界改该任务文件。
- [x] AC6: 任务体如实记录：`reason` 字段**有**真实消费者（full-suite-runner fail-fast-check
      `:636-637`），本任务的缺口只在 `finishedAt`／覆盖范围，不得把 reason 一并说成没人读
      **核实（2026-08-06）**：reason 的消费者断言仍在——本任务给 runner 加了 ~41 行后位置
      `:636-637` → `:677-678`：
      `grep -n 'redEv.state?.reason' plugin/scripts/full-suite-runner.ts` ⇒
      `:677  if (redEv.state?.reason !== "failed") {`（fail-fast-check 断言 red 的 reason 必须是
      failed）。缺口确实只在 `finishedAt`／覆盖范围，reason 轴是健康的一半——本条与「消费者侧核查」
      段如实记录，没有把 reason 说成没人读。

## Definition of Done

- [x] AC1-AC6 实跑输出贴进任务体（见上方 AC 各条 + 下方「执行记录」）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
      **未做（环境限制，如实记录）**：worktree 无 node_modules（`scripts/test.sh` 的 dist 构建需要
      esbuild，先报 `core dist build FAILED`），且完整套件是 ~38 分钟重型操作——属外层
      verification-round 的验证面，不在本任务 worktree 内重跑。本任务已在该 worktree 内直接跑
      相关 scoped 测试（见「执行记录」）：相关 5 个测试文件 = 72 个测试全绿（fail 0 / cancelled 0）。

## 执行记录（2026-08-06）

**改了什么（Touches 三个文件）**：
- `plugin/scripts/full-suite-runner.ts`：verdict 写入时记录覆盖锚点 `verdictCommit`（起跑时
  `git rev-parse HEAD`，best-effort，非 git 根缺失）；`SuiteState` 接口 + 头注同步。
- `plugin/scripts/suite-state-trigger.ts`：新增 `--json` 一次性报告（纯读、不写文件、不做判定）——
  `verdictAgeMin`（finishedAt 距今分钟数）+ `verdictCommitDelta`（`git rev-list --count
  <verdictCommit>..HEAD`）+ `verdictCommitDeltaReadable` band（存在=1/缺失=0）+ 既有
  `state`/`stopSignal`/`reason`。`shouldStopDispatch`/`routeRed` 逐字未动（AC4：不加硬闸）。
- `plugin/loop/orchestrator-loop-tick.md`：1b 套件块记录 `verdictCommit?` 字段 + 「verdict 覆盖
  范围可读」条款（只报可见性不加硬闸）；「每个 tick 必报」加 verdict 覆盖；相关文件表同步。

**AC3 负控制完整输出**（hermetic 临时 git 仓库）：
```
== Step 1: verdict covers C1, just finished (delta should be 1, age ~0) ==
{ "state": "green", "verdictCommit": "257aa2c2...", "verdictAgeMin": 0, "verdictCommitDelta": 1,
  "verdictCommitDeltaReadable": 1, "stopSignal": false, "finishedAt": "2026-08-06T15:09:21Z", ... }
== Step 2: fake verdict finishedAt 8h ago + advance HEAD by 2 commits (age -> ~480, delta -> 3) ==
{ "state": "green", "verdictCommit": "257aa2c2...", "verdictAgeMin": 480, "verdictCommitDelta": 3,
  "verdictCommitDeltaReadable": 1, "stopSignal": false, "finishedAt": "2026-08-06T07:09:22Z", ... }
```
两个量都随之变化（0→480、1→3）⇒ 消费者在读这两个量。

**scoped 测试结果**（worktree 内 `node --test --experimental-strip-types` 直接跑相关测试文件）：
`plugin/test/suite-state-trigger.test.mjs` + `plugin/test/full-suite-runner.test.mjs` +
`plugin/test/red-window-shared-gate.test.mjs` + `plugin/test/checker-cost.test.mjs` +
`plugin/test/trend-check.test.mjs` ⇒ **tests 72 / pass 72 / fail 0 / cancelled 0**（EXIT=0）。
（`scripts/test.sh` 在 worktree 内因缺 node_modules 的 esbuild 无法构建 dist，故用直接 node --test。）

## Touches
- plugin/scripts/suite-state-trigger.ts
- plugin/scripts/full-suite-runner.ts
- plugin/loop/orchestrator-loop-tick.md

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务在飞（dispatch 记账 0d6e98b7 补晋）。

