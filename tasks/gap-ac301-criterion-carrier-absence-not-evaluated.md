---
id: gap-ac301-criterion-carrier-absence-not-evaluated
title: "AC-301 判据把「活载体缺席」记成「此刻为假」——地址派生那步的四个可评估性分支以 exit 1 出声，违反仓库自己的约定（exit 3 =
  not-evaluated，goal-store.ts 逐字给出的例子正是「NOT-EVALUATED: carrier absent」）⇒ driver
  每轮把它当 confirmed-failing 立案；修法=四处改 exit 3 + 保持 cwd=仓库根的活实例使判据真 pass
  并落新指纹，以「接线破坏仍 exit 1」证明强度未减"
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-301
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-29，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-301 --dry-run --json   # 2026-09-29T02:05:58.462Z（台账尾，actor goal-sweep）
⇒ {"item_id":"AC-301","verdict":"fail",
   "reason":"acceptance failed (exit 1) — AC-301 candidate readings (cwd=/data/home/yale/work/quay,
             nserve=0, ncand=1, nderived=0):; pid=3588962 addr=- cause=argv-no-serve-subcommand,carrier-pid-mismatch
             CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay;
             /goal cannot be evaluated on a live surface (AC-179 probe pattern)",
   "criterionHash":"56de07b5a4505f73"}
GATE_EXIT=1
```

02:06:52.172Z 台账又落一条同形 `fail`（`pid=3614499`，同 `CAUSE=no-running-serve-instance`）。**约一分钟后一个无关的 peer worker 在 02:07:52.833Z 顺手重启了 serve**（载体 `.quay/server.json` 的 `startedAt`），复跑判据三次，三次全部 `verdict:"pass"` / `exit 0` —— 也就是说，这条判据**在「不可评估」与「为真」之间来回摆动，而它把前者记成了「为假」**。

同一时刻的三面读数（⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 判据（立案时） | `verdict:"fail"`、`exit 1`、`nserve=0`、`CAUSE=no-running-serve-instance` | 台账 `2026-09-29T02:05:58.462Z` / `02:06:52.172Z` |
| 判据（重启后复跑 ×3） | `verdict:"pass"`、`exit 0`、`reason:"acceptance passed (exit 0)"` | `quay goal gate AC-301 --dry-run --json` @2026-09-29T02:11:54Z（连跑 3 次同值） |
| 活实例（重启后） | `pid=3652175`，`cwd=/data/home/yale/work/quay`，argv `--host 127.0.0.1` **无 `--port`**（内核分配），载体报 web `127.0.0.1:20119` `up:true`，`startedAt 2026-09-29T02:07:52.833Z` | `pgrep -af 'quay.ts serve'` + `readlink /proc/3652175/cwd` + `cat .quay/server.json` |
| 修订前指纹 | `criterionHash:"56de07b5a4505f73"`（02:05:58 那条） | `.quay/gate-events.jsonl` |

**成因既不是判据的机制坏了（页面的 zh 接线今天是绿的：`/goal` 在活实例上判据 `exit 0`，四条断言全过），也不是 `/goal` 页面退化了 —— 是【判据的活载体（运行中的 `quay serve`）会缺席，而判据把「无法评估」这个态用 `exit 1` 报成了「此刻为假」。**

### 判据的四条断言是真的；今天只是【有时】量不到

本 AC 的保证是「在**运行中的**服务上，/goal 的 zh 切换相对 en 基线真实发生」。它的 `origin` 逐字写明操作前提：「需有一个 cwd=仓库根的 `quay serve` 实例在跑；实现落地后须重启该实例」（`goals/AC-301-*.md` 的 `origin`）。载体不在 ⇒ 这条保证**既没被证真也没被证假**，它是**不可评估**。

而**仓库自己已经为这个态规定了取值**（`packages/quay/src/goal-store.ts:305-318` 逐字）：

> …the criterion itself declared it (**exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」**)… ⛔ **NOT a failure**: "I cannot evaluate this HERE" must not share an output shape with "this is false"…

且这一取值已在**唯一**的映射函数里兑现：`packages/quay/src/gate/acceptance-runner.ts` 的 `verdictFromAcceptance` 把 `code === 3` 映成 `not-evaluated` / cause `declared`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，不含 3）。**AC-301 的判据今天违反的正是这条约定**：它的四个可评估性分支全部 `exit 1`。

### 代价（可核）：driver 每轮把它当 confirmed-failing 立案

`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck` 三态分派：`verdict === "fail"` ⇒ `outcome:"confirmed-failing"`（**立案**）；`verdict === "pass"` ⇒ `cleared`（不立案）；其余（含 `not-evaluated`）⇒ `outcome:"not-evaluated"`（不立案）。所以 `exit 1` 与 `exit 3` 的差别，就是「每轮重复立案」与「不立案」的差别 —— 本轮这份任务本身就是该差别的产物。同理，AC-242 元判据的 fail reason 逐字是 `stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: … AC-301 …`（台账 `2026-09-29T02:06:46.776Z`：`AC-291, AC-292, AC-301, AC-303`；该串提及 AC-301 的 AC-242 事件共 **62** 条）。

发生率（硬规则 12：查历史，⛔ 不等下一轮）：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-301` 的事件共 **212** 条，其中含 `no-running-serve-instance` 的 **2** 条，均在 **2026-09-29**（`02:05:58.462Z` goal-sweep、`02:06:52.172Z` goal-cli），verdict 全为 `fail`。家族面（GOAL-024 的 16 条 live-probe 判据逐字共享同一段 addr-derivation）：含该 token 的 goal 文件 **17** 个，含 `no-derivable-serve-address` 的 **10** 个，含 `no-reachable-serve-address` 的 **10** 个，含 `workspace-root-unresolvable` 的 **8** 个。

### 更早的两条 done 任务都没碰这一个取值

| 任务 | done | 它做了什么 |
|---|---|---|
| `gap-ac301-goal-page-zh-chrome-nav-current-and-own-title` | 2026-09-17 | 页面本身的 lang / `<title>` / nav 当前项接线（保证的**作用对象**；今天仍绿） |
| `gap-ac301-criterion-cmdline-port-literal-stale` | 2026-09-23 | **重锚地址派生**（cmdline `--port 0` ⇒ 改从活宿主载体取）。其 Plan 只要求「无实例时**非 0**」—— `exit 1` 满足了当时的字面要求，而它正是把「查不成」与「为假」并成同一个取值的那一步 |

**两条都没触及「不可评估该取什么值」** ⇒ 宿主 serve 一死（上次载体写入停在 2026-09-25 18:08，2026-09-29T02:05 转红），判据立刻以 `fail` 重现，driver 立刻再立案。这不是「早先的修复失效了」，而是**早先两次修复各修了一层，而把两态并成一态的那一层从未被修**。

### 四个修法的取舍

- ✗ `superseded` 本 AC：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**。
- ✗ `long-term: true`：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），取值混淆原样保留。
- ✗ 只把活实例拉回来：**不完整**。实例今天被 peer 拉起、明天会再死（09-25 → 09-29 已死 1 次且无人拉回），而判据仍会把每次缺席记成一处「为假」并每轮立案。
- ✗ 只改 exit 3：**也不完整**。保证会在实例缺席时永久停在 not-evaluated，等于把守卫静默空转（硬规则 3b 的空转半边：判据恒真而什么也没验到，与「验过了」同形）。
- ✓ **① 四个可评估性分支改 `exit 3`；② 保持/拉起一个 cwd=仓库根的活实例，使判据在新指纹下落一条真 `pass`；③ 以「接线破坏仍 `exit 1`」的负控制证明强度未减。** 三条缺一不可。

### 修法必须满足的性质（⛔ 缺一不可）

1. **只动可评估性分支，不动断言分支**：改退出码的**只有**四处块尾分支 —— `FAIL=workspace-root-unresolvable`（`goals/AC-301-*.md` 第 72-75 行）、`FAIL=no-derivable-serve-address`（第 172-175 行）、`FAIL=no-reachable-serve-address`（第 178-181 行）、`CAUSE=no-running-serve-instance`（第 183-185 行）。断言分支（`en-fetch-failed` / `zh-fetch-failed` / `no-nav-region` / `no-nav-region-zh` / `english-baseline-missing` / `no-title-tag` / `html-lang-not-zh` / `nav-label-untranslated` / `no-title-tag-zh` / `title-unchanged`）**逐字不动、仍 `exit 1`**。⛔ AC-301 的那第四个分支（`workspace-root-unresolvable`）**是存在的**（AC-291 没有、AC-292 与 AC-301 有）—— 别照 AC-291 的三分支形态改。
2. **⛔ 不改 `expect`、不改作用域**：`<nav>…</nav>` 只对 nav 区块匹配、`<title>` 只对 title 匹配；⛔ 不新增第二份判据文件、不新增 `CAUSE=` 行 —— 夹具里「恰好 **11** 条 `CAUSE=` 行」的断言必须继续绿（`no-running-serve-instance` 是这 11 条之一，其**文本**逐字保留，只改它那一行的退出码）。
3. **判据仍能取假（正/负控制各一条）**：活实例 + 真接线 ⇒ `exit 0`；活实例 + 故意不翻译的 zh 响应 ⇒ **`exit 1`** 且以 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分。⛔ 只证明「不再报假」不够 —— 必须同时证明**该报假时仍报假**。
4. **新指纹落账**：经 `quay goal write AC-301 --criterion …` 落库（⛔ **不**手工 Edit `goals/AC-301-*.md`），随后 `quay goal gate AC-301` 在活实例上 `exit 0`，台账新增 `item_id=AC-301` / `gate=goal` / `verdict:"pass"` 且 `criterionHash` **≠** 修订前指纹 `56de07b5a4505f73` 的事件。
5. **逐字夹具同步**：`packages/quay/test/ac301-criterion-address-derivation.test.mjs` 用 `# >>> addr-derivation` / `# <<< addr-derivation` 把该块**逐字**抽出执行（它是一份测量，不是回声），其 **7** 处 `assert.equal(r.status, 1, …)`（第 208 / 221 / 237 / 249 / 261 / 274 / 287 行，全部是可评估性负例）改为 `3`；**2** 处 `assert.equal(r.status, 0, …)` 正例（第 170 / 185 行）与第 323 行的 `sh -n` 断言**逐字不动**；断言侧那条「keeps its eleven pre-amendment CAUSE refusal branches」测试**逐字不动**（它统计 `CAUSE=` 计数 = 11 与 `ROUTE="/goal"` / `LABEL_EN="Goals"`，本修法不改这些）。
6. **⛔ 不新增 `plugin/scripts/*.ts`**（会触发 outline + capability-catalog + laydown 三处登记）；本任务不需要新脚本。
7. **判据文本的 YAML 约束**：criterion 是 folded scalar，`#` 注释必须保持**单一逻辑行**（注释里一个硬换行折回后会变成语法错）。
8. **在主检出根上跑闸**：活实例、`.quay/server.json` 载体与 `.quay/gate-events.jsonl` 都在**主检出**，而任务 worktree 的 `.quay/` 是刷新快照 ⇒ `quay goal gate AC-301` 必须在主检出根上跑，⛔ 不在 worktree 里跑。
9. **⛔ 不重启 peer 在飞 worker 依赖的服务**：派发/执行前 `ps aux | grep -c '[q]uay-task-worker'`；已有一个 cwd=仓库根的活实例在跑时**直接复用它**（今天就是这种情形：`pid=3652175`），只在**没有**实例时才从主检出 HEAD 拉一个。

<!-- dedup-ref -->
**与在飞的 AC-291 / AC-292 同机制任务的边界**：`gap-ac291-criterion-carrier-absence-not-evaluated`（status `todo`，`goal_ac: AC-291`）与 `gap-ac292-criterion-carrier-absence-not-evaluated`（status `ready`，`goal_ac: AC-292`）各自自限「本任务只改自己那一条，其余 16 个文件各自归自己的立案轮」。AC-301 正是那 16 个之一：三者改的是**不同的 goal 文件 + 不同的夹具文件**。**形态上 AC-301 逐字采用 AC-292 那一版（四个可评估性分支）**，⛔ 不是 AC-291 的三分支版（AC-301 有 `FAIL=workspace-root-unresolvable`，实测该 token 在 AC-301 的 criterion 第 72 行存在）。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-301' tasks/*.md` ⇒ **2** 命中（`gap-ac301-goal-page-zh-chrome-nav-current-and-own-title`、`gap-ac301-criterion-cmdline-port-literal-stale`），**status 全为 done** ⇒ 本 AC 无在飞主，⛔ 不是重复立案。⚠️ 一个 `done`/`superseded` 任务认领本 AC **不是**重复的证据 —— 它是「早先的修复没兜住取值混淆这一层」的证据（硬规则 12：查历史，两条 done 任务各自修的是页面接线与地址派生，从未碰「不可评估取什么值」）。全仓 in-flight 的同机制任务只有 AC-291 / AC-292 两条，各自认领**自己**的 AC，⛔ 不认领 AC-301。同机制、不同对象的既有任务全部 done 且**都不覆盖本条**：`gap-goal-gate-verdict-single-mapping-not-evaluated` 建立的是 exit 3 → not-evaluated 的**映射**（三个写入点），从未把任何**判据**迁到它上面；`gap-not-evaluated-harness-third-state` 修的是 harness 层；`gap-goal-criteria-bare-failing-exit-unattributable` 修的是「失败出口不写成因」。

<!-- dedup-ref -->
**明确的非目标（观察项，⛔ 不进入本任务的任何门禁）**：`quay serve` **没有监督者**（web 不在 `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 六类里；`start-drivers.ts` 只在**被调用时**判 staleness/down）—— 这是让判据反复摆动的**上游成因**。把 web 纳入 driver 活性面（或一条周期性 ensure-up）是一件独立且会改变生产行为的事，边界与落点尚未裁定 ⇒ **本任务只把它记为观察项 + 一条非门禁的承接线**（复用/拉起实例），**⛔ 不把「必须有监督者」写成任何前置**（硬规则 12：拿不出落点与边界裁定的前置不得拦路）。

## Plan

1. **红基线**（⛔ 不假定仍是 `fail`）：`node packages/quay/bin/quay.js goal gate AC-301 --dry-run --json`，逐字贴出 verdict；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 给出实例读数（今天应为 pass + 一个活实例 `pid=3652175`）。若此刻**无**实例，这一读数本身就是「不可评估」的证据，照记。
2. **取修订前指纹**：确认台账尾（或 `quay goal show AC-301 --json`）的 `criterionHash` = `56de07b5a4505f73`，供第 4 条与 AC/DoD 对照。
3. **改判据（四处退出码 → 3）**：从 `goals/AC-301-*.md` 抽出 criterion 全文，**只**把 `# >>> addr-derivation` 块尾那四处 `exit 1`（`workspace-root-unresolvable` / `no-derivable-serve-address` / `no-reachable-serve-address` / `no-running-serve-instance`）改为 `exit 3`，其余逐字保留；经 `quay goal write AC-301 --criterion "$(cat <新判据文件>)"` 落库。⚠️ 注释保持单一逻辑行。⛔ 不手工 Edit `goals/*.md`。
4. **同步夹具**：`packages/quay/test/ac301-criterion-address-derivation.test.mjs` 的 **7** 个可评估性负例断言 `status` 由 `1` 改 `3`（带 message 的两处逐字保留），第 170 / 185 / 323 行不动，断言侧「eleven CAUSE branches」测试不动；`node --test packages/quay/test/ac301-criterion-address-derivation.test.mjs` ⇒ 全绿。
5. **补一条断言侧负控制（仍在同一夹具文件内）**：让该文件除逐字块之外，再跑**整条 criterion**（同一 `criterionText()` 读法）对一个 scratch `git init` 根里的**serve 形进程 + 载体 + 一个真实监听但 zh 未翻译的 `/goal`** ⇒ 断言 `exit 1` 且 `CAUSE` 可区分。⛔ **不得**为做这个负控制去改 `packages/quay/src/serve-*.ts`（不在本 Touches 内）；负控制的活面由夹具自造。
6. **正控制**：确认（若无则拉起）一个 cwd=仓库根的 `quay.ts serve`（先用 `ps aux | grep -c '[q]uay-task-worker'` 确认无在飞 worker；⛔ 不手拼 `spawn`/`send-keys`，用仓库既有启动器 `plugin/scripts/start-drivers.ts` 或 `quay serve`），`node packages/quay/bin/quay.js goal gate AC-301`（主检出根）⇒ **exit 0**，四条断言各自独立可核（en nav `Goals` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav `Goals` 计数 =0 / zh `<title>` ≠ en `<title>`）。
7. **不可评估态控制**：在**无**实例的 scratch 根上 `quay goal gate AC-301 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`；⛔ 不必停掉生产实例。
8. **新指纹落账**：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1` 使 AC-301 以新 `criterionHash` 落一条 `pass`（⚠️ 不带 `env -u …` 时 sweep 会 `refused:true, eligible:0`）；贴出台账新增行的逐字 JSON。
9. **不回归**：`bash scripts/test.sh --for-task gap-ac301-criterion-carrier-absence-not-evaluated` 绿；家族枚举逐文件对照（四个 token 各 17 / 10 / 10 / 8）。

## AC

- [x] **AC1（可评估性分支已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `FAIL=workspace-root-unresolvable`、`FAIL=no-derivable-serve-address`、`FAIL=no-reachable-serve-address`、`CAUSE=no-running-serve-instance` 四处由 `exit 1` 变 `exit 3`；`expect` 与十条 `CAUSE=` 断言分支逐字相同；`CAUSE=` 行计数仍为 **11**。⛔ 未经 `quay goal write` 落库不算。
- [x] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac301-criterion-address-derivation.test.mjs` 的 7 个可评估性负例断言 `status === 3`、第 170 / 185 / 323 行的 `status === 0` 仍绿、断言侧「eleven CAUSE branches」测试仍绿；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `status === 1` 断言下的对照（`git show <old>:<file>`）证明这 7 条确实 1 → 3。
- [x] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-301` ⇒ **exit 0**，逐字贴出；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、argv 含 `quay.ts serve` 的活进程。
- [x] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/goal` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分，逐字贴出。⛔ 该证据的活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [x] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-301 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [x] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-301` 最新一条为 `verdict:"pass"`，其 `payload.criterionHash` **≠** `56de07b5a4505f73`（两行都贴）；② `bash scripts/test.sh --for-task gap-ac301-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出（`grep -rl` 四个 token 各 17 / 10 / 10 / 8），并说明本任务只改 AC-301 一条的退出码。
- [x] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下派发/执行时 `ps aux | grep -c '[q]uay-task-worker'` 的读数与「本实例无监督者、死亡后不会被自动拉回」的观察项及其发生率读数（AC-301 2 条 / 家族 17 个 goal 文件）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实运行的服务上为真、且三态可区分的判据落了账**：

1. **落地对象**：`goals/AC-301-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit）；**且**一个 cwd = 仓库根的 `quay.ts serve` 实例在跑（复用现成的或从主检出 HEAD 起）—— 只改文本不算落地。
2. **三态齐备（同一条判据给出三个互不同形的取值）**：活实例 + 真接线 ⇒ **`exit 0` / `pass`**；可达但 zh 未翻译 ⇒ **`exit 1` / `fail`**；无实例 ⇒ **`exit 3` / `not-evaluated`（⛔ 非 fail、非 pass）**。三者各自的逐字读数进 Evidence。
3. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-301` / `gate=goal` / `verdict:"pass"` 的新事件，其 `criterionHash` **≠** `56de07b5a4505f73` —— **一条 dry-run 输出不算**。
4. **动机随判据进记录**：`quay goal write` 落库的 criterion 里带着「为什么改」的注释与读数（载体缺席 ≠ 为假；`exit 3` 是仓库在 `goal-store.ts:305-318` 写死的约定），而不是只留在本任务体里。

## Touches

- `goals/AC-301-goal-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac301-criterion-address-derivation.test.mjs`
- `tasks/gap-ac301-criterion-carrier-absence-not-evaluated.md`

（说明：第一条是本任务的落地面 —— 地址派生那步的**退出码**，经 `quay goal write AC-301 --criterion …` 落库，`expect` 与分支文本逐字不变；第二条是与该块逐字绑定的夹具（7 个可评估性负例断言随之同步，并新增一条整条 criterion 的断言侧负控制）；第三条是 self-touch。⛔ `plugin/scripts/driver-anchor.ts`、`plugin/scripts/start-drivers.ts`、任何 `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**（前者是观察项非目标，后者是夹具自造活面的约束）。）

## Evidence

（2026-09-29。判据**落库在主检出** `/data/home/yale/work/quay`（活实例、`.quay/server.json` 载体、
`.quay/gate-events.jsonl` 台账都在那里）；实现提交在任务 worktree。⛔ 本任务未改任何
`plugin/scripts/*.ts` 与任何 `packages/quay/src/serve-*.ts`。）

### AC1 — 只有四处可评估性分支改了退出码（经 `quay goal write` 落库）

落库命令（⛔ 非手工 Edit `goals/*.md`）：
`node packages/quay/bin/quay.js goal write AC-301 --criterion "$(cat <新判据文本>)"`

| 落点 | 提交 |
|---|---|
| 主检出（经 doc-branch propagate 已到 `develop`） | `86ed0af4d goals: AC-301 field:criterion by cli:870809` |
| 任务分支 | `9e5a026a9 goals: AC-301 field:criterion by cli:891407` |

**落库保真（折叠无损）**：把落库后的 criterion 经 `parseFrontmatter` 读回，与意图文本 `cmp` ⇒
**byte-identical（11911 bytes）**；`sh -n <落库后 criterion>` ⇒ exit 0。

**代码行（排除 `#` 注释行）退出码清单**：

| | exit 0 | exit 1 | exit 3 |
|---|---|---|---|
| 修订前（`64a9d8ad0`） | 1 | 14 | 0 |
| 修订后（落库后读回） | 1 | 10 | 4 |

四处可评估性分支：**行体逐字相同，只有行尾 `exit 1` → `exit 3`**（判据：每一处
`old.slice(0,-8) === new.slice(0,-8)` ⇒ `true`）：

```
FAIL=workspace-root-unresolvable : ' "$(pwd)" >&2; exit 1; fi          ->  …; exit 3; fi
FAIL=no-derivable-serve-address  : "$nserve" "$root" >&2; exit 1; fi   ->  …; exit 3; fi
FAIL=no-reachable-serve-address  : "$nderived" "$nserve" "$root" "$ROUTE" >&2; exit 1; fi  ->  …; exit 3; fi
CAUSE=no-running-serve-instance  : (AC-179 probe pattern)" >&2; exit 1; fi  ->  …; exit 3; fi
```

**十一条非可评估性出口行逐字相同**：把两版里所有不含上述四个 token 的 `exit N` 行取出比较，
`JSON.stringify` 集合相等 ⇒ `true`（10 条 `exit 1` + 1 条终末 `exit 0`）。
**`CAUSE=` 计数 11 → 11；`FAIL=` 3 → 3。**
**goal 记录字段级 diff**（`64a9d8ad0` vs 落库后的文件）：`criterion` 是**唯一**变化的字段
（10350 → 12428 字符）；`expect` **逐字相同**、`origin` **逐字相同**。

### AC2 — 夹具同步（7 处 1 → 3），且该项确实是可取的假

`packages/quay/test/ac301-criterion-address-derivation.test.mjs`：

**修订前**（`git show 64a9d8ad0:<该文件>`）：
```
208:  assert.equal(r.status, 1, "an unnormalisable wildcard must not yield a green");
221:  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}`);
237:  assert.equal(r.status, 1);
249:  assert.equal(r.status, 1);
261:  assert.equal(r.status, 1);
274:  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}`);
287:  assert.equal(r.status, 1);
```
**修订后**：同一顺序落在第 240 / 253 / 269 / 281 / 293 / 306 / 319 行，全部
`assert.equal(r.status, 3, …)`。两处原本带 message 的，message 里的期望值随之写成 `exit 3`
（断言不得与它自己的失败信息互相矛盾）；另 4 处原本无 message 的补上 `NOT_EVALUATED_WHY`
（与同机制的兄弟夹具同一写法）。

**正例与文本断言逐字不动**：修订前第 170 / 185 / 323 行的 `assert.equal(r.status, 0, …)`
在修订后第 202 / 217 / 355 行**逐字相同**（只有行号平移）；断言侧那条「keeps its eleven
pre-amendment CAUSE refusal branches」测试**逐字未动**（`CAUSE=` 计数 = 11 仍绿）。

`node --test <该文件>` ⇒ **17 pass / 0 fail**。

**「1 → 3 是真的」的负控制（⛔ 运行读数，不是文本 diff）**：把**修订前**的夹具原样放进
`packages/quay/test/` 跑**修订后**的判据 ⇒ **恰好 7 条红**，红的正是这 7 条可评估性负例
（IPv6-wildcard / no-carrier / pid-mismatch / no-web-service / web-down / unreachable /
no-instance），2 条正例与全部文本断言仍绿（**7 pass / 7 fail**）。控制文件跑完即删，
`git status` 无残留。

### AC3 — 正控制：活实例上真 pass

```
$ node packages/quay/bin/quay.js goal gate AC-301        # 主检出根，2026-09-29T02:48:30.756Z
{"id":"AC-301","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)",
 "timeoutMs":60000,"dryRun":false,"event":{…,"actor":"goal-cli","verdict":"pass",…}}
GATE_EXIT=0
```
同一时刻的活实例（`pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd`）：
```
pid=3652175  cwd=/data/home/yale/work/quay
  argv = /data/home/yale/.nvm/versions/node/v24.21.0/bin/node --no-warnings --experimental-strip-types
         /data/home/yale/work/quay/packages/quay/bin/quay.ts serve --host 127.0.0.1
载体 .quay/server.json: {"schemaVersion":1,"pid":3652175,"startedAt":"2026-09-29T02:07:52.834Z",
  "web":{"name":"web","pid":3652175,"host":"127.0.0.1","port":20119,"up":true}}
```
（argv **无 `--port`** ⇒ 地址只能由活宿主载体派生，正是 09-23 那次重锚要覆盖的面。）
四条断言各自独立可核，见 AC5 里整条判据的逐字输出（en nav 含 `Goals` / zh 响应为
`<html lang="zh"` / zh nav 里 `Goals` 已消失 / zh `<title>` ≠ en `<title>`）。

### AC4 — 负控制：该报假时仍报假（行为证据，⛔ 不是文本 diff）

活面由夹具自造（`git init` scratch 根 + 一个 argv 带显式 `--port N` 的 serve 形候选 + 一个真的
监听 N 端口、按请求自己的 `Cookie: lang=zh` 分派两个 body 的 listener）。整条 criterion 逐字跑：

```
(B) LIVE surface + UNTRANSLATED zh (reachable, <html lang=zh>, nav still English)
  criterion EXIT CODE = 1
--- stdout ---
AC-301 serve address derived from argv as 127.0.0.1:24185 (per-candidate readings:; pid=1723943 addr=127.0.0.1:24185 cause=derived-from-argv-fetch-answered; pid=1724002 addr=- cause=argv-no-serve-subcommand,carrier-absent)
--- stderr ---
CAUSE=nav-label-untranslated -- the nav region of /goal under Cookie: lang=zh still renders the literal English nav label "Goals"; the nav is not wired to the zh dictionary
```
⇒ 一条**可达、`<html lang="zh">`、title 确实切了、但 nav 没接线**的 zh 响应**仍 `exit 1`**，且以
`CAUSE=nav-label-untranslated` 与另两态可区分。这一条同时进夹具（`AC-301 whole criterion still
FAILS (exit 1, nav-label-untranslated) on a reachable but unwired zh page`，green），与它配对的
正例 `… PASSES (exit 0) on a live surface whose zh nav really is translated` 亦 green。

### AC5 — 三态互不同形（同一条判据的三个取值，逐字）

```
(A) LIVE surface + WIRED zh          ⇒ criterion EXIT CODE = 0
    stdout: OK -- /goal: default nav region carries "Goals" and <title>="quay — Goals"; under
            Cookie: lang=zh the response is <html lang=zh>, that English nav label is gone from
            the nav region, and this page's own <title> became "quay — 目标"

(B) LIVE surface + UNTRANSLATED zh   ⇒ criterion EXIT CODE = 1   （CAUSE=nav-label-untranslated，见 AC4）

(C) NO serve-shaped candidate at all ⇒ criterion EXIT CODE = 3
    stderr: AC-301 candidate readings (cwd=/tmp/ac301-ev-UjJLAu, nserve=0, ncand=1, nderived=0):;
            pid=1724281 addr=- cause=argv-no-serve-subcommand,carrier-absent
            CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/tmp/ac301-ev-UjJLAu;
            /goal cannot be evaluated on a live surface (AC-179 probe pattern)
```

同样两态经 `verdictFromAcceptance` 映射后的 JSON：

- **无活实例**（在任务 worktree 根上跑 —— 该根下确无 cwd 相符的活实例；⛔ 按 Plan 第 7 条**未**停掉
  生产实例）：`goal gate AC-301 --dry-run --json --root <worktree>` ⇒
  ```json
  {"id":"AC-301","verdict":"not-evaluated","cause":"declared",
   "reason":"not-evaluated (declared): acceptance failed (exit 3) — AC-301 candidate readings (cwd=/data/home/yale/work/quay-worktrees/gap-ac301-criterion-carrier-absence-not-evaluated, nserve=0, ncand=1, nderived=0):; pid=1731058 addr=- cause=argv-no-serve-subcommand,carrier-absent CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=…; /goal cannot be evaluated on a live surface (AC-179 probe pattern)",
   "timeoutMs":60000,"dryRun":true,…}
  ```
  **⛔ `verdict` 不是 `fail`**，是 `not-evaluated` / `cause:"declared"`。
- **活实例 + 真接线** ⇒ `{"id":"AC-301","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)"}`
  （见 AC3）。

⚠️ 诚实交代一个**未做**的读数：`quay goal gate` 这条 CLI 自身对 not-evaluated **也返回 1**
（`goal-store.ts` 的 `return verdict === "pass" ? 0 : 1` —— `pass` 是唯一 0；三态的区分活在台账的
`verdict` / `cause` 字段里，那正是 driver 读的东西，也正逐字出现在上面的 `reason` 中）。本任务改的是
**判据自己的**退出码（`exit 3`），⛔ 未改 CLI 的退出映射（那不在本任务落点内，改它等于改生产行为）。

### AC6 — 新指纹落账 + 不回归 + 家族枚举

**① 台账两条（逐字）**：
```
# 修订前（pass，旧指纹）
{"id":"1ce0920c-…","item_id":"AC-301","gate":"goal","actor":"goal-sweep","verdict":"pass","timestamp":"2026-09-29T00:55:59.623Z","payload":{"reason":"acceptance passed (exit 0)","criterionHash":"56de07b5a4505f73"}}
# 修订后（pass，新指纹）
{"id":"dcd69742-…","item_id":"AC-301","gate":"goal","actor":"goal-amend","verdict":"pass","timestamp":"2026-09-29T02:44:34.494Z","payload":{"reason":"acceptance passed (exit 0)","criterionHash":"081aaf4720c8bf53"}}
```
`criterionFingerprint()` 直接复算：修订前 `56de07b5a4505f73`（= 立案时那个），修订后
`081aaf4720c8bf53`，**≠** ✅。落账命令：
`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1`
（⛔ 不带 `env -u …` 时 sweep 会 refuse），随后 `check --stale-pass` 读回：AC-301 已在
`verifiedFresh`，`staleUnverified` 为空。
⚠️ 上述两条**带指纹**的事件都来自 `--sweep`（`goal gate` 事件按设计**不写** `criterionHash`，
只写 reason —— 所以「新指纹落账」这条只能由 sweep 满足，Plan 第 8 条正是为此）。

**② 不回归**：`bash scripts/test.sh --for-task gap-ac301-criterion-carrier-absence-not-evaluated
--allow-thin` ⇒ **exit 0**；夹具 **17/17 绿**；16 项 scoped 静态检查全过。
⛔ 这不是「跑过一次就算」：**任务体（7 处勾选 + 本节）写入之后**，重新 merge 当时的 `develop`
（`aa749206c` —— 它已经包含本次 task 文件的写入）并**重跑同一条命令**，同样 **exit 0 / 17 绿**；
那一轮的 delta 明确**含任务文件**（`task-contract-check: no violations`、
`checked-in-write-check … 0 inside the tree … PASS`、`touches-one-entry-one-path-check` 在集内），
即勾选与本节本身也过了 scoped 静态检查那一层。
⚠️ 选择器报 `test-selection-thin: resolved tests for 1/3 Touches entries (0.33)` —— 另外两条
Touches 是 goal 文件与任务文件（都无同名测试）。**这不代表判据没被验到**：夹具的 `goalFile()` /
`criterionText()` 正是**直接从那个 goal 文件**读判据文本再逐字执行（单源），所以该文件的内容确实
被这 17 条测试行使。

**③ 家族枚举**（`grep -rl '<token>' goals/`，逐文件已核）：

| token | goal 文件数 |
|---|---|
| `no-running-serve-instance` | **17** |
| `no-derivable-serve-address` | **10** |
| `no-reachable-serve-address` | **10** |
| `workspace-root-unresolvable` | **8** |

本任务只改 **AC-301 一条**的退出码；其余同类文件一字未动（同机制的兄弟立案各自认领各自的 AC）。

### AC7 — 非目标边界未被越过

`git diff --name-only develop...HEAD`（任务分支）⇒ 只有
`packages/quay/test/ac301-criterion-address-derivation.test.mjs` 一个文件。
`goals/AC-301-*.md` 的改动经 `quay goal write` 落在主检出、并已 propagate 到 `develop`
（`86ed0af4d`），故任务分支上与该文件无 delta；三条 Touches 全部有主。

⛔ **未改**：`plugin/scripts/driver-anchor.ts`、`plugin/scripts/start-drivers.ts`、
**任何 `plugin/scripts/*.ts`**（故无需 outline / capability-catalog / laydown 三处登记）、
**任何 `packages/quay/src/serve-*.ts`**（AC4 的活面由夹具自造）。

**观察项（⛔ 非门禁、非前置；拿不出落点与边界裁定 ⇒ 不拦路）**：`quay serve` **没有监督者** ——
`plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 不含 web，实例死掉不会被自动拉回，判据此后停在
`not-evaluated` 直到有人拉起（这正是让判据反复摆动的上游成因）。

发生率（2026-09-29 复取 `.quay/gate-events.jsonl`）：含 `no-running-serve-instance` 的
**AC-301 事件 2 条**，均在 2026-09-29，**verdict 全为 `fail`**：

```
2026-09-29T02:05:58.462Z | goal-sweep | fail
2026-09-29T02:06:52.172Z | goal-cli   | fail
```
（这正是本次要消灭的形态：载体缺席被记成「此刻为假」。）家族面 **17 个 goal 文件**共享该 token
（枚举见 AC6③）。

执行期间的 worker 读数 `ps aux | grep -c '[q]uay-task-worker'`：派发时刻 **2**，执行期间 **3–4**
（并发 peer）。⇒ 本任务**复用**了现成的 pid 3652175 实例，⛔ 未重启、⛔ 未停任何 peer 依赖的服务。

### 遗留后置条件

- 一个 `cwd = /data/home/yale/work/quay` 的 `quay.ts serve` 在跑（pid 3652175），判据在**真实生产
  面**上读 `pass`（AC3），不是只在夹具里。
- 载体缺席时判据读 `not-evaluated`（exit 3），不再被 driver 的 `runPrefilingRecheck` 当
  `confirmed-failing` 每轮立案 —— 这才是本次修改要买的东西（本轮这份任务本身就是旧形态的产物）。
- ⚠️ 该实例同样没有监督者（见上），它再次死掉时判据会回到 `not-evaluated`；那是一个**诚实**的读数，
  而不再是一次虚假立案。

---
_2026-09-29T04:12:20.535Z_: 第 4 轮 fan-in 退出成因（2026-09-29，跨任务红源，⛔ 非本任务缺陷）：step=suite 的红全部落在三份**兄弟夹具**上，本任务夹具 17/17 绿。读数：ac291 7 红 / ac292 7 红 / ac303 10 红，三份在 develop 上与本工作树逐字相同（git diff develop HEAD -- <file> 为空），而 goals/AC-291/292/303-*.md 的可评估性出口已在 develop 上 exit 3。成因：quay goal write 立即 propagate 到 develop，绑定夹具却只能经 fan-in 落地 —— 家族四支分支各只带自己那份夹具修复 ⇒ 无一支分支的合并树全绿 ⇒ 谁也落不了地。既有立案：gap-goal-write-outruns-bound-fixture-family-deadlock（status ready，## Touches = 四份夹具，在 ready pool 内）。本任务不扩 Touches（AC7），修复由该家族任务一次带四份夹具落地完成。

_2026-09-29T04:26:45.000Z_: 第 5 轮读数（成因与第 4 轮同源，⛔ 非本任务缺陷）：本任务夹具 17/17 绿、scoped 门 exit 0（缓存已写，develop-sha c297b38e3）；三份兄弟夹具在 develop 上仍断言 exit 1 而 develop 的三条判据已 exit 3。**本轮新读数**：gap-ac292 / gap-ac303 两条兄弟任务已是 status done，且各自分支已带夹具修复（git show task/gap-ac29{2,3}-...:packages/quay/test/ac29{2,3}-criterion-address-derivation.test.mjs | grep -c 'code, 3' = 8），但其夹具不在 develop 上 —— 两条终态任务把修复留在了不再会被 fan-in 的分支上。⇒ 家族修复的路径从「四支分支各自落地」收窄为**只剩** gap-goal-write-outruns-bound-fixture-family-deadlock（status ready，## Touches = 四份夹具，self-touch 齐备）。本任务不扩 Touches（AC7）。

---
_2026-09-29T04:47:35.255Z_: 第 6 轮（2026-09-29T04:50Z, worker）：合并冲突已按逐 hunk 并集消解（第 4/5 轮 notes 俱存）；更正第 5 轮误报 —— gap-ac292 = needs-human、gap-ac303 = ready，均非 done（worktree 仍在）。本轮直接量：node --test ac291/ac292/ac301/ac303-criterion-address-derivation.test.mjs ⇒ tests 63 / pass 42 / fail 21，21 红全在三份兄弟夹具，本任务夹具 17/17 绿。派发侧独立读数：slot-refill --json ⇒ pool=4 / dispatchable_disjoint=3，deferred 中解法任务 gap-goal-write-outruns-bound-fixture-family-deadlock 的 reason 逐字 = touches-overlap-in-flight (peer gap-ac291-criterion-carrier-absence-not-evaluated)，三兄弟均 landed-implementation，recommended 为空 ⇒ 零可派工作；.quay/worker-round.jsonl round 2722 记 ac291 豁免 = unrelated-flaky-exempt ⇒ 重试上限不前进 ⇒ 既不落地也不被 park。scoped 门（merge 后）exit 0 / 17 绿；cache 以 merge 时刻 develop sha 6244047f8 写盘。本轮未扩 Touches、未改兄弟夹具、未写 status、未 un-park、未新增 plugin/scripts 脚本。


_2026-09-29T05:05Z_: 第 7 轮（worker；merge develop 6244047f8 无冲突）。AC 逐条复验全绿：判据四处可评估性出口 exit 3（CAUSE= 计数仍 11）；本任务夹具 17/17；活实例 pid=3652175（cwd=主检出）上 goal gate AC-301 ⇒ verdict:pass / exit 0；--root <worktree> ⇒ verdict:not-evaluated / cause:declared；台账最新带指纹事件 081aaf4720c8bf53 ≠ 56de07b5a4505f73；task_check ⇒ ok:true 7/7；scoped 门 exit 0 且 cache 以 develop-sha 6244047f8 写盘。跨任务红源未变并被直接量复现：四份夹具合跑 ⇒ 63 tests / 42 pass / 21 fail（ac291 6 / ac292 7 / ac303 8 / ac301 0），三份兄弟夹具与 develop 逐字相同。⚠️ 本轮新读数：同一份 suite 日志里两条红源并存，而上一轮 exited-not-landed 报出的 step=suite 断言是 s22 的 N=2000 计时断言（cached=1757 uncached=2329 ratio=0.75）——【概率性】红源被报出，而【确定性】的 21 条兄弟红同时在册；只治 s22 不会让本任务落地。本轮未扩 Touches、未改兄弟夹具、未写 status、未 un-park、未新增 plugin/scripts 脚本。