---
id: gap-ac303-criterion-carrier-absence-not-evaluated
title: "AC-303 判据把「活载体缺席」记成「此刻为假」——`/architecture` 地址派生那步的两个可评估性分支以 exit 1
  出声，违反仓库自己的约定（exit 3 = not-evaluated，goal-store.ts:311-318
  逐字给出的例子正是「NOT-EVALUATED: carrier absent」）⇒ driver 每轮把它当 confirmed-failing
  立案；修法=两个分支改 exit 3 + 保持 cwd=仓库根的活实例使判据真 pass 并落新指纹，以「接线破坏仍 exit 1」证明强度未减"
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-303
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-29，cwd = 主检出 `/data/home/yale/work/quay`）**

台账尾部两条 `fail`（同为今天、同因）：

```
2026-09-29T02:05:58.575Z  item_id=AC-303  gate=goal  verdict=fail  payload.criterionHash=abc74ce6609f1567
  reason: acceptance failed (exit 1) — CAUSE=no-derivable-address -- pgrep -f 'quay.ts serve' x
          cwd=/data/home/yale/work/quay matched candidate(s) but none yielded a live web address
2026-09-29T02:06:53.018Z  item_id=AC-303  gate=goal  verdict=fail
  reason: acceptance failed (exit 1) — CAUSE=no-derivable-address
```

约一分钟后一个无关的 peer worker 顺手重启了 serve（载体 `.quay/server.json` 的 `startedAt = 2026-09-29T02:07:52.833Z`，`pid=3652175`，web `127.0.0.1:20119` `up:true`），立案轮复跑判据：

```
node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json       # 2026-09-29T02:16:49.304Z
⇒ {"id":"AC-303","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)"}   GATE_EXIT=0
```

⇒ **这条判据在「不可评估」与「为真」之间来回摆动，而它把前者记成了「为假」。**

**成因既不是判据的机制坏了（`/architecture` 的 zh 接线今天在活实例上是绿的），也不是这个页面退化了 —— 是【判据的活载体（运行中的 `quay serve`）会缺席，而判据把「无法评估」这个态用 `exit 1` 报成了「此刻为假」。**

### 两个可评估性分支 vs 十条断言分支

AC-303 的判据（`quay goal show AC-303 --json` 的 `.criterion`，逐字 **8247 bytes**，`md5=7b35d8c0511508643b9c0c484a55700a`）里：

- **可评估性分支只有两处**，都经 `fail()` 出声（criterion 第 **79 / 80** 行）：
  - `fail "no-running-serve-instance -- …"`（`$cands` 为空：没有任何 cwd=仓库根的 `quay.ts serve` 候选）
  - `fail "no-derivable-address -- …"`（有候选但都没派生出活地址）
  而 `fail()` 唯一一处出口是 `exit 1`（第 **56** 行）。
- **断言分支十处**，都是 inline `echo "CAUSE=…"; exit 1`（第 **86 / 88 / 91 / 92 / 93 / 96 / 97 / 98 / 100 / 101** 行），逐字不动。

`grep -c 'fail "'` 对判据全文 = **2**（即上面两处，⛔ 没有别的调用者）⇒ 改 `fail()` 那一行的退出码，就是这条判据【可评估性】这一层的完整且最小改法。

### 仓库自己已经为「不可评估」规定了取值

`packages/quay/src/goal-store.ts:311-318` 逐字：

> …the criterion itself declared it (**exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」**)… ⛔ **NOT a failure**: "I cannot evaluate this HERE" must not share an output shape with "this is false"…

且这一取值已在**唯一**的映射函数里兑现：`packages/quay/src/gate/acceptance-runner.ts:105` 的 `verdictFromAcceptance` 把 `code === 3` 映成 `not-evaluated` / cause `declared`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，不含 3）。AC-303 的判据今天违反的正是这条约定：两个可评估性分支全部 `exit 1`。

### 代价（可核）：driver 每轮把它当 confirmed-failing 立案

`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck` 三态分派：`verdict === "fail"` ⇒ `outcome:"confirmed-failing"`（**立案**）；`verdict === "pass"` ⇒ `cleared`（不立案）；其余（含 `not-evaluated`）⇒ `outcome:"not-evaluated"`（不立案）。所以 `exit 1` 与 `exit 3` 的差别，就是「每轮重复立案」与「不立案」的差别 —— 本轮这份任务本身就是该差别的产物。

### 更早的两条 done 任务都没碰这一个取值

| 任务 | done | 它做了什么 |
|---|---|---|
| `gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title` | 2026-09-17 | `/architecture` 的页头 lang / 本页 `<title>` / nav 当前项接线（保证的**作用对象**；今天仍绿）。台账里 46 条 `CAUSE=html-lang-not-zh` 的 fail 止于该日 23:36 |
| `gap-ac303-criterion-cmdline-port-literal-stale` | 2026-09-23 | **重锚地址派生**（cmdline `--port 0` ⇒ 改从活宿主载体取）。台账里 33 条 `CAUSE=en-fetch-failed` 的 fail 止于该日 16:09。其 Plan 只要求「无实例时**非 0**」—— `exit 1` 满足了当时的字面要求，而它正是把「查不成」与「为假」并成同一个取值的那一步 |

**两条都没触及「不可评估该取什么值」** ⇒ 宿主 serve 一死（2026-09-29T02:05 转红），判据立刻以 `fail` 重现，driver 立刻再立案。这不是「早先的修复失效了」，而是**早先两次修复各修了一层，而把两态并成一态的那一层从未被修**。

### 发生率（硬规则 12：查历史，⛔ 不等下一轮）

台账 `.quay/gate-events.jsonl` 中 `item_id=AC-303` 的事件共 **212** 条（`pass` **131** / `fail` **81**），fail 按成因分三簇：

| 成因 | 条数 | 时间窗 |
|---|---|---|
| `CAUSE=html-lang-not-zh` | 46 | 2026-09-17T16:34:24 – 23:36:28 |
| `CAUSE=en-fetch-failed` | 33 | 2026-09-23T08:55:42 – 16:09:18 |
| `CAUSE=no-derivable-address` | **2** | **2026-09-29T02:05:58 – 02:06:53** |

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）与可追溯性**：顶层 `grep -rln '^goal_ac: AC-303' tasks/` ⇒ **2** 命中（`gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title`、`gap-ac303-criterion-cmdline-port-literal-stale`），**status 全为 done** ⇒ 本 AC 无在飞主，⛔ 不是重复立案。同机制、**不同 AC** 的在飞任务：`gap-ac291-criterion-carrier-absence-not-evaluated`（todo）、`gap-ac292-criterion-carrier-absence-not-evaluated`（ready）、`gap-ac301-criterion-carrier-absence-not-evaluated`（todo）—— 每条只改**自己那一条** goal 文件 + 夹具，**互不覆盖**；AC-303 是本轮尚未立案的那一条。⚠️ 两个 `done` 认领本 AC **不是**重复的证据 —— 它们是「早先两次修复各修一层、取值混淆这一层从未被修」的证据。

### 四个修法的取舍

- ✗ `superseded` 本 AC：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**。
- ✗ `long-term: true`：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），取值混淆原样保留。
- ✗ 只把活实例拉回来：**不完整**。实例今天被 peer 拉起、明天会再死，而判据仍会把每次缺席记成一处「为假」并每轮立案。
- ✗ 只改 exit 3：**也不完整**。保证会在实例缺席时永久停在 not-evaluated，等于把守卫静默空转（硬规则 3b 的空转半边：判据恒真而什么也没验到，与「验过了」同形）。
- ✓ **① 两个可评估性分支改 `exit 3`；② 保持/拉起一个 cwd=仓库根的活实例，使判据在新指纹下落一条真 `pass`；③ 以「接线破坏仍 `exit 1`」的负控制证明强度未减。** 三条缺一不可。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json`，逐字贴出 verdict；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` + `cat .quay/server.json` 给出实例读数。若此刻判据已 `pass`（立案轮就是这种情形：实例在 02:07:52 被 peer 拉起、判据在 02:16:49 复跑 `pass`），照记 —— 这本身就是「不可评估 ↔ 为真 摆动」的证据，不是「缺口不存在」。
2. **取修订前指纹**：确认台账尾（或 `quay goal show AC-303 --json`）的 `criterionHash` = `abc74ce6609f1567`，供 AC6 对照。
3. **改判据（可评估性那一层 → exit 3）**：从 `goals/AC-303-*.md` 抽出 criterion 全文，**只**把 `fail()`（criterion 第 56 行）的 `exit 1` 改为 `exit 3`（该 helper 唯一的两个调用者就是第 79 / 80 行的可评估性分支，已实测 `grep -c 'fail "'` = 2）；十条 inline 断言 `CAUSE=` 分支逐字保留 `exit 1`；经 `quay goal write AC-303 --criterion "$(cat <新判据文件>)"` 落库。⚠️ 注释保持**单一逻辑行**（folded scalar 里一个硬换行折回后会变成语法错）。⛔ 不手工 Edit `goals/*.md`。
4. **同步夹具**：`packages/quay/test/ac303-criterion-address-derivation.test.mjs` 的 **8** 个可评估性负例断言 `code` 由 `1` 改 `3`（第 **384 / 405 / 424 / 441 / 489 / 509 / 524 / 559** 行，带 message 的四处逐字保留）；**7** 个正例（第 **280 / 295 / 308 / 330 / 351 / 368 / 587** 行）与**2** 个整条 criterion 的 fetch 失败断言（第 **612 / 631** 行，`CAUSE=en-fetch-failed`，必须仍 `exit 1`）**逐字不动**；`node --test packages/quay/test/ac303-criterion-address-derivation.test.mjs` ⇒ 全绿。
5. **补一条断言侧负控制（仍在同一夹具文件内）**：让该文件除逐字块之外，再跑**整条 criterion**（同一 `criterionText()` 读法）对一个 scratch `git init` 根里的 **serve 形进程 + 载体 + 一个真实监听但 zh 未翻译的 `/architecture`** ⇒ 断言 `exit 1` 且 `CAUSE=` 可区分（`nav-label-untranslated` 或 `no-nav-region`）。⛔ **不得**为做这个负控制去改 `packages/quay/src/serve-*.ts`（不在本 Touches 内）；负控制的活面由夹具自造。
6. **正控制**：先用 `ps aux | grep -c '[q]uay-task-worker'` 确认无在飞 worker（⛔ 不与 peer 抢同一活面）；已有一个 cwd=仓库根的活实例时**直接复用它**，只在**没有**实例时才用仓库既有启动器（`plugin/scripts/start-drivers.ts` 或 `quay serve`，⛔ 不手拼 `spawn`/`send-keys`）从**主检出 HEAD** 起一个。`node packages/quay/bin/quay.js goal gate AC-303`（主检出根）⇒ **exit 0**，并同一时刻四条断言各自独立可核（en nav `Architecture` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav `Architecture` 计数 =0 / zh `<title>` ≠ en `<title>`）。
7. **不可评估态控制**：在**无**实例的 scratch 根上 `quay goal gate AC-303 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 既不是 `fail` 也不是 `pass`）；⛔ 不必停掉生产实例。
8. **新指纹落账**：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1` 使 AC-303 以新 `criterionHash` 落一条 `pass`（⚠️ 不带 `env -u …` 时 sweep 会 `refused:true, eligible:0`）；贴出台账新增行的逐字 JSON。
9. **不回归**：`bash scripts/test.sh --for-task gap-ac303-criterion-carrier-absence-not-evaluated` 绿；家族枚举逐文件对照（`grep -rl` 各 token 的 goal 文件数），并逐字说明「本任务只改 AC-303 一条的退出码，其余 16 个文件原样」。

## AC

- [ ] **AC1（可评估性分支已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `fail()` 的 `exit 1` 变 `exit 3`（即第 79 / 80 行两个可评估性分支共用的出口）；`expect` 与十条 inline 断言 `CAUSE=` 分支（`en-fetch-failed` / `zh-fetch-failed` / `no-nav-region` / `no-nav-region-zh` / `english-baseline-missing` / `no-title-tag` / `html-lang-not-zh` / `nav-label-untranslated` / `no-title-tag-zh` / `title-unchanged`）逐字相同、仍 `exit 1`。⛔ 未经 `quay goal write` 落库不算。
- [ ] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac303-criterion-address-derivation.test.mjs` 的 8 个可评估性负例断言 `code === 3`、7 个正例仍 `code === 0`、2 个整条 criterion 的 fetch 失败断言仍 `code === 1`；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `code === 1` 断言下的对照（`git show <old>:<file>`）证明这 8 条确实 1 → 3。
- [ ] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-303` ⇒ **exit 0**，逐字贴出；四条断言各自独立可核；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、cmdline 含 `quay.ts serve` 的活进程。
- [ ] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/architecture` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分，逐字贴出。⛔ 该证据的活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [ ] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-303 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [ ] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-303` 最新一条为 `verdict:"pass"`，其 `payload.criterionHash` **≠** 修订前指纹 `abc74ce6609f1567`（两行都贴）；② `bash scripts/test.sh --for-task gap-ac303-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出，并说明本任务只改 AC-303 一条的退出码。
- [ ] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下观察项「`quay serve` 无监督者、死亡后不会被自动拉回」及其发生率读数。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实运行的服务上为真、且三态可区分的判据落了账**：

1. **落地对象**：`goals/AC-303-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit）；**且**一个 cwd = 仓库根的 `quay.ts serve` 实例在跑 —— 只改文本不算落地。
2. **三态齐备（同一条判据给出三个互不同形的取值）**：活实例 + 真接线 ⇒ **`exit 0` / `pass`**；可达但 zh 未翻译 ⇒ **`exit 1` / `fail`**；无实例 ⇒ **`exit 3` / `not-evaluated`（⛔ 非 fail、非 pass）**。三者各自的逐字读数进 Evidence。
3. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-303` / `gate=goal` / `verdict:"pass"` 的新事件，其 `criterionHash` 与修订前 `abc74ce6609f1567` 不同 —— **一条 dry-run 输出不算**。
4. **动机随判据进记录**：`quay goal write` 落库的 criterion 里带着「为什么改」的注释与读数（载体缺席 ≠ 为假；`exit 3` 是仓库在 `goal-store.ts:311-318` 写死的约定），而不是只留在本任务体里。

## Touches

- `goals/AC-303-architecture-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac303-criterion-address-derivation.test.mjs`
- `tasks/gap-ac303-criterion-carrier-absence-not-evaluated.md`

（说明：第一条是本任务的落地面 —— 地址派生那步的**退出码**，经 `quay goal write AC-303 --criterion …` 落库，`expect` 与分支文本逐字不变；第二条是与该块逐字绑定的夹具（8 个负例断言随之同步，并新增一条整条 criterion 的断言侧负控制）；第三条是 self-touch。⛔ `plugin/scripts/driver-anchor.ts`、`plugin/scripts/start-drivers.ts`、任何 `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**。）