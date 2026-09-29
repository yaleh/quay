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

⚠️ **执行轮实测的两处工具陷阱**（记录，供同族后续轮复用）：

- `quay-native task edit <id> --body-file <f>` **被静默丢弃** —— `packages/quay-native/bin/quay-native.ts` 的 `adr` / `doc` 两个 `write|new|edit` 分支都读 `flags["body-file"]`（:134 / :170），而 **`task edit` 分支只读 `flags["body"]`**（:390）。后果：`patch.body` 保持 undefined ⇒ `store.write(id, {})` 把文件**原样重写**（mtime 变、内容一字不变），却以 **exit 0 + `updated <id>`** 报告成功。本执行轮先命中它：那次写入后 `git status` 干净、复选框仍 0/7。改用 `--body "$(cat <file>)"` 即正常。（同族先例：`task edit <id> --help` 同样是静默写入而非帮助。）
- **两条写面的尾随换行不一致**：`"$(cat f)"` 会剥掉尾随换行，而 MCP `task_write` 的 body 保留它 ⇒ 两边产出的文件差一个 `\n`（实测 32144 vs 32145 字节，末行内容相同）。为避免 fan-in 的 merge 在末行上起冲突，本轮把 worktree 与主检出两侧**校准到逐字相同**（`md5 acab4b4bc319a6f638a0638ec4c9ea0a`）。

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

① 台账 `.quay/gate-events.jsonl` 中 `item_id=AC-291` 的**最后一条带 `criterionHash` 的记录**（修订后、⛔ 非 dry-run）—— ⚠️ 以「带指纹的那条」为准，是因为 `goal gate`（actor=goal-cli）路径按设计**不写**该字段（本任务实测多条），而 goal driver 的轮转每几分钟就追加一条不带指纹的 `pass` ⇒ 「最新一条」这个措辞会随台账尾移动而失效：

```
{"id":"35a913a8-d2c7-4266-a746-01bf53306428","item_id":"AC-291","pipeline_id":"AC-291","gate":"goal","actor":"goal-amend","verdict":"pass","timestamp":"2026-09-29T02:44:57.567Z","payload":{"reason":"acceptance passed (exit 0)","criterionHash":"fc4b03f7c662d8ec"}}
```

修订前同字段的最后一条（对照，逐字）：

```
{"id":"e3407247-51f6-4736-a803-e1a06424042f","item_id":"AC-291","pipeline_id":"AC-291","gate":"goal","actor":"goal-sweep","verdict":"fail","timestamp":"2026-09-29T02:05:58.682Z","payload":{"reason":"acceptance failed (exit 1) — … CAUSE=no-running-serve-instance …","criterionHash":"f455d4534f8067e9"}}
```

⇒ `f455d4534f8067e9` → `fc4b03f7c662d8ec`。该 `goal-amend` 行由**生产 goal driver 的轮转自动产生**（`sweepFrozen` 的 AMENDMENT PRIORITY：判据文本变过 ⇒ 不等 `minAgeMs` 即重跑并记录），即「判据改版后自动获得一条针对新版可用的 verdict」这条设计路径按预期工作；`check --stale-pass` 在同一时刻把 AC-291 从 `amendedUnverified` 中移出（修订后读数：`amendedUnverified` 已不含 AC-291）。

该行 `actor: goal-amend`，由生产 goal driver 的轮转写下；其指纹与修订文本实算值一致 ⇒ 本条断言对后续任何一次轮转**保持为真**（判据已改版，之后的轮转只会写新指纹）。

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

**观察项（非目标，⛔ 不构成任何门禁要求）**：`quay serve` **无监督者** —— web 不在 `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 六类里，`start-drivers.ts` 只在**被调用时**判 staleness/down ⇒ 实例死亡后不会被自动拉回。发生率读数（硬规则 12，查历史而非等下一轮；⛔ 下列为**本轮读数**，台账尾会继续增长）：台账 `item_id=AC-291` 事件共 **200** 条，其中含 `no-running-serve-instance` 的 **4** 条，跨越 **2** 个日期（2026-09-23、2026-09-29），verdict 全为 `fail`；家族面含 `.quay/server.json` 的 goal 文件 **17** 个。本执行的**承接线**：派发时已有一个 cwd=仓库根的活实例（pid 3652175），**直接复用**，⛔ 未重启任何 peer 在飞任务所依赖的服务。


执行轮 4（2026-09-29，worker worktree）—— 本轮 exited-not-landed 于 step=suite，⛔ 不是本任务 delta 的缺陷。读数：suite 红 23（20 确定性 + 3 同源计数），其中 20 条分布在 packages/quay/test/ac{292,301,303}-criterion-address-derivation.test.mjs；那三份夹具与本任务工作树/develop 逐字相同（git diff develop HEAD -- <三文件> 为空），失败形一律 '3 !== 1'。根因：三支兄弟任务的 quay goal write 已直落 develop（判据的可评估性出口已 exit 3），而其绑定夹具只能经 fan-in 落地 ⇒ 合并树不绿。本任务 delta 只有 packages/quay/test/ac291-...test.mjs 一条，其夹具 13/13 绿，scoped 门 exit 0。剩余 1 条 plugin/test/tmux-isolated.test.mjs 隔离跑 5/5 绿 ⇒ suite 负载下的 flake，非缺陷。该机制已由 gap-goal-write-outruns-bound-fixture-family-deadlock（status ready）立案；其永久化半边是 gap-ac292 已 needs-human（分支带着自己的夹具修复却不落地）⇒ 家族一起落地或改 goal 写入时序之前，本任务无法经 fan-in 落地。⛔ 未越 Touches、未改任何兄弟夹具。

更正上一则笔记的计数（硬规则 2：贴出计数前先核命中）：精确读数为 22 条家族红 + 1 条 flake = 23，不是 20。（a）本工作树（ac291 夹具已修）跑出的 23 = ac292 7 + ac301 7 + ac303 8 + plugin/test/tmux-isolated.test.mjs 1；上一则写的 20 来自一次被 head 截断的隔离跑，作废。（b）develop 树的家族红是 28 = 上述 22 + 本任务自己的 ac291 6 条（develop 上 ac291 夹具仍断言 1）。逐字依据：suite 日志 'AssertionError [ERR_ASSERTION]' 行 = 23；'test at <file>' 头按文件分布 = ac292 7 / ac301 7 / ac303 8 / tmux-isolated 1；tmux-isolated 隔离跑 5/5 绿 ⇒ 负载 flake。本任务 delta 仍是唯一一条 ac291 夹具，13/13 绿。


执行轮 5（2026-09-29T04:02Z，同一 worker worktree）—— 本轮**未改任何代码**（`git merge develop` ⇒ `Already up to date`；`git merge-base --is-ancestor develop HEAD` ⇒ 真，分支已自带前 13 提交的全部实现）。本轮只做**逐条 AC 复核**与**死锁现状的直接量复核**。

**复核读数（本轮实测，⛔ 非转述）**：合并树内四份绑定夹具逐文件 `node --test` ⇒ ac291 **13 tests / 13 pass / 0 fail**（本任务 delta，绿色）、ac292 **13 / 6 / 7 fail**、ac301 **14 / 7 / 7 fail**、ac303 **20 / 12 / 8 fail**，合计 **22 红**，与 fan-in suite 日志 `# fail 22` 逐字一致；红形一律 `expected exit 1, got 3`。`ready-pool-check.ts --json` ⇒ `pool=4`、`dispatchable_disjoint=3`、`landing_blocked=false`、`suite_blocking.consecutive_red=0`、`ready=[ac291, ac301, ac303, 解法任务]`。

<!-- dedup-ref -->
**⚠️ 新观察（本轮机械算出，⛔ 非关键词匹配）**：逐文件求 `## Touches` 交集 ⇒ 三个兄弟任务**彼此不相交**，而解法任务 `gap-goal-write-outruns-bound-fixture-family-deadlock` 的 5 条 Touches 与三个兄弟**逐一相交**（各命中同一条夹具）⇒ `dispatchable_disjoint=3` 中那个非 disjoint 项就是**解法任务本身**。后果：解法任务只能在三个兄弟都不在飞时才被派，而三个兄弟每轮 fan-in 失败即被重派（重试上限因 `unrelated-flaky-exempt` 不前进）⇒ **存在「解法被它所要解锁的那三个任务饿死」的路径**。本任务⛔ 不改任何状态（不 un-park 兄弟、不自改 `status`、不扩 `## Touches`），只把读数记在此处。


执行轮 6（2026-09-29T04:30Z，同一 worker worktree）—— 本轮⛔未改任何代码（`git merge --no-edit develop` ⇒ `Already up to date`；`git merge-base --is-ancestor develop HEAD` ⇒ 真，分支已带上全部实现）。本轮复核读数：本任务夹具 `node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs` ⇒ tests 13 / pass 13 / fail 0；scoped 门 `bash scripts/test.sh --for-task gap-ac291-criterion-carrier-absence-not-evaluated --allow-thin` ⇒ SCOPED_GATE_EXIT=0；scoped-gate cache 以 **merge 时刻**的 develop sha `c297b38e32d7f241fdc534939decc85578647a49`（实测是 HEAD 的祖先）写盘 —— ⛔ 不用 scoped 门跑完后 `git rev-parse develop` 的值：develop 在那 6 分钟内已前进到 `09a66639a26ec7022f9cdfb63ee5376a3af0315b`，而那**不是** HEAD 的祖先，写进去永远不会命中（`worker-fan-in.ts:1592` 的判定是「与锁内 merge 到的 develop tip **完全一致**」）。

**本轮新读数（硬规则 4：一个结构上不可能取某值的量，不是测量）**：`ready-pool-check.ts` 的 suite-red 刹车**结构上永不触发**。

- 刹车读 `.quay/per-task-suite-records.jsonl`（`ready-pool-check.ts:1724` → `:3268` `computeSuiteBlocking`）。
- 该账本的**唯一活 writer** 是 `plugin/workflows/fan-in-execute.js:787/798`，它在「无锁段 step 4.5 — per-task-suite 入账（**全绿后**）」块内、把 `--state green` **写死** ⇒ 红 fan-in 永远走不到那一步 ⇒ 账本**不可能新增 red 行**。实测：635 行 = `{green: 631, red: 4}`，4 条 red 全在 2026-08-16/17（旧 writer 遗留），末行 `2026-09-24 green`，**2026-09-29 共 0 行**（而当天有多轮红 fan-in suite）。
- 真 red 读数**就在隔壁且是今天的**：`.quay/verification-round.jsonl` round **2189 / 2190 / 2191** 全 `state: red`，taskId 正是本家族三支（ac291 / ac301 / ac303）；但 `ready-pool-check.ts:3257` 逐字写明它「**NO LONGER** a throttling input」。
- `worker-fan-in.ts` 与 `worker-driver.ts` 对该 writer 的引用数各 = **0** ⇒ 机械 fan-in（happy path）什么都不写。

⇒ `consecutiveRedRounds()` 从一个「按构造为绿」的尾部往回数 ⇒ 恒 0 ⇒ 本轮实测 `consecutive_red:0` / `window_active:false` / `landing_blocked:false` ⇒ 本任务与三支兄弟被无限重派，**每轮烧一个 ~20 分钟全量 suite**。

与 `judgeRetryExemption` 的 `unrelated-flaky-exempt`（同断言签名跨 ≥2 任务 ⇒ **不推进重试上限**）合起来构成**无出口的 churn**：本任务第 4 / 5 / 6 轮全部 `exited-not-landed` 于 step=suite，且本轮读数给出**本轮无法落地**的判据 —— 本任务 delta 只有 `packages/quay/test/ac291-criterion-address-derivation.test.mjs` 一条（`git diff --stat develop...HEAD` 逐字），其余红源（ac292 / ac301 / ac303 三份绑定夹具）在 `## Touches` 之外，而 `anti-drift-touches-check.ts` 对未声明写入 HARD-FAIL ⇒ **在 develop 变绿之前本任务的 fan-in 不可能成功**，与重试次数无关。⛔ 本轮未越 Touches、未改任何兄弟夹具、未写任何 `status:`、未 un-park 任何任务、未新增 `plugin/scripts/*.ts`。

---
_2026-09-29T04:45:04.276Z_: Round 2026-09-29T04:38–04:44Z (worker, continuation round). ⛔ NOT a re-implementation: the branch's 15 commits already carry the landing object (goal write in main checkout + worktree, byte-identical md5 `ff10ec355f37133093e000463b38997e`). This round re-verified AC1–AC7 one by one with fresh direct readings:

- **AC1** — parsed criterion (`YAML.parse(frontmatter).criterion`, 115 logical lines): `exit 3` lands on critlines **92 / 94 / 96** = exactly the three evaluability branches (`CAUSE=no-running-serve-instance` / `no-derivable-serve-address` / `no-reachable-serve-address`); critlines 82/83 are the WHY-comment prose. `exit 1` count = **10** = exactly the ten assertion branches.
- **AC2** — `node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs` ⇒ **13 pass / 0 fail**; `git diff develop...HEAD` = that one file, exactly the 6 evaluability assertions `1 → 3` with the 7th (ASSERTION block) kept at `1` and all positives at `0`.
- **AC3** — live reading **2026-09-29T04:43:17.390Z**: `node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json` ⇒ `"verdict":"pass"`, `GATE_EXIT=0`; same instant `pgrep -f 'quay.ts serve'` + `readlink /proc/<pid>/cwd` ⇒ live instances at cwd=`/data/home/yale/work/quay` (pid 2205593, 3652175).
- **AC4** — the negative control is behavioural and green: the last of the 13 tests (`the ASSERTION block is still live — a zh page whose nav was never wired fails, and says which arm`) asserts `code === 1` and passes.
- **AC6①** — ledger `.quay/gate-events.jsonl`, `item_id=AC-291`: latest event **2026-09-29T04:08:49.860Z** `gate=goal` `actor=goal-sweep` `verdict:"pass"` with `payload.criterionHash = fc4b03f7c662d8ec` ≠ the filing hash `f455d4534f8067e9`.
- **AC6②** — scoped gate `bash scripts/test.sh --for-task gap-ac291-criterion-carrier-absence-not-evaluated --allow-thin` ⇒ **EXIT=0** (13 pass / 0 fail; log `.quay/ac291-round2-scoped-gate.log`); scoped-gate cache written for `developSha 6244047f8266c882ae0d1f8ef79916e8b796e71a`.
- **AC7** — `git diff --name-only develop...HEAD` = `packages/quay/test/ac291-criterion-address-derivation.test.mjs` only, which IS in `## Touches`. No `plugin/scripts/*.ts`, no `packages/quay/src/serve-*.ts` touched.

**The only reason this round is still `exited-not-landed` is the already-filed cross-task family deadlock** — `gap-goal-write-outruns-bound-fixture-family-deadlock` (status `ready`). Direct readings this round: on `develop` the goal criteria for AC-292 / AC-301 / AC-303 already exit `3`, while their three bound fixtures still assert `1`; those three fixtures are **byte-identical between develop and this worktree** (`git diff develop HEAD -- <the three files>` is empty), so they are not this task's delta. The mechanical fan-in runs the **full** suite in *this* branch's merge tree, which necessarily still carries those three unfixed fixtures ⇒ a deterministic 22-red suite ⇒ no branch in the family can be green ⇒ no fan-in can land (measured: 30+ suite-red attempts across the four sibling tasks since 02:22Z, every one judged `unrelated-flaky-exempt`, so the retry cap never trips and the driver re-dispatches indefinitely).

⛔ This worker did **not** try to break out from its own mandate: the sibling fixtures are outside this task's `## Touches`, `anti-drift-touches-check.ts` HARD-FAILs out-of-declared writes, and widening `## Touches` by hand would falsify this task's own AC7. The break-out is a manager action on the filed deadlock task.

_2026-09-29T05:13:30.829Z_: 
执行轮 7（2026-09-29T05:13Z，同一 worker worktree；`git merge develop` ⇒ clean，合并 develop @ e937b4e4e）—— ⛔ 未改任何代码（`git diff --stat develop...HEAD` 仍只有 ac291 夹具 + 本任务体两条）。

**根因升级：从推论到机械直读。** 前几轮写的是「合并树红」；本轮直接给 develop 自身做普查 ⇒ **develop 自己就是红的**，与合并无关：

```
goals/AC-291-*.md  exit3=4 exit1=10   ← 判据（exit 3 已落）
goals/AC-292-*.md  exit3=5 exit1=10
goals/AC-301-*.md  exit3=5 exit1=12
goals/AC-303-*.md  exit3=2 exit1=10
夹具 develop 副本      code===1 断言：ac292 7 / ac303 10 / ac291 7，code===3 全 0
```

即：`quay goal write` 把**判据**即时直落 develop，而**绑定夹具**只能经 fan-in 落地 ⇒ 半迁移态。**只要 develop 上这三份夹具仍是 `code === 1`，本任务（以及三支兄弟）的 fan-in 就不可能过 suite。**

**复现（逐文件 `node --test`，⛔ 非全量 suite）**：

```
ac291  13 / 13 pass  / 0 fail    ← 本任务 delta，绿
ac292  13 /  6 pass  / 7 fail    ← 7× "3 !== 1"
ac301  14 /  7 pass  / 7 fail    ← 7× "3 !== 1"（含 2× "expected exit 1, got 3"）
ac303  20 / 12 pass  / 8 fail    ← 8× "3 !== 1"
家族红 22 条；失败形一律 3 !== 1
```

**饿死链（本轮新读，硬规则 4b：用外部可核的量）**：`ready-pool-check.ts --json` ⇒ `pool=4 / dispatchable_disjoint=3 / landing_blocked=false`。四支 = ac291 / ac301 / ac303 / 解法任务（ac292 已 needs-human 出池）；`recommended` 批次是**互斥**批，非 disjoint 的那一条正是 `gap-goal-write-outruns-bound-fixture-family-deadlock`（其 Touches 逐条压在三支在飞兄弟的夹具上）⇒ **解法任务被它正要解锁的那三个任务静态饿死**。已知唯一出口（见 `gap-goal-write-outruns-bound-fixture-family-deadlock`）：把兄弟**移出在飞集** —— park，或加一条 `depends_on` 边（`deps-ready` 过滤器承认该边）；提高其 relevance / `blocking` 无效。⚠️ 三个**同时**移出才够（只移本任务一个，解法仍与另两支非 disjoint）。

`suite_blocking.consecutive_red=0 / window_active=false` 本轮再次实测 —— 刹车结构上不可能持有 red（`per-task-suite-records.jsonl` 唯一活 writer 把 `--state green` 写死，且只在全绿后跑）。

**三态复核（本轮实测，活载体 pid 3652175 cwd=/data/home/yale/work/quay）**：① 活实例 + 真接线 ⇒ `verdict:"pass"` / exit 0；② 无实例 scratch 根 ⇒ `verdict:"not-evaluated"` / `cause:"declared"`（⛔ 非 `fail`）；③ 可达但 zh 未翻译 ⇒ exit 1（执行轮 4 行为证据 + 夹具末条独立覆盖）。**本任务交付物本身完好。**

scoped 门 `--for-task gap-ac291-… --allow-thin` ⇒ **exit 0（13/13）**；scoped-gate cache 以 **merge 时刻** develop sha `e937b4e4ec00792e9bababaab17fee9513030fcb`（= `HEAD^2`，实测是 HEAD 的祖先）写盘。

⛔ 本轮未越 Touches、未改任何 `status:`、未 un-park 兄弟、未扩 `## Touches`（遵本任务既有约束与 worker prompt「status 归 driver」）。**结论：本任务 delta 已完成且自绿，落地面被一个已立案的跨任务死锁阻塞；需要 manager 层做一次顺序裁定（三个兄弟同时 park / 加 `depends_on` 边），否则本家族每轮各烧一个 ~20 分钟全量 suite 且恒定 exited-not-landed。**

---
_2026-09-29T06:13:46.363Z_: Round 8 (2026-09-29T06:12Z) — THE BLOCKER OF ROUNDS 4–7 IS GONE; ⛔ NOT a re-implementation.

The previous four rounds all exited-not-landed at step=suite for ONE reason: a cross-task family
deadlock (four AC-29x goal criteria landed with the evaluability branches at `exit 3` while their
bound fixtures still asserted `1`), filed as `gap-goal-write-outruns-bound-fixture-family-deadlock`.
That task has since LANDED on develop (`23dc19417` "fix(tests): land the four bound fixtures on one
commit"), so develop's four fixtures now carry the exit-3 expectations. The branch was simply 7
commits BEHIND develop — branch-lag, not a code defect.

This round: `git merge develop` @ `7c311f20e`. The only conflict was in THIS task file; both sides
were append-only Evidence blocks ⇒ resolved by per-hunk union (both kept, round 6 then round 7).
Branch delta vs develop is now the TASK FILE ONLY — the ac291 fixture blob is `2480540cf`,
byte-identical to develop's, i.e. this task's own fixture fix is what the family landing propagated.

Fresh readings this round, all taken in the merge tree:

- the four family fixtures together (`node --test ac291 ac292 ac301 ac303`) ⇒ **70 pass / 0 fail**
  (the prior rounds measured 22 red spread across the three sibling fixtures).
- scoped gate `bash scripts/test.sh --for-task gap-ac291-… --allow-thin` ⇒ **exit 0** (13/13,
  the AC-291 block).
- AC1, criterion: exactly **3** evaluability branches at `exit 3` (l.206 `no-running-serve-instance`,
  l.212 `no-derivable-serve-address`, plus the line-wrapped `no-reachable-serve-address` arm — the
  folded YAML scalar puts its `exit` and `3` on different lines, which is why a naive
  `grep 'exit 3'` sees only two) and exactly **10** assertion branches at `exit 1`, verbatim.
- AC3, live: `node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json` @
  2026-09-29T06:12:47.644Z ⇒ `"verdict":"pass"`, `GATE_EXIT=0`; live instance pid 3652175 with
  `cwd=/data/home/yale/work/quay`.
- AC5, three-state: a scratch **git** root with no live instance ⇒ `"verdict":"not-evaluated"`,
  `"cause":"declared"` (⛔ not `"fail"`), while the same criterion on the live instance ⇒ `pass`.
  The not-evaluated / false / true distinction holds end to end.
- AC6①, ledger: the last `item_id=AC-291` event is 2026-09-29T05:22:12.218Z `verdict:"pass"`
  with `payload.criterionHash = fc4b03f7c662d8ec` ≠ the filing hash `f455d4534f8067e9`.
- AC6③, family enumeration: `no-running-serve-instance` **17** / `no-derivable-serve-address`
  **10** / `no-reachable-serve-address` **10** goal files.
- AC7: `git diff --name-only develop...HEAD` = `tasks/gap-ac291-…md` only (which IS in `## Touches`);
  no `plugin/scripts/*.ts`, no `packages/quay/src/serve-*.ts`.

⚠️ OBSERVED, not fixed (outside `## Touches`): `.quay/scoped-gate-cache.json` is a SINGLE flat
record. A peer worker rewrote it with its own task key within the same minute this round wrote its
own (observed key `gap-ac301-…\t7c311f20…`). The cache is an optimization only — on a miss the
driver simply re-runs the scoped gate, so this costs time, never correctness. Recording it as a
reading, not acting on it.

⇒ This task's deliverable is complete and self-green, and the landing surface is now clear:
develop carries the family fix, the branch is current, and the scoped gate is green.
