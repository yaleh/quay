# 立案节流的 live 证据 — `gap-goal-driver-filing-throttle`（GOAL-914 / AC-934 的子任务）

本文件是该任务的 **live 证据**（AC5 / DoD「证据必须来自真实轮次，不能只用 fixture」）。

它证明三件事，且每一件都**取自生产载体或生产配置**，不是 fixture：

1. **同一 AC 被重复立案是真实发生的**，并且间隔可以低到分钟级（`.quay/goal-round.jsonl` 的
   `gap_spawns`，2026-09-07 → 2026-11-06，373 次真实立案事件）。
2. 把那些**真实的重复立案时刻**逐条喂给落地后的判定函数（`goalFilingThrottle`，配置取自生产
   `drivers.yml`），其中 **112 次会被判节流**，并各自给出 `nextEligibleAt`。
3. 真实台账 `.quay/goal-filing.jsonl` 里那条真实立案，在**真实时钟**下已过冷却（可再立案），在
   立案时刻 +1min 则被判 `cooldown` —— 同一份真实数据、两个方向各测一次。

⚠️ 边界（硬规则 4 推论四：能解释现象的说法不是被检验的结论）：
  · 第 2 节是**重放**（replay），不是新轮次：历史轮次发生在台账（`.quay/goal-filing.jsonl`）落地
    之前，故历史事件只能从 `goal-round.jsonl` 的 `gap_spawns` 取；重放时把它们按台账行形态重建。
  · 第 4 节是**今天的真实读数**：生产此刻有 **0 条**可立案缺口，因此「今天的真实轮次里没有一条
    `filing-throttled` 行」——这不是节流失效，是候选 population 为空（`candidates: 0` 是一个测量）。
    节流行本身的形状由第 2/3 节的真实时刻 + `plugin/test/goal-driver.test.mjs` 的 ⑧ 轮级用例共同钉住。

## 1. 真实立案事件：373 次、172 个 AC、74 个 AC 被重复立案

来源：`/data/home/yale/work/quay/.quay/goal-round.jsonl`（生产轮记录，每轮 `goal-ring` fact 的
`value.gap_spawns`）。逐字读数：

```
{"carrier":"/data/home/yale/work/quay/.quay/goal-round.jsonl","events":373,"distinctAcs":172,"repeatedAcs":74,
 "span":["2026-09-07T11:47:34.799Z","2026-11-06T12:46:20.795Z"]}
```

每 AC 的**间隔读数**（同一份载体，取重复立案最多的前 5 个 AC；时间是真实事件时刻）：

```
{"ac":"AC-214","filings":34,"first":"2026-09-09T12:56:16.037Z","minIntervalMin":2.9,"intervalsMin":[59.5,16.5,3.3,3,3.4,4.8,2.9,6.8]}
{"ac":"AC-158","filings":21,"first":"2026-09-07T11:47:34.799Z","minIntervalMin":2.6,"intervalsMin":[31.3,10.2,11.3,10,11.6,36.9,53,29.7]}
{"ac":"AC-190","filings":14,"first":"2026-09-07T16:56:00.721Z","minIntervalMin":7.4,"intervalsMin":[8131,2059.6,17.6,17.6,17.8,17.7,17.7,17.9]}
{"ac":"AC-194","filings":9,"first":"2026-09-07T18:12:38.709Z","minIntervalMin":52,"intervalsMin":[10548.1,96.1,338.1,52,11467,11364.4,12785.8,59.5]}
{"ac":"AC-157","filings":8,"first":"2026-09-07T11:47:34.799Z","minIntervalMin":10,"intervalsMin":[31.3,10.2,11.3,10,11.6,36.9,17255]}
```

⇒ AC-214 同一 AC 立案 **34 次**，相邻两次最短 **2.9 分钟**。这就是本任务要消灭的成本形态：
上一次立案的**可观察结果**（台账里 `filed` 行的延迟实测 475.7s）都还没落定，下一轮又立了一次。

## 2. 用落地后的判定函数重放这 201 次**重复**立案（配置取自生产 drivers.yml）

生产配置（`drivers.yml` 无 `kinds.goal.filing` 段 ⇒ 取缺省；读数逐字）：

```
drivers.yml kinds.goal.filing => {"perAcCooldownMs":21600000,"perAcPerDay":3,"warnings":[]}
```

重放方式：对每个 AC 的第 i 次立案（i ≥ 1），把前 i−1 次真实时刻按台账 `spawned` 行形态重建，
交给 `goalFilingThrottle(candidates, ledger, cfg, 第 i 次的真实时刻)`。逐字读数：

```
{"replayedRepeatFilings":201,"throttledUnderShippedDecision":112,"stillEligible":89}
```

逐条样本（真实时刻 + 判定出的 `nextEligibleAt`）：

```
{"ac":"AC-157","at":"2026-09-07T12:18:52.116Z","reason":"cooldown","nextEligibleAt":"2026-09-07T17:47:34.799Z","lastFiledAt":"2026-09-07T11:47:34.799Z","filingsInWindow":1}
{"ac":"AC-157","at":"2026-09-07T12:29:05.347Z","reason":"cooldown","nextEligibleAt":"2026-09-07T18:18:52.116Z","lastFiledAt":"2026-09-07T12:18:52.116Z","filingsInWindow":2}
{"ac":"AC-157","at":"2026-09-07T12:40:25.063Z","reason":"cooldown","nextEligibleAt":"2026-09-07T18:29:05.347Z","lastFiledAt":"2026-09-07T12:29:05.347Z","filingsInWindow":3}
{"ac":"AC-157","at":"2026-09-07T12:50:23.446Z","reason":"cooldown","nextEligibleAt":"2026-09-07T18:40:25.063Z","lastFiledAt":"2026-09-07T12:40:25.063Z","filingsInWindow":4}
```

⚠️ 重放里 `stillEligible: 89` 是**必须存在的那一半**：这些重复立案的间隔已超过 6h 冷却（例如
AC-194 的 10548 / 11467 / 12785 分钟），节流**不挡**它们 —— 若 201 条全部被挡，那才说明判定
把「间隔多久都算重复」，即判据在空转。

## 3. 真实台账 + 真实配置：同一个 AC 的两个方向

台账载体 `/data/home/yale/work/quay/.quay/goal-filing.jsonl`（生产工作区根，gitignored 运行时载体）
逐字全文（两行 = 一次真实立案的意图 + 结论）：

```jsonl
{"state":"spawned","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:49:45.867Z","promptSha":"e5af4127b26ba5a4","round":"2026-11-06T07:49:45.859Z"}
{"state":"filed","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:57:41.597Z","spawnedAt":"2026-11-06T07:49:45.867Z","taskId":"gap-goal-filing-chain-audit","reason":null}
```

判定函数对这份**真实台账**的两个方向（配置同上）：

```
nextEligibleAt = last + cooldown = 2026-11-06T13:49:45.867Z
(a) 真实时钟： {"now":"2026-11-06T17:12:14.089Z","eligible":1,"throttled":[]}
(b) 真实台账时刻 +1min： {"now":"2026-11-06T07:50:45.867Z","eligible":0,
    "throttled":[{"ac":"AC-937","goal":"GOAL-914","reason":"cooldown","nextEligibleAt":"2026-11-06T13:49:45.867Z",
    "lastFiledAt":"2026-11-06T07:49:45.867Z","filingsInWindow":1}]}
```

- (a) = **负控**：冷却已过 ⇒ **仍可立案**（`eligible: 1`，零条节流）。节流不是「立过案就永久封条」。
- (b) = 同一份台账在立案后 1 分钟 ⇒ `cooldown`，`nextEligibleAt` 逐字 = 真实立案时刻 + 6h。
  ⚠️ 这一行的时钟是**同一时间线上的真实锚点**（真实台账时刻 +1min），不是编造的时刻：本任务落地
  之前不存在台账行，故不可能有一条「当时真的被节流了」的轮 fact。落地之后，真实轮次的读数由
  第 4 节的通道产生。

## 4. 今天的生产真实读数（真实缺口 + 真实台账 + 真实代码）

缺口读数取自生产轮记录里**最近一条带 `value.gaps` 的 `goal-ring` fact**，台账取生产载体，
`runGapSpawnPass` 以 `spawnCap: 0` 真跑（零 spawn、零写入）：

```
source round: {"ts":"2026-11-06T17:09:24.397Z","runId":"gl-prod-anchor","gaps":237}
filing-state gaps: []
{"ledger":"/data/home/yale/work/quay/.quay/goal-filing.jsonl","spawned":0,
 "throttle":{"evaluated":true,"cause":null,"candidates":0,"eligible":0,"throttled":[]}}
```

⇒ 今天生产**零条**可立案缺口（237 条缺口读数里 196 `not-evaluated` / 37 `standing-ok` /
3 `stalled` / 1 `world-gated`）。因此今天不会有 `filing-throttled` 行 —— `candidates: 0` +
`evaluated: true` 把它与「没判成」分开（后者是 `evaluated: false` + `cause`）。
落地后一旦某条 AC 再被立案，下一轮的轮 fact 就会带上 `filing-throttled=<n>/<m>` 与逐条的
`nextEligibleAt`（形状由 `plugin/test/goal-driver.test.mjs` ⑧ 的轮级用例钉住，那一轮**真的是**
`runGoalRound` 跑出来的）。

## 5. 交付物与可重跑命令

| 交付 | 位置 |
|---|---|
| 配置面（`kinds.goal.filing`：缺省 / 两种拼写 / 非法值 fail-closed + 留痕） | `plugin/scripts/driver-config.ts`（`GoalFilingConfig` / `mergeGoalFilingConfig` / `DEFAULT_GOAL_FILING_*`） |
| 判定面（纯函数，无 I/O、不改入参）+ spawn pass 接入（**先节流后切名额**） | `plugin/scripts/goal-driver.ts`（`goalFilingThrottle` / `GOAL_FILING_DAY_MS` / `runGapSpawnPass` / 轮 fact 的 `filing_throttled`） |
| 用例 | `plugin/test/goal-driver.test.mjs`（9 例，含冷却边界两侧 / 日上限 / 两种拼写 / 非法值 / 负控 / 与 spawn_cap 叠加 / 缺口态不变 / 轮 fact）、`plugin/test/driver-config.test.mjs`（+1 例） |

重跑（cwd = 仓库根）：

```sh
# AC1：两个文件
node --test plugin/test/goal-driver.test.mjs plugin/test/driver-config.test.mjs
# 全部 goal-driver shard（s01..s14 + 本文件）
node --test plugin/test/goal-driver*.test.mjs
```

实测输出（本任务 worktree，2026-11-06）：

```
$ node --test plugin/test/goal-driver.test.mjs plugin/test/driver-config.test.mjs
ℹ tests 20   ℹ pass 20   ℹ fail 0

$ node --test plugin/test/goal-driver*.test.mjs
ℹ tests 167  ℹ pass 167  ℹ fail 0   ℹ duration_ms 65282.394156
```

第 1/2/3/4 节的读数分别由 `/tmp/goal-filing-throttle-evidence.mjs` 与
`/tmp/goal-filing-throttle-live-round.mjs` 产出（一次性只读脚本，⛔ 不进仓库：它们只是把生产载体
喂给落地后的函数，属于取证，不属于产品面）。
