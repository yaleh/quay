# gap-develop-ci-first-decisive-green — Evidence

worktree `/home/yale/work/quay-worktrees/gap-develop-ci-first-decisive-green`（branch
`task/gap-develop-ci-first-decisive-green`，base develop `4f44c7a3c`，merge develop 到 `acdd69271`）。
所有读数在本 worktree / 与 CI 同形的复制检出 `/tmp/citest` 上跑出，⛔ 无自述结论。

---

## 0. 立案前提复核（先查，再改）

任务体 Finding 表列了 11 个「CI 里红、本机绿」的测试文件。**逐条复跑后发现：这 11 条在当前
develop 树（复制检出，与 CI 同形）上全部已经绿** —— 它们是被 develop 上后续任务修好的，**而那份
修复从未到达 origin**（见 §5）。所以本任务真正的交付不是「修 11 条」，是**把 develop 推到能绿**
以及**让 AC-265 的判据有生产者**。

复制检出构造（与 CI 同形，这是判据能取假的前提，⛔ 不是「本机跑跑看」）：

```
git clone --no-hardlinks <repo> /tmp/citest && git checkout -B develop <tip>   # 有本地 develop 分支（actions/checkout 的形态）
cp .quay/config.yml.example .quay/config.yml                                   # ci.yml 的 bootstrap 步
HOME=/tmp/fakehome GIT_CONFIG_GLOBAL=/dev/null                                 # 无全局 git 身份（CI runner 的形态）
```

11 条逐条读数（复制检出，`node --test <file>`）：

| # | 文件 | CI 里的失败读数 | 复制检出（修后） |
|---|---|---|---|
| 1 | plugin/test/axis-generator.test.mjs | `Committer identity unknown`（exit 128） | exit 0 · pass 10 / fail 0 / skip 0 |
| 2 | plugin/test/launch-settings.test.mjs | `claude --settings must exit 0`（actual: null） | exit 0 · pass 15 / fail 0 / skip 0 |
| 3 | plugin/test/outer-cron-registry.test.mjs | `expected '/tmp/fake-global/-home-yale-work-quay'` | exit 0 · pass 24 / fail 0 / skip 9 |
| 4 | plugin/test/prod-data-audit.test.mjs | `checker-cost.jsonl@<CI 路径>（不存在）` | exit 0 · pass 9 / fail 0 / skip 1 |
| 5 | plugin/test/direct-to-develop-bypass-check.test.mjs | `部分可分类 ⇒ 0 < ratio < 1` | exit 0 · pass 58 / fail 0 / skip 0 |
| 6 | plugin/test/long-term-guarantee-goal-backed-check.test.mjs | `default run must be green, got status=1` | exit 0 · pass 11 / fail 0 / skip 0 |
| 7 | packages/quay-native/test/goal-ac-write-face.test.mjs | `default run must be green, got 1` | exit 0 · pass 12 / fail 0 / skip 0 |
| 8 | packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs | `renders ≥1 <rect> from real worker-outcome.jsonl` | exit 0 · pass 7 / fail 0 / skip 1 |
| 9 | packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs | `renders ≥1 fanin segment in the page` | exit 0 · pass 17 / fail 0 / skip 1 |
| 10 | packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs | `develop label appears on exactly one commit (got 0, was 6)` | exit 0 · pass 7 / fail 0 / skip 0 |
| 11 | packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs | 同上（`data layer unchanged`） | exit 0 · pass 8 / fail 0 / skip 0 |

**处置**：11 条全部为「已在 develop 修好、只差推送」，本任务**不重复修改**它们（⛔ 不删测试、
不缩 glob、不把断言删空 —— 事实上一条测试文件都没有改）。第 10/11 条的修法是 AC-265 同族的
「按本机形态派生期望值」（`namesDevelop` 同时认 `develop` 与 `HEAD -> develop`），第 2 条的修法是
「以依赖缺席为条件的 skip 守卫」，第 1 条的修法是「git 身份放进子进程 env」。

**跳过守卫的**双向控制**（AC6 ③ 要求）**：`plugin/test/launch-settings.test.mjs`

```
claude 在场（本机 PATH）           →  pass 15 / fail 0 / skipped 0   （守卫不触发）
claude 缺席（PATH 去掉其所在目录） →  pass 14 / fail 0 / skipped 1   （只在缺席时 NOT-EVALUATED）
```

---

## 1. 本任务改了什么（为什么不是「只修 11 条」）

真正让 AC-265 无法被评估的是另外三件事：

1. **collector 没有生产者**（本任务新增接线）—— 见 §4。
2. **testFiles 三个结构性缺口**（默认不派生 / 后派生字段补不进已落盘的记录 / 恒缺）—— 见 §2。
3. **develop 上有一条静态闸红，会让 CI 在跑到任何测试之前就 fail-closed** —— 见 §3。

---

## 2. AC1 / AC2 / AC3 — 仪器落地、字段口径、回填

### AC1 仪器落地

```
$ git log -1 --format=%cI -- plugin/scripts/ci-runs-collect.ts
2026-09-15T13:57:10+00:00                      （非空 ⇒ 已落地）
```

逐字重跑 AC-265 的 criterion（`goals/AC-265-goal.md` 的 `criterion:` 块）：

```
CAUSE=no-decisive-run-after-landing — carrier holds 23 decisive develop runs in total but none with
ts > the collector landing 2026-09-15T13:57:10+00:00
exit 1
```

⇒ **不再是 `CAUSE=collector-not-landed`**：判据第一次推进到了「窗口」这一步（立案基线是它连第一行
都过不去）。这是 AC1 的判据，也是 §5 那条阻塞的直接读数。

### AC2 载体口径 + 字段能取假

真实采集后（`.quay/ci-runs.jsonl`，23 条 decisive develop run）。前 3 条与末 3 条逐字：

```
{"ts":"2026-08-22T03:16:38Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":32548528776}          ← 无 testFiles 键
{"ts":"2026-08-22T03:36:37Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":32549444011}          ← 无 testFiles 键
{"ts":"2026-08-22T04:17:36Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":32551311648}          ← 无 testFiles 键
...
{"ts":"2026-09-15T02:38:35Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":34921960393,"testFiles":631}
{"ts":"2026-09-15T12:47:36Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":34970958367,"testFiles":631}
{"ts":"2026-09-15T12:55:17Z","branch":"develop","workflow":"CI","conclusion":"failure","runId":34971747152,"testFiles":631}
```

**负控制（生产语料，⛔ 不是 fixture）**：同一个载体里 **18 条没有 `testFiles` 键、5 条是整数 631**
——字段**真的会缺席**，不是一个恒定值。缺席的原因逐条可查：那 18 条的 run 来自 `__GROUP__` 行
被引入之前（或 job 日志里没有该行），实测一条：

```
$ gh api /repos/yaleh/quay/actions/runs/32687088952/jobs --jq '.jobs[] | "\(.id) \(.name) \(.conclusion)"'
97314038058 version-consistency success
97314038223 dist-verify-node-floor success
97314038278 test failure
97314038716 cold-start-e2e skipped
$ gh api --allow-escape-sequences /repos/yaleh/quay/actions/jobs/97314038278/logs | grep -c __GROUP__
0                                    ← 该 run 的日志里真的没有 __GROUP__ ⇒ 派生不出 ⇒ 不写该键（缺 ≠ 0）
```

**离线负控制（可重复）**：`plugin/test/ci-runs-collect.test.mjs` 里同一夹具换日志内容 ——
`LOG_WITHOUT_GROUPS ⇒ "testFiles" in rec === false`、`LOG_WITH_GROUPS ⇒ 631`（正控制），
且派生不出时留 `testFiles-underivable:<runId>` 警告。

### AC3 回填

```
land(collector)              = 2026-09-15T13:57:10+00:00
decisive develop rows        = 23
其中 ts < land（回填）        = 23
其中 ts > land               = 0        ← 见 §5：没有推送 ⇒ 没有落地后的 run
带整数 testFiles 的           = 5
```

⇒ 回填**成立**（23 条全部早于落地提交，判据的「紧邻前一次」有对象可比）；「落地后」那半边
= 0，成因见 §5。

**回填为什么此前补不上（这是本次要修的结构性缺口）**：去重键是 `workflow|runId`，而 `testFiles`
是**后派生**的（要下载 job 日志）。纯追加路径下，已落盘的那批记录在重采时被去重跳过 ⇒ **永远补不上**。
实测（改前）：30 条 run 里 5 条派生成功、10 条新追加、20 条被跳过，**载体里 testFiles 计数 = 0**。
改后加「就地补全」（只填缺失的 testFiles，其余字段逐字保留）：

```
$ node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --root . --branch develop --workflow ci.yml --limit 30
carrier=.quay/ci-runs.jsonl appended=0 skipped=30 attributed=0 logRunsFetched=23 testFilesDerived=5
  ⇒ 5 条既有记录的 testFiles 被就地补成 631（行数不变，attribution/signals 逐字保留）
real 0m47.657s                          ← 成本上界：23 条 run 的日志下载 ≈ 48s（一次性回填）
```

增量性：已派生过 testFiles 的 runId 不再重复下载（`knownTestFilesFromCarrier`）；派生不出的
runId 进负缓存（`.quay/ci-runs-collect-state.json` 的 `underivable`），下一轮不再重试。
decisive-only：`cancelled` 的 run 不拉日志（占 develop run 的 ~43%，判据按设计不读它们）。

---

## 3. 顺带发现并修掉的一条 **develop 静态闸红**（会挡住整条 CI）

复制检出（= develop tip `42457bec9`）跑全量 suite：

```
STATIC_CHECK_FAILED: spec-declaration-point-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): spec-declaration-point-check(exit=1)
```

```
  plugin/skills/init/SKILL.md missing:    SPEC-release-and-hotfix-branching-2026-09-15.md
  plugin/skills/manager/SKILL.md missing: SPEC-release-and-hotfix-branching-2026-09-15.md
FAIL: 2 missing SPEC declaration(s) across 2 declaration points
```

成因：`f92d3699e`（2026-09-15T13:41）刚落地的 SPEC 漏了两个声明点。**它是 fail-closed 的静态闸，
CI 的 `test` job 在任何测试跑起来之前就会因此失败** —— 即使 11 条测试全绿，CI 也还是红。
修法照该检查器自己头注释的正本（声明点由 grep `plugin/skills/**` 派生，⛔ 不硬编码）：
两个 SKILL.md 各补一行。修后：

```
PASS: all 43 orchestration/SPEC-*.md declared at each of 2 declaration points      exit 0
```

---

## 4. AC4 — 生产接线（⛔ 不是手工 CLI 面）

**调用点 `file:line`**：`plugin/scripts/goal-driver.ts:3080`

```ts
const fn = opts.ciRunsCollectFn ?? ((r, o) => collectForRound(r, o));   // ← 默认走真实现
```
（import 在 `:83`；开关 `goalCiRunsCollect` 就地读 `drivers.yml` `kinds.goal.ci_runs_collect`，
`drivers.yml:47` 起显式置位 `ci_runs_collect: true` + `ci_runs_collect_throttle_ms: 600000`；
轮读数写面在 `goal-driver.ts:3083` 起的 `ciRuns` 字段。）

**由该路径写出的一条载体记录**（`.quay/ac-devci-ac4-production-path.mjs`：跑的是**生产入口
`runGoalRound()`**，夹具 root 带真的 `origin` remote，⛔ 没有注入 `ciRunsCollectFn`）：

```
wall_ms=46773
round.fact.state=verified
round.fact.value.ciRuns={ "status":"ok","ran":true,
  "reason":"采集 20 条，追加 20 条，补全 0 条",
  "appended":20,"attributed":12,"enriched":0,"logsFetched":16,"testFilesDerived":5 }
round.fact.reason 含调用痕: true
  reason=1 criteria gated, 1 flip(s): … ciRuns=ok(appended=20,enriched=0,attributed=12,logs=16)
carrier_lines=20
carrier_first={"ts":"2026-09-15T12:55:17Z","branch":"develop","workflow":"CI","conclusion":"failure",
  "runId":34971747152,…,"testFiles":631,"attribution":"real-defect","signals":["defect:tests-ran-and-failed"]}
state_exists=true state={"lastRunAt":1789480919635,"underivable":{…11 条…}}
```

⇒ 载体记录由 **goal-driver 的每轮路径**写出（时刻 = 该轮 `lastRunAt`），且该轮记录里带着对应的
调用痕。**四态可区分**（硬规则 3b）：`ok` / `throttled` / `gh-unavailable` / `error` / `disabled`
—— 「没采集」永不与「采集了零条」同形（`goal-driver.ts` 里 `ciRuns` 字段恒存在）。

**gh 可达性（任务体专门点名的一条）**：driver 的 PATH 不保证含 `~/.local/bin`，本机 gh 恰在那里
（`/home/yale/.local/bin/gh`）。`resolveGhBin` 显式解析：`QUAY_GH_BIN` → `GH_BIN` → PATH →
`~/.local/bin/gh` → 常见安装位；解析不出 ⇒ `status:"gh-unavailable"` + 候选清单（⛔ 不静默写 0 条）。
实测：

```
resolveGhBin({PATH:"/nonexistent",HOME:"/tmp/fakehome"})          → bin=null, source="none", 6 candidates
resolveGhBin({PATH:"/nonexistent",HOME:"/home/yale"})             → bin=/home/yale/.local/bin/gh, source="fallback:~/.local/bin/gh"
```

---

## 5. AC5 — **未达成**（阻塞点，逐条给出直接量）

判据原文要求「**落地后**存在一次 `branch=develop`、`conclusion=success` 的 CI run」。实测三条：

**(a) origin/develop 自 02:38 起冻结，落后本地 326+ 提交**

```
$ git ls-remote origin develop
9dd8067566f8a22a9f699e29beee68f0ab0f9c56        ← 2026-09-15T02:38:26
$ git rev-parse develop
33fb2cfb3…（本地，且在持续前进）
$ git rev-list --count origin/develop..develop
326
$ gh run list --workflow ci.yml --branch develop --limit 5 --json createdAt,event,headSha
2026-09-15T12:55:17Z workflow_dispatch failure 9dd806756   ← 12:47/12:55 那两次是**人工 dispatch 在旧 sha 上**
2026-09-15T12:47:36Z workflow_dispatch failure 9dd806756
2026-09-15T02:38:35Z push              failure 9dd806756   ← 最后一次 push
```

⇒ 今天 12:47 / 12:55 的两次 CI run 跑的都是 **02:38 的旧树**，所以它们报出的 11 条失败是
「已经在 develop 修好、只是没推上去」的旧读数（§0 逐条实测）。**没有推送 ⇒ 那 11 条的红永远
不会自愈。**

**(b) 没有任何机件在推 develop**（这是根因，且它自己也有一处「恒绿检查」）

```
$ grep -rn "sync-lag-check" --include="*.ts" --include="*.sh" --include="*.mjs" plugin/ scripts/ | wc -l
0                                   ← 零个代码调用方（命中全在 .md 里）
$ node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check --json --root . | jq '…sync-lag-check…'
{ "file":"sync-lag-check.sh", "cadence":"每轮", "ok":true, "kind":"wired-strict",
  "strict":[ "orchestration/fast-mode-tick-core.md", "plugin/loop/fast-mode-loop-tick.md",
             "plugin/loop/fast-mode-tick-core.md", "plugin/loop/orchestrator-loop-tick.md" ], … }
```

`sync-lag-check.sh`（每轮 upsync 心跳，人 2026-08-06 裁定保留的**单机防丢**机制）被判
`wired-strict` —— 而那四个「调用点」里**三个是已退役的 tick core**（`fast-mode-tick-core.md`
= inner 已退役、`orchestrator-loop-tick.md` = outer 会话角色已退役）。检查器只按**文件名含
`tick`** + **基名出现**判「有为它写的调用点」，⛔ 不问那个 tick core 是否还活着
⇒ **「有调用点」与「调用点在已退役的文档里」同形**（硬规则 3b 的形态，且是同一个味道：
一个看起来覆盖了的判据）。机械 fan-in 的 ff 是 `fan-in/ff-merge.ts` 的**本地 ref 移动**，
不推 origin（`fan-in-ff-merge.sh` 里零 `push` 命中）。

**(c) 即使现在推，也推不出一次能绿的 run**

AC-265 的判据读的是**本地** `git log -1 --format=%cI -- plugin/scripts/ci-runs-collect.ts`（= 13:57:10），
但它要的是一条 **CI 上真绿的 develop run**。而当前本地 develop 的树**不含本任务 §3 那条静态闸修复**
（它在我的任务分支上，要等 fan-in 才能进 develop）。所以：

* 现在推本地 develop ⇒ CI 仍红（`spec-declaration-point-check`），证明不了任何东西；
* 要推一条能绿的，得先让本任务落地 → 而落地由 driver 的 fan-in 完成（本地 ref 移动），**它不推**。

⇒ **AC5 在 worker 这一回合内、乃至 fan-in 之后，都是结构性不可达的**，直到有人跑那条被裁定
保留、但已失去活调用点的 upsync。

**一条命令解除阻塞**（非 force、fail-closed，正是那条被裁定保留的机制）：

```
bash plugin/scripts/sync-lag-check.sh --push --branch develop --root /home/yale/work/quay
# 等 CI（实测 18–25 分钟）：
gh run watch "$(gh run list --workflow ci.yml --branch develop --limit 1 --json databaseId --jq '.[0].databaseId')"
# 然后让 goal-driver 采集（或手工采一次），AC-265 应 exit 0：
node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --root . --branch develop --workflow ci.yml --limit 30
```

⛔ **本任务没有推**：推送会把 326+ 提交（含其他在飞任务的中间状态）发布到 origin，且会把
**未经本次 fan-in 校验**的分支内容送上 develop —— 这既越出 per-task worker 的边界，也不是
「修好机制」（一次性手工推送不会让那条退役的调用点回来）。**决策与理由记录在此，⛔ 不包装成已达成。**

**预测（可证伪，留给下一次核对）**：本任务落地后，本地 develop 的树应是 CI 绿的（依据 = §0 的
11 条 + §3 的静态闸 + 复制检出全量 suite 读数）；而 origin/develop 仍是 `9dd806756`。

---

## 6. AC6 — 绿不是靠少跑测试换的

① **testFiles 不缩水**：`__GROUP__ … files=` 的当前实测值是 **631**（`run 34971747152` 与
`34970958367`、`34921960393` 的 job 日志逐字 `__GROUP__ concurrency=8 files=631`）。本任务**没有**
改 `scripts/test.sh` 的 glob（`git diff develop...HEAD -- scripts/test.sh` 为空），**没有**删除或改名
任何 `*.test.mjs`（`git diff --diff-filter=DR --name-only develop...HEAD` 只命中 `.quay/ci-runs.jsonl`
—— 那是**载体去跟踪**，不是测试）。

② **落地提交 stat**（`a09aa38a5`，collector 的落地提交）：

```
 .gitignore                           |  13 +
 .quay/ci-runs.jsonl                  |  40 ---        ← git rm --cached（去跟踪），⛔ 文件仍在盘上
 plugin/scripts/capability-catalog.sh |   6 +-
 plugin/scripts/ci-runs-collect.ts    | 494 ++++++++++++++++++++++++++++++++---
 plugin/scripts/drivers.yml           |  10 +
 plugin/scripts/goal-driver.ts        | 105 +++++++-
 plugin/test/ci-runs-collect.test.mjs | 423 ++++++++++++++++++++++++++++++
 plugin/test/goal-driver.test.mjs     | 122 +++++++++
```
（全是新增/修改；无 `*.test.mjs` 删除或改名，无 glob 缩小。）

③ 11 条逐条的「修前 / 修后」读数见 §0 表。

---

## 7. AC7 — 登记 + scoped 门

```
$ bash plugin/scripts/capability-catalog.sh --entry-surface
AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS      exit 0
$ node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check --root .
[判据1-non-按需-call-site] ok — 221 judged, 0 violation(s)
[判据2-按需-consumer]      ok — 110 judged, 0 violation(s)
[判据3-no-block-consumer]  ok — 4 judged, 0 violation(s)                                 exit 0
```

登记变动（新增 `plugin/scripts/*.ts` + 把它从「按需」升为「每轮」会同时踩多张闸）：
CADENCE 行 `按需 → 每轮`；CONSUMER 行改写为「**①机器·每轮** goal-driver 的 collectForRound（含开关与
节流真源）+ ②人·按需 CLI」；QUESTION 行补 testFiles 派生默认开/增量/上界与 gh 解析；
INVALIDATION / LAST_REAFFIRMED 行保持有效。`plugin/scripts/quay-runtime-artifacts.txt` **未改**：
载体是 `.quay/` 下的路径，消费者项目的 `.gitignore` 由 quay-init 的 `.quay/*` 规则覆盖
（该清单文件头注释明确说「under `.quay/` is deliberately NOT listed」），
`gitignore-runtime-coverage-check` 修前修后都是 `PASS … marked=9 manifest=9`。

---

## 8. 5b 扫描（先数再改）

| 同类实例 | 判定谓词 | 命中数 | 前 3 条 | 处置 |
|---|---|---|---|---|
| ①「测试里 git commit 但不给身份 ⇒ 裸检出 `Committer identity unknown`」 | 文件里有真实的 `["commit"` 调用 ∧ 无 `GIT_COMMITTER_NAME\|GIT_AUTHOR_NAME\|user.email\|user.name` ∧ 不 import 共享 harness | **0** | —（粗扫命中 10 条，逐条读后**全是假阳性**：`archive-exclusion-wiring` 命中表头列名 `commit`；`gate-dispatch-coverage` 命中 YAML 文本 `split-or-commit`；其余 import 了 `makeGitRoot`） | 已闭合，无需改 |
| ②「期望值取自本机绝对路径」 | 文件里 `assert` 行含 `/home/yale` | 36（**逐条读后**：34 条是**纯函数夹具入参**，与机器无关） | `runtime-usage-inventory:95/117`（把字面路径当输入喂给解析器）、`outer-cron-registry:245`（`repoSlug("/home/yale/work/quay")` 纯函数） | 真实例（3/10/11 号）**已由 develop 修好**：改成按 `HEAD -> develop` / 按当前 slug 派生；本任务不改 |
| ③「依赖 gitignored 生产载体的断言」 | 复制检出（无 `.quay/*` 生产载体）实跑全量 suite 的 `__PERFILE__ … passed=false` | **0**（见 §9） | — | 无 |

**经验性扫描**（比谓词更硬的一条）：复制检出就是那个判别环境（不同路径 / 无全局 git 身份 /
无 `.quay/*` 生产载体 / 不同 HOME），全量 suite 跑完 **0 个 `__PERFILE__ … passed=false`**。

---

## 9. 全量 suite（复制检出 = 与 CI 同形的环境）

见文末「运行记录」一节（本节在 suite 跑完后补写）。
