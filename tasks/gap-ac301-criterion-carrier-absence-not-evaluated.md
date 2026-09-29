---
id: gap-ac301-criterion-carrier-absence-not-evaluated
title: "AC-301 判据把「活载体缺席」记成「此刻为假」——地址派生那步的四个可评估性分支以 exit 1 出声，违反仓库自己的约定（exit 3 =
  not-evaluated，goal-store.ts 逐字给出的例子正是「NOT-EVALUATED: carrier absent」）⇒ driver
  每轮把它当 confirmed-failing 立案；修法=四处改 exit 3 + 保持 cwd=仓库根的活实例使判据真 pass
  并落新指纹，以「接线破坏仍 exit 1」证明强度未减"
status: todo
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

- [ ] **AC1（可评估性分支已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `FAIL=workspace-root-unresolvable`、`FAIL=no-derivable-serve-address`、`FAIL=no-reachable-serve-address`、`CAUSE=no-running-serve-instance` 四处由 `exit 1` 变 `exit 3`；`expect` 与十条 `CAUSE=` 断言分支逐字相同；`CAUSE=` 行计数仍为 **11**。⛔ 未经 `quay goal write` 落库不算。
- [ ] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac301-criterion-address-derivation.test.mjs` 的 7 个可评估性负例断言 `status === 3`、第 170 / 185 / 323 行的 `status === 0` 仍绿、断言侧「eleven CAUSE branches」测试仍绿；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `status === 1` 断言下的对照（`git show <old>:<file>`）证明这 7 条确实 1 → 3。
- [ ] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-301` ⇒ **exit 0**，逐字贴出；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、argv 含 `quay.ts serve` 的活进程。
- [ ] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/goal` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分，逐字贴出。⛔ 该证据的活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [ ] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-301 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [ ] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-301` 最新一条为 `verdict:"pass"`，其 `payload.criterionHash` **≠** `56de07b5a4505f73`（两行都贴）；② `bash scripts/test.sh --for-task gap-ac301-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出（`grep -rl` 四个 token 各 17 / 10 / 10 / 8），并说明本任务只改 AC-301 一条的退出码。
- [ ] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下派发/执行时 `ps aux | grep -c '[q]uay-task-worker'` 的读数与「本实例无监督者、死亡后不会被自动拉回」的观察项及其发生率读数（AC-301 2 条 / 家族 17 个 goal 文件）。

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
