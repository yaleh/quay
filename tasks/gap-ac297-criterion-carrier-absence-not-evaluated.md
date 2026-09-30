---
id: gap-ac297-criterion-carrier-absence-not-evaluated
title: AC-297 判据把「活载体缺席」记成「此刻为假」——`fail()` 助手的出口 `exit 1`（被
  no-running-serve-instance 与 no-derivable-address 两条分支共用）违反仓库自己的约定（exit 3 =
  NOT-EVALUATED，`acceptance-runner.ts` 的 `verdictFromAcceptance` 把 code 3 映成
  not-evaluated/declared）⇒ driver 每轮把它当 confirmed-failing 立案；修法=`fail()` 改 exit
  3（10 条断言分支逐字不动）+ 保持 cwd=仓库根的活实例使判据在新指纹下落真 pass + 以 `en-fetch-failed` 仍 exit 1
  证明强度未减
status: todo
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-297
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30，cwd = 主检出 `/data/home/yale/work/quay`）**

立案那一刻，判据被直接复跑一次（⛔ 不是读台账尾巴）：

```
$ bash <从 goals/AC-297-*.md 抽出的 criterion>
CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay; the locale mechanism cannot be evaluated on a live surface (AC-179 probe pattern)
CANDIDATES: none -- pgrep -f 'quay.ts serve' x cwd=/data/home/yale/work/quay matched no process
EXIT=1
```

同一条判据、**同一份判据文本**，约 4 分钟后再读（07:11:19）—— 期间一个 cwd=仓库根的 `quay.ts serve`（pid 438577，07:10:02 起，carrier `.quay/server.json` 报 web `127.0.0.1:23311` up）出现：

```
$ node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json
{"id":"AC-297","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)","timeoutMs":60000,
 "timestamp":"2026-09-30T07:11:19.887Z","dryRun":true, ...}
```

台账 `.quay/gate-events.jsonl` 里 `item_id=AC-297` / `gate=goal` 共 **218** 条；同一个 `criterionHash = 1374f0d89eb3ccc6` 上先连绿后转红：

| 时刻 | actor | verdict | 该条 `payload.reason` 的致命段 |
|---|---|---|---|
| 2026-09-30T05:58:35.055Z | goal-sweep | **pass** | `acceptance passed (exit 0)` |
| 2026-09-30T07:07:21.381Z | goal-sweep | **fail** | `CAUSE=no-derivable-address -- pgrep -f 'quay.ts serve' x cwd=/data/home/yale/work/quay matched candidate(s) but none yielded a live web address` |
| 2026-09-30T07:08:54.783Z | goal-cli | **fail** | 同上 |
| 2026-09-30T07:11:19.887Z | goal-cli (dry-run) | **pass** | `acceptance passed (exit 0)` |

⇒ **判据的判据没变（同一指纹），变的是它的活载体在不在**。载体在 ⇒ pass；载体不在 ⇒ `fail()` ⇒ exit 1 ⇒ 复核器把它读成「此刻为假」。

**成因不是页面退化，也不是接线失效 —— 是「无法评估」这个态被用 `exit 1` 报成了「为假」。**

### 判据的断言是真的；今天只是【有时】量不到

本 AC 的保证是「在**运行中的**服务上，`/git-history` 的 zh 切换相对 en 基线真实发生」。它的 `origin` 逐字写明操作前提：「需有一个 cwd=仓库根的 `quay serve` 实例在跑；实现落地后须重启该实例」。载体不在 ⇒ 这条保证**既没被证真也没被证假**。

而仓库自己已经为这个态规定了取值：

- `packages/quay/src/gate/acceptance-runner.ts:105-107` —— `verdictFromAcceptance`：`r.code === 3 ? "declared"` ⇒ `verdict: "not-evaluated"`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，**不含 3**）。
- `packages/quay/src/goal-store.ts`（约 :311-318）逐字：「exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」… ⛔ NOT a failure: "I cannot evaluate this HERE" must not share an output shape with "this is false"」。

AC-297 的判据今天违反的正是这条约定：它的**两个**不可评估分支（`no-running-serve-instance`、`no-derivable-address`）共用一个 `fail()` 助手，而 `fail()` 的出口是 `exit 1`。

### 代价（可核）：driver 每轮把它当 confirmed-failing 立案

`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck` 三态分派：`verdict === "fail"` ⇒ `outcome:"confirmed-failing"`（**立案照旧**）；`verdict === "pass"` ⇒ `cleared`；其余（含 `not-evaluated`）⇒ 不立案。所以 `exit 1` 与 `exit 3` 的差别，就是「每轮重复立案」与「不立案」的差别 —— 本轮这份任务本身就是该差别的产物。

发生率（硬规则 12b：查历史）：`.quay/gate-events.jsonl` 中 `item_id=AC-297` / `gate=goal` 共 218 条，其中 `payload.reason` 含 `no-derivable-address` 的 **2** 条、含 `en-fetch-failed` 的 **8** 条（后者是派生出地址但无人应答 —— 见下「一处家族分歧」）。

### 判据的结构（立案轮逐行枚举，⛔ 先枚举再改）

`goals/AC-297-*.md` 的 criterion 解析后，`exit 1` 共 **11** 处、`exit 3` **0** 处：

- **不可评估（2 条分支，1 个共用出口）**：`fail()`（第 54 行，`exit 1`）被**恰好两条**分支调用 —— 第 77 行 `no-running-serve-instance`、第 78 行 `no-derivable-address`。
- **断言（10 条，各自内联 `exit 1`）**：`en-fetch-failed`(84) / `zh-fetch-failed`(86) / `no-nav-region`(89) / `no-nav-region-zh`(90) / `english-baseline-missing`(91) / `no-title-tag`(94) / `html-lang-not-zh`(95) / `nav-label-untranslated`(96) / `no-title-tag-zh`(98) / `title-unchanged`(99)。
- ⚠️ AC-297 的这一版**没有** `no-reachable-serve-address`、也**没有** `workspace-root-unresolvable` 这两个分支（`grep -c` 各为 0）—— 它与 AC-290/AC-292 那一族（`goals/` 里 `no-derivable-serve-address` 10 个文件、`no-reachable-serve-address` 10 个、`workspace-root-unresolvable` 8 个）**不是同一份文本**，⛔ 不要照抄 AC-290 的任务体。
- `fail()` 是**唯一**的不可评估出口：改它一处，两条分支同时归位；10 条断言分支不走 `fail()`，逐字不受影响。

### 作用对象仍然完好（三条互相独立的读数，⛔ 不是推断）

**读数 ①（源码，按位置）**：`packages/quay/src/serve-git.ts` 的 `/git-history` 仍在页头/本页 title/nav 当前项三处吃 `cfg.lang`；`packages/quay/src/serve-i18n.ts:212` 逐字记着 AC-297 的页内词条（「this page's own tokens — FOUR of them」）。

**读数 ②（活面，直接 HTTP）**：在 07:10 起的活实例上：

```
en <title> = quay — Git history — vertical commit timeline
zh <title> = quay — Git 历史 — 提交纵向时间轴        (≠ en)
en <nav> 含 "Git History"  ⇒ 是
zh <nav> 含 "Git History"  ⇒ 否
zh 响应含 <html lang="zh"  ⇒ 是
```

**读数 ③（绑定夹具，实测）**：`node --test packages/quay/test/ac297-criterion-address-derivation.test.mjs` ⇒ `tests 12 / pass 12 / fail 0`。

⇒ 作用对象绿、活面绿、夹具绿；唯一红的是**不可评估态的输出形状**。

### 修法的取舍

- ✗ `superseded` 本 AC：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），保证今天仍是本仓库的意图。
- ✗ `long-term: true`：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），取值混淆原样保留。
- ✗ 只把活实例拉回来：**不完整**。实例今天被 peer 拉起、明天会再死（本轮 07:08→07:10 两分钟内就死过一次），而判据仍会把每次缺席记成一处「为假」并每轮立案。
- ✗ 只改 `exit 3`：**也不完整**。保证会在实例缺席时永久停在 not-evaluated，等于把守卫静默空转（硬规则 3b 的空转半边：判据恒真而什么也没验到，与「验过了」同形）。
- ✓ **① `fail()` 由 `exit 1` 改 `exit 3`；② 保持/拉起一个 cwd=仓库根的活实例，使判据在新指纹下落一条真 `pass`；③ 以「断言分支仍 `exit 1`」的负控制证明强度未减。** 三条缺一不可。

### 一处家族分歧，本任务的选择要写明理由

AC-290 那一族在 `no-reachable-serve-address`（派生出地址但无人应答）上有分歧（AC-291/292/301 改 `exit 3`，AC-303 留 `exit 1`）。**AC-297 的这一版没有该分支** —— 它的「派生出地址但无人应答」直接落在断言分支 `en-fetch-failed`（第 84 行）。本任务**不动它**（属断言分支，逐字保留 `exit 1`），理由是 AC-297 的夹具把它当作**强度基线**逐字钉住：`packages/quay/test/ac297-criterion-address-derivation.test.mjs:404` 断言「一条派生成功但无人应答的地址必须 `code === 1` 且以 `CAUSE=en-fetch-failed` 可区分」——它正是「重锚不得把真不可达变成假拒绝、也不得变成 pass」的那条断言。⚠️ 若执行轮实测到相反证据（例如载体陈旧导致 `en-fetch-failed` 反复误报），**改判并把读数贴进 Evidence**；两种取舍都必须是有读数的，⛔ 不是风格选择。

### 修法必须满足的性质（⛔ 缺一不可）

1. **只动不可评估出口，不动断言分支**：改退出码的**只有** `fail()` 助手一处（第 54 行）—— 它是 `no-running-serve-instance` / `no-derivable-address` 两条分支的共用出口。10 条断言分支**逐字不动、仍 `exit 1`**。⚠️ **先读实际文件再动手**，贴出改前的逐行枚举（本任务立案轮读数：`exit 1` = 11、`exit 3` = 0，其中 `fail()` 计 1 处、断言计 10 处）。
2. **⛔ 不改 `expect`、不改作用域**：`<nav>…</nav>` 只对 nav 区块匹配、`<title>` 只对 title 匹配；⛔ 不新增第二份判据文件、不新增 `CAUSE=` / `FAIL=` 行。
3. **判据仍能取假（正/负控制各一条）**：活实例 + 真接线 ⇒ `exit 0`；活实例 + 故意不翻译的 zh 响应 ⇒ **`exit 1`** 且以 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分。
4. **新指纹落账**：经 `quay goal write AC-297 --criterion …` 落库（⛔ **不**手工 Edit `goals/AC-297-*.md`），随后 `quay goal gate AC-297` 在活实例上 `exit 0`，台账新增 `item_id=AC-297` / `gate=goal` / `verdict:"pass"` 且 `criterionHash` **≠** `1374f0d89eb3ccc6` 的事件。
5. **逐字夹具同步**：`packages/quay/test/ac297-criterion-address-derivation.test.mjs` 用 `# >>> addr-derivation` / `# <<< addr-derivation` 把该块**逐字**抽出执行（它是一份测量，不是回声）。其 **4** 条不可评估负例断言（`r.code`，第 248/269/288/305 行 —— carrier-absent / carrier-pid-mismatch / carrier-no-web-service / carrier-web-down）由 `1` 改 `3`；**4 条 `code === 0` 正例（175/190/212/233）与第 404 行的 `code === 1`（`en-fetch-failed` 强度基线）逐字不动**。⚠️ 该夹具**没有** `no-running-serve-instance` 的用例 —— ⛔ 不要为它新造一个（那会改夹具语义）；该分支与 `no-derivable-address` 共用 `fail()`，其新取值用第 7 步的端到端读数证明。
6. **判据文本的 YAML 约束**：criterion 是 folded scalar，`#` 注释必须保持**单一逻辑行**（注释里一个硬换行折回后会变成语法错）。
7. **在主检出根上跑闸**：活实例、`.quay/server.json` 载体与 `.quay/gate-events.jsonl` 都在**主检出**，而任务 worktree 的 `.quay/` 是刷新快照 ⇒ `quay goal gate AC-297` 必须在主检出根上跑，⛔ 不在 worktree 里跑。goal 写要**两个 root 都在位**。
8. **⛔ 不重启 peer 在飞 worker 依赖的服务**：派发/执行前 `ps aux | grep -c '[q]uay-task-worker'`；已有一个 cwd=仓库根的活实例在跑时**直接复用它**，只在**没有**实例时才从主检出 HEAD 拉起一个（用仓库既有启动器，⛔ 不手拼 `spawn`）。

<!-- dedup-ref -->
**明确的非目标（观察项，不进入本任务的任何门禁）**：`quay serve` **没有监督者**（web 不在 `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 六类里；`start-drivers.ts` 只在**被调用时**判 staleness/down）—— 这是让判据反复摆动的**上游成因**。把 web 纳入 driver 活性面（或一条周期性 ensure-up）是一件独立且会改变生产行为的事，边界与落点尚未裁定 ⇒ **本任务只把它记为观察项 + 一条非门禁的承接线**（复用/拉起实例），⛔ 不把「必须有监督者」写成任何前置（硬规则 12：拿不出落点与边界裁定的前置不得拦路）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-297$' tasks/*.md` ⇒ **2** 命中（`gap-ac297-criterion-cmdline-port-literal-stale`、`gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title`），**status 全为 done** ⇒ 本 AC 无在飞主，本条不是重复立案。另有 `gap-criterion-live-web-address-derivation-17-copies-to-one`（status `ready`，**无** `goal_ac`）—— 它是把 17 份内联派生**收成一个三态助手**的收敛任务；本任务改的是 **AC-297 这一条判据的不可评估出口 + 其绑定夹具**，与该收敛任务**不重叠**（收敛任务不认领 AC-297，也不改本夹具的断言数值）；若收敛任务先落地，本任务的判据改动可能被它覆盖，届时本 AC 的**具体要求**仍是「不可评估出口读 `exit 3` 而其夹具测量它」。同机制、不同对象的既有任务全部 done：`gap-goal-gate-verdict-single-mapping-not-evaluated` 建立的是 exit 3 → not-evaluated 的**映射**，从未把任何**判据**迁到它上面；`gap-ac291/301/303-criterion-carrier-absence-not-evaluated` 各只改了**另一条** AC。

## Plan

1. **红基线**（⛔ 不假定仍是 `fail`）：`node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json`，逐字贴出 verdict；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 给出实例读数。若此刻**已有** cwd=仓库根的活实例，这一读数多半是 `pass` —— 那本身就是「载体在不在决定取值」的证据，照记；若**无**实例，就是本条立案读数。
2. **取修订前指纹**：确认台账尾（或 `quay goal show AC-297 --json`）的 `criterionHash` = `1374f0d89eb3ccc6`，供 AC6① 对照。
3. **枚举两条不可评估分支与十条断言分支**（⛔ 先枚举再改）：从 `goals/AC-297-*.md` 抽出 criterion 全文（解析后的逻辑行），数出 `exit 1` = 11 处、`exit 3` = 0 处，并逐条归到上表的两类；贴出这份枚举。
4. **改判据（`fail()` 一处 → exit 3）**：**只**把 `fail()` 助手（第 54 行）尾部的 `exit 1` 改 `exit 3`，其余逐字保留（含一个「为什么改」的单一逻辑行注释块）；经 `quay goal write AC-297 --criterion "$(cat <新判据文件>)"` 落库。⚠️ 注释保持单一逻辑行。⛔ 不手工 Edit `goals/*.md`。
5. **同步夹具**：`packages/quay/test/ac297-criterion-address-derivation.test.mjs` 的 4 条不可评估负例断言 `code` 由 `1` 改 `3`，正例与第 404 行的 `code === 1` 逐字不动；`node --test packages/quay/test/ac297-criterion-address-derivation.test.mjs` ⇒ 全绿。
6. **正控制**：确认（若无则拉起）一个 cwd=仓库根的 `quay.ts serve`，`node packages/quay/bin/quay.js goal gate AC-297`（主检出根）⇒ **exit 0**，四段断言各自独立可核（en nav 含 `Git History` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav 该字面量计数 =0 / zh `<title>` ≠ en `<title>`）。
7. **不可评估态控制**：在**无**实例的 scratch 根上 `quay goal gate AC-297 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`；⛔ 不必停掉生产实例。
8. **负控制（行为，不是文本 diff）**：造一个真实监听但 zh 未翻译的 `/git-history` 活面（脚本自造的临时根 + 真 http server + 生产 argv 形状的 serve 子进程 + 载体），跑整条 criterion ⇒ **`exit 1`** 且 `CAUSE=nav-label-untranslated` 可区分。⛔ 该活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
9. **新指纹落账**：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1` 使 AC-297 以新 `criterionHash` 落一条 `pass`（⚠️ 不带 `env -u …` 时 sweep 会 `refused:true, eligible:0`）；贴出台账新增行的逐字 JSON。若生产 goal driver 的轮转已先落下带新指纹的 `pass`，照贴那条，并说明它是自动落下的。
10. **不回归**：`bash scripts/test.sh --for-task gap-ac297-criterion-carrier-absence-not-evaluated` 绿；家族枚举逐文件对照（六个 token 各 17 / 6 / 10 / 10 / 8 / 17）。

## AC

- [ ] **AC1（不可评估出口已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `fail()` 的出口由 `exit 1` 变 `exit 3`（该出口被第 77 行 `no-running-serve-instance` 与第 78 行 `no-derivable-address` 两条分支共用）；`expect` 与十条断言分支逐字相同（`exit 1` 计数 11 → 10，`exit 3` 计数 0 → 1，解析后逐行贴出）。⛔ 未经 `quay goal write` 落库不算。
- [ ] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac297-criterion-address-derivation.test.mjs` 的 4 条不可评估负例断言 `code === 3`（行 248/269/288/305）、4 条正例仍 `code === 0`（行 175/190/212/233）、第 404 行 `code === 1`（`en-fetch-failed` 强度基线）逐字未动；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `code === 1` 断言下的对照（`git show <old>:<file>`）证明这 4 条确实 1 → 3。
- [ ] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-297` ⇒ **exit 0**，逐字贴出；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、argv 含 `quay.ts serve` 的活进程。
- [ ] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/git-history` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分，逐字贴出。⛔ 该证据的活面由夹具/脚本自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [ ] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-297 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [ ] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-297` 最新一条带 `payload.criterionHash` 的事件为 `verdict:"pass"`，其 `criterionHash` **≠** `1374f0d89eb3ccc6`（修订前后两行都贴，并注明哪条由生产轮转自动写下）；② `bash scripts/test.sh --for-task gap-ac297-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出（`no-running-serve-instance` 17 / `no-derivable-address` 6 / `no-derivable-serve-address` 10 / `no-reachable-serve-address` 10 / `workspace-root-unresolvable` 8 / `.quay/server.json` 17），并说明本任务只改 AC-297 一条的不可评估出口。
- [ ] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下派发/执行时 `ps aux | grep -c '[q]uay-task-worker'` 的读数与「本实例无监督者、死亡后不会被自动拉回」的观察项及其发生率读数。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实运行的服务上为真、且三态可区分的判据落了账**：

1. **落地对象**：`goals/AC-297-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit）；**且**一个 cwd = 仓库根的 `quay.ts serve` 实例在跑（复用现成的或从主检出 HEAD 起）—— 只改文本不算落地。
2. **三态齐备（同一条判据给出三个互不同形的取值）**：活实例 + 真接线 ⇒ **`exit 0` / `pass`**；可达但 zh 未翻译 ⇒ **`exit 1` / `fail`**；无实例 ⇒ **`exit 3` / `not-evaluated`（⛔ 非 fail、非 pass）**。三者各自的逐字读数进 Evidence。
3. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-297` / `gate=goal` / `verdict:"pass"` 的新事件，其 `criterionHash` **≠** `1374f0d89eb3ccc6` —— **一条 dry-run 输出不算**。
4. **动机随判据进记录**：`quay goal write` 落库的 criterion 里带着「为什么改」的注释与读数（载体缺席 ≠ 为假；`exit 3` 是仓库在 `goal-store.ts` 写死的约定；AC-297 无 `no-reachable-serve-address` 分支、其「无人应答」由 `en-fetch-failed` 断言承载的理由），而不是只留在本任务体里。
5. **可回滚**：写明回滚形态（用旧 criterion 文本重跑 `quay goal write` + 还原夹具 + 重跑 `node --test <夹具>`）与它的作用域（纯本地文本 + 一处测试断言，无外部状态）。

## Touches

- goals/AC-297-git-history-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac297-criterion-address-derivation.test.mjs
- tasks/gap-ac297-criterion-carrier-absence-not-evaluated.md

（说明：第一条是落地面 —— 不可评估出口的**退出码**，经 `quay goal write AC-297 --criterion …` 落库，`expect` 与分支文本逐字不变；第二条是与该块逐字绑定的夹具（4 条不可评估负例断言随之同步，正例与第 404 行的 `en-fetch-failed` 断言不动）；第三条是 self-touch。⛔ `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**（前者是观察项非目标，后者是夹具自造活面的约束）。运行时证据落 `.quay/` **保持未跟踪**，故不声明 —— `anti-drift-touches-check` 只比对已跟踪文件。）