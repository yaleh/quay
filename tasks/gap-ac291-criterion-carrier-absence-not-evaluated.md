---
id: gap-ac291-criterion-carrier-absence-not-evaluated
title: "AC-291 判据把「活载体缺席」记成「此刻为假」——地址派生那步的三个不可评估分支以 exit 1 出声，违反仓库自己的约定（exit 3 =
  not-evaluated，goal-store.ts 逐字给出的例子正是「NOT-EVALUATED: carrier absent」）⇒ driver
  每轮把它当 confirmed-failing 立案；修法=三处改 exit 3 + 保持 cwd=仓库根的活实例使判据真 pass
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
goal_ac: AC-291
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-29，cwd = 主检出 `/data/home/yale/work/quay`）**

立案那一刻的读数（⛔ 非转述）：

```
node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json     # 2026-09-29T02:07:41.658Z
⇒ {"id":"AC-291","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-291 candidate readings (cwd=/data/home/yale/work/quay,
             nserve=0, ncand=1, nderived=0):; pid=3649063 addr=<none>
             argv=argv-no-serve-subcommand cause=carrier-pid-mismatch
             CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay;
             /live cannot be evaluated on a live surface (AC-179 probe pattern)"}
GATE_EXIT=1
```

11 秒后同一个探针改判为 pass —— 因为一个**无关的 peer worker 在 02:07:52 顺手重启了 serve**（载体 `.quay/server.json` 的 `startedAt`；见下表）。也就是说，这条判据**在「不可评估」与「为真」之间来回摆动，而它把前者记成了「为假」**。

同一时刻的三面读数（⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 判据（立案时） | `verdict:"fail"`、`exit 1`、`nserve=0`、`CAUSE=no-running-serve-instance`、`cause:null` | `quay goal gate AC-291 --dry-run --json` @02:07:41Z |
| 判据（11 秒后重测） | `verdict:"pass"`、`exit 0`、`reason:"acceptance passed (exit 0)"` | 同命令 @2026-09-29T02:09:01.994Z |
| 活实例 | 立案时**无** cwd=仓库根的真 `serve`；02:07:52 起有 `pid=3652175`，`cwd=/data/home/yale/work/quay`，argv 无 `--port`（内核分配），载体报 web `127.0.0.1:20119` `up:true` | `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` + `cat .quay/server.json` |
| 台账尾 | `verdict:"fail"` @2026-09-29T02:06:50.182Z（`actor:"goal-cli"`），`criterionHash:"f455d4534f8067e9"` | `.quay/gate-events.jsonl` |

**成因既不是判据的机制坏了（页面的 zh 接线今天是绿的：`node --test packages/quay/test/serve-live-zh-chrome.test.mjs` ⇒ 4/4 pass，含一条真启服务的黑盒断言），也不是 `/live` 页面退化了 —— 是【判据的活载体（运行中的 `quay serve`）会缺席，而判据把「无法评估」这个态用 `exit 1` 报成了「此刻为假」。**

### 判据的四条断言是真的；今天只是【有时】量不到

本 AC 的保证是「在**运行中的**服务上，/live 的 zh 切换相对 en 基线真实发生」。它的 `origin` 逐字写明操作前提：「需有一个 cwd=仓库根的 `quay serve` 实例在跑；实现落地后须重启该实例」。载体不在 ⇒ 这条保证**既没被证真也没被证假**，它是**不可评估**。

而**仓库自己已经为这个态规定了取值**（`packages/quay/src/goal-store.ts:305-318` 逐字）：

> …the criterion itself declared it (**exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」**)… ⛔ **NOT a failure**: "I cannot evaluate this HERE" must not share an output shape with "this is false"…

且这一取值已在**唯一**的映射函数里兑现：`packages/quay/src/gate/acceptance-runner.ts` 的 `verdictFromAcceptance` 把 `code === 3` 映成 `not-evaluated` / cause `declared`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，不含 3）。**AC-291 的判据今天违反的正是这条约定**：它的三个「无实例 / 不可派生 / 不可抵达」分支全部 `exit 1`。

### 代价（可核）：driver 每轮把它当 confirmed-failing 立案

`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck` 三态分派：`verdict === "fail"` ⇒ `outcome:"confirmed-failing"`（**立案**）；`verdict === "pass"` ⇒ `cleared`（不立案）；其余（含 `not-evaluated`）⇒ `outcome:"not-evaluated"`（不立案）。所以 `exit 1` 与 `exit 3` 的差别，就是「每轮重复立案」与「不立案」的差别 —— 本轮这份任务本身就是该差别的产物。

发生率（硬规则 12：查历史，⛔ 不等下一轮）：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-291` 的事件共 197 条，其中含 `no-running-serve-instance` 的 **4** 条，跨越 **2** 个日期（2026-09-23、2026-09-29），verdict 全为 `fail`，actor ∈ {goal-sweep, goal-cli}。家族面（GOAL-024 的 16 条 live-probe 判据逐字共享同一段 addr-derivation）：含该 token 的 goal 文件 **17** 个，含 `no-derivable-serve-address` 的 **10** 个，含 `no-reachable-serve-address` 的 **10** 个。

### 更早的两条 done 任务都没碰这一个取值

| 任务 | done | 它做了什么 |
|---|---|---|
| `gap-ac291-live-page-zh-chrome-nav-current-and-own-title` | 2026-09-17 | 页面本身的 lang / `<title>` / nav 当前项接线（保证的**作用对象**；今天仍绿） |
| `gap-ac291-criterion-cmdline-port-literal-stale` | 2026-09-23 | **重锚地址派生**（cmdline `--port 0` ⇒ 改从活宿主载体取）。其 AC2 只要求「无实例时**非 0**」—— `exit 1` 满足了当时的字面要求，而它正是把「查不成」与「为假」并成同一个取值的那一步 |

**两条都没触及「不可评估该取什么值」** ⇒ 宿主 serve 一死（上次载体写入停在 2026-09-25 18:08，2026-09-29T02:05 转红），判据立刻以 `fail` 重现，driver 立刻再立案。这不是「早先的修复失效了」，而是**早先两次修复各修了一层，而把两态并成一态的那一层从未被修**。

<!-- dedup-ref -->
**与在飞的 AC-292 同机制任务的边界**：`gap-ac292-criterion-carrier-absence-not-evaluated`（status `ready`，`goal_ac: AC-292`）明确自限「本任务只改 AC-292 一条，其余 16 个文件各自归自己的立案轮，本条给出的形态可逐字复用」。AC-291 正是那 16 个之一；两者改的是**不同的 goal 文件 + 不同的夹具文件**（AC-292 判据有四个分支，含 `FAIL=workspace-root-unresolvable`；**AC-291 只有三个**：`no-running-serve-instance` / `no-derivable-serve-address` / `no-reachable-serve-address`），互不重叠、互不干涉。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-291' tasks/*.md` ⇒ 2 命中（`gap-ac291-live-page-zh-chrome-nav-current-and-own-title`、`gap-ac291-criterion-cmdline-port-literal-stale`），**status 全为 done**；全仓 in-flight（todo/ready/needs-human）只有 `gap-ac292-criterion-carrier-absence-not-evaluated` 一条，`goal_ac: AC-292`，⛔ 不认领 AC-291 ⇒ 本 AC 无在飞主，本条不是重复立案。同机制、不同对象的既有任务全部 done：`gap-goal-gate-verdict-single-mapping-not-evaluated` 建立的是 exit 3 → not-evaluated 的**映射**（三个写入点），从未把任何**判据**迁到它上面；`gap-not-evaluated-harness-third-state` 修的是 harness 层；`gap-goal-criteria-bare-failing-exit-unattributable` 修的是「失败出口不写成因」。

### 四个修法的取舍

- ✗ `superseded` 本 AC：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**。
- ✗ `long-term: true`：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），取值混淆原样保留。
- ✗ 只把活实例拉回来：**不完整**。实例今天被 peer 拉起、明天会再死（09-25 → 09-29 已死 1 次且无人拉回），而判据仍会把每次缺席记成一处处「为假」并每轮立案。
- ✗ 只改 exit 3：**也不完整**。保证会在实例缺席时永久停在 not-evaluated，等于把守卫静默空转（硬规则 3b 的空转半边：判据恒真而什么也没验到，与「验过了」同形）。
- ✓ **① 三个可评估性分支改 `exit 3`；② 保持/拉起一个 cwd=仓库根的活实例，使判据在新指纹下落一条真 `pass`；③ 以「接线破坏仍 `exit 1`」的负控制证明强度未减。** 三条缺一不可。

### 修法必须满足的性质（⛔ 缺一不可）

1. **只动可评估性分支，不动断言分支**：改退出码的**只有**三处块尾分支 —— `CAUSE=no-running-serve-instance`、`CAUSE=no-derivable-serve-address`、`CAUSE=no-reachable-serve-address`。断言分支（`en-fetch-failed` / `zh-fetch-failed` / `no-nav-region` / `no-nav-region-zh` / `english-baseline-missing` / `no-title-tag` / `no-title-tag-zh` / `html-lang-not-zh` / `nav-label-untranslated` / `title-unchanged`）**逐字不动、仍 `exit 1`**。⛔ AC-291 判据**没有** `FAIL=workspace-root-unresolvable` 分支（那是 AC-292 的），⛔ 不要去找第四个。
2. **⛔ 不改 `expect`、不改作用域**：`<nav>…</nav>` 只对 nav 区块匹配、`<title>` 只对 title 匹配；⛔ 不新增第二份判据文件、不新增 `CAUSE=` 行（夹具里对 `CAUSE=` 行的计数断言必须继续绿）。
3. **判据仍能取假（正/负控制各一条）**：活实例 + 真接线 ⇒ `exit 0`；活实例 + 故意不翻译的 zh 响应 ⇒ **`exit 1`** 且以 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分。
4. **新指纹落账**：经 `quay goal write AC-291 --criterion …` 落库（⛔ **不**手工 Edit `goals/AC-291-*.md`），随后 `quay goal gate AC-291` 在活实例上 `exit 0`，台账新增 `item_id=AC-291` / `gate=goal` / `verdict:"pass"` 且 `criterionHash` **≠** `f455d4534f8067e9` 的事件。
5. **逐字夹具同步**：`packages/quay/test/ac291-criterion-address-derivation.test.mjs` 用 `# >>> addr-derivation` / `# <<< addr-derivation` 把该块**逐字**抽出执行（它是一份测量，不是回声）；其 7 个 `code === 1` 断言中 **6 个**（no-instance / no-derivable / carrier-no-web-entry / carrier-pid-mismatch / carrier-web-marked-down / no-reachable）改为 `3`，**第 7 个**（"the ASSERTION block is still live — CAUSE=nav-label-untranslated"）**逐字保留 `1`**；全部 `code === 0` 正例逐字不动。
6. **⛔ 不新增 `plugin/scripts/*.ts`**（会触发 outline + capability-catalog + laydown 三处登记）；本任务不需要新脚本。
7. **判据文本的 YAML 约束**：criterion 是 folded scalar，`#` 注释必须保持**单一逻辑行**（注释里一个硬换行折回后会变成语法错）。
8. **在主检出根上跑闸**：活实例、`.quay/server.json` 载体与 `.quay/gate-events.jsonl` 都在**主检出**，而任务 worktree 的 `.quay/` 是刷新快照 ⇒ `quay goal gate AC-291` 必须在主检出根上跑，⛔ 不在 worktree 里跑。
9. **⛔ 不重启 peer 在飞 worker 依赖的服务**：派发/执行前 `ps aux | grep -c '[q]uay-task-worker'`；已有一个 cwd=仓库根的活实例在跑时**直接复用它**（今天就是这种情形），只在**没有**实例时才从主检出 HEAD 拉一个。

<!-- dedup-ref -->
**明确的非目标（观察项，不进入本任务的任何门禁）**：`quay serve` **没有监督者**（web 不在 `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 六类里；`start-drivers.ts` 只在**被调用时**判 staleness/down）—— 这是让判据反复摆动的**上游成因**。把 web 纳入 driver 活性面（或一条周期性 ensure-up）是一件独立且会改变生产行为的事，边界与落点尚未裁定 ⇒ **本任务只把它记为观察项 + 一条非门禁的承接线**（复用/拉起实例），**⛔ 不把「必须有监督者」写成任何前置**（硬规则 12：拿不出落点与边界裁定的前置不得拦路）。

## Plan

1. **红基线**（⛔ 不假定仍是 `fail`）：`node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json`，逐字贴出 verdict；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 给出实例读数（今天应为 pass + 一个活实例）。若此刻**无**实例，这一读数本身就是「不可评估」的证据，照记。
2. **取修订前指纹**：确认台账尾（或 `quay goal show AC-291 --json`）的 `criterionHash` = `f455d4534f8067e9`，供第 4 条与 AC/DoD 对照。
3. **改判据（三处退出码 → 3）**：从 `goals/AC-291-*.md` 抽出 criterion 全文，**只**把 `# >>> addr-derivation` 块尾那三处 `exit 1`（`no-running-serve-instance` / `no-derivable-serve-address` / `no-reachable-serve-address`）改为 `exit 3`，其余逐字保留；经 `quay goal write AC-291 --criterion "$(cat <新判据文件>)"` 落库。⚠️ 注释保持单一逻辑行。⛔ 不手工 Edit `goals/*.md`。
4. **同步夹具**：`packages/quay/test/ac291-criterion-address-derivation.test.mjs` 的 6 个可评估性负例断言 `code` 由 `1` 改 `3`，第 7 个（断言侧）保留 `1`；`node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs` ⇒ 全绿。
5. **正控制**：确认（若无则拉起）一个 cwd=仓库根的 `quay.ts serve`（⛔ 不手拼 `spawn`；用仓库既有启动器 `plugin/scripts/start-drivers.ts` 或 `quay serve`），`node packages/quay/bin/quay.js goal gate AC-291`（主检出根）⇒ **exit 0**，四条断言各自独立可核（en nav `Live` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav `Live` 计数 =0 / zh `<title>` ≠ en `<title>`）。
6. **不可评估态控制**：在**无**实例的 scratch 根上 `quay goal gate AC-291 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`；⛔ 不必停掉生产实例。
7. **新指纹落账**：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1` 使 AC-291 以新 `criterionHash` 落一条 `pass`（⚠️ 不带 `env -u …` 时 sweep 会 `refused:true, eligible:0`）；贴出台账新增行的逐字 JSON。
8. **不回归**：`bash scripts/test.sh --for-task gap-ac291-criterion-carrier-absence-not-evaluated` 绿；家族枚举逐文件对照（三个 token 各 17 / 10 / 10）。

## AC

- [x] **AC1（可评估性分支已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `CAUSE=no-running-serve-instance`、`CAUSE=no-derivable-serve-address`、`CAUSE=no-reachable-serve-address` 三处由 `exit 1` 变 `exit 3`；`expect` 与十条 `CAUSE=` 断言分支逐字相同。⛔ 未经 `quay goal write` 落库不算。
- [x] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac291-criterion-address-derivation.test.mjs` 的 6 个可评估性负例断言 `code === 3`、断言侧那一条仍 `code === 1`、全部正例仍 `code === 0`；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `code === 1` 断言下的对照（`git show <old>:<file>`）证明这 6 条确实 1 → 3。
- [x] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-291` ⇒ **exit 0**，逐字贴出；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、argv 含 `quay.ts serve` 的活进程。
- [x] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/live` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分，逐字贴出。⛔ 该证据的活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [x] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-291 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [x] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-291` 最新一条为 `verdict:"pass"`，其 `payload.criterionHash` **≠** `f455d4534f8067e9`（两行都贴）；② `bash scripts/test.sh --for-task gap-ac291-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出（`grep -rl` 三个 token 各 17 / 10 / 10），并说明本任务只改 AC-291 一条的退出码。
- [x] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下派发/执行时 `ps aux | grep -c '[q]uay-task-worker'` 的读数与「本实例无监督者、死亡后不会被自动拉回」的观察项及其发生率读数（AC-291 4 条 / 家族 17 个 goal 文件）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实运行的服务上为真、且三态可区分的判据落了账**：

1. **落地对象**：`goals/AC-291-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit）；**且**一个 cwd = 仓库根的 `quay.ts serve` 实例在跑（复用现成的或从主检出 HEAD 起）—— 只改文本不算落地。
2. **三态齐备（同一条判据给出三个互不同形的取值）**：活实例 + 真接线 ⇒ **`exit 0` / `pass`**；可达但 zh 未翻译 ⇒ **`exit 1` / `fail`**；无实例 ⇒ **`exit 3` / `not-evaluated`（⛔ 非 fail、非 pass）**。三者各自的逐字读数进 Evidence。
3. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-291` / `gate=goal` / `verdict:"pass"` 的新事件，其 `criterionHash` **≠** `f455d4534f8067e9` —— **一条 dry-run 输出不算**。
4. **动机随判据进记录**：`quay goal write` 落库的 criterion 里带着「为什么改」的注释与读数（载体缺席 ≠ 为假；`exit 3` 是仓库在 `goal-store.ts:305-318` 写死的约定），而不是只留在本任务体里。

## Touches

- `goals/AC-291-live-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac291-criterion-address-derivation.test.mjs`
- `tasks/gap-ac291-criterion-carrier-absence-not-evaluated.md`

（说明：第一条是落地面 —— 地址派生那步的**退出码**，经 `quay goal write AC-291 --criterion …` 落库，`expect` 与分支文本逐字不变；第二条是与该块逐字绑定的夹具（6 个可评估性负例断言随之同步，断言侧那条保留 `1`）；第三条是 self-touch。⛔ `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**（前者是观察项非目标，后者是夹具自造活面的约束）。）

## Evidence（执行轮，2026-09-29T02:40–02:52Z，worker worktree `/data/home/yale/work/quay-worktrees/gap-ac291-criterion-carrier-absence-not-evaluated`）

⛔ 本节每条读数都是本执行轮的**直接量**，逐字贴出；未跟踪的原始产物在同 worktree 的 `.quay/ac291/`。

### 落地对象与指纹（AC1 / AC6① 的载体）

```
worktree 提交   2bd142052  goals: AC-291 field:criterion by cli:1002590
主检出提交      e0105451a  goals: AC-291 field:criterion by cli:1037611   （生产 goal store）
merge 提交      abdda9e68  Merge branch 'develop' into task/gap-ac291-criterion-carrier-absence-not-evaluated
```

- 两处 goal 文件**逐字相同**：`md5 ff10ec355f37133093e000463b38997e`（主检出 = worktree）⇒ fan-in 的 merge 实测 clean，`git diff --name-only develop...HEAD` 只剩夹具一条。
- 旧 `criterionHash` = `f455d4534f8067e9`（本任务立案值；台账 goal-sweep `2026-09-29T02:05:58.682Z` 那条逐字同值）。
- 新 `criterionHash` = `fc4b03f7c662d8ec`（`criterionFingerprint` 对修订前/后文本实算 + 台账 goal-amend 行，**两条独立来源一致**）。
- 修订**只**经 `quay goal write AC-291 --criterion "$(cat <新判据文件>)"` 落库（worktree 与主检出各一次），⛔ 未手工 Edit `goals/*.md`。

### AC1 —— 三处可评估性分支 `exit 1` → `exit 3`，断言分支逐字未动

criterion 修订 diff（parsed 后的逻辑行；新增一个「为什么改」注释块 + 三处退出码）：

- `if [ -z "$addr" ] && [ "$nserve" = 0 ]; … "CAUSE=no-running-serve-instance …" >&2; exit 1; fi` ⇒ `exit 3`
- `if [ -z "$addr" ] && [ "$nderived" = 0 ]; … "CAUSE=no-derivable-serve-address …" >&2; exit 1; fi` ⇒ `exit 3`
- `if [ -z "$addr" ]; … "CAUSE=no-reachable-serve-address …" >&2; exit 1; fi` ⇒ `exit 3`

解析后 criterion 的 `exit 3` 计数 = **3，全在三处分支行**（critline 92 / 94 / 96）；断言分支零处（注释块内另有 2 处为说明文字）。十条断言分支（`en-fetch-failed` / `zh-fetch-failed` / `no-nav-region` / `no-nav-region-zh` / `english-baseline-missing` / `no-title-tag` / `no-title-tag-zh` / `html-lang-not-zh` / `nav-label-untranslated` / `title-unchanged`）与 `expect` 字段逐字不变（`git diff` 无触碰）。⛔ AC-291 判据**没有** `workspace-root-unresolvable` 分支（未去找第四个）。⛔ 注释块内**不含** `CAUSE=` / `FAIL=` 字面量（`grep` 实测 0）。

### AC2 —— 夹具同步（6 条 1→3，断言侧保留 1）

修订前（`git show develop:packages/quay/test/ac291-criterion-address-derivation.test.mjs`，**逐字**）：

```
282:    assert.equal(r.code, 1, `expected a non-zero verdict, got ${r.code}`);   ← no instance
298:    assert.equal(r.code, 1, `expected a non-zero verdict, got ${r.code}`);   ← no derivable address
315:    assert.equal(r.code, 1);                                                 ← carrier-no-web-entry
325:    assert.equal(r.code, 1);                                                 ← carrier-pid-mismatch
335:    assert.equal(r.code, 1);                                                 ← carrier-web-marked-down
346:    assert.equal(r.code, 1);                                                 ← no reachable address
376:    assert.equal(r.code, 1, "the amended derivation must not have softened the assertion it feeds");  ← 断言侧，保留
```

修订后：前 6 条 `code === 3`，第 7 条**逐字保留 `1`**，全部正例仍 `code === 0`。

```
$ node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs
ℹ tests 13   ℹ pass 13   ℹ fail 0
```

⚠️ **与任务体 Plan 第 5 条的一处实测差异**（硬规则 4c：判据落笔当轮取真实读数就是为了抓到这类）：AC-291 的夹具**不使用** `# >>> addr-derivation` / `# <<< addr-derivation` 定界块 —— 那两个 marker 只存在于同族其余判据里（`grep -c addr-derivation goals/AC-291-*.md ⇒ 0`）。它用 `storedCriterion()` 读整条 `criterion` 字段、在 `git init` 过的临时根里跑**整条**判据（比抽块更强，不是回声）。故本任务只改 6 条断言的数值，⛔ 未为引入 marker 而重构夹具（那既超出本任务语义，也与「其余逐字保留」冲突）。

### AC3 —— 正控制：活实例上真 pass

```
$ node packages/quay/bin/quay.js goal gate AC-291          # cwd = 主检出根
{"id":"AC-291","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)","timeoutMs":60000,
 "timestamp":"2026-09-29T02:43:41.786Z","dryRun":false,
 "event":{"id":"2a89224a-0e51-4cc4-9d4c-d5d2d011a6d9","item_id":"AC-291","gate":"goal","actor":"goal-cli",
          "verdict":"pass","payload":{"reason":"acceptance passed (exit 0)"}}}
GATE_EXIT=0
```

同一时刻的活实例（`pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd`）：

```
pid=3652175 cwd=/data/home/yale/work/quay
argv=/data/home/yale/.nvm/versions/node/v24.21.0/bin/node --no-warnings --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts serve --host 127.0.0.1
```

同根上直接跑**存储文本**的逐字读数：

```
AC-291 candidate readings (cwd=/data/home/yale/work/quay, nserve=1, ncand=2, nderived=1):;
  pid=1074711 addr=<none> argv=argv-no-serve-subcommand cause=carrier-pid-mismatch;
  pid=3652175 addr=127.0.0.1:20119 argv=argv-port-absent cause=fetch-answered
OK -- /live: default nav region carries "Live" and <title>="quay — Live — loop activity"; under Cookie: lang=zh the response is <html lang=zh>, that English nav label is gone from the nav region, and this page's own <title> became "quay — 实时 — 循环活动"
CRITERION_EXIT=0
```

四条断言**各自独立复算**（绕开判据，直接对活端口 `127.0.0.1:20119` 取两条响应体）：

```
A1 en nav region literal "Live" count: 2   (>=1 required)
A2 zh response has <html lang="zh": true
A3 zh nav region literal "Live" count: 0   (===0 required)
A4 en <title>: "quay — Live — loop activity" / zh <title>: "quay — 实时 — 循环活动" → differ: true
VERDICT: ALL FOUR ASSERTIONS HOLD INDEPENDENTLY
```

载体 `.quay/server.json` 的 `web` 项：`{name:"web", pid:3652175, host:"127.0.0.1", port:20119, up:true}`，`startedAt 2026-09-29T02:07:52.834Z` —— 与立案材料记载的 peer 重启时刻（02:07:52Z）一致。

### AC4 —— 负控制：该报假时仍报假（**行为**证据，⛔ 非文本 diff）

活面由脚本自造（`/tmp/ac291-negcontrol.mjs`：`git init` 临时根 + 真 `http` server 提供**未翻译**的 zh 面 + 生产 argv 形状的 serve 子进程 + 载体）。⛔ 未改任何 `packages/quay/src/serve-*.ts`。

```
--- negative control: root=/tmp/ac291-neg-mGf7iw fake-serve pid=1299678 web port=13105 (zh nav NOT wired) ---
AC-291 candidate readings (cwd=/tmp/ac291-neg-mGf7iw, nserve=1, ncand=2, nderived=1):;
  pid=1299678 addr=127.0.0.1:13105 argv=argv-port-kernel-assigned cause=fetch-answered;
  pid=1301624 addr=<none> argv=argv-no-serve-subcommand cause=carrier-pid-mismatch
CAUSE=nav-label-untranslated -- the nav region of /live under Cookie: lang=zh still renders the literal English nav label "Live"; the nav is not wired to the zh dictionary
CRITERION_EXIT=1
```

⇒ 判据**仍能取假**，且断言侧的 `exit 1` 与三处可评估性 `exit 3` 形态可区分。夹具最后一条（"the ASSERTION block is still live"）以同样形态独立覆盖。

### AC5 —— 三态可区分（同一条判据给出三个互不同形的取值）

(a) **无活实例**（`git init` 过的 scratch 根，无 serve 子进程）：

```
$ node packages/quay/bin/quay.js goal gate AC-291 --root /tmp/ac291-noinst --dry-run --json
{"id":"AC-291","verdict":"not-evaluated","cause":"declared",
 "reason":"not-evaluated (declared): acceptance failed (exit 3) — AC-291 candidate readings (cwd=/tmp/ac291-noinst,
   nserve=0, ncand=1, nderived=0):; pid=1338245 addr=<none> argv=argv-no-serve-subcommand cause=carrier-unreadable
   CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/tmp/ac291-noinst; /live cannot be evaluated
   on a live surface (AC-179 probe pattern)", "timeoutMs":60000, "dryRun":true, ...}
```

⛔ `verdict:"not-evaluated"` / `cause:"declared"` —— **不是 `fail`**（实测同一条命令在修订前会读成 `verdict:"fail"`）。

(b) **活实例 + 真接线**（主检出根）：

```
$ node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json
{"id":"AC-291","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)","timeoutMs":60000,"dryRun":true, ...}
GATE_EXIT=0
```

(c) **可达但 zh 未翻译** ⇒ 见 AC4：`exit 1` / `fail`。三态读数齐备（DoD 2）。

### AC6 —— 新指纹落账 + 不回归 + 家族枚举

① 台账 `.quay/gate-events.jsonl` 中 `item_id=AC-291` 的**最新一条**（修订后、⛔ 非 dry-run）：

```
{"id":"35a913a8-d2c7-4266-a746-01bf53306428","item_id":"AC-291","pipeline_id":"AC-291","gate":"goal","actor":"goal-amend","verdict":"pass","timestamp":"2026-09-29T02:44:57.567Z","payload":{"reason":"acceptance passed (exit 0)","criterionHash":"fc4b03f7c662d8ec"}}
```

修订前同字段的最后一条（对照，逐字）：

```
{"id":"e3407247-51f6-4736-a803-e1a06424042f","item_id":"AC-291","pipeline_id":"AC-291","gate":"goal","actor":"goal-sweep","verdict":"fail","timestamp":"2026-09-29T02:05:58.682Z","payload":{"reason":"acceptance failed (exit 1) — … CAUSE=no-running-serve-instance …","criterionHash":"f455d4534f8067e9"}}
```

⇒ `f455d4534f8067e9` → `fc4b03f7c662d8ec`。该 `goal-amend` 行由**生产 goal driver 的轮转自动产生**（`sweepFrozen` 的 AMENDMENT PRIORITY：判据文本变过 ⇒ 不等 `minAgeMs` 即重跑并记录），即「判据改版后自动获得一条针对新版可用的 verdict」这条设计路径按预期工作；`check --stale-pass` 在同一时刻把 AC-291 从 `amendedUnverified` 中移出（修订后读数：`amendedUnverified` 已不含 AC-291）。

② scoped 门绿（driver fan-in 跑的正是同一条命令）：

```
$ bash <worktree>/scripts/test.sh --for-task gap-ac291-criterion-carrier-absence-not-evaluated --allow-thin
ℹ tests 13   ℹ pass 13   ℹ fail 0
SCOPED_GATE_EXIT=0
```

本轮实测该门**只执行了本任务的夹具 13 条**（delta 被真实执行；日志 `.quay/ac291/scoped-gate.log`）。scoped-gate cache 以 **merge 时刻**的 develop sha 落盘：`e0105451a18b75c33dc8b74922a519345fe09304`（= `HEAD^2`，实测是 `HEAD` 的祖先；⛔ 未用此后已前进的 `develop` tip）。

③ 家族枚举（逐文件，`grep -rlF`）：

```
grep -rlF '.quay/server.json'           goals/ | wc -l  =>  17
grep -rlF 'no-derivable-serve-address'  goals/ | wc -l  =>  10
grep -rlF 'no-reachable-serve-address'  goals/ | wc -l  =>  10
```

17 个家族文件逐个（物理文件里 `exit 3` 的行数）：

```
exit3=1  AC-179-web-card-and-cli                 ← 先于本任务存在，⛔ 非本任务所改
exit3=0  AC-288 / AC-289 / AC-290
exit3=4  AC-291-live…                            ← 本任务：3 处代码分支（第 1 处被 YAML 折行拆开故物理行显示 2 处）+ 2 处注释文字
exit3=5  AC-292-board…  /  AC-301-goal…          ← 同机制的在飞兄弟任务各自修订，⛔ 非本任务所改
exit3=0  AC-293 / 294 / 295 / 296 / 297 / 298 / 299 / 300 / 302 / 303
```

**本任务只改 AC-291 一条**：提交里只有 `goals/AC-291-*` 与夹具两个文件，其余 16 个家族文件的退出码未由本任务改动。

### AC7 —— 非目标边界未被越过

```
$ git -C <worktree> diff --name-only develop...HEAD
packages/quay/test/ac291-criterion-address-derivation.test.mjs
$ git -C <worktree> diff --name-only develop...HEAD | grep -E '^plugin/scripts/.*\.ts$|^packages/quay/src/serve-.*\.ts$'
(none — 空)
```

⇒ ⛔ 未改 `plugin/scripts/driver-anchor.ts`、⛔ 未改 `plugin/scripts/start-drivers.ts`、⛔ 未新增任何 `plugin/scripts/*.ts`、⛔ 未改任何 `packages/quay/src/serve-*.ts`。

执行轮读数：`ps aux | grep -c '[q]uay-task-worker'` ⇒ **4**。

**观察项（非目标，⛔ 不构成任何门禁要求）**：`quay serve` **无监督者** —— web 不在 `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 六类里，`start-drivers.ts` 只在**被调用时**判 staleness/down ⇒ 实例死亡后不会被自动拉回。发生率读数（硬规则 12，查历史而非等下一轮）：台账 `item_id=AC-291` 事件共 **200** 条，其中含 `no-running-serve-instance` 的 **4** 条，跨越 **2** 个日期（2026-09-23、2026-09-29），verdict 全为 `fail`；家族面含 `.quay/server.json` 的 goal 文件 **17** 个。本执行的**承接线**：派发时已有一个 cwd=仓库根的活实例（pid 3652175），**直接复用**，⛔ 未重启任何 peer 在飞任务所依赖的服务。