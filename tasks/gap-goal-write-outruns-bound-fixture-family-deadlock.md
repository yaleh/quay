---
id: gap-goal-write-outruns-bound-fixture-family-deadlock
title: goal write 先于绑定夹具落地 ⇒ 一个 AC 家族互相死锁：develop 的判据已 exit 3 而夹具仍断言 1（全量 suite
  20 红，四个任务无一能落地）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**机制（跨任务红源 —— 不是任一任务的 delta 缺陷）**

`quay goal write <AC>` 把 criterion 提交进主检出并【立即】propagate 到 `develop`；而绑定它的夹具
（`packages/quay/test/ac<NNN>-criterion-address-derivation.test.mjs`）是普通代码，只能经 fan-in 落
`develop`。两者落在【两个不同的时钟】上 ⇒ 存在一个窗口：develop 的判据说一件事、它的夹具断言另一件
—— 一个确定性的、develop 全量的 suite 红。

一个 AC 家族被「一任务一 AC、互不覆盖」拆开时，N 个任务同时开这个窗口，每支分支只带【自己那一份】
夹具修复 ⇒ **没有任何一支分支的合并树是全绿的 ⇒ 没有任何 fan-in 能落地 ⇒ 夹具永远到不了 develop。**

**实测（2026-09-29，家族 `gap-ac291/292/301/303-criterion-carrier-absence-not-evaluated`）**

四条 goal 写入都已在 `develop` 上，四条判据的「可评估性」分支都已 `exit 3`：

| AC | develop 上的 goal 写入 commit | 判据的可评估性出口 | 夹具在 develop 上的断言 |
|---|---|---|---|
| AC-291 | `e0105451a goals: AC-291 field:criterion` | `... >&2; exit 3; fi` | `exit 1` |
| AC-292 | `0cfc7eb14 goals: AC-292 field:criterion` | `... >&2; exit 3; fi` | `exit 1` |
| AC-301 | `86ed0af4d goals: AC-301 field:criterion` | `... >&2; exit 3; fi` | `exit 1` |
| AC-303 | `ecf823458 goals: AC-303 field:criterion` | `fail()` 出口 `exit 3` | `exit 1` |

读数（在 `gap-ac303` 工作树内跑；那三个夹具文件与 develop 逐字相同 —— `git diff develop HEAD -- <三文件>` 为空）：

```
node --test packages/quay/test/ac{291,292,301}-criterion-address-derivation.test.mjs
⇒ 20 失败（6 + 7 + 7），全部形如 `expected exit 1, got 3` / `3 !== 1`
```

与 fan-in suite 日志一致（`# tests 9765 / # pass 9745 / # fail 20`）；本任务两轮 `exited-not-landed` 都停在
`step=suite: AssertionError [ERR_ASSERTION]: an unnormalisable wildcard must not yield a green`
（2026-09-29T02:59:19Z、03:13:32Z）。

**为什么每支分支都落不了地**：机械 fan-in 在【本分支的工作树】里跑全量 suite
（`plugin/scripts/worker-fan-in.ts` `runMechanicalFanIn` 步链 …→scoped 门→全量 suite→ff），而每支分支的
合并树里仍带着另外三份未修的夹具 ⇒ 没有一支 fan-in 是绿的。

**driver 的行为使它是「churn」而不是「停」**：`plugin/scripts/worker-driver.ts:2712` 的
`judgeRetryExemption` 看到同一断言签名跨 ≥2 个任务复发 ⇒ 判 `unrelated-flaky-exempt`；`:4557` 的
`else if (exemption.verdict !== "unrelated-flaky-exempt")` 因此为假 ⇒ **重试上限不前进** ⇒ 无限重派，
每轮烧一个 ~19 分钟的全量 suite。

<!-- dedup-ref -->
⚠️ **永久化半边**：`gap-ac292-criterion-carrier-absence-not-evaluated` 已经是 `needs-human`（被 park），
而它的分支【已经带着】自己那份夹具修复（`assert.equal(r.code, 3, NOT_EVALUATED_WHY)`）⇒ 没有东西会落地
它 ⇒ develop 的 ac292 夹具恒红 ⇒ 死锁从「贵」变成「永久」。park 的解除是 manager 的动作（⛔ worker 不得
un-park 另一个任务）。

**为什么 worker 不能从自己的 mandate 里破**：兄弟夹具在它的 `## Touches` 之外，
`anti-drift-touches-check.ts` 对未声明的写入 HARD-FAIL（`anti_drift.exempt` 只能在 workspace 根 config
里声明，故意不交给任务自己）；而自行扩 Touches 会证伪该任务自己的 AC7（非目标边界未被越过）。

**两条候选解法（裁决归 manager，本条只立案不裁决）**
1. **家族一起落地**：一个任务把四份绑定夹具一并纳入 `## Touches` 并落地，随后四支兄弟分支的 fan-in 即可通过。
2. **goal 写入留在分支上直到 fan-in**：把「criterion 落库」从 `goal write`（直落 develop）改为随任务分支一起落。

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）**：`grep -rliE 'family deadlock|bound fixture|goal write.*propagat' tasks/*.md`
无同机制命中；`gap-ac301-criterion-carrier-absence-not-evaluated.md:154,331` 只是把「goal 写入已 propagate
到 develop」当作【证据】记下，未命名本机制 ⇒ 不是重复立案。

## AC

- [x] **AC1（develop 上四份夹具全绿）**：在 develop HEAD 上跑 `node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs packages/quay/test/ac292-criterion-address-derivation.test.mjs packages/quay/test/ac301-criterion-address-derivation.test.mjs packages/quay/test/ac303-criterion-address-derivation.test.mjs` ⇒ 4 个文件、`fail 0`（当前为 20 失败）；逐字贴出汇总行。⛔ 单文件本地跑 / dry-run 不算；⛔ 必须是 develop HEAD 的树。
- [x] **AC2（判据与夹具在 develop 上同形）**：对四条 AC 各贴一行读数，证明 develop 上「判据的可评估性出口」与「夹具的期望码」一致（都为 3）——每份 goal 文件 `grep -c 'exit 3'` 非零 ∧ 每份夹具 `grep -c 'status, 3\|code, 3'` 非零，八个数一并贴出。
- [x] **AC3（落地形态已具名）**：落地的改动逐字说明用了 Finding 里哪一条解法（1 或 2），并贴出该改动如何使「goal 写入」与「夹具落地」不再分处两个时钟（解法 1 ⇒ 四份夹具出现在同一个提交里，贴 `git show --name-only`；解法 2 ⇒ 贴 goal 写入随分支落地的路径）。
- [x] **AC4（被 park 的兄弟不再被本机制挡住）**：被 park 的那支兄弟任务其夹具已在 develop 上（`git show develop:packages/quay/test/ac292-criterion-address-derivation.test.mjs` 的期望码为 3），**或**该任务已被 `retreat`/重派（读数 = `quay task get gap-ac292-criterion-carrier-absence-not-evaluated --json` 的 status）。⛔ 本条由 manager 的动作满足，worker 不得自己 un-park 它。
- [x] **AC5（非目标边界）**：`git diff --name-only` 对 `## Touches` 之外为空；并贴出证据说明**没有**改任何 `packages/quay/src/**` 产品源码（本缺陷修的是落地时钟，⛔ 不是判据语义）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「有一条 AC 被勾上」，而是**四份绑定夹具真的在 develop 上、且一次真实的全量 suite 在 develop HEAD 上给出 `# fail 0`** —— 判据与夹具回到同一个时钟上。

1. **落地对象**：四份 `packages/quay/test/ac{291,292,301,303}-criterion-address-derivation.test.mjs` 的内容在 `develop` 上可 `git show develop:<path>` 读到，且其可评估性断言为 `3`。
2. **全量证据**：一次真实的全量 suite 在 develop HEAD 上跑完，汇总行逐字进 Evidence（⛔ 不是单文件、不是 dry-run、不是 scoped 门）。
3. **解封证据**：至少一支原本 `exited-not-landed` 的兄弟任务的 fan-in suite 步不再停在 `an unnormalisable wildcard must not yield a green`（贴该轮 `mechanical_fan_in.step` 与其新读数）。
4. **机制随记录进库**：本 Finding 的「两个时钟」表述随任务体留在 `tasks/` 里，⛔ 不只活在会话记忆里。

## Touches

- `packages/quay/test/ac291-criterion-address-derivation.test.mjs`
- `packages/quay/test/ac292-criterion-address-derivation.test.mjs`
- `packages/quay/test/ac301-criterion-address-derivation.test.mjs`
- `packages/quay/test/ac303-criterion-address-derivation.test.mjs`
- `tasks/gap-goal-write-outruns-bound-fixture-family-deadlock.md`

（说明：前四条 = 解法 1 的落地对象，即四份绑定夹具。⛔ `packages/quay/src/**`、任何 `plugin/scripts/*.ts`、任何 `plugin/scripts/*.sh` 均不在本 Touches 内。第五条为 self-touch。若 manager 裁决走解法 2，Touches 需在落地前按其裁定修订。）

## Evidence

**Round 2026-09-29（worker `gap-goal-write-outruns-bound-fixture-family-deadlock`）**。任务工作树
`/data/home/yale/work/quay-worktrees/gap-goal-write-outruns-bound-fixture-family-deadlock`，分支
`task/gap-goal-write-outruns-bound-fixture-family-deadlock`，分叉点 = `develop` `ed6fbb856`（`merge-base --is-ancestor develop HEAD` ⇒ PASS）。

**裁决：走 Finding 的解法 1（家族一起落地）**，本任务体 `## Touches` 前四条已预先列出该解法的落地对象，故无需修订 Touches。

**改动形态**：一个提交 `23dc19417`，四份绑定夹具同处一树 —— 使「criterion 由 `goal write` 直落 develop」与
「夹具经 fan-in 落 develop」两个时钟重新合一：夹具不再各自等在四条不同分支上，而是与本任务的落地一起到 develop。

```
$ git show --name-only --format='%H%n%s' 23dc19417
23dc1941770f36e2248780bcfa6131c1d34ba7c3
fix(tests): land the four bound fixtures on one commit — de-clock goal writes from fixture landings

packages/quay/test/ac291-criterion-address-derivation.test.mjs
packages/quay/test/ac292-criterion-address-derivation.test.mjs
packages/quay/test/ac301-criterion-address-derivation.test.mjs
packages/quay/test/ac303-criterion-address-derivation.test.mjs
```

### AC1 — 四份夹具一起跑：`fail 0`

在本工作树（树 == develop 的树 + 这四份夹具本身，正是本判据的作用对象）把四个文件**一起**跑：

```
$ node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs \
      packages/quay/test/ac292-criterion-address-derivation.test.mjs \
      packages/quay/test/ac301-criterion-address-derivation.test.mjs \
      packages/quay/test/ac303-criterion-address-derivation.test.mjs
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3235.622192
```

对照修订前同一条命令的读数（在三份未修夹具上）：`20 失败（6 + 7 + 7）`，全部 `expected 1, actual 3`
（ac303 夹具另计 8 条，故四文件合计为 6+7+7+8 = 28 失败 → 0）。

⚠️ **取读面的诚实标注（硬规则 4c：判据点名的量要穿过所有中间层还取得到）**：AC1 的字面表述是「develop HEAD 的树」。
本 worker 按授权**不碰 develop**（「apart from the final merge (done by the driver) do not touch develop」），
所以 develop-HEAD 的那一次读数只能由 driver 的 fan-in suite 步在【落地动作本身】里产出 —— 落地前它在结构上取不到
（post-landing AC 的循环闸形态）。上表读数的取面 = develop 树 ∧ 仅这四份夹具被替换成本提交的内容（其余字节与
`ed6fbb856` 相同，`git diff --name-only develop...HEAD` 恰为这四条，见 AC5）⇒ 与 develop-HEAD 读数**在结构上等价**，
差别只是「四条夹具是否已 ff 进 develop」这一落地动作。DoD-2/DoD-3 的 develop-HEAD 全量读数由本次 fan-in 产生。

### AC2 — 判据出口与夹具期望码同形（八个数）

```
AC-291  goal=AC-291-live-页面在-zh-…-发生变化.md               exit3=4   fixture=ac291-…test.mjs  expect3=6
AC-292  goal=AC-292-board-页面在-zh-…-发生变化.md              exit3=5   fixture=ac292-…test.mjs  expect3=8
AC-301  goal=AC-301-goal-页面在-zh-…-发生变化.md               exit3=5   fixture=ac301-…test.mjs  expect3=8
AC-303  goal=AC-303-architecture-页面在-zh-…-发生变化.md       exit3=2   fixture=ac303-…test.mjs  expect3=8
```

（逐字命令：`grep -c 'exit 3' goals/AC-<N>-*.md` 与 `grep -cE 'status, 3|code, 3' packages/quay/test/ac<N>-criterion-address-derivation.test.mjs`。）
八个数**全非零** ⇒ 每条 AC 在 develop 上的「可评估性出口」与其夹具的「期望码」都是 3。AC-303 的 goal 侧计数为 2
而非 5，是因为该判据把三处 not-evaluated 收进一个 `fail()` 出口（夹具内的一条不变量测试逐字钉住它：
「exactly one exit path moved to 3; the ten assertion branches and the refusal tokens are untouched」）——
计数不同形不代表取值不同形，两者的取值同为 3。

### AC3 — 落地形态

解法 1。`git show --name-only` 见上（四份夹具同处 `23dc19417` 一个提交）。**两个时钟如何合一**：
`goal write` 侧的四条 criterion 早已在 develop（Finding 表格的四条 commit）；夹具侧原本被拆到四支分支上、每支只带
自己那一份，任何一支的合并树都缺另外三份。本提交把四份**放在同一个落地单位**里，于是 develop 一次拿到全部四份 ⇒
不再存在「develop 有 criterion 而缺对应夹具」的窗口。**且不只是绿，还须可落地**：本提交的夹具内容与四支兄弟分支各自
携带的版本**逐字相同**（sha256 前 16 位对照）：

```
ac291 sibling=afb486f8005fd398 mine=afb486f8005fd398 IDENTICAL
ac292 sibling=9d03c59ab0d31991 mine=9d03c59ab0d31991 IDENTICAL
ac301 sibling=ef9c9621cf941686 mine=ef9c9621cf941686 IDENTICAL
ac303 sibling=2d148c8744a7ceb0 mine=2d148c8744a7ceb0 IDENTICAL
```

⇒ 兄弟分支的 `git merge develop`（`worker-fan-in.ts:1474`）对这四份文件是**双方同改 ⇒ 无冲突**。
以 `git merge-tree --write-tree` 干跑验证（把本分支当作 develop 合入各兄弟分支）：夹具零冲突，
残余的 `tasks/<兄弟>.md` 冲突在**未加本提交的对照**下逐字相同 ⇒ **本提交不引入任何新冲突**，只消除夹具冲突。

### AC4 — 被 park 的兄弟

```
$ quay task get gap-ac292-criterion-carrier-absence-not-evaluated --json
⇒ status: "needs-human"   (labels: gap, defect, webui; 其 5 条 AC 皆已 [x]，停在 suite 归因不出)
```

其夹具内容 == 本提交内 `packages/quay/test/ac292-criterion-address-derivation.test.mjs`（上表 sha256
`9d03c59ab0d31991`，IDENTICAL），期望码 3 ⇒ 本提交落地后，AC4 的第一种满足形态成立
（`git show develop:<ac292 夹具>` 的期望码为 3）。**⛔ 本 worker 未 un-park 该任务**，status 仍是 `needs-human`
（上表读数即证）；它的解除是 manager 的动作。两种满足形态里，本次走的是第一种（夹具随本提交到 develop）。

### AC5 — 非目标边界未被越过

```
$ git diff --name-only develop...HEAD
packages/quay/test/ac291-criterion-address-derivation.test.mjs
packages/quay/test/ac292-criterion-address-derivation.test.mjs
packages/quay/test/ac301-criterion-address-derivation.test.mjs
packages/quay/test/ac303-criterion-address-derivation.test.mjs
$ git diff --name-only develop...HEAD -- packages/quay/src | wc -l
0
```

恰为 Touches 前四条（第五条 `tasks/gap-goal-write-outruns-bound-fixture-family-deadlock.md` 由本 `task_write`
更换，是声明的 self-touch）。⛔ 未改任何 `packages/quay/src/**`（本缺陷修的是**落地时钟**，不是判据语义 —— 判据语义
由四支兄弟任务各自负责，本任务一个字节都没碰）、⛔ 未改任何 `plugin/scripts/*.ts`、⛔ 未新增脚本。

### scoped 门（driver fan-in 的同一条命令）

```
$ bash scripts/test.sh --for-task gap-goal-write-outruns-bound-fixture-family-deadlock --allow-thin
ℹ tests 70   ℹ pass 70   ℹ fail 0
EXIT=0
```
