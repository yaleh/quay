# goal request 队列的 live 证据 — `gap-goal-request-queue`（GOAL-914 / AC-936）

本文件是该任务的 **live 证据**（AC5 / DoD「证据必须来自真实提交并被 driver 消费的一条请求
（带 consumedAt），不能只用 fixture」）。下面每一条都是**逐字粘贴的真实输出**，不是重写的摘要。

它证明四件事：

1. **提交面是真的**：`quay goal request GOAL-914 AC-936 --reason …` 经**真实 Core CLI** 对**真实
   goal store**（`goals/GOAL-914-*.md` + `goals/AC-936-*.md`，不是夹具）校验后写下一行 `submitted`。
2. **消费面是真的**：真实 driver 函数 `runGoalRequestPass`（`runGoalRound` 的 pass 1d 就是这一句）
   用**既有 `gateCriterion`** 重跑了 AC-936 **出厂判据本体**，写回一条带 `consumedAt` 的终态行。
3. **两种终态都真的出现过**：先 `refused`（那一刻载体上还没有终态行 ⇒ 判据如实判红），再
   `accepted`（第一条终态落地后重跑 ⇒ 判据判绿）。这条链本身就是「请求触发一次重新评估」的定义。
4. **幂等是真的**：同一 requestId 重放**零写**（载体 md5 逐字节不变），再消费 `openBefore:0`
   `appended:0`；负控（短 reason / 未知 AC / 未知 goal / 缺 `<ac>`）**具名拒绝 + 零写**。

## ⚠️ 边界（硬规则 4 推论四：能解释现象的说法，不是被检验的结论）

| 事项 | 本次测量的实际取值 | 没被本次测量覆盖的部分 |
|---|---|---|
| 载体位置 | `ROOT=/data/home/yale/work/quay-worktrees/gap-goal-request-queue`（任务 worktree）的 `.quay/goal-requests.jsonl` | **主检出** `/data/home/yale/work/quay/.quay/goal-requests.jsonl` 此刻**不存在**——它由第一个真正调用该动词的人创建。worker 的写守卫禁止把主检出路径当作写目标，故本轮没有、也不应该在那里造载体。 |
| `goals/` 数据 | 真实的 `goals/`（develop tip：`GOAL-914` + `AC-936` 及全部在域记录）。提交时 `no-such-ac` 这条负控能取假，正是因为探针真去读了 `goals/AC-936-*.md`。 | — |
| 消费者 | `runGoalRequestPass(SCRIPT_ROOT, ROOT, listGoalRecords(…))` —— **单独调用**，参数与 `runGoalRound` 的 pass 1d 逐字相同。 | 它没有跑在**一整轮** `runGoalRound` 里：整轮会翻 `goals/*.md` 状态、建 goal 分支，在任务 worktree 里跑会污染待合入的工作树。**轮级接线**由 `plugin/test/goal-driver.test.mjs` ⑪ 的五条用例证明（那些用例真跑 `runGoalRound`，真跑 goal-store CLI，只是 `spawnCap:0` 挡住立案 spawn）。 |
| 判据 | AC-936 的**出厂 criterion 原文**（`goals/AC-936-*.md`），⛔ 不是测试里复述的一份 | — |

⇒ 一句话：**提交、消费、终态、幂等、负控五件事都是真实代码 + 真实 store 的读数**；唯一没有覆盖的是
「主检出里的那份生产载体」，而它在生产上会由与本文件第 1 节**逐字相同**的命令产生：

```
node --experimental-strip-types packages/quay/bin/quay.ts goal request <GOAL-NNN> <AC-NNN> --reason '<why now>'
```

（在 `/data/home/yale/work/quay` 下直接执行，`--root` 缺省即该目录；下一轮 goal-driver 消费它并把
终态行追加到同一份载体。）

---

## 1. 提交：真实 CLI，真实 goal store

```
$ node --experimental-strip-types <WT>/packages/quay/bin/quay.ts goal request GOAL-914 AC-936 \
    --reason "live evidence run 1: the request queue landed and its shared carrier needs a first reading" \
    --root <WT> --json
{
  "ok": true,
  "state": "submitted",
  "requestId": "GOAL-914|AC-936|8be5cfbda1c96c78",
  "goal": "GOAL-914",
  "ac": "AC-936",
  "ledger": "/data/home/yale/work/quay-worktrees/gap-goal-request-queue/.quay/goal-requests.jsonl",
  "settledAs": null,
  "refusal": null
}
EXIT=0
```

`requestId` 是 `(goal, ac, reason)` 的纯派生：`GOAL-914|AC-936|` + `sha256(goal\0ac\0reason)[0..16]`。
⛔ 没有时钟、没有随机数——同一请求重放必然得到同一个 id，这正是下面第 4 节幂等的依据。

## 2. 第一次消费：判据如实判红 ⇒ 终态 `refused`

```
$ node --experimental-strip-types live-evidence.mjs <WT> <WT> consume
CONSUME {"evaluated":true,"cause":null,"ledger":"<WT>/.quay/goal-requests.jsonl","badLines":0,
 "openBefore":1,"openAfter":0,"appended":1,"alreadySettled":[],"errors":[],
 "settled":[{"requestId":"GOAL-914|AC-936|8be5cfbda1c96c78","goal":"GOAL-914","ac":"AC-936",
 "state":"refused","verdict":"fail",
 "detail":"acceptance failed (exit 1) — {\"rows\":1,\"consumed\":0}"}]}
```

`detail` 是 AC-936 判据**自己写出的读数**：载体上此刻只有 1 行、0 条终态 ⇒ 判据 exit 1 ⇒ `fail`。
这是「请求被处理了，但答案是『这条 AC 还不成立』」——⛔ 不是「请求失败」。

## 3. 第二次消费：判据转绿 ⇒ 终态 `accepted`

```
$ node --experimental-strip-types <WT>/packages/quay/bin/quay.ts goal request GOAL-914 AC-936 \
    --reason "live evidence run 2: after the first terminal row landed, re-evaluate the same criterion" \
    --root <WT> --json
{ "ok": true, "state": "submitted", "requestId": "GOAL-914|AC-936|8a8e6e631803ebac", … }

$ node --experimental-strip-types live-evidence.mjs <WT> <WT> consume
CONSUME {"evaluated":true,"cause":null,"ledger":"<WT>/.quay/goal-requests.jsonl","badLines":0,
 "openBefore":1,"openAfter":0,"appended":1,"alreadySettled":[],"errors":[],
 "settled":[{"requestId":"GOAL-914|AC-936|8a8e6e631803ebac","goal":"GOAL-914","ac":"AC-936",
 "state":"accepted","verdict":"pass","detail":"acceptance passed (exit 0)"}]}
```

## 4. 载体逐字（4 行：2 次提交 + 2 条终态）

```
{"state":"submitted","requestId":"GOAL-914|AC-936|8be5cfbda1c96c78","goal":"GOAL-914","ac":"AC-936","reason":"live evidence run 1: the request queue landed and its shared carrier needs a first reading","at":"2026-11-06T19:18:37.964Z"}
{"state":"refused","requestId":"GOAL-914|AC-936|8be5cfbda1c96c78","goal":"GOAL-914","ac":"AC-936","reason":"live evidence run 1: the request queue landed and its shared carrier needs a first reading","at":"2026-11-06T19:18:37.964Z","consumedAt":"2026-11-06T19:18:43.451Z","verdict":"fail","detail":"acceptance failed (exit 1) — {\"rows\":1,\"consumed\":0}"}
{"state":"submitted","requestId":"GOAL-914|AC-936|8a8e6e631803ebac","goal":"GOAL-914","ac":"AC-936","reason":"live evidence run 2: after the first terminal row landed, re-evaluate the same criterion","at":"2026-11-06T19:18:49.296Z"}
{"state":"accepted","requestId":"GOAL-914|AC-936|8a8e6e631803ebac","goal":"GOAL-914","ac":"AC-936","reason":"live evidence run 2: after the first terminal row landed, re-evaluate the same criterion","at":"2026-11-06T19:18:49.296Z","consumedAt":"2026-11-06T19:18:54.584Z","verdict":"pass","detail":"acceptance passed (exit 0)"}
```

每一条终态都带 `consumedAt`，且 `requestId` 在终态集合里互不重复 —— 这正是 AC-936 判据逐字检查的
两条性质（它就是读这份载体算出来的）。

## 5. 出厂判据在本载体上的直接读数

```
$ node --experimental-strip-types <WT>/packages/quay/bin/quay.ts goal gate AC-936 --store --root <WT> --json
{
  "id": "AC-936",
  "verdict": "pass",
  "cause": null,
  "reason": "acceptance passed (exit 0)",
  …
  "event": { "gate": "goal", "item_id": "AC-936", … }
}
```

## 6. 幂等：重放零写（载体 md5 逐字节不变）

```
$ md5sum <WT>/.quay/goal-requests.jsonl      → a9680e61f00424c0aa6205440130d9ef   (4 行)
$ node … goal request GOAL-914 AC-936 --reason '<与 run 2 逐字相同>' --root <WT> --json
{ "ok": true, "state": "already-settled", "requestId": "GOAL-914|AC-936|8a8e6e631803ebac",
  "settledAs": "accepted", "refusal": null }
EXIT=0
$ md5sum <WT>/.quay/goal-requests.jsonl      → a9680e61f00424c0aa6205440130d9ef   (仍然 4 行)

$ node … live-evidence.mjs <WT> <WT> consume
CONSUME {… "openBefore":0,"openAfter":0,"appended":0,"settled":[],"alreadySettled":[],"errors":[]}
```

⇒ 同一 requestId **没有**第二条终态行；已落定的请求不再 open。`already-settled` 也**不是错误**
（exit 0）：调用方要的那件事已经是这个状态，再写一遍就是制造重复。

## 7. 负控：具名拒绝 + 零写（md5 前后相同）

```
before md5 = a9680e61f00424c0aa6205440130d9ef

$ … goal request GOAL-914 AC-936 --reason "  too  bad  "
request refused (reason-too-short): --reason must carry at least 8 non-whitespace characters (got 6)
EXIT=1

$ … goal request GOAL-914 AC-999 --reason "a reason long enough to pass the floor"
request refused (no-such-ac): GOAL-914 has no criterion AC-999
EXIT=1

$ … goal request GOAL-999 AC-936 --reason "a reason long enough to pass the floor"
request refused (no-such-goal): no such goal: GOAL-999
EXIT=1

$ … goal request GOAL-914 --reason "a reason long enough to pass the floor"
request refused (missing-ac): missing required <ac> (e.g. AC-936)
EXIT=1

after md5 = a9680e61f00424c0aa6205440130d9ef   (仍然 4 行)
```

⛔ 「零写」不是从退出码推断的：四条负控跑完，载体**逐字节**没有变化。
第四条同时证明「缺 AC 位置参数」走的不是 `no-such-ac` 这条（那条讲的是 store 里没有），
而是 `missing-ac`——两种不同的缺失各有各的名字（硬规则 3b）。

## 8. 未被本文件覆盖、由测试钉住的部分

- **轮级接线**（`runGoalRound` 的 pass 1d 真的调用它、读数落在 `fact.value.requests` 且恒非 null）：
  `plugin/test/goal-driver.test.mjs` ⑪ 五条用例（真跑 `runGoalRound`）。
- **只读 workspace / 台账读不动**两颗负控：`packages/quay/test/goal-request.test.mjs`
  （前者 `ledger-unwritable`、后者 `evaluated:false` + cause）与 ⑪ 的最后一条。
