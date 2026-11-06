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

## 9. 落地与工作区树读数（`gap-goal-filing-ledger-landing`）

§1–§8 是**实现分支**上的证据。本节是**落地**那一半：这条实现如何进入 develop 的载体、
AC-938 判据在「落地前」与「落地树」上的两次输出，以及**本 worker 取不到、必须由外部事件产生**的读数。

### 9.1 落地形态

| 量 | 读数 |
|---|---|
| 落地分支 | `task/gap-goal-filing-ledger-landing` |
| 落地 worktree | `/data/home/yale/work/quay-worktrees/gap-goal-filing-ledger-landing` |
| **落地提交 sha** | `88a9882dc6459406527a2cf6bde973573ed6eb47`（`Merge branch 'task/gap-goal-driver-filing-ledger' into task/gap-goal-filing-ledger-landing`） |
| 被并入的实现分支 tip | `64fe08b25ef966eaa15dc18aebb02d6e920e148d` |
| 分叉基（落地前 develop） | `aab5db17abf05bd161a5957fc821e807115a6215` |
| 主检出 HEAD（取读数时） | `aab5db17abf05bd161a5957fc821e807115a6215`，分支 `author`，`git rev-list --count develop..HEAD` = `0`、`HEAD..develop` = `0` ⇒ **取读数时主检出与 develop 同点，落地后的 ff 没有分叉要解决** |
| develop 在本会话中前进 | `aab5db17a` → `ed0942e92`（`615d32345 routine(architecture-analysis)`、`6c4deda93 task_write`、`ed0942e92 …→ready`）。落地树上再合一次 develop 得 `b3ea5afffc068a586c0bad78775d7fc873b1d99b`；**落地 ff 以 fan-in 当时的 develop tip 为准**，不是上面这个分叉基 |
| 落地前干跑 | `git merge-tree --write-tree develop task/gap-goal-driver-filing-ledger` ⇒ exit `0`、无 `CONFLICT` |
| 改动面 | 6 文件、`+958 −22`：`plugin/scripts/goal-driver.ts`(+409)、`plugin/scripts/meta-driver.ts`(+78)、`plugin/test/goal-driver-s14.test.mjs`(+326, new)、`plugin/test/goal-driver-s06.test.mjs`(21)、`docs/carrier-registry.json`(6)、`docs/evidence/2026-11-06-goal-filing-ledger.md`(+140, new) |

落地树上的实现读数（**不是** git 对象，是那棵将被 ff 合入 develop 的树）：

```
$ git -C <landing worktree> merge-base --is-ancestor 840956f44 HEAD ; echo $?
0
$ git -C <landing worktree> show HEAD:plugin/scripts/goal-driver.ts | grep -c "export function reconcileGoalFiling"
1
$ git -C <landing worktree> merge-base --is-ancestor task/gap-goal-driver-filing-ledger HEAD ; echo $?
0        # 实现分支已是落地分支的祖先 ⇒ ff 进 develop 后它也是 develop 的祖先
```

### 9.2 AC-938 判据：负控（落地前）vs 正臂（落地树）

判据逐字取自 `goals/AC-938-….md` 的 `criterion:`（只把 JS 内部的单引号规范成双引号，语义不变）：

```
node --experimental-strip-types --input-type=module -e "import fs from \"node:fs\"; import { reconcileGoalFiling } from \"./plugin/scripts/goal-driver.ts\"; if (typeof reconcileGoalFiling !== \"function\") { console.error(\"workspace goal-driver has no ledger writer\"); process.exit(1) } const rows = fs.readFileSync(\".quay/goal-filing.jsonl\",\"utf8\").split(\"\n\").filter(Boolean).map(s=>JSON.parse(s)); const term = rows.filter(r=>r.state===\"filed\"||r.state===\"not-filed\"); if (term.length < 1) { console.error(\"no terminal goal-filing row\"); process.exit(1) } console.log(JSON.stringify({writer:\"present\",terminal:term.length}));"
```

两次运行共用**同一份** `.quay/goal-filing.jsonl`（从主检出 `cp` 过去，2 行），所以两次之间唯一
变量就是「有没有 `reconcileGoalFiling` 这个导出」：

**负臂** — cwd = `/data/home/yale/work/quay-worktrees/neg-goal-filing-prelanding`（detached at 落地前
develop `aab5db17a`，⛔ 不在 `/tmp`）：

```
SyntaxError: The requested module './plugin/scripts/goal-driver.ts' does not provide an export named 'reconcileGoalFiling'
    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)
NEG_EXIT=1
```

**正臂** — cwd = 落地 worktree：

```
{"writer":"present","terminal":1}
POS_EXIT=0
```

⇒ 判据**能区分**有/无实现：同一个载体、同一份台账，落地前红、落地树绿。

> **负臂的第一次尝试是仪器故障，逐字留痕（硬规则 4 推论二）**：第一次跑在新建的 neg worktree 里
> 直接报 `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml' imported from …/packages/quay/src/kernel/frontmatter.ts`
> —— 那是 neg worktree 没有 `node_modules`（`dispatch-worktree-setup.sh` 没跑），**不是**「没有导出」。
> 一个因错误原因而红的负控等于没做：给 neg worktree 补上 `node_modules` 符号链接后重跑，才得到上面那条
> `SyntaxError: … does not provide an export named 'reconcileGoalFiling'`。

### 9.3 判据涉及的两份测试，在落地树上

```
$ node --test plugin/test/goal-driver-s14.test.mjs
ℹ tests 10   ℹ pass 10   ℹ fail 0        exit 0

$ node --test plugin/test/goal-driver-s06.test.mjs
ℹ tests 9    ℹ pass 9    ℹ fail 0        exit 0
```

### 9.4 本 worker 取不到的读数（NOT-EVALUATED，附可执行 unpark 检查）

worker 在本会话里**不能**写 develop、不能写主检出、不能触发 goal-driver 轮次。因此下列读数依赖
**外部事件**（fan-in 的 ff、promotion-driver 的 `syncDevelopToDoc`、goal-driver 的下一次 gap spawn）。
按硬规则 3b/4c 它们记 `NOT-EVALUATED`，⛔ 不记成「通过」：

| # | 待取的量 | 依赖的外部事件 | unpark 检查（只读，可直接跑） |
|---|---|---|---|
| A | `git -C /data/home/yale/work/quay merge-base --is-ancestor 840956f44 develop` = 0 且 `git show develop:plugin/scripts/goal-driver.ts \| grep -c "export function reconcileGoalFiling"` ≥ 1 | fan-in ff 落地提交到 develop | `git -C /data/home/yale/work/quay merge-base --is-ancestor 840956f44 develop && git -C /data/home/yale/work/quay show develop:plugin/scripts/goal-driver.ts \| grep -c "export function reconcileGoalFiling"` |
| B | AC-938 判据 **以 cwd=`/data/home/yale/work/quay`** 退出 0、stdout `{"writer":"present","terminal":N}` | fan-in ff + `syncDevelopToDoc`（主检出追上 develop） | 在 `/data/home/yale/work/quay` 下原样执行 §9.2 的那条命令 |
| C | `grep -c "export function reconcileGoalFiling" /data/home/yale/work/quay/plugin/scripts/goal-driver.ts` ≥ 1（读工作树文件） | 同上 | 就是这条 `grep` 本身 |
| D | `.quay/goal-filing.jsonl` 中出现 `at` 晚于 `88a9882dc` 的行 | goal-driver 下一次产生 gap spawn 的生产轮次 | `awk -F'"' '/"at":"2026-11-06T1[12]:/{print}' /data/home/yale/work/quay/.quay/goal-filing.jsonl`（按实际时刻自行收紧） |
| E | `node --test plugin/test/goal-driver-s14.test.mjs` / `-s06` 在**工作区树**退出 0 | 同 B | 在 `/data/home/yale/work/quay` 下跑这两条 |

读数侧的现状（供 unpark 判读，同样是读数而非结论）：四类 driver 全部 `running=1`、worker/promotion
control-state `halted:false`；`goal-driver` 最近一条 `goal-round.jsonl` 记录 `2026-11-06T11:37:03.375Z`；
`.quay/goal-filing.jsonl` 现有 2 行（`spawned` 07:49:45Z / `filed` 07:57:41Z），**都早于**落地提交
`88a9882dc` ⇒ ⛔ 不能拿来充 D。goal-driver 未 halted ⇒ 一旦落地生效，D 会在下一轮自然产生；
若届时无新行，按任务 AC4 记 `NOT-EVALUATED` + `halted_by`/`halted_at` + `quay driver resume --kind worker`。

### 9.5 为什么 D 这一项⛔ 不能被「台账已有 filed 行」顶替（AC-941）

本会话期间 goal-driver 立案了新判据 **AC-941**（`goals/AC-941-….md`，status `draft`），它把本节的 D 项
从「观察项」提升成了一条可执行判据：AC-938 只断言「导出存在」+「台账有终态行」，**不建立两者之间的因果**；
一旦 `reconcileGoalFiling` 落地，AC-938 会拿**实现之前**就存在的 `filed` 行（`at=2026-11-06T07:57:41.597Z`）
变绿——这正是 AC-938 自己标题要排除的「一次证据跑留下的静态文件」。AC-941 的判据把这条路封掉：

```
git log --format=%cI -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts   # 取写入符号的落地提交时刻
… 台账里必须存在 at > landedAt 的 filed/not-filed 行，否则 exit 1
```

⇒ 这**直接印证**了本节 §9.4 的 D 项与任务 AC4 的口径：本 worker ⛔ 不勾 AC4，也⛔ 不把
`07:57:41Z` 那行当成「落地后的生产写入」。落地之后 factory 侧的正确读法是 AC-941 那条命令，
不是 AC-938 那条（AC-938 落地后必然变绿，但它的绿在本例中是可被 AC-941 证伪的）。
