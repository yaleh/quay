# Evidence — gap-ac941-filing-window-anchor-post-landing-row

Date: 2026-11-06
Task: `tasks/gap-ac941-filing-window-anchor-post-landing-row.md`（goal_ac: AC-941）

## 0. 一句话结论

AC-941 的判据把「实现落地」锚在 **`git log -S reconcileGoalFiling` 的最旧一条**（引入符号的**代码提交**）
上，而代码真正进入工作区树是**几小时之后的一次 `--ff-only` fan-in**。落在两者之间的、由**任务 worktree
证据跑**写下的终态行（`at=2026-11-06T07:57:41.597Z`）因此对旧锚点是 fresh、对落地锚点不是 ——
**判据在落地后拿一条落地前写的静态行翻了绿，而且生产上真的已经翻了**（§3）。

本任务交两个可执行物：

1. `plugin/test/ac941-filing-window-anchor.test.mjs`（新）—— 在临时 git 工作区上区分「落地前写的终态行」
   与「落地后写的终态行」；**现判据在前者上也是绿的**，这就是缺陷的可执行证明。
2. 本文件 —— `land_code` 与 `land_landing` 两个时刻、两行 `at`、生产缺口语义环的判定路径，逐字读数。

> **读数来源标注（AC6 要求）**：本文所有 `$` 命令块都是**本任务在 2026-11-06 会话内现取**（cwd 见各块），
> 每条都带退出码。**引用**的只有三处，均已在文中注明「引用」：①任务 Proposal 里立案时的读数（§2 的
> 07:46:57Z 与之相同，但我重新取了一次）；②`.quay/fan-in-…log` 的历史行；③`git reflog`（本地历史，
> 换一台机器 clone 就没有）。其余没有任何一个数字是从任务体转抄的。

---

## 1. 落地生效核实（AC1）—— **通过**

```
$ cd /data/home/yale/work/quay
$ git log --format='%H %cI' -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts
840956f442b756fe41069264646e8efe5dfc1bba 2026-11-06T15:46:57+08:00
$ echo "EXIT=$?"
EXIT=0

$ grep -c 'export function reconcileGoalFiling' plugin/scripts/goal-driver.ts
1
$ echo "EXIT=$?"
EXIT=0
```

两项都非零 ⇒ **落地生效**（本任务不停在 `NOT-EVALUATED`，继续走 §2–§5）。

函数位置（同一棵工作区树内现取）：

```
$ grep -n 'export function reconcileGoalFiling' plugin/scripts/goal-driver.ts
3188:export function reconcileGoalFiling(
```

台账写入的两个站点（现取，行号与任务 Proposal 引用的一致）：

```
$ grep -n 'appendGoalFilingRow' plugin/scripts/goal-driver.ts
3140:export function appendGoalFilingRow(ledgerPath: string, row: GoalFilingRow): { ok: boolean; error: string | null } {
3258:    const w = appendGoalFilingRow(ledgerPath, {      ← reconcileGoalFiling 写【终态行】(filed / not-filed)
3463:    const w = appendGoalFilingRow(ledger, {          ← runGapSpawnPass 在 spawn【之前】写 spawned 行
```

⇒ 生产缺口语义环 = `spawned`（本轮 spawn 前，`:3463`）→ 下一轮 `reconcileGoalFiling` 对该行写
`filed`/`not-filed`（`:3258`）。一条「落地后生产写的终态行」在结构上要求：**落地之后**至少出现过一次
`isFilingGapState`（`gap`/`workable`/`standing-violated`/`frozen-violated`，`goal-driver.ts:3304-3306`）
为真的 AC。§4 给出这一条此刻的读数。

---

## 2. 锚点差（AC2，本任务的核心读数）—— `fresh ≥ 1` vs `fresh = 0`

### 2a. 两个时刻

**`land_code`** —— 现判据实际使用的锚点（`log[log.length-1]`，最旧一条）：

```
$ git log --format='%H %cI' -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts
840956f442b756fe41069264646e8efe5dfc1bba 2026-11-06T15:46:57+08:00      # = 07:46:57Z
```

**`land_landing`** —— 判据**应当**使用的锚点。任务 Proposal 建议用
`git log --merges --format='%H %cI' -S reconcileGoalFiling -- …` 发现它。**该命令返回空**（这是一个
独立发现，见 §2b），所以落地提交由 develop 的 reflog 与 fan-in 日志交叉定位：

```
$ git reflog show develop --date=iso | grep '21:03:07'
59b5e4325 develop@{2026-11-06 21:03:07 +0800}: push          # = 13:03:07Z，develop 被 ff 到 59b5e4325

$ grep '"step":"ff"' .quay/fan-in-gap-goal-filing-ledger-landing-wk-prod-anchor.log
{"ts":"2026-11-06T13:03:07.445Z","step":"ff","exit":0,"wall_ms":25026,"ok":true}     # 引用（历史日志行）

$ git log -1 --format='%H %cI %s' 59b5e4325
59b5e43254b8a894205ed84e21d0559183004771 2026-11-06T21:02:42+08:00 Merge branch 'develop' into task/gap-goal-filing-ledger-landing
                                                                      # = 13:02:42Z  ← land_landing
```

边界核对（**取假**：不是「看起来像」，而是「前一棵树里没有、这一棵树里有」）：

```
$ git show 7515b1b28:plugin/scripts/goal-driver.ts | grep -c reconcileGoalFiling
0                    # ff 之前 develop 指向的 7515b1b28：没有 writer 符号
$ git show 59b5e4325:plugin/scripts/goal-driver.ts | grep -c 'export function reconcileGoalFiling'
1                    # ff 之后 develop 指向的 59b5e4325：有
```

⇒ **`land_code` = 07:46:57Z**，**`land_landing` = 13:02:42Z**（若取「ff 真正发生的时刻」13:03:07Z 结果不变，
见 §2c 第三行）。两者相差 **5 小时 15 分 45 秒**；而那条落进窗口的终态行 `at=07:57:41.597Z` 恰好落在中间。

### 2b. 附带发现：`--merges -S` 找不到落地提交（因为 fan-in 是 ff，不是 merge）

```
$ git log --merges --format='%H %cI' -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts | cat
$ echo "EXIT=${PIPESTATUS[0]}"
EXIT=0
```

**输出为空、退出码 0** —— 一个「空集」与「检查失败」不同形，但**与「没有落地合并提交」同形**。
原因有两层：①fan-in 的落地是 `git merge --ff-only`（`fan-in-ff-merge.sh`），历史里因此**没有**一条
「落地合并提交」；②`59b5e4325` 本身虽是一条 `Merge branch 'develop' into task/…`，但它的树与第一父
（任务分支尖端）相同 ⇒ `-S` 的历史简化把它 TREESAME 掉。

⇒ **这不是判据的第二个缺陷，而是修正版判据不能照抄任务 Proposal 的那条命令**：落地锚点必须从
「develop 指针何时被 ff」这个事件取（reflog / fan-in 日志），或从「这次 ff 落到的那条提交」取。
本文件采用后者（`59b5e4325` 的 `%cI`），因为它是一个**提交上的量**，而 `%cI` 在任何 clone 里都在。

### 2c. 同一份台账、同一段 `fresh` 过滤、只换锚点

过滤器（逐字）——只做现判据里那一个谓词 `Date.parse(r.at) > land`：

```
$ cd /data/home/yale/work/quay
$ FRESH_FILTER='
import fs from "node:fs";
const land = Date.parse(process.argv[1]);
const rows = fs.readFileSync(".quay/goal-filing.jsonl","utf8").split("\n").filter(Boolean).map(s=>JSON.parse(s));
const term = rows.filter(r=>r.state==="filed"||r.state==="not-filed");
const fresh = term.filter(r=>Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) > land);
console.log(JSON.stringify({anchor:new Date(land).toISOString(), terminal:term.length, fresh:fresh.length, matched:fresh.map(r=>r.at)}));
'
```

| 锚点 | 命令 | stdout | 退出码 |
|---|---|---|---|
| `land_code` | `node --input-type=module -e "$FRESH_FILTER" '2026-11-06T15:46:57+08:00'` | `{"anchor":"2026-11-06T07:46:57.000Z","terminal":1,"fresh":1,"matched":["2026-11-06T07:57:41.597Z"]}` | 0 |
| `land_landing` | `node --input-type=module -e "$FRESH_FILTER" '2026-11-06T21:02:42+08:00'` | `{"anchor":"2026-11-06T13:02:42.000Z","terminal":1,"fresh":0,"matched":[]}` | 0 |
| `ff` 时刻（对照） | `node --input-type=module -e "$FRESH_FILTER" '2026-11-06T21:03:07+08:00'` | `{"anchor":"2026-11-06T13:03:07.000Z","terminal":1,"fresh":0,"matched":[]}` | 0 |

**`land_code` ⇒ `fresh ≥ 1`（命中的正是 `at=2026-11-06T07:57:41.597Z`）；`land_landing` ⇒ `fresh = 0`。**
换 ff 时刻（25 秒之后）结论不变 —— 这个差不是「取哪个更精确」的问题，是**差了 5 个多小时**。

台账原文（现取，两行，未跟踪文件）：

```
$ cat .quay/goal-filing.jsonl
{"state":"spawned","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:49:45.867Z","promptSha":"e5af4127b26ba5a4","round":"2026-11-06T07:49:45.859Z"}
{"state":"filed","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:57:41.597Z","spawnedAt":"2026-11-06T07:49:45.867Z","taskId":"gap-goal-filing-chain-audit","reason":null}
```

---

## 3. 缺陷已在生产上发生（不是假想）

AC-941 判据在**落地之后**执行并翻绿：

```
$ cd /data/home/yale/work/quay && bash -c "<AC-941 criterion，经 goal store 读出>"
{"landedAt":"2026-11-06T07:46:57.000Z","fresh":1}
$ echo "EXIT=$?"
EXIT=0
```

它报出的 `landedAt` 是 **07:46:57Z（= 代码提交 `840956f44`）**，而命中的行是 **07:57:41.597Z** ——
即这条绿完全来自「代码合进来之前 11 分钟、在任务 worktree 里跑证据时写下的那一行」。

goal store 里这条 AC 的状态（现取）：

```
$ (读 goals/AC-941-*.md frontmatter)
status=achieved
statusLog=[{"at":"2026-11-06T12:22:33.334Z","from":"draft","to":"active","actor":"goal-driver","reason":"triage: activate"},
           {"at":"2026-11-06T13:10:47.287Z","from":"active","to":"achieved","actor":"goal-driver","reason":"I2: criterion pass"}]
```

翻绿时刻 **13:10:47Z 晚于落地时刻 13:03:07Z** ⇒ 生产进程在落地后跑了判据、判据用落地前的行变绿。
**这正是 AC-941 自己的 origin 要排除、也正是本任务存在的理由。**

把同一段判据的锚点换掉（`land` ← `59b5e4325` 的 `%cI`，其余每个字符不动），在同一棵工作区树上重跑：

```
$ bash -c "<AC-941 criterion，锚点段替换为落地提交>"          # 替换只发生在 /tmp 的副本里
{"landedAt":"2026-11-06T13:02:42.000Z","terminal":["2026-11-06T07:57:41.597Z"]}
$ echo "EXIT=$?"
EXIT=1
```

⇒ **同一份台账、同一段过滤，只换锚点：现判据 0，落地锚点变体 1。**

---

## 4. 生产终态行（AC4）—— `NOT-EVALUATED`（窗口内没有可立案缺口）

按硬规则 3b/6：这一项**不是**「没做到」，是「本窗口内没有可评估的输入」，所以给它一个独立取值，
⛔ 不拿 §2c 那两行（`07:49:45.867Z` / `07:57:41.597Z`，都在落地前）充数。

### 4a. 落地之后的每一轮，`isFilingGapState` 都为 0

```
$ cd /data/home/yale/work/quay && node --input-type=module -e '
import fs from "node:fs";
const lines=fs.readFileSync(".quay/goal-round.jsonl","utf8").split("\n").filter(Boolean);
const r=JSON.parse(lines[lines.length-1]);
const g=r.facts.find(f=>f.name==="goal-gaps");
const F=["gap","workable","standing-violated","frozen-violated"];
const hits=g.value.gaps.filter(e=>F.includes(e.state));
console.log(JSON.stringify({round:r.round, ts:r.ts, filingGaps:hits.length, hits}));
'
{"round":6,"ts":"2026-11-06T14:04:34.388Z","filingGaps":0,"hits":[]}
$ echo "EXIT=$?"
EXIT=0
```

落地（13:03:07Z）之后的**三轮**读数，逐轮同形（现取）：

| round | ts | state 分布 | filing-gap 条数 |
|---|---|---|---|
| 4 | 2026-11-06T13:47:36.189Z | `not-evaluated`=196 / `stalled`=3 / `world-gated`=1 | 0 |
| 5 | 2026-11-06T13:56:26.766Z | `not-evaluated`=196 / `stalled`=3 / `world-gated`=1 | 0 |
| 6 | 2026-11-06T14:04:34.388Z | `not-evaluated`=196 / `stalled`=3 / `world-gated`=1 | 0 |

### 4b. 该轮 `goal-gaps` 逐条读数（round 6，`run_id=gl-prod-anchor`，`pid=1245739`）

```
fact.name    = goal-gaps
fact.state   = verified
fact.reason  = "非安静态 200/237 条：not-evaluated=196 stalled=3 world-gated=1；world-gated 路由 1 条（round-gate-reread，⛔ 不 spawn）"
value.evaluated = true
value.cause     = null
value.routed    = [{"goal":"GOAL-914","ac":"AC-939","carriers":[".quay/goal-filing.jsonl"],"route":"round-gate-reread"}]
gaps_total      = 200
```

**非 `not-evaluated` 的四条**（其余 196 条全部是 `not-evaluated`，可用 4a 的命令原样复读全量）：

```
{"goal":"GOAL-914","ac":"AC-935","state":"stalled","taskCount":2}
{"goal":"GOAL-914","ac":"AC-936","state":"stalled","taskCount":1}
{"goal":"GOAL-914","ac":"AC-937","state":"stalled","taskCount":1}
{"goal":"GOAL-914","ac":"AC-939","state":"world-gated","taskCount":1}
```

`stalled` / `world-gated` **都不是** `isFilingGapState`（`goal-driver.ts:3304-3306` 只认
`gap`/`workable`/`standing-violated`/`frozen-violated`）⇒ 这几轮 `goal-gaps` 里**没有一条**会让
`runGapSpawnPass` 写 `spawned` 行 ⇒ 落地之后**结构上不可能**出现一条落地后的 `filed`/`not-filed` 行。
本任务认领 AC-941 之后，缺口读数里 AC-941 也退出了（它已 `achieved`），缺口面因此是 0。

### 4c. unpark 检查（一次可跑，出现即自动可判）

```bash
cd /data/home/yale/work/quay && node --input-type=module -e '
import fs from "node:fs";
const lines=fs.readFileSync(".quay/goal-round.jsonl","utf8").split("\n").filter(Boolean);
const r=JSON.parse(lines[lines.length-1]);
const g=r.facts.find(f=>f.name==="goal-gaps");
const F=["gap","workable","standing-violated","frozen-violated"];
const hits=g.value.gaps.filter(e=>F.includes(e.state));
console.log(JSON.stringify({round:r.round, ts:r.ts, filingGaps:hits.length, hits}));
'
```

- 输出 `filingGaps: 0` ⇒ 仍无输入，AC4 保持 `NOT-EVALUATED`（**现在就是这一态**）。
- 输出 `filingGaps ≥ 1` ⇒ 下一到两轮里会出现一条 `spawned` 行，再下一轮出现它的终态行；届时判据：

```bash
cd /data/home/yale/work/quay && node --input-type=module -e '
import fs from "node:fs";
const land = Date.parse("2026-11-06T21:02:42+08:00");   // land_landing = 59b5e4325 的 %cI
const rows = fs.readFileSync(".quay/goal-filing.jsonl","utf8").split("\n").filter(Boolean).map(s=>JSON.parse(s));
const fresh = rows.filter(r=>(r.state==="filed"||r.state==="not-filed") && Date.parse(r.at) > land);
console.log(JSON.stringify({land_landing:new Date(land).toISOString(), postLandingTerminalRows:fresh}));
'
```

`postLandingTerminalRows` 非空 ⇒ AC4 由 `NOT-EVALUATED` 变为可判（**逐字抄录那一行 + 它的轮读数**）。

---

## 5. 负控（AC5）：落地前的工作区树 ⇒ 判据 exit 1

临时 worktree 建在 `/home/yale/work/quay-worktrees/`（⛔ 不用 `/tmp`），pin 在 **ff 之前**的 develop 提交
`7515b1b28`，跑完立即删除：

```
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-11-06T14:13:22Z
$ git worktree add --detach /home/yale/work/quay-worktrees/ac941-preland-negctl 7515b1b28
Preparing worktree (detached HEAD 7515b1b28)
$ git -C <wt> log -1 --format='%H %cI %s'
7515b1b286682865e17edcb08550dd12c0fd7d86 2026-11-06T20:46:52+08:00 tasks: gap-test-harness-tmp-dir-leak 记录未落地原因（worker exited-not-landed）
$ grep -c reconcileGoalFiling <wt>/plugin/scripts/goal-driver.ts
0
```

**第一次跑是【仪器故障】，不是负控读数**（硬规则 3b：⛔ 不把「读不懂输入」当成「判据红了」）：

```
$ cd <wt> && bash -c "<criterion>"
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from …/ac941-preland-negctl/packages/quay/src/kernel/frontmatter.ts
EXIT=1
```

工作树里没有 `node_modules` ⇒ 判据连 `import('./plugin/scripts/goal-driver.ts')` 都走不到。
补上依赖链接后重跑（**代码仍是被 pin 的落地前提交，只补依赖**）：

```
$ ln -s /data/home/yale/work/quay/node_modules <wt>/node_modules
$ cd <wt> && bash -c "<criterion>"
workspace goal-driver has no ledger writer
EXIT=1
```

⇒ 负控成立：**落地前的工作区树上，判据以自己的语义判红**（不是语法错、不是依赖缺失）。

正臂（落地生效后的工作区树）已在 §3 取到：`{"landedAt":"2026-11-06T07:46:57.000Z","fresh":1}` / `EXIT=0`
（按 AC5 的口径，「exit 0 或 `NOT-EVALUATED`」二者之一即可 —— 这里取到的是 exit 0，而**它为什么绿**正是
本任务要指出的问题）。

清理：

```
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-11-06T14:13:41Z
$ git worktree remove --force /home/yale/work/quay-worktrees/ac941-preland-negctl
$ git worktree list | grep -c 'ac941-preland-negctl'
0
```

（建与删相隔 19 秒；该路径不留在 `git worktree list` 里，不会污染 in-flight 计数。）

---

## 6. 窗口语义测试（AC3）：`plugin/test/ac941-filing-window-anchor.test.mjs`

夹具是真的 git 仓库（不是注入 seam）：C1 引入 writer 符号（`GIT_*_DATE=2026-11-06T07:46:57+00:00`，
= `land_code`），C2 是落地提交（`13:02:42+00:00`，= `land_landing`），C2 **不改变符号出现次数**
⇒ `git log -S` 仍只命中 C1，与生产形态一致。台账两态：`ROW_BETWEEN=07:57:41.597Z`（落地前那次证据跑
写的）与 `ROW_AFTER=14:00:00.000Z`（落地后）。**时刻全部固定，⛔ 不依赖墙钟。**

landing-anchored 变体不是第二份判据：它是**同一段判据**在运行时做一次锚点段替换
（`const log = execSync(` … `: NaN;` → `const land = Date.parse(execSync('git log -1 --format=%cI <落地 sha>'…))`），
所以 ① 臂上两条腿的差别**只有锚点**。

```
$ cd <worktree> && node --test plugin/test/ac941-filing-window-anchor.test.mjs
✔ 判据取自 goal store（测试里无副本），且夹具两个时刻真的先后可辨 (98.479528ms)
✔ 正臂：终态行 at 晚于落地提交 ⇒ 现判据 exit 0 且 landing-anchored 变体 exit 0 (182.138597ms)
✔ 取假臂：终态行 at 落在代码提交与落地提交之间 ⇒ 现判据 exit 0（缺陷可复现）而 landing-anchored 变体 exit 1 (187.795617ms)
✔ 负控：台账里没有终态行 ⇒ 现判据与 landing-anchored 变体都 exit 1 (158.328003ms)
✔ 落地前臂：工作区树里没有 reconcileGoalFiling ⇒ 现判据 exit 1（has no ledger writer） (103.985572ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 912.473983
$ echo "EXIT=$?"
EXIT=0
```

判据单一真相源（AC3 的 `grep -c 判据正文副本 = 0`）：

```
$ node --experimental-strip-types --input-type=module -e '<读 store 的 criterion；读测试文件；count=split(crit).length-1>'
criterion_len=1261
copies_in_test_file=0

$ grep -c 'writer symbol not yet committed to the workspace tree' plugin/test/ac941-filing-window-anchor.test.mjs
0
$ echo "EXIT=$?"
EXIT=1                      # grep 的 1 = 零命中，正是要的读数
```

⚠️ 一处必须写明的**已知局限**：① 臂断言的是「**现**判据在落地前行上 exit 0」。若有人把 AC-941 的判据
改成落地锚点，这一臂会红 —— 断言消息里已写清「那是判据被修好了，请把本臂改成断言 exit 1 并同步改本文，
⛔ 不要删掉这一臂」。这是一个**故意**的 tripwire，不是脆断言。

---

## 7. 修正版判据（给 人 / manager 决策，⛔ 本任务不自行改 goal store）

现状（锚在代码提交上）：

```js
const log = execSync('git log --format=%cI -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts',{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const land = log.length ? Date.parse(log[log.length-1]) : NaN;
```

修正版（锚在**落地提交**上；其余每个字符不动）：

```js
const land = Date.parse(execSync('git log -1 --format=%cI 59b5e43254b8a894205ed84e21d0559183004771',{encoding:'utf8'}).trim());
```

一条可复跑的完整修正判据（本节读数即由它产生，cwd = `/data/home/yale/work/quay`）：

```bash
cd /data/home/yale/work/quay && node --experimental-strip-types --input-type=module -e "import fs from 'node:fs'; import { execSync } from 'node:child_process'; const mod = await import('./plugin/scripts/goal-driver.ts'); if (typeof mod.reconcileGoalFiling !== 'function') { console.error('workspace goal-driver has no ledger writer'); process.exit(1); } const rows = fs.readFileSync('.quay/goal-filing.jsonl','utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s)); const term = rows.filter(r=>r.state==='filed'||r.state==='not-filed'); if (term.length < 1) { console.error('no terminal goal-filing row'); process.exit(1); } const land = Date.parse(execSync('git log -1 --format=%cI 59b5e43254b8a894205ed84e21d0559183004771',{encoding:'utf8'}).trim()); if (!Number.isFinite(land)) { console.error('landing commit unreadable'); process.exit(1); } const fresh = term.filter(r=>Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) > land); if (fresh.length < 1) { console.error(JSON.stringify({landedAt:new Date(land).toISOString(), terminal:term.map(r=>r.at)})); process.exit(1); } console.log(JSON.stringify({landedAt:new Date(land).toISOString(), fresh:fresh.length}));"
```

**但把 sha 写死进 criterion 只是把这一个窗口钉住，不是通用解** —— 提交 sha 是这台机器此刻的历史，
下一次 writer 变更就过期。真正要人决定的是**语义**，三选一：

| 方案 | 锚点 | 代价 |
|---|---|---|
| A（最小改动） | 落地提交的 `%cI`（本文件 §7） | 只钉住这一次；sha 会过期 |
| B | **ff 发生的时刻**（`git reflog show develop` 里对应 `fan-in` 日志 `ff` 步骤那一条的时间） | 量对了，但 reflog 是**本地**状态，clone/GC 后消失（硬规则 4c：量要穿过所有中间层还取得到） |
| C（推荐，需人裁定） | 让 **fan-in 落地时写下一条落地事件**（例如 `.quay/landing-events.jsonl` 的 `{task, sha, at}`），判据读它 | 要新增一个生产载体 + gitignore + carrier-registry；但它是**唯一**能同时满足「落地语义」与「任何 clone 都读得到」的量 |

⇒ 本任务只提供读数与候选，⛔ 不改 AC-941 的 criterion（criterion 是读数，不是无人值守的写者 —— 任务 Plan 6）。

---

## 8. 复跑清单（按需）

| 要看什么 | 命令 |
|---|---|
| 落地是否生效 | `git log --format='%H %cI' -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts` + `grep -c 'export function reconcileGoalFiling' plugin/scripts/goal-driver.ts` |
| 两个锚点 | §2a（`land_code`）/ `git -C … log -1 --format=%cI 59b5e4325`（`land_landing`） |
| 锚点差 | §2c 的 `FRESH_FILTER`，换第三个参数即可 |
| 窗口语义锁 | `node --test plugin/test/ac941-filing-window-anchor.test.mjs` |
| AC4 是否可判 | §4c 的 unpark 检查 |
| 现判据此刻的读数 | §7 的「现状」两行 + goal store 里的 criterion 原文 |
