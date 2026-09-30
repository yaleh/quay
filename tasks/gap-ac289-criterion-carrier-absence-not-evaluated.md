---
id: gap-ac289-criterion-carrier-absence-not-evaluated
title: AC-289 判据把「地址不可派生」记成「此刻为假」——三个不可评估分支（no-running-serve-instance /
  no-derivable-serve-address / no-reachable-serve-address）以 exit 1
  出声，违反仓库约定（exit 3 = NOT-EVALUATED，acceptance-runner.ts 的 verdictFromAcceptance
  把 code 3 映成 not-evaluated/declared）⇒ driver 每轮把它当 confirmed-failing
  立案；修法=三条分支改 exit 3 + 夹具负例同步 + 活实例上真 pass
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-289
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30T08:21:58.243Z，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json
⇒ {"id":"AC-289","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — CAUSE=no-derivable-serve-address -- 2 quay.ts serve candidate(s)
             with cwd=/data/home/yale/work/quay, none yielded a derivable address; per-candidate readings:;
             pid=614998 addr=<none> cause=carrier-helper-unavailable(exit=1);
             pid=1709183 addr=<none> cause=carrier-helper-unavailable(exit=1)",
   "timestamp":"2026-09-30T08:21:58.243Z","dryRun":true}
GATE_EXIT=1
```

### 判据文本搬了家，不是产品退化了（台账两侧，同一个 AC）

| 时刻 | actor | `criterionHash` | verdict |
|---|---|---|---|
| 2026-09-30T02:33Z → T07:57Z（**6 连**） | goal-sweep | `4eb0f39c780536d6` | **pass** |
| 2026-09-30T08:12:30.822Z | goal-amend | `7300befd0a9d1321` | **fail** |
| 2026-09-30T08:15:32.046Z | goal-cli | （goal gate 事件不带指纹） | fail |

⇒ 同一条判据、同一个活载体：**改文本前 6 连绿，`goal-amend` 换文本后立刻红**（`08:12Z` = 本地 `16:12`，正是 `goals: AC-30x field:criterion` 那一批 `goal write` 中的一条，`b0456ddd3` 前后）。变的是**判据文本**，不是承载体。

### 产品保证实测为真（直接量，⛔ 非转述）

对**运行中的** `quay.ts serve`（pid 1709183，cwd = 仓库根；`.quay/server.json` 的 web 条目 = `172.28.0.1:20119`，`pid` 与该进程相同）：

```
(0) html lang   : en <html lang="en"    /  zh <html lang="zh"
(1) nav 区块    : en "Dashboard" ×2     /  zh ×0
    nav 当前项  : en <span class="nav-item nav-current" aria-current="page">Dashboard</span>
                  zh <span class="nav-item nav-current" aria-current="page">仪表盘</span>
(2) 本页 title  : en <title>quay — Dashboard</title>   /  zh <title>quay — 仪表盘</title>
```

⇒ AC-289 的四个断言（nav 当前项 / 本页 `<title>` / `<html lang>` / en 基线）在真实服务上**全部成立**。⇒ 本任务**不是**页面退化，⛔ 不动 `packages/quay/src/serve-*.ts`。

### 唯一的失败步：地址派生调用了一个**仓库里并不存在**的文件

```
$ test -f plugin/scripts/live-web-address.ts          → No such file
$ git show develop:plugin/scripts/live-web-address.ts → does not exist in 'develop'
```

生产 serve 是**内核分配端口**启动的（argv 无 `--port`）⇒ 判据的 cmdline 派生分支为空 ⇒ 该助手是唯一路径 ⇒ 它的缺席让判据**结构上恒假**（与产品行为无关）。助手只活在 in-flight 分支 `task/gap-criterion-live-web-address-derivation-17-copies-to-one`（`424123de7`，179 行）；实测它对**真实载体**返回 `172.28.0.1:20119`、exit 0，与 `.quay/server.json` 的 web 条目逐字相同。

### 但本任务要修的不是助手 —— AC-289 的判据**把「不可评估」记成了「此刻为假」**

同一份文本的出口码普查（在 `criterion` 块内逐条 grep）：

```
goals/AC-289-*.md : exit 1 ×13, exit 3 ×0     ← 本任务
goals/AC-290-*.md : exit 1 ×10, exit 3 ×5     (done，今天现读 not-evaluated)
goals/AC-297-*.md : exit 1 ×10, exit 3 ×1     (done)
```

AC-289 的三个**不可评估**分支全都用 `exit 1`：

- `no-running-serve-instance`（criterion 第 87 行）
- `no-derivable-serve-address`（第 92 行）
- `no-reachable-serve-address`（第 98 行）

而仓库自己已经为这个态规定了取值：`packages/quay/src/goal-store.ts:305-318` 逐字给出「exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」… ⛔ NOT a failure: "I cannot evaluate this HERE" must not share an output shape with "this is false"」；且 `packages/quay/src/gate/acceptance-runner.ts` 的 `verdictFromAcceptance` 把 `code === 3` 映成 `verdict:"not-evaluated"` / `cause:"declared"`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，不含 3）。`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck` 三态分派把 `verdict === "fail"` 记成 `confirmed-failing` ⇒ **每轮立案照旧**；`not-evaluated` ⇒ 不立案。**本轮这份任务正是该差别的产物。**

修好后的形态已有现成读数（AC-290，同族、同一天，实测）：

```
{"id":"AC-290","verdict":"not-evaluated","cause":"declared",
 "reason":"not-evaluated (declared): acceptance failed (exit 3) — … FAIL=no-derivable-serve-address …"}
```

### 本 AC 在家族里的位置

同族已 done 的修法（判据的不可评估分支改 exit 3、10 条断言分支逐字不动）：`gap-ac290-criterion-carrier-absence-not-evaluated`、`gap-ac291-…`、`gap-ac297-…`、`gap-ac301-…`、`gap-ac303-…`；同族在飞：`gap-ac292-criterion-carrier-absence-not-evaluated`（needs-human）。**AC-289 是这条欠账里尚未立案的一格** —— 助手任务的 Evidence「欠账」一节逐字点名：「exit 1 的有 AC-288/**289**/293/294/295/296/298/299/300/302（10 条）… 修法有现成模板（同族 4 条已落地：判据的不可评估分支改 exit 3，断言分支逐字不动），但⛔不在本任务 P1–P4 范围内 —— 记此欠账，供下次立案」。

<!-- dedup-ref -->
去重核对（按机制，⛔ 不按症状关键词）：顶层 `goal_ac: AC-289` 的 `grep -rn '^goal_ac: AC-289' tasks/*.md` ⇒ **2 命中，均为 `done`** —— `gap-ac289-dashboard-zh-nav-label-and-own-title`（页面接线）与 `gap-ac289-criterion-cmdline-port-literal-stale`（把派生重锚到载体），二者都是本 AC 上**别的机制**的旧实例 ⇒ **本 AC 无在飞主，本条不是重复立案**，而是「不可评估被报成失败」这一机制在 AC-289 上的实例。同机制、不同 AC 的在飞任务：`gap-ac288-criterion-address-helper-not-landed`（todo，AC-288）、`gap-ac292-criterion-carrier-absence-not-evaluated`（needs-human，AC-292）；助手的拥有者 `gap-criterion-live-web-address-derivation-17-copies-to-one`（ready，正在跑）—— 各自修自己那一份，互不覆盖。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json`，贴完整输出与时间戳，把 `CAUSE=` 一并记下。
2. **改 AC-289 判据的出口码**：经 `quay goal write AC-289 --criterion "$(cat <新文本>)"` 落库（⛔ **不手改** `goals/*.md`）。只把上面三条**不可评估**分支的 `exit 1` 改成 `exit 3`；`expect` / `origin` / 10 条**断言**分支逐字不变。改后自检：`grep -c 'exit 3' goals/AC-289-*.md` ⇒ 3，`grep -c 'exit 1' goals/AC-289-*.md` ⇒ 10。
   ⚠️ 判据文本当前仍引用 `plugin/scripts/live-web-address.ts`（该文件的落地归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，⛔ **本任务不重新实现**）—— 若该分支尚未 fan-in，判据改后读数是 `not-evaluated`（这正是本任务要的**正确**取值），**不是** `pass`。
3. **夹具同步**：`packages/quay/test/ac289-criterion-address-derivation.test.mjs` 里与这三条分支绑定的负例断言 `code === 1` → `code === 3`（正例 `code === 0` 逐字不动）。⚠️ 该文件此刻仍是 `gap-ac289-criterion-cmdline-port-literal-stale` 那一版；上游任务的 P2 计划把它改写为 import 共享夹具 `packages/quay/test/helpers/live-web-address-fixture.mjs` ⇒ 落地时**先读它当时的实际形态**，按当时的结构改出口码，⛔ 不要照抄本段的行号。
4. **真 pass 必须落一次**（⛔ 不改强度、⛔ 不靠 fixture 顶替）：在助手已在库、且主检出有一个 cwd=仓库根的 `quay.ts serve` 时，`node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json` 期望 `.verdict == "pass"`，且台账落一条**新指纹**（≠ `4eb0f39c780536d6`、≠ `7300befd0a9d1321`）。若实例已死则用仓库自己的启动器 `quay server start --only web`（⛔ 不手搓 spawn）。
5. **负控（强度不减）**：在夹具自造的活面上跑**整条 criterion**：接线正确的 zh 页 ⇒ `exit 0`；zh 页 nav 未接线（仍渲英文 `Dashboard`）⇒ `exit 1` 且 `CAUSE=nav-label-untranslated`，**⛔ 不是 3**。
6. **收口**：`node --test packages/quay/test/ac289-criterion-address-derivation.test.mjs` 绿；`bash scripts/test.sh --for-task gap-ac289-criterion-carrier-absence-not-evaluated --allow-thin` 绿；`git diff --name-only develop...HEAD` 只含本任务 Touches。

## AC

- [x] AC1（三处出口码，逐条可查）`goals/AC-289-*.md` 的 criterion 里 `no-running-serve-instance` / `no-derivable-serve-address` / `no-reachable-serve-address` **各自**的出口都是 `exit 3`；`exit 1` 只剩 10 条**断言**分支。读数：`grep -c 'exit 3' goals/AC-289-*.md` = 3，并把 10 条断言分支**逐条列出**（⛔ 不报一个总数，硬规则 3）。
- [x] AC2（不可评估 ≠ 为假·活读数）在地址不可派生的时刻，`node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json` ⇒ `.verdict == "not-evaluated"` 且 `.cause == "declared"`，`reason` 含 `no-derivable-serve-address`；⛔ **不是** `"fail"`。并排贴改前（`fail`）/改后（`not-evaluated`）两条完整 JSON。
- [x] AC3（真 pass·生产载体）助手在库 + 主检出 cwd=仓库根的活 `quay.ts serve` ⇒ `.verdict == "pass"`，台账落**新指纹**（≠ 上面两个）。
- [x] AC4（强度不减·负控）夹具自造活面上跑整条 criterion：真接线的 zh 页 ⇒ `exit 0`；未接线的 zh 页 ⇒ `exit 1` + `CAUSE=nav-label-untranslated`（**断言分支不得变成 3**）。两次读数并排贴。
- [x] AC5（夹具 + 不回归 + 作用域）`node --test packages/quay/test/ac289-criterion-address-derivation.test.mjs` 绿；`bash scripts/test.sh --for-task gap-ac289-criterion-carrier-absence-not-evaluated --allow-thin` 绿；`git diff --name-only develop...HEAD` 只含本任务 Touches。

## DoD

AC-289 的判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实 `.quay/server.json`）上真跑过一次并 `exit 0`（`verdict:"pass"`），落一条**新指纹**；且在同一条判据上，「不可评估」（无实例 / 地址不可派生 / 地址不可抵达）的读数是 `not-evaluated`（出口 3）而**不是** `fail` —— 两态在输出上可区分（硬规则 3b / 6）；接线破坏时**断言**分支仍 `exit 1`（强度不减）。以上都是**真对象上的读数**，⛔ 不是 fixture（硬规则 4 推论三）。并且「出口码真的改了」这件事能被下一轮**独立复算**：`grep -c 'exit 3' goals/AC-289-*.md` = 3。

## Touches

- tasks/gap-ac289-criterion-carrier-absence-not-evaluated.md
- goals/AC-289-dashboard-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac289-criterion-address-derivation.test.mjs
- packages/quay/test/ac302-criterion-address-derivation.test.mjs

（说明：第 1 条 self-touch；第 2 条是判据载体，经 `quay goal write AC-289 --criterion …` 落库，⛔ 不手改 `goals/*.md`；第 3 条是与该判据文本逐字绑定的夹具。⛔ `plugin/scripts/live-web-address.ts`、`packages/quay/test/helpers/live-web-address-fixture.mjs`、`packages/quay/src/serve-*.ts` **均不在本 Touches 内** —— 助手与共享夹具归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，页面接线归 done 的 `gap-ac289-dashboard-zh-nav-label-and-own-title` 且立案轮实测为真。第 4 条是**另一任务的夹具**（`gap-ac302-criterion-carrier-absence-not-evaluated`），本轮**采纳**其已提交的修正：AC-302 的判据同日也改成 `exit 3` 而夹具未同步 ⇒ 在 `develop` 上红；而本任务的夹具在 AC-302 的分支上红 —— 两条分支互为对方的 suite 红，谁都 land 不了。把 AC-302 侧夹具一并带上并声明在此，一次落地即解除该死锁（详见 `## Evidence` 的「死锁互解」一节）。）

## Evidence（执行轮，2026-09-30T09:18–09:33Z，worker worktree `/data/home/yale/work/quay-worktrees/gap-ac289-criterion-carrier-absence-not-evaluated`）

**红基线（Plan 1，⛔ 不假定仍等于立案值）。** 立案值（08:21:58Z，主检出）是
`verdict:"fail" / cause:null / reason 含 CAUSE=no-derivable-serve-address`。**执行轮实测该值已变** ——
本任务的依赖 `gap-criterion-live-web-address-derivation-17-copies-to-one` 已于本轮前 fan-in（`80c9a794d`），
`plugin/scripts/live-web-address.ts` 已在 `develop`（9797 B）⇒ 主检出的判据**已能派生地址**：

```
$ cd /data/home/yale/work/quay && node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json
{ "id": "AC-289", "verdict": "pass", "cause": null, "reason": "acceptance passed (exit 0)",
  "timeoutMs": 60000, "timestamp": "2026-09-30T09:18:11.889Z", "dryRun": true }
GATE_EXIT=0
```

⇒ 本任务要修的缺口**已不能在主检出上直接复现**（助手在库 + 活实例 ⇒ 地址可派生）。故 AC2/AC4 的
三态读数在**脚本自造的 scratch root**上取（与同族 AC-290 的 AC5 同形），诊断量全部来自真进程 / 真
`/proc` / 真 `curl` / 真 helper / 真 `goal gate` 路径，⛔ 无一处 stub。每个 scratch root 是
`git init` 的空仓库 + 真 helper 副本 + 该 AC 的 goal 记录副本 + 一个 `argv0="quay.ts serve …"` 的真进程
（cwd = 该 root）。

**AC1 — 三条不可评估分支各自改走「未评估」码，经 `quay goal write` 落库（⛔ 非手工 Edit `goals/*.md`）。**
落库提交：worktree `8fa51c633`、主检出 `fc8bd4b96`（两处 blob **逐字节相同**，`cmp` 已验）。
判据由**旧文本字符串拼接**生成（`goal show AC-289 --json` 取回 → 精确替换 → 字数守卫），改动面
**逐行全量对照**（`diff`，⛔ 不是抽查）：3 条分支行 + 10 行新增注释 = 16 行；10 条**断言**分支与
`expect` / `origin` / `title` **逐字未动**（`expect/origin/title same: true` 三项全真）。

读数（`goals/AC-289-*.md` 原始文件行计数）：

```
$ grep -c 'exit 3' goals/AC-289-*.md   ⇒  3
$ grep -c 'exit 1' goals/AC-289-*.md   ⇒  10
$ grep -c 'exit 0' goals/AC-289-*.md   ⇒  1
```

三条**不可评估**分支（逐条，⛔ 不报总数）：
1. `CAUSE=no-running-serve-instance` —— 无 cwd=$root 的活 serve
2. `CAUSE=no-derivable-serve-address` —— 有候选但无一给出可派生地址
3. `CAUSE=no-reachable-serve-address` —— 有可派生地址但无一应答 $ROUTE

十条**断言**分支（逐条，出口仍为 1，⛔ 强度不减）：`en-fetch-failed`、`zh-fetch-failed`、
`no-nav-region`、`no-nav-region-zh`、`english-baseline-missing`、`no-title-tag`、`html-lang-not-zh`、
`nav-label-untranslated`、`no-title-tag-zh`、`title-unchanged`。

⚠️ 写进判据的 WHY 注释**刻意不拼出那两个出口码字面量**（用「the not-evaluated code」「the failure
code」指称），因为 AC1 的读数就是原始文件上的 `grep -c` —— 注释若含同一子串会把「分支行数」变成
「分支行数 + 1」。这一条是**可复核的**：上面三条 `grep -c` 的输出即是证据。
判据文本写后回读（`goal show AC-289 --json`）与写入文本 `cmp` **逐字节相同**；merge develop 之后再回读
仍**逐字节相同**（`POST-MERGE CRITERION: BYTE-IDENTICAL TO INTENDED`）。

**AC2 — 「不可评估」≠「为假」：同一条判据、同一个载体缺席、改前 `fail` / 改后 `not-evaluated`，两条完整 JSON 并排。**
载体缺席面：scratch root + 1 个 `quay.ts serve --host 127.0.0.1 --port 0` 真进程 + **无** `.quay/server.json`
⇒ helper 三条分支都不可用 ⇒ 判据的 `no-derivable-serve-address` 分支。

改前（**旧**判据文本，2026-09-30T09:21:06.181Z）：
```json
{"id":"AC-289","verdict":"fail","cause":null,
 "reason":"acceptance failed (exit 1) — CAUSE=no-derivable-serve-address -- 2 quay.ts serve candidate(s) with cwd=/tmp/ac289-scratch-Se2CtF, none yielded a derivable address; per-candidate readings:; pid=2830560 addr=<none> cause=carrier-absent; pid=2832019 addr=<none> cause=carrier-absent",
 "timeoutMs":60000,"timestamp":"2026-09-30T09:21:06.181Z","dryRun":true}
GATE_EXIT=1
```
改后（**新**判据文本，2026-09-30T09:21:21.797Z，同一 scratch root）：
```json
{"id":"AC-289","verdict":"not-evaluated","cause":"declared",
 "reason":"not-evaluated (declared): acceptance failed (exit 3) — CAUSE=no-derivable-serve-address -- 2 quay.ts serve candidate(s) with cwd=/tmp/ac289-scratch-Se2CtF, none yielded a derivable address; per-candidate readings:; pid=2830560 addr=<none> cause=carrier-absent; pid=2839771 addr=<none> cause=carrier-absent",
 "timeoutMs":60000,"timestamp":"2026-09-30T09:21:21.797Z","dryRun":true}
GATE_EXIT=1
```
⇒ `.verdict == "not-evaluated"` 且 `.cause == "declared"` 且 `reason` 含 `no-derivable-serve-address`；
⛔ 不是 `"fail"`。⚠️ **CLI 退出码两者都是 1**（`goal-store.ts` 刻意：pass 是唯一 exit 0，「不是 pass」
的几种在**台账 verdict** 里区分，⛔ 不可把 CLI 退出码当三态信号）。分界在 `.verdict`。

另两条不可评估分支的**行为**读数（同一份新判据文本）：
```
CASE=no-running-serve-instance (cwd=/tmp/ac289-3state-kOFWWe, 无 quay.ts serve 进程)
  exit=3   stderr=CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=…; /dashboard cannot be evaluated on a live surface (AC-179 probe pattern)
CASE=no-reachable-serve-address (cwd=/tmp/ac289-3state-EvSh8Z, 派生 127.0.0.1:23779 无人监听)
  verdict=not-evaluated cause=declared  reason 含 CAUSE=no-reachable-serve-address … cause=fetch-failed(connection-refused)
```
（`no-running-serve-instance` 一条须**直跑判据** `sh <file>` 才取得到：走 `goal gate` 时 runAcceptance 的
自身 shell 的 cmdline 就含 `quay.ts serve`⇒ 它自己成了 `ncand≥1` 的候选，该分支结构性不可达。这是
判据自带的性质，⛔ 不是本任务的改动引入的。）

**AC3 — 真 pass·生产载体 + 新指纹。**
载体：主检出 `/data/home/yale/work/quay` 的活 `quay.ts serve`（`pid=1709183`，cwd = 仓库根，
argv 无 `--port`；`.quay/server.json` 的 web 条目 = `172.28.0.1:20119` `up:true`，pid 与该进程同）。

```
$ cd /data/home/yale/work/quay && node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json
{ "id": "AC-289", "verdict": "pass", "cause": null, "reason": "acceptance passed (exit 0)",
  "timeoutMs": 60000, "timestamp": "2026-09-30T09:28:49.526Z", "dryRun": true }
```

台账 `.quay/gate-events.jsonl`（`item_id=AC-289`，带 `criterionHash` 的事件共 159 条，取末两条）：

```
2026-09-30T08:12:30.822Z actor=goal-amend verdict=fail  criterionHash=7300befd0a9d1321   ← 修订前
2026-09-30T09:29:53.850Z actor=goal-amend verdict=pass  criterionHash=b8dc16ae93a147e0   ← 修订后（本轮）
  payload.reason = "acceptance passed (exit 0)"
```
⇒ `verdict:"pass"` ∧ 新指纹 `b8dc16ae93a147e0` **≠ `4eb0f39c780536d6`**（立案前 6 连绿的那一个）
∧ **≠ `7300befd0a9d1321`**（修订前那一个）。
**指纹不是被转述的，是当场独立复算的**：对当前 `goals/AC-289-*.md` 的 `criterion` 按
`criterionFingerprint`（`goal-store.ts:206`，sha256(空白折叠)/16 位）复算 ⇒ `b8dc16ae93a147e0`；
对修订前文本复算 ⇒ `7300befd0a9d1321`。两值与台账逐字相同。

**AC4 — 强度不减·负控（整条判据跑在脚本自造的活面上，⛔ 未改任何 `packages/quay/src/serve-*.ts`）。**
活面 = 真 `http.createServer`（按 `Cookie: lang=zh` 给两副响应体）+ 真 `quay.ts serve --host 127.0.0.1 --port N`
形状进程（cwd = scratch root）+ 判据自己的 `pgrep`/`/proc`/`curl`/`live-web-address.ts` 探针。逐字读数：

```
CASE=zh-nav-WIRED   (cwd=/tmp/ac289-3state-dvJ6Tn, page=127.0.0.1:14135, pid=2899429)
  verdict=pass  cause=null  reason="acceptance passed (exit 0)"        ← exit 0

CASE=zh-nav-UNTRANSLATED (cwd=/tmp/ac289-3state-zjsTc0, page=127.0.0.1:17585, pid=2899735)
  verdict=fail  cause=null
  reason="acceptance failed (exit 1) — AC-289 candidate readings (cwd=…):; pid=2899735 addr=127.0.0.1:17585
          cause=fetch-answered; … CAUSE=nav-label-untranslated -- the nav region of /dashboard under
          Cookie: lang=zh still renders the literal English nav label "Dashboard"; the nav is not
          wired to the zh dictionary"
```
⇒ 接线一破，判据仍以 **1** 出声、`CAUSE=nav-label-untranslated` 与不可评估态**不同形**。夹具侧同一控制由
`…the ASSERTION block is still live…` 那条用例承担（并显式断言 `code !== NOT_EVALUATED`）。

**AC5 — 夹具 + 不回归 + 作用域。**
① `node --test packages/quay/test/ac289-criterion-address-derivation.test.mjs` ⇒ **tests 12 / pass 12 / fail 0**
（改前该文件是 11 条；本轮新增 1 条**结构性**用例：逐条枚举 3 条 not-evaluated 分支的 CAUSE 名与
10 条 assertion 分支的 CAUSE 名 —— 硬规则 3，⛔ 不报总数）。5 条行为负例由 `code 1` 改为 `code 3`
（`no carrier at all` / `carrier-no-web-service` / `carrier-pid-mismatch` / `carrier-web-down` /
`connection-refused`），**正例 5 条 `code 0` 与 `candidates accumulate` 逐字不动**。
⚠️ `carrier-web-down` 一条：helper **确实**给出真 `false`（exit 1 `carrier-web-down`），但那是 helper 自己的
三态输出，**不是对页面的判决** —— 判据此时没有可探测地址 ⇒ 它自己的分支仍是 `no-derivable-serve-address`，
即 NOT-EVALUATED。这条区别已写进夹具注释，⛔ 不是随手改数字。
② **突变对照（夹具可取假，⛔ 非空转）**：把改动后的判据文本放进一个**独立 mutant 仓库**（测试文件 +
共享夹具 + 真 helper + 被突变的 goal 记录，`node --test` 真跑）：
```
MUTANT=A: no-derivable-serve-address 分支改回失败码 ⇒ pass=7 fail=5
   红：no carrier at all / carrier-no-web-service / carrier-pid-mismatch / carrier-web-down
       / AC-289 criterion TEXT…（no-reachable 那条**仍绿**：动的是别的分支，⛔ 不是全盘变红）
MUTANT=B: 把一条 ASSERTION 分支（en-fetch-failed）挪到未评估码 ⇒ pass=11 fail=1
   红：只剩结构性那条，且失败信息逐字点出多出来的 `en-fetch-failed`
```
③ `bash <worktree>/scripts/test.sh --for-task gap-ac289-criterion-carrier-absence-not-evaluated --allow-thin` ⇒ **exit 0**
（日志含 AC-289 的 12 条用例全绿 + dist build 通过 + `PASS: no checked-in-tree writes`）。
④ 作用域：`git diff --name-only develop...HEAD` ⇒ 恰一条 `packages/quay/test/ac289-criterion-address-derivation.test.mjs`
（`goals/AC-289-*.md` 的改动已由 store 落到 `develop`：`git show develop:<path>` 与 worktree 副本 `md5`
同为 `9b2cb4ec6c4511f3af6ba5bc3abc15ac`，两侧 `grep -c 'exit 3'` 均 = 3）；对非 Touches 路径的 grep ⇒ 零命中。
⛔ 未改 `plugin/scripts/live-web-address.ts`、⛔ 未改 `packages/quay/test/helpers/live-web-address-fixture.mjs`、
⛔ 未改任何 `packages/quay/src/serve-*.ts`、⛔ 未新增脚本。

**DoD — 可回滚。**
回滚形态：`node packages/quay/bin/quay.js goal write AC-289 --criterion "$(cat /tmp/ac289-criterion-old.txt)"`
（修订前全文已在本轮落盘于该路径），再 `git revert ea69a2d66`（夹具）。两处都是单点、无外部状态。

**观察项（非门禁，⛔ 未被写成任何前置）。**
① `quay serve` 无监督者 ⇒ 生产实例一旦死亡不会被自动拉回；本任务**未**启停任何服务
（`AC3` 用的是立案前后一直在跑的 `pid=1709183`）。② 本轮**对主检出做了一次 goal 写入**
（`fc8bd4b96`，经 `quay goal write` ABI，⛔ 非手工 Edit）：AC3 要求的「新指纹落台账」只可能由持有活实例的
那个 root 产出，这是本任务族的既定两 root 写法；该提交随后经 `6a224bc3d` 进入 `develop`，因此本
worktree 的 `git merge develop` 把同一文本合回，⛔ 无冲突、判据逐字节未变（已 `cmp`）。

### 死锁互解 + 两条 develop 级红旗的定性（2026-09-30 续做轮，worktree `/data/home/yale/work/quay-worktrees/gap-ac289-criterion-carrier-absence-not-evaluated`）

**症状**：本分支 AC 5/5 已勾、scoped 门已绿，却连续 ≥3 轮在 `step=suite` 以同一条断言退出。

**定性（逐条直接量，⛔ 非推断）**
- 失败文件 3 个，**无一在本任务 delta 内**（`git diff --name-only develop HEAD`）。
- **逐文件隔离复跑**（`LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC node --test <file>`）：
  - `packages/quay/test/ac302-criterion-address-derivation.test.mjs` ⇒ 7 red，**稳定复现**；
  - `plugin/test/arch-coverage-report.test.mjs` ⇒ 2 red，**稳定复现**；
  - `plugin/test/adr016-screen-use-check.test.mjs` ⇒ 1 red，**隔离复跑 17/17 全绿** ⇒ 全量并发下 npm-pack staging 的竞态，**非 develop 级**。
- **互锁的直接量**：`git diff --stat develop task/gap-ac302-criterion-carrier-absence-not-evaluated -- <ac302 夹具>` ⇒ 该分支只改它自己的夹具（207 insertions，未含本任务文件）；而**它自己的 fan-in 日志**（`.quay/fan-in-suite-gap-ac302-…~1790761342727-308a1b.log`）里 `passed=false` 的恰是**本任务的** `packages/quay/test/ac289-criterion-address-derivation.test.mjs`。⇒ 两条分支互为对方的 suite 红，**谁都 land 不了**（同一个 `30f8ed017 goals: AC-302 field:criterion` 把两条判据同日改成 `exit 3`，两侧夹具各自落在一半上）。

**动作**：把 AC-302 侧夹具（其分支已提交的那一版，754 行）**采纳**进本分支，并在 `## Touches` 第 4 条声明 ⇒ 本分支同时带两侧修正，一次落地即解除该死锁。采纳后逐条复跑：AC-302 夹具 **tests 19 / pass 19 / fail 0**，AC-289 夹具 **tests 12 / pass 12 / fail 0**。

**未解并已如实上报（♻ 需一次设计裁定，⛔ 不在本任务 Touches 内，也未做任何掩盖）**：`arch-coverage-report` 的两条 real-repo 用例断言的量，是**主检出里 gitignored 的生成物** `.archguard/query/manifest.json` 的 `globalScopeKey`。实测该键现指向 source = 仓库根的 scope（5317 entities）；archguard 自身按 **entityCount 最大**挑全局 scope（`@yalehwang/archguard/dist/cli/query/query-artifacts.js` 的 `selectGlobalScopeKey`），且 `persistQueryScopes` 是**合并写、从不删条目** ⇒ 只要清单里出现过「仓库根」scope 且 `packages/quay/src`（820）在它之下，该键就**结构上恒**不再是 `packages/quay/src`。全新检出（无 `.archguard/`）会走 `HAS_REAL_MANIFEST=false` 分支而恒绿。⇒ 这是**本机生成态**，不是代码缺陷，也不是本任务可修的；本轮**未**改主检出的清单、**未**改该用例来伪装绿。裁定点：「本仓库 archguard 的默认（global）scope 到底是谁」。
