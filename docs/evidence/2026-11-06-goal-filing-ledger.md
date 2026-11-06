# 立案台账的 live 证据 — `gap-goal-driver-filing-ledger`（GOAL-914 / AC-934）

本文件是 `tasks/gap-goal-driver-filing-ledger.md` 的 live 证据。它证明的不是「测试能产出读数」，
而是**实现落地之后，真实 spawn 真的产出了 `spawned` → `filed` 这一对行**，且 `filed` 指向的任务文件
里逐字带着 `goal_ac: AC-937`。

## 1. 台账：两条行，逐字抄录

载体：`/data/home/yale/work/quay/.quay/goal-filing.jsonl`（生产工作区根，gitignored 运行时载体；
AC-934/AC-937 的判据都在仓库根以相对路径 `.quay/goal-filing.jsonl` 读它）。

```jsonl
{"state":"spawned","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:49:45.867Z","promptSha":"e5af4127b26ba5a4","round":"2026-11-06T07:49:45.859Z"}
{"state":"filed","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:57:41.597Z","spawnedAt":"2026-11-06T07:49:45.867Z","taskId":"gap-goal-filing-chain-audit","reason":null}
```

- `state` 的两个取值不同形：`spawned` 是**意图**，`filed` 是**下一轮核对的结论**；`reason:null` 只出现在
  `filed` 上（`not-filed` 带枚举 reason，见 §4 的负控）。
- `spawnedAt` 把结论与它核验的那一行绑在一起（⛔ 不要求读者回原行拼装）。
- `promptSha` 把「spawn 的是什么」也钉进载体（⛔ 只有一个时间戳）。

## 2. 对应任务：`goal_ac` 逐字可核

`taskId` = `gap-goal-filing-chain-audit`，来自真实 gap-filing agent 的 `task_write`（提交
`6e3809b57 tasks: gap-goal-filing-chain-audit task_write by cli:1591720`）。该任务文件的 frontmatter 首几行：

```
---
id: gap-goal-filing-chain-audit
title: goal-filing 整链审计：filed 行的 taskId 与任务落地状态交叉核对
status: todo
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-filing-ledger
goal_ac: AC-937
---
```

⇒ `goal_ac: AC-937` 是**驱动自己立案**写下的（不是预置：该 AC 在 spawn 之前的 `readTaskFacts` 快照里
零认领，见 §3 的 `ELIGIBLE {"ac":"AC-937","state":"gap","taskCount":0}`）。

## 3. 这条链是怎么产生的（真实 spawn，不是 fixture）

一次性操作脚本（不进仓库）用**本任务的实现**（worktree 上的代码）对**真实工作区**
`/data/home/yale/work/quay` 跑了一次 `runGapSpawnPass`：

- 输入缺口读数：`ELIGIBLE [{"goal":"GOAL-914","ac":"AC-937","state":"gap","taskCount":0}]`
  —— `gap` 态 = 该 AC 没有任何 todo/ready/needs-human 的认领任务（`computeGoalGaps` 的真实输出）。
- 资源门：`{"go":true,"reason":"=> GO: 资源充足，可以跑"}`（⛔ 未绕过）。
- spawn 用**真实 argv**：`gapWorkerCmd` 未覆盖 ⇒ `launchArgv("fix-worker", prompt, root)`，即与生产
  相同的 `claude-fjdac … -n quay-fix-worker -p <prompt>`。spawn 读数：

```
"spawned": 1, "llmInvoked": true,
"outcomes": [{ "ac": "AC-937", "goal": "GOAL-914", "exitCode": 0, "timedOut": false }]
```

- agent 的 stdout 首段（原文）：`## Filed  **\`gap-goal-filing-chain-audit\`** — \`status: todo\`,
  \`goal_ac: AC-937\`, \`depends_on: [gap-goal-driver-filing-ledger]\`, shape \`plan\`, committed on
  \`author\` as \`6e3809b57\` (via \`task_write\`)`。
- 随后同一次运行调用 `reconcileGoalFiling(root, readTaskFacts(root))`，它写下 §1 的第二行：

```
"openBefore": 1, "openAfter": 0, "appended": 1,
"reconciled": [{ "state": "filed", "reason": null, "taskId": "gap-goal-filing-chain-audit" }]
```

⛔ 关键点：`filed` 行**不是** agent 写的（agent 的 stdout 明确写了它没有写台账——「hand-writing it
would forge the very reading AC-937 exists to measure」），也不是任何人手写的：它是 `reconcileGoalFiling`
从 `readTaskFacts` 的读数里**独立核**出来的。

## 4. 负控：`no-task` / `no-goal-ac` 不会被写成 `filed`

live 链路证明的是正臂。负臂在 `plugin/test/goal-driver-s14.test.mjs` 里用**真台账 + 真任务文件**跑：

| 用例 | 场景 | 断言 |
|---|---|---|
| ③a | spawn 后零文件落盘 | `state="not-filed"`, `reason="no-task"`, 且 `assert.notEqual(state,"filed")` |
| ③b | spawn 后落了一个**不带** `goal_ac` 的文件 | `state="not-filed"`, `reason="no-goal-ac"` |
| ③c | spawn 前已有认领该 AC 的任务、spawn 后零新文件 | `state="not-filed"`, `reason="deduped-by-skill"` |
| ④b | `tasks/` 读不到 | `evaluated:false, cause:"tasks-unreadable"`，**零终态行**（⛔ 不把「不知道」写成 not-filed） |

三成因是**枚举**而非布尔（③d 钉住三者互不相等）。

## 5. 读面两处（Proposal 的第二半）

- pass 1 的 `goal list` 走 `--no-evidence`，pass 2 保留 evidence：`plugin/test/goal-driver-s14.test.mjs`
  的 ⑤a 用注入的 `listGoalRecordsFn` 断言**两次调用的 opts**（`noEvidence: true` / `false`），并在
  argv 层断言 `--no-evidence` 真的进了 argv、缺省不带它（既有调用点行为不变）。
- `listGoalRecords` 的 wall-clock 上限：`goalListTimeoutReading` 从 `drivers.yml
  kinds.goal.list_timeout_ms` 派生，缺省 `180000`；非法值（如 `-5`）回落缺省**并在 `detail` 里点名原值**
  （⛔ 静默）。⑤b 逐条钉住四态（explicit / config / default+无 detail / default+有 detail）。

## 6. 静态闸（本任务触碰的两条）

```
node --no-warnings --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts
  → PASS — goal-driver.ts has no task-write call sites ... and no OWN-REPO fan-in/落地率 carrier reads

node --no-warnings --experimental-strip-types plugin/scripts/task-file-bypass-check.ts --gate
  → PASS: no new task-file bypass — 39 hit(s), all within the allowlist

node --test plugin/test/carrier-registry-completeness.test.mjs
  → 7 pass / 0 fail（goal-filing.jsonl 已登记 docs/carrier-registry.json）
```

## 7. AC1 路径更正（记录偏离，不藏）

AC1 原写 `node --test plugin/test/goal-driver.test.mjs`。该单体文件**已被**
`gap-suite-split-15-over-30s-test-files` 拆成 `goal-driver-s01..s13`，且 AC-279（GOAL-022，status
achieved）的判据逐条断言 `plugin/test/goal-driver.test.mjs` **不存在**（存在即
`CAUSE=offender-still-monolithic` ⇒ exit 1）。在那条 AC 仍然生效的前提下重建这个路径会直接把
GOAL-022 打红，且不会增加任何覆盖。

⇒ 新用例落在 shard `plugin/test/goal-driver-s14.test.mjs`（同族命名，`<stem>-sNN` 已被
full-suite-runner 的 cascade 分类识别），AC1 的**实质**（同一文件里的 filed / not-filed / 坏行 / 重放
用例，`node --test` 退出码 0）逐字保留：

```
$ node --test plugin/test/goal-driver-s14.test.mjs
ℹ tests 10   ℹ pass 10   ℹ fail 0
```

## 8. 已知局限（如实记，不粉饰）

`not-filed` 的成因细分依赖两个机械量：任务文件的 **mtime**（`readTaskFacts.mtimeMs`）与 `tasks/*.md`
的**文件数**（`countTaskFiles`，spawn 前记进 `spawned` 行的 `taskCount`）。

- 用「文件数增长」而不是「有没有文件被改过」是刻意的：本仓 promotion/worker driver 每几分钟就会改一条
  既有任务的状态，若拿「被改过」当替代量，`no-task` 在真实生产里会恒不可达（每一次未立案都会被误判成
  `no-goal-ac`）。
- 残留局限：**并发的其它 spawn** 也会让文件数增长，此时一次「agent 没落盘」的 spawn 会被判成
  `no-goal-ac` 而非 `no-task`。两者都是 `not-filed`，只影响成因细分，⛔ 不影响「立没立案」这个二值结论。
- `spawned.at` 读不懂（时钟不可比）⇒ 独立取值 `spawn-time-unreadable`，⛔ 不与「确实没立案」同形。
