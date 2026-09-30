---
id: gap-ac290-criterion-carrier-absence-not-evaluated
title: "AC-290 判据把「活载体缺席」记成「此刻为假」——地址派生那步的四个不可评估分支（workspace-root-unresolvable /
  no-derivable-serve-address / no-reachable-serve-address /
  no-running-serve-instance）以 exit 1 出声，违反仓库自己的约定（exit 3 =
  NOT-EVALUATED，goal-store.ts:311-318 逐字给出的例子正是「NOT-EVALUATED: carrier absent」）⇒
  driver 每轮把它当 confirmed-failing 立案；修法=四处改 exit 3 + 保持 cwd=仓库根的活实例使判据真 pass
  并落新指纹，以「接线破坏仍 exit 1」证明强度未减"
status: done
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-290
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-30T06:58Z，cwd = 主检出 `/data/home/yale/work/quay`）**

立案那一刻的读数（⛔ 非转述）：

```
node packages/quay/bin/quay.js goal gate AC-290 --dry-run --json
⇒ {"id":"AC-290","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-290 candidate readings (cwd=/data/home/yale/work/quay,
             nserve=0, ncand=1, nderived=0):; pid=2960710 addr=- cause=argv-no-serve-subcommand,carrier-pid-mismatch
             CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay;
             /tasks cannot be evaluated on a live surface (AC-179 probe pattern)"}
GATE_EXIT=1
```

**这条判据在「不可评估」与「为真」之间来回摆动**（硬规则 4b：用外部可核的量的时刻读，⛔ 不用它自己写的心跳）。同一个 `criterionHash = f62c0c486e26a83a` 的 AC-290 台账事件，70 分钟内先绿后红、再绿再红：

| 时刻 | actor | verdict | 该条 `payload.reason` 的致命段 |
|---|---|---|---|
| 2026-09-30T05:48:02.888Z | goal-sweep | **pass** | `acceptance passed (exit 0)` |
| 2026-09-30T06:50:33.896Z | goal-sweep | **fail** | `nserve=1, ncand=2, nderived=1 … pid=3652175 addr=127.0.0.1:20119 cause=derived-from-carrier-fetch-failed(curl-exit-56)` |
| 2026-09-30T06:51:20.740Z | goal-cli | **pass** | `acceptance passed (exit 0)` |
| 2026-09-30T06:55:21.152Z | goal-cli | **pass** | `acceptance passed (exit 0)` |
| 2026-09-30T06:58:14.312Z | goal-cli | **fail** | `nserve=0 … CAUSE=no-running-serve-instance` |

⇒ **判据的判据没变（同一指纹 3 次出现），变的是它的活载体（运行中的 `quay.ts serve`）在不在**。载体在 ⇒ `pass`；载体不在 ⇒ `exit 1` ⇒ 复核器把它读成「此刻为假」（下面「代价」一节给出那个映射）。

**成因不是页面退化，也不是接线失效 —— 是「无法评估」这个态被用 `exit 1` 报成了「为假」。**

### 判据的四段断言是真的；今天只是【有时】量不到

本 AC 的保证是「在**运行中的**服务上，`/tasks` 的 zh 切换相对 en 基线真实发生」。它的 `origin` 逐字写明操作前提：「需有一个 cwd=仓库根的 `quay serve` 实例在跑；实现落地后须重启该实例」。载体不在 ⇒ 这条保证**既没被证真也没被证假**，它是**不可评估**。

而**仓库自己已经为这个态规定了取值**（`packages/quay/src/goal-store.ts:311-318` 逐字）：

> …the criterion itself declared it (**exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」**)… ⛔ **NOT a failure**: "I cannot evaluate this HERE" must not share an output shape with "this is false"…

且这一取值已在**唯一**的映射函数里兑现：`packages/quay/src/gate/acceptance-runner.ts` 的 `verdictFromAcceptance` 把 `code === 3` 映成 `not-evaluated` / cause `declared`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，不含 3）。**AC-290 的判据今天违反的正是这条约定**：它的四个「无实例 / 不可派生 / 不可抵达 / 根不可解析」分支全部 `exit 1`。

### 代价（可核）：driver 每轮把它当 confirmed-failing 立案

`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck`（:628-700）三态分派，逐字是 `verdict === "fail"` ⇒ `outcome:"confirmed-failing"`（**立案照旧**）；`verdict === "pass"` ⇒ `cleared`（不立案）；其余（含 `not-evaluated`）⇒ `outcome:"not-evaluated"`（不立案）。所以 `exit 1` 与 `exit 3` 的差别，就是「每轮重复立案」与「不立案」的差别 —— 本轮这份任务本身就是该差别的产物。

发生率（硬规则 12：查历史，⛔ 不等下一轮）：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-290` 的事件共 **219** 条，其中 `payload.reason` 含 `no-running-serve-instance` 的 **2** 条，跨越 **2** 个日期（2026-09-23、2026-09-30）。⚠️ 这两个数**低估**该态的频次：`no-reachable-serve-address` 那一格（如上表 06:50:33 的 `curl-exit-56`）今天也在出声，而它同样 `exit 1`。家族面（GOAL-024 的 16 条 live-probe 判据逐字共享同一段 addr-derivation）：

```
grep -rlF '.quay/server.json'          goals/ | wc -l  =>  17
grep -rlF 'no-derivable-serve-address' goals/ | wc -l  =>  10
grep -rlF 'no-reachable-serve-address' goals/ | wc -l  =>  10
grep -rlF 'no-running-serve-instance'  goals/ | wc -l  =>  17
grep -rlF 'workspace-root-unresolvable' goals/ | wc -l =>  8
```

### 四条已 done 的任务都没碰这一个取值

| 任务 | done | 它做了什么 |
|---|---|---|
| `gap-ac290-tasks-page-zh-shell-lang-title-nav-current` | 2026-09-17 | `/tasks` **列表页**的 zh 接线（判据的**作用对象**；今天仍完整，见下） |
| `gap-ac290-criterion-cmdline-port-literal-stale` | 2026-09-23 | **重锚地址派生**（cmdline `--port 0` ⇒ 改从活宿主载体取）。它的验收只要求「无实例时**非 0**」—— `exit 1` 满足了当时的字面要求，而它正是把「查不成」与「为假」并成同一个取值的那一步 |
| `gap-ac291-criterion-carrier-absence-not-evaluated` | 2026-09-29 | **同一机制的另一条 AC**（AC-291）。它把三条分支改 `exit 3` 并保持活实例；⛔ 只改 AC-291 一条，未触碰 AC-290 的四个分支 |
| `gap-ac303-criterion-carrier-absence-not-evaluated` | 2026-09-29 | 同上，AC-303 一条；且它把 `no-reachable` **留在 `exit 1`**（判据不同、取舍不同，见下「一处家族分歧」） |

**前两条都没触及「不可评估该取什么值」** ⇒ 宿主 serve 一死（载体 `.quay/server.json` 今天 06:50:45 起、pid 2094594 已死），判据立刻以 `fail` 重现，driver 立刻再立案。这不是「早先的修复失效了（作用对象坏了）」，而是**早先两次修复各修了一层，而把两态并成一态的那一层从未被修**。

### 作用对象仍然完好（两条互相独立的读数，⛔ 不是推断）

**读数 ①（源码，按位置）**：`packages/quay/src/serve-task.ts` 的**列表页** `handleTaskList` 仍在四个点上吃 `cfg.lang` —— `htmlLangTag(cfg.lang)`（页头 lang 属性）、`pageTitle("Tasks", cfg.identity, cfg.lang)`（本页自己的 `<title>`）、`renderSiteNav("tasks", cfg.lang)`（nav 当前项）、`renderMobileChrome("tasks", pageNameFor("task list", cfg.lang), cfg.lang)`。⛔ 详情页（`/task/<id>`）的 `lang="en"` 是**出作用域**的，AC-290 的判据不查它。

**读数 ②（绑定夹具，实测）**：

```
$ node --test packages/quay/test/ac290-criterion-address-derivation.test.mjs
ℹ tests 13   ℹ pass 13   ℹ fail 0
```

⇒ 作用对象绿、夹具绿；唯一红的是**不可评估态的输出形状**。

### 四个修法的取舍

- ✗ `superseded` 本 AC：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**。
- ✗ `long-term: true`：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），取值混淆原样保留。
- ✗ 只把活实例拉回来：**不完整**。实例今天被 peer 拉起、明天会再死（今天 06:50→06:58 一趟内就死了 1 次），而判据仍会把每次缺席记成一处处「为假」并每轮立案。
- ✗ 只改 `exit 3`：**也不完整**。保证会在实例缺席时永久停在 not-evaluated，等于把守卫静默空转（硬规则 3b 的空转半边：判据恒真而什么也没验到，与「验过了」同形）。
- ✓ **① 四个可评估性分支改 `exit 3`；② 保持/拉起一个 cwd=仓库根的活实例，使判据在新指纹下落一条真 `pass`；③ 以「接线破坏仍 `exit 1`」的负控制证明强度未减。** 三条缺一不可。

### 修法必须满足的性质（⛔ 缺一不可）

1. **只动可评估性分支，不动断言分支**：改退出码的**只有**四处块尾分支 —— `FAIL=workspace-root-unresolvable`、`FAIL=no-derivable-serve-address`、`FAIL=no-reachable-serve-address`、`CAUSE=no-running-serve-instance`。断言分支（`en-fetch-failed` / `zh-fetch-failed` / `no-nav-region` / `no-nav-region-zh` / `english-baseline-missing` / `no-title-tag` / `html-lang-not-zh` / `nav-label-untranslated` / `no-title-tag-zh` / `title-unchanged`，共 **10** 条）**逐字不动、仍 `exit 1`**。⚠️ **先读实际文件再动手**：本任务立案时的枚举是 `exit 1` 共 **14** 处 = 4 可评估 + 10 断言；`exit 3` **0** 处。⛔ 不要照抄 AC-291（它只有 3 条可评估分支，**没有** `workspace-root-unresolvable`）；AC-290 **有**，且它是「根都解析不出」这一档最纯粹的不可评估。
2. **一处家族分歧，本任务的选择要写明理由**：`no-reachable-serve-address`（派生出地址但无人应答）在 AC-291/AC-292/AC-301 三处被改成 `exit 3`，而 AC-303 把它**留在 `exit 1`**。本任务选 **`exit 3`**，理由是今天实测的成因形态：06:50:33 那条 `derived-from-carrier-fetch-failed(curl-exit-56)` 的载体是**陈旧的**（活实例已换端口，载体仍写旧端口）—— 这是「读不到当下的实况」，不是「保证被证伪」。⚠️ 若执行轮实测到相反证据（例如载体全新、实例健在而端口真拒答），**改判 `exit 1` 并把该读数贴进 Evidence**；两种取舍都必须是有读数的，⛔ 不是风格选择。
3. **⛔ 不改 `expect`、不改作用域**：`<nav>…</nav>` 只对 nav 区块匹配、`<title>` 只对 title 匹配；⛔ 不新增第二份判据文件、不新增 `CAUSE=` / `FAIL=` 行（夹具里对 `CAUSE=` 行的 **11** 条计数断言必须继续绿）。
4. **判据仍能取假（正/负控制各一条）**：活实例 + 真接线 ⇒ `exit 0`；活实例 + 故意不翻译的 zh 响应 ⇒ **`exit 1`** 且以 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分。
5. **新指纹落账**：经 `quay goal write AC-290 --criterion …` 落库（⛔ **不**手工 Edit `goals/AC-290-*.md`），随后 `quay goal gate AC-290` 在活实例上 `exit 0`，台账新增 `item_id=AC-290` / `gate=goal` / `verdict:"pass"` 且 `criterionHash` **≠** `f62c0c486e26a83a` 的事件。
6. **逐字夹具同步**：`packages/quay/test/ac290-criterion-address-derivation.test.mjs` 用 `# >>> addr-derivation` / `# <<< addr-derivation` 把该块**逐字**抽出执行（它是一份测量，不是回声）。其 **7** 个 `code === 1` 断言全是可评估性负例（`no-derivable` 及其 4 个子成因 carrier-pid-mismatch / carrier-no-web-service / carrier-web-down / carrier-unreadable、`no-reachable`、`no-running-serve-instance`），全部改 `3`；**全部 `code === 0` 正例（5 条）与第 ⑤ 组的 11 条 `CAUSE=` 计数断言逐字不动**。⚠️ 该夹具**没有** `workspace-root-unresolvable` 的用例 —— ⛔ 不要为它新造一个（那会改夹具语义）；也不要把 marker 引入/移出。
7. **⛔ 不新增 `plugin/scripts/*.ts`**（会触发 outline + capability-catalog + laydown 三处登记）；本任务不需要新脚本。
8. **判据文本的 YAML 约束**：criterion 是 folded scalar，`#` 注释必须保持**单一逻辑行**（注释里一个硬换行折回后会变成语法错）。
9. **在主检出根上跑闸**：活实例、`.quay/server.json` 载体与 `.quay/gate-events.jsonl` 都在**主检出**，而任务 worktree 的 `.quay/` 是刷新快照 ⇒ `quay goal gate AC-290` 必须在主检出根上跑，⛔ 不在 worktree 里跑。
10. **⛔ 不重启 peer 在飞 worker 依赖的服务**：派发/执行前 `ps aux | grep -c '[q]uay-task-worker'`；已有一个 cwd=仓库根的活实例在跑时**直接复用它**，只在**没有**实例时才从主检出 HEAD 拉起一个（用仓库既有启动器，⛔ 不手拼 `spawn`）。

<!-- dedup-ref -->
**明确的非目标（观察项，不进入本任务的任何门禁）**：`quay serve` **没有监督者**（web 不在 `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 六类里；`start-drivers.ts` 只在**被调用时**判 staleness/down）—— 这是让判据反复摆动的**上游成因**。把 web 纳入 driver 活性面（或一条周期性 ensure-up）是一件独立且会改变生产行为的事，边界与落点尚未裁定 ⇒ **本任务只把它记为观察项 + 一条非门禁的承接线**（复用/拉起实例），⛔ 不把「必须有监督者」写成任何前置（硬规则 12：拿不出落点与边界裁定的前置不得拦路）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-290$' tasks/*.md` ⇒ **2** 命中（`gap-ac290-tasks-page-zh-shell-lang-title-nav-current`、`gap-ac290-criterion-cmdline-port-literal-stale`），**status 全为 done** ⇒ 本 AC 无在飞主，本条不是重复立案。全仓 in-flight（todo/ready/needs-human）另有 `gap-criterion-live-web-address-derivation-17-copies-to-one`（status `ready`，**无** `goal_ac`）—— 它是把 17 份内联派生**收成一个三态助手**的收敛任务；本任务改的是 **AC-290 这一条判据的退出码 + 其绑定夹具**，与该收敛任务**不重叠**（收敛任务不认领 AC-290，也不改本夹具的断言数值）。同机制、不同对象的既有任务全部 done：`gap-goal-gate-verdict-single-mapping-not-evaluated` 建立的是 exit 3 → not-evaluated 的**映射**（三个写入点），从未把任何**判据**迁到它上面；`gap-not-evaluated-harness-third-state` 修的是 harness 层；`gap-goal-criteria-bare-failing-exit-unattributable` 修的是「失败出口不写成因」。

## Plan

1. **红基线**（⛔ 不假定仍是 `fail`）：`node packages/quay/bin/quay.js goal gate AC-290 --dry-run --json`，逐字贴出 verdict；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 给出实例读数。若此刻**已有** cwd=仓库根的活实例，这一读数多半是 `pass` —— 那本身就是「载体在不在决定取值」的证据，照记；若**无**实例，就是本条立案读数。
2. **取修订前指纹**：确认台账尾（或 `quay goal show AC-290 --json`）的 `criterionHash` = `f62c0c486e26a83a`，供 AC6① 对照。
3. **枚举四个分支与十条断言分支**（⛔ 先枚举再改）：从 `goals/AC-290-*.md` 抽出 criterion 全文（解析后的逻辑行），数出 `exit 1` = 14 处、`exit 3` = 0 处，并逐条归到上表的两类；贴出这份枚举。
4. **改判据（四处退出码 → 3）**：**只**把第 3 步归入「可评估性」的四条（`FAIL=workspace-root-unresolvable` / `FAIL=no-derivable-serve-address` / `FAIL=no-reachable-serve-address` / `CAUSE=no-running-serve-instance`）由 `exit 1` 改 `exit 3`，其余逐字保留（含一个「为什么改」的单一逻辑行注释块）；经 `quay goal write AC-290 --criterion "$(cat <新判据文件>)"` 落库。⚠️ 注释保持单一逻辑行。⛔ 不手工 Edit `goals/*.md`。
5. **同步夹具**：`packages/quay/test/ac290-criterion-address-derivation.test.mjs` 的 7 个可评估性负例断言 `code` 由 `1` 改 `3`，正例与 11 条 `CAUSE=` 计数断言逐字不动；`node --test packages/quay/test/ac290-criterion-address-derivation.test.mjs` ⇒ 全绿。
6. **正控制**：确认（若无则拉起）一个 cwd=仓库根的 `quay.ts serve`，`node packages/quay/bin/quay.js goal gate AC-290`（主检出根）⇒ **exit 0**，四段断言各自独立可核（en nav 含 `Tasks` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav 该字面量计数 =0 / zh `<title>` ≠ en `<title>`）。
7. **不可评估态控制**：在**无**实例的 scratch 根上 `quay goal gate AC-290 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`；⛔ 不必停掉生产实例。
8. **负控制（行为，不是文本 diff）**：造一个真实监听但 zh 未翻译的 `/tasks` 活面（脚本自造的临时根 + 真 http server + 生产 argv 形状的 serve 子进程 + 载体），跑整条 criterion ⇒ **`exit 1`** 且 `CAUSE=nav-label-untranslated` 可区分。⛔ 该活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
9. **新指纹落账**：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1` 使 AC-290 以新 `criterionHash` 落一条 `pass`（⚠️ 不带 `env -u …` 时 sweep 会 `refused:true, eligible:0`）；贴出台账新增行的逐字 JSON。若生产 goal driver 的轮转已先落下带新指纹的 `pass`，照贴那条，并说明它是自动落下的。
10. **不回归**：`bash scripts/test.sh --for-task gap-ac290-criterion-carrier-absence-not-evaluated` 绿；家族枚举逐文件对照（五个 token 各 17 / 10 / 10 / 17 / 8）。

## AC

- [x] **AC1（可评估性分支已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `FAIL=workspace-root-unresolvable`、`FAIL=no-derivable-serve-address`、`FAIL=no-reachable-serve-address`、`CAUSE=no-running-serve-instance` 四处由 `exit 1` 变 `exit 3`；`expect` 与十条断言分支逐字相同（`exit 1` 计数 14 → 10，`exit 3` 计数 0 → 4，解析后逐行贴出）。⛔ 未经 `quay goal write` 落库不算。
- [x] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac290-criterion-address-derivation.test.mjs` 的 7 个可评估性负例断言 `code === 3`、5 个正例仍 `code === 0`、第 ⑤ 组 11 条 `CAUSE=` 计数断言逐字未动；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `code === 1` 断言下的对照（`git show <old>:<file>`）证明这 7 条确实 1 → 3。
- [x] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-290` ⇒ **exit 0**，逐字贴出；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、argv 含 `quay.ts serve` 的活进程。
- [x] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/tasks` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分，逐字贴出。⛔ 该证据的活面由夹具/脚本自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [x] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-290 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [x] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-290` 最新一条带 `payload.criterionHash` 的事件为 `verdict:"pass"`，其 `criterionHash` **≠** `f62c0c486e26a83a`（修订前后两行都贴，并注明哪条由生产轮转自动写下）；② `bash scripts/test.sh --for-task gap-ac290-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出（五个 token 各 17 / 10 / 10 / 17 / 8），并说明本任务只改 AC-290 一条的退出码。
- [x] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下派发/执行时 `ps aux | grep -c '[q]uay-task-worker'` 的读数与「本实例无监督者、死亡后不会被自动拉回」的观察项及其发生率读数。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实运行的服务上为真、且三态可区分的判据落了账**：

1. **落地对象**：`goals/AC-290-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit）；**且**一个 cwd = 仓库根的 `quay.ts serve` 实例在跑（复用现成的或从主检出 HEAD 起）—— 只改文本不算落地。
2. **三态齐备（同一条判据给出三个互不同形的取值）**：活实例 + 真接线 ⇒ **`exit 0` / `pass`**；可达但 zh 未翻译 ⇒ **`exit 1` / `fail`**；无实例 ⇒ **`exit 3` / `not-evaluated`（⛔ 非 fail、非 pass）**。三者各自的逐字读数进 Evidence。
3. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-290` / `gate=goal` / `verdict:"pass"` 的新事件，其 `criterionHash` **≠** `f62c0c486e26a83a` —— **一条 dry-run 输出不算**。
4. **动机随判据进记录**：`quay goal write` 落库的 criterion 里带着「为什么改」的注释与读数（载体缺席 ≠ 为假；`exit 3` 是仓库在 `goal-store.ts:311-318` 写死的约定；AC-303 在 `no-reachable` 上的分歧与本任务的选择理由），而不是只留在本任务体里。
5. **可回滚**：写明回滚形态（用旧 criterion 文本重跑 `quay goal write` + 还原夹具 + 重跑 `node --test <夹具>`）与它的作用域（纯本地文本 + 一处测试断言，无外部状态）。

## Touches

- goals/AC-290-tasks-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
- packages/quay/test/ac290-criterion-address-derivation.test.mjs
- tasks/gap-ac290-criterion-carrier-absence-not-evaluated.md

（说明：第一条是落地面 —— 地址派生那步的**退出码**，经 `quay goal write AC-290 --criterion …` 落库，`expect` 与分支文本逐字不变；第二条是与该块逐字绑定的夹具（7 个可评估性负例断言随之同步，正例与 11 条 `CAUSE=` 计数断言不动）；第三条是 self-touch。⛔ `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**（前者是观察项非目标，后者是夹具自造活面的约束）。运行时证据落 `.quay/` **保持未跟踪**，故不声明 —— `anti-drift-touches-check` 只比对已跟踪文件。）
## Evidence（执行轮，2026-09-30T07:04–07:20Z，worker worktree `/data/home/yale/work/quay-worktrees/gap-ac290-criterion-carrier-absence-not-evaluated`）

**AC1 — 四处可评估性分支改 `exit 3`，经 `quay goal write` 落库（⛔ 非手工 Edit `goals/*.md`）。**
落库提交：主检出 `ba5c68791` + `b1a87e583`；worktree `d966e8433` + `b1a87e583`（两处 blob 逐字节相同，`git rev-parse` 对照）。
判据正文 **107 行，只有 4 行改变**（逐行全量对照，⛔ 不是抽查）：

```
line 22:  FAIL=workspace-root-unresolvable … >&2; exit 1; fi   ⇒  … >&2; exit 3; fi
line 83:  FAIL=no-derivable-serve-address … >&2; exit 1; fi   ⇒  … >&2; exit 3; fi
line 84:  FAIL=no-reachable-serve-address … >&2; exit 1; fi   ⇒  … >&2; exit 3; fi
line 85:  CAUSE=no-running-serve-instance … >&2; exit 1; fi   ⇒  … >&2; exit 3; fi
```

计数（解析后的逻辑行）：含 `exit 1` 的行 **14 → 10**；结尾为 `exit 3; fi` 的**分支行** **0 → 4**。
（`exit 3` 这个子串在整段文本里出现 5 次，第 5 次在注释里逐字引用仓库自己的约定
`"exit 3 -- this repo's convention, e.g. NOT-EVALUATED: carrier absent"` —— 与同样已落地的 AC-292 的注释逐字同形；
**判据分支的计数是 4**，注释里的那次是引用，⛔ 两者不可混计。）
`expect` 写前写后逐字相同；`<<< addr-derivation` 之后的十条断言分支与全部 `FAIL=`/`CAUSE=` 分支逐字未动；
每条注释都是**单一逻辑行**（folded scalar 约束）。写后回读 `quay goal show AC-290 --json` 的 criterion
与写前准备的文本**逐字节相同**（round-trip 已验，⛔ 不是「写进去了大概对」）。

**AC2 — 夹具同步（7 条 1 → 3；正例与 11 条 `CAUSE=` 计数断言逐字不动）。**
修订前 `git show develop:packages/quay/test/ac290-criterion-address-derivation.test.mjs | grep -n 'assert.equal(r.code'`
⇒ 5 条 `code, 0` + 7 条 `code, 1`（行 381 / 406 / 425 / 444 / 464 / 486 / 505，全部是可评估性负例）。
修订后同一命令 ⇒ 5 条 `code, 0` **逐字不变**、那 7 条变 `code, 3`，另加 §⑤b（结构性：恰好 4 条 `exit 3; fi`、
恰好 10 条 `exit 1`）与 §⑥（整条判据的行为控制，2 例：wired ⇒ 0，unwired ⇒ 1）。
第 ⑤ 组 11 条 `CAUSE=` 计数断言逐字未动；经 `quay goal show` 回读该判据的 `CAUSE=` 行数仍为 **11**。
`node --test packages/quay/test/ac290-criterion-address-derivation.test.mjs` ⇒ `tests 16 / pass 16 / fail 0`。
**夹具本身可取假（突变对照）**：把 §⑥ 的 `TASKS_ZH_UNTRANSLATED` 常量临时改指到 wired 体后重跑 ⇒
**只有** §⑥ 那条失败用例转红（15 pass / 1 fail），其余 15 条逐字不变 ⇒ 该断言不是空转；改回后 16/16 再次全绿
（对照后 `md5sum` 证明文件已逐字节还原）。

**AC3 — 正控制（活实例上真 `pass`）。**
活实例由仓库自己的启动器拉起（`node packages/quay/bin/quay.js server start --only web --host 127.0.0.1`；
⛔ 不手拼 spawn、⛔ 未碰任何 driver、⛔ 未重启 peer 在飞 worker 依赖的任何服务）：

```
pid=438577  cwd=/data/home/yale/work/quay
argv=…/node --no-warnings --experimental-strip-types …/packages/quay/bin/quay.ts serve --host 127.0.0.1
.quay/server.json: pid=438577 startedAt=2026-09-30T07:10:02.925Z  web 127.0.0.1:23311 up:true
$ node packages/quay/bin/quay.js goal gate AC-290
{ "id": "AC-290", "verdict": "pass", "cause": null, "reason": "acceptance passed (exit 0)", "timeoutMs": 60000,
  "timestamp": "2026-09-30T07:14:59.792Z", "dryRun": false, … }
GATE_EXIT=0
```

四段断言各自独立可核（判据源码里逐条可读）：en nav 含 `Tasks`、zh 响应含 `<html lang="zh"`、
zh nav 里该英文字面量计数为 0、zh `<title>` ≠ en `<title>`。

**AC4 — 负控制（行为读数，不是文本 diff；活面由脚本自造，⛔ 未改任何 `packages/quay/src/serve-*.ts`）。**
`/tmp/ac290-negative-control.mjs`：临时 `git init` 根 + 真 http server（按 `Cookie: lang=zh` 给两副响应体）
+ 真 serve 形状子进程（`quay.ts serve --host 127.0.0.1 --port N`，N≥1）+ 判据自己的 `pgrep`/`curl` 探针；
喂给它的判据文本取自 `quay goal show AC-290 --json`（⛔ 不是判据的副本，是同一份文本）。逐字读数：

```
── CASE=zh-nav-WIRED
   surface: pid=849862 quay.ts serve --host 127.0.0.1 --port 14205 (cwd=/tmp/ac290-neg-ING6AM), listener answers /tasks
   criterion rc = 0
   stdout = "AC-290 serve address derived from argv as 127.0.0.1:14205 … OK -- /tasks: default nav region carries \"Tasks\" …"
── CASE=zh-nav-UNTRANSLATED
   surface: pid=850404 quay.ts serve --host 127.0.0.1 --port 26461 (cwd=/tmp/ac290-neg-ING6AM), listener answers /tasks
   criterion rc = 1
   stderr = "CAUSE=nav-label-untranslated -- the nav region of /tasks under Cookie: lang=zh still renders the literal English nav label \"Tasks\"; the nav is not wired to the zh dictionary"
```

⇒ 接线一破，判据仍以 **1** 出声、且以 `CAUSE=nav-label-untranslated` 与可评估性态**不同形**。

**AC5 — 三态可区分（同一条判据，三个互不同形的取值）。**
无活实例（scratch `git init` 根 + 同一份判据，`--dry-run`；⛔ 未停生产实例）：

```
$ node …/quay.js goal gate AC-290 --dry-run --json --root /tmp/ac290-scratch
{ "verdict": "not-evaluated", "cause": "declared",
  "reason": "not-evaluated (declared): acceptance failed (exit 3) — AC-290 candidate readings (cwd=/tmp/ac290-scratch, nserve=0, ncand=1, nderived=0): … CAUSE=no-running-serve-instance …" }
```

活实例 + 真接线 ⇒ `"verdict": "pass"`（AC3 逐字）；可达但 zh 未翻译 ⇒ `rc = 1` + `CAUSE=nav-label-untranslated`（AC4 逐字）。
⇒ `pass` / `fail` / `not-evaluated` 三值互不同形，**且「不可评估」不再与「为假」共用输出**。

**AC6 — 新指纹落账 + 不回归 + 家族枚举。**
① 台账 `.quay/gate-events.jsonl`，`item_id=AC-290`，**修订前最后一条带指纹**的事件：
```
{"id":"54d8ef80-b55a-4107-932f-f1cc8001d97b","item_id":"AC-290","gate":"goal","actor":"goal-sweep","verdict":"fail",
 "timestamp":"2026-09-30T06:50:33.896Z","payload":{…,"criterionHash":"f62c0c486e26a83a"}}
```
**修订后最新一条带指纹**的事件：
```
{"id":"ececec59-24d6-4b8d-b2d9-9c93175a7fc6","item_id":"AC-290","gate":"goal","actor":"goal-amend","verdict":"pass",
 "timestamp":"2026-09-30T07:14:22.365Z","payload":{"reason":"acceptance passed (exit 0)","criterionHash":"5554701a9b826a78"}}
```
⇒ `verdict:"pass"` ∧ `criterionHash 5554701a9b826a78 ≠ f62c0c486e26a83a`。
**哪条是谁写的**：06:50:33Z 那条是**生产轮转自动**落下的（修订前文本，载体缺席 ⇒ `fail`）；
07:07:16Z 有一条 `actor:"goal-amend"` / `verdict:"not-evaluated"` / `criterionHash:"d2ed0b103c80cd63"`，
也是**生产 goal-driver 的轮转自动**落下的 —— 判据一改，上一轮结尾的指纹就不对，下一轮轮转把它优先复验，
当时无实例 ⇒ 它落的是 `not-evaluated`（**同一个「载体缺席」，修订前落 `fail`、修订后落 `not-evaluated`**，
这正是本任务要的那条分界）。07:14:22Z 那条 `pass` 由本轮**显式**触发的一次 bounded rotation 写下：
`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1`
（不加 `env -u` 时该命令自报 `refused`，故必须加）；它 pick 到 AC-290 是因为该 AC 被本轮的判据修订
标成「amend 优先」，与年龄无关。`quay goal check --stale-pass` 现报 `notEvaluated: []`、`AC-290 ∈ verifiedFresh`。
② `bash scripts/test.sh --for-task gap-ac290-criterion-carrier-absence-not-evaluated --allow-thin` ⇒ **exit 0**
（夹具 16/16 绿，dist build 通过）。
③ 家族枚举（`grep -rlF <token> goals/ | wc -l`，每个 token 同时打印前 3 条命中以确认谓词命中的是我要的东西）：
`.quay/server.json` **17**、`no-derivable-serve-address` **10**、`no-reachable-serve-address` **10**、
`no-running-serve-instance` **17**、`workspace-root-unresolvable` **8** —— 与本任务立案时逐字相同。
本任务**只改 AC-290 一条**的退出码；家族里其余 16 条判据的退出码逐字未动（各归自己的立案轮）。

**AC7 — 非目标边界未被越过。**
`git diff --name-only develop...HEAD` ⇒ 恰好两条：`goals/AC-290-*.md`、`packages/quay/test/ac290-criterion-address-derivation.test.mjs`
（外加 self-touch 的 `tasks/<id>.md`，其变更经 ABI 落库）。对该列表 `grep -E 'plugin/scripts/|packages/quay/src/serve-|driver-anchor|start-drivers'`
⇒ **零命中**：⛔ 未改 `plugin/scripts/driver-anchor.ts`、⛔ 未改 `plugin/scripts/start-drivers.ts`、
⛔ 未改任何 `plugin/scripts/*.ts`（⛔ 也未新增脚本）、⛔ 未改任何 `packages/quay/src/serve-*.ts`。
派发/执行时 `ps aux | grep -c '[q]uay-task-worker'` = **2**（本轮执行中另行读到 1）。
**观察项（非门禁，⛔ 未被写成任何前置）**：`quay serve` 没有监督者 ⇒ 该实例一旦死亡不会被自动拉回。
本轮实测的频次读数：台账 `item_id=AC-290` 事件共 **219** 条，其中 `no-running-serve-instance` **2** 条
（跨 2026-09-23、2026-09-30 两个日期）、`no-reachable-serve-address` **1** 条。
本轮的活实例正是按任务许可「**只在没有实例时**才拉起」启的（执行前实测：cwd=仓库根的 `serve` **零个**，
载体 `.quay/server.json` 的 pid 2094594 已死）。

**DoD 5 — 可回滚。**
回滚形态：`node packages/quay/bin/quay.js goal write AC-290 --criterion "$(cat <修订前的判据全文>)"`，
再把夹具还原到 develop 版（`git checkout develop -- packages/quay/test/ac290-criterion-address-derivation.test.mjs`）
并重跑 `node --test <该文件>`。作用域 = **一处判据文本 + 一处测试断言**的纯本地改动，**无外部状态**：
⛔ 未改产品源码、⛔ 未改任何 driver、⛔ 未新增脚本、⛔ 未动 `.gitignore` 或任何配置。
