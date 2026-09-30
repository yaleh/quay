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

- [ ] AC1（三处出口码，逐条可查）`goals/AC-289-*.md` 的 criterion 里 `no-running-serve-instance` / `no-derivable-serve-address` / `no-reachable-serve-address` **各自**的出口都是 `exit 3`；`exit 1` 只剩 10 条**断言**分支。读数：`grep -c 'exit 3' goals/AC-289-*.md` = 3，并把 10 条断言分支**逐条列出**（⛔ 不报一个总数，硬规则 3）。
- [ ] AC2（不可评估 ≠ 为假·活读数）在地址不可派生的时刻，`node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json` ⇒ `.verdict == "not-evaluated"` 且 `.cause == "declared"`，`reason` 含 `no-derivable-serve-address`；⛔ **不是** `"fail"`。并排贴改前（`fail`）/改后（`not-evaluated`）两条完整 JSON。
- [ ] AC3（真 pass·生产载体）助手在库 + 主检出 cwd=仓库根的活 `quay.ts serve` ⇒ `.verdict == "pass"`，台账落**新指纹**（≠ 上面两个）。
- [ ] AC4（强度不减·负控）夹具自造活面上跑整条 criterion：真接线的 zh 页 ⇒ `exit 0`；未接线的 zh 页 ⇒ `exit 1` + `CAUSE=nav-label-untranslated`（**断言分支不得变成 3**）。两次读数并排贴。
- [ ] AC5（夹具 + 不回归 + 作用域）`node --test packages/quay/test/ac289-criterion-address-derivation.test.mjs` 绿；`bash scripts/test.sh --for-task gap-ac289-criterion-carrier-absence-not-evaluated --allow-thin` 绿；`git diff --name-only develop...HEAD` 只含本任务 Touches。

## DoD

AC-289 的判据在**生产载体**（主检出 cwd=仓库根的活 `quay.ts serve` + 真实 `.quay/server.json`）上真跑过一次并 `exit 0`（`verdict:"pass"`），落一条**新指纹**；且在同一条判据上，「不可评估」（无实例 / 地址不可派生 / 地址不可抵达）的读数是 `not-evaluated`（出口 3）而**不是** `fail` —— 两态在输出上可区分（硬规则 3b / 6）；接线破坏时**断言**分支仍 `exit 1`（强度不减）。以上都是**真对象上的读数**，⛔ 不是 fixture（硬规则 4 推论三）。并且「出口码真的改了」这件事能被下一轮**独立复算**：`grep -c 'exit 3' goals/AC-289-*.md` = 3。

## Touches

- tasks/gap-ac289-criterion-carrier-absence-not-evaluated.md
- goals/AC-289-dashboard-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac289-criterion-address-derivation.test.mjs

（说明：第 1 条 self-touch；第 2 条是判据载体，经 `quay goal write AC-289 --criterion …` 落库，⛔ 不手改 `goals/*.md`；第 3 条是与该判据文本逐字绑定的夹具。⛔ `plugin/scripts/live-web-address.ts`、`packages/quay/test/helpers/live-web-address-fixture.mjs`、`packages/quay/src/serve-*.ts` **均不在本 Touches 内** —— 助手与共享夹具归 in-flight 的 `gap-criterion-live-web-address-derivation-17-copies-to-one`，页面接线归 done 的 `gap-ac289-dashboard-zh-nav-label-and-own-title` 且立案轮实测为真。）
