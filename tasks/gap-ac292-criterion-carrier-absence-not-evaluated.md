---
id: gap-ac292-criterion-carrier-absence-not-evaluated
title: "AC-292 判据把「活载体缺席」记成「此刻为假」——地址派生那步的可评估性分支以 exit 1 出声，违反仓库自己的约定（exit 3 =
  判据声明 not-evaluated，goal-store.ts:313 逐字给出的例子正是「NOT-EVALUATED: carrier
  absent」）⇒ driver 每轮把它当 confirmed-failing 立案；修法=这些分支改 exit 3 + 从 HEAD 拉起活实例使判据真
  pass，并以「接线破坏仍 exit 1」证明强度未减"
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-292
---
**type:** execution

## Proposal

**缺口（立案轮直接量，2026-09-29，cwd = 主检出 `/data/home/yale/work/quay`）**

```
node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json
⇒ {"id":"AC-292","verdict":"fail","cause":null,
   "reason":"acceptance failed (exit 1) — AC-292 candidate readings (cwd=/data/home/yale/work/quay,
             nserve=0, ncand=1, nderived=0):; pid=3001900 addr=-
             cause=argv-no-serve-subcommand,carrier-pid-mismatch
             CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay;
             /board cannot be evaluated on a live surface (AC-179 probe pattern)"}
```

**成因既不是判据的机制坏了，也不是页面退化了 —— 是【判据的活载体（运行中的 `quay serve`）不在】，而判据把「无法评估」这个态用 `exit 1` 报成了「此刻为假」。**

同一时刻的三个读数（⛔ 非转述）：

| 面 | 读数 | 取法 |
|---|---|---|
| 判据 | `verdict:"fail"`、`exit 1`、`nserve=0`、`CAUSE=no-running-serve-instance`、`cause:null` | `quay goal gate AC-292 --dry-run --json` |
| 活实例 | **无**：能匹配的候选里没有一个 cwd = 仓库根的真 `serve` | `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` |
| 载体 `.quay/server.json` | `pid 1555141`（`startedAt 2026-09-25T10:08:25.330Z`）⇒ `kill -0 1555141` = **No such process**；该文件 mtime 停在 `2026-09-25 18:08`，此后再未更新 | `cat .quay/server.json` / `kill -0` / `stat -c %y` |

`.quay/serve.log` 末行逐字是 `[quay serve] STALE CODE: 进程 2026-09-25T10:08:25.330Z 启动，最新 serve 相关提交 2026-09-28T11:01:18.000Z 晚于启动 — 运行中的代码已过期，请重启 server.`，**没有 shutdown 行**（与 SIGKILL/OOM 一致；同机 `journalctl --since '2026-09-29 01:00'` 在 09:48–09:55 有多条其它 scope 的 `A process of this unit has been killed by the OOM killer`）。此后没有任何东西把它拉回来：`quay serve` 有**启动器**（`plugin/scripts/start-drivers.ts`，自带 staleness/down 判定与重启）但**没有监督者** —— `plugin/scripts/driver-anchor.ts` 的 `DRIVER_KINDS` 只有 promotion/worker/outer/goal/quality/meta 六类，web 不在其中。立案时台账里 in-flight 任务 = 0，也没有任何 worker 会顺手重启它。

### 判据的四条断言是真的；今天只是量不到

本 AC 的保证是「在**运行中的**服务上，/board 的 zh 切换相对 en 基线真实发生」。它的 `origin` 逐字写明操作前提：「需有一个 cwd=仓库根的 `quay serve` 实例在跑；实现落地后须重启该实例」。载体不在 ⇒ 这条保证**既没被证真也没被证假**，它是**不可评估**。

而**仓库自己已经为这个态规定了取值**（`packages/quay/src/goal-store.ts:305-318` 逐字）：

> …the criterion itself declared it (**exit 3 — this repo's convention, e.g. 「NOT-EVALUATED: carrier absent」**)… ⛔ **NOT a failure**: "I cannot evaluate this HERE" must not share an output shape with "this is false" — recording it as `fail` would be this file's own original sin (conflating what was recorded with what is true) in a new place.

且这一取值已在**唯一**的映射函数里兑现：`packages/quay/src/gate/acceptance-runner.ts:97-114` 的 `verdictFromAcceptance` 把 `code === 3` 映成 `not-evaluated` / cause `declared`（`NOT_RUNNABLE_EXIT_CODES` 只有 126/127，不含 3）。**AC-292 的判据今天违反的正是这条约定**：它的三个承载体缺席分支（`no-derivable-serve-address` / `no-reachable-serve-address` / `no-running-serve-instance`）与夹具里的七个负例全部 `exit 1`。

### 代价（可核）：driver 每轮把它当 confirmed-failing 立案

`plugin/scripts/goal-driver.ts` 的 `runPrefilingRecheck` 三态分派逐字写着：`verdict === "fail"` ⇒ `outcome:"confirmed-failing"`（**立案**）；`verdict === "pass"` ⇒ `cleared`（不立案）；**其余（含 `not-evaluated`）⇒ `outcome:"not-evaluated"`（不立案）**。所以 `exit 1` 与 `exit 3` 的差别，就是「每轮重复立案」与「不立案」的差别 —— 本轮这份任务本身就是该差别的产物。同理，AC-242 那条元判据的 fail reason 逐字是 `stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-292`（台账 2026-09-29T01:53:19.936Z）：`goal-store.ts:1928-1930` 的冻结扫描把「判据自己声明 not-evaluated」归入 `notEvaluated`（注释逐字「判据自己声明【此地无法评估】，⛔ 不是假」），**只有 `fail` 才进 `failing`**。

发生率（硬规则 12：查历史，⛔ 不等下一轮）：台账 `.quay/gate-events.jsonl` 里含 `no-running-serve-instance` 的事件共 **18** 条，跨 **2** 个日期（2026-09-23 ×16、2026-09-29 ×2），涉 **9** 个不同 AC（AC-288/289/290/291/292/293/294/295/296）。

### 更早的三条 done 任务都没碰这一个取值

| 任务 | done | 它做了什么 |
|---|---|---|
| `gap-ac292-board-page-zh-chrome-nav-current-and-own-title` | 2026-09-17 | 页面本身的 lang / `<title>` / nav 当前项接线（保证的**作用对象**） |
| `gap-ac292-criterion-cold-miss-30s-ttl-always-expired` | 2026-09-18 | 判据的间歇假红（30s TTL 冷构建越过 `curl --max-time 10`） |
| `gap-ac292-criterion-cmdline-port-literal-stale` | 2026-09-23 | **重锚地址派生**（cmdline `--port 0` ⇒ 改从活宿主载体取）。其 AC2 只要求「无实例时**非 0**」—— `exit 1` 满足了当时的字面要求，而它正是把「查不成」与「为假」并成同一个取值的那一步 |

### 家族（枚举，硬规则 3/5b；⛔ 不是一个布尔）

```
grep -rl 'no-running-serve-instance' goals/ | wc -l    ⇒ 17   （= GOAL-024 自身 + AC-288…AC-303 共 16 条，逐字同一段 addr-derivation）
grep -rl 'no-derivable-serve-address' goals/ | wc -l   ⇒ 10
grep -rl 'no-reachable-serve-address' goals/ | wc -l   ⇒ 10
```

**本任务只改 AC-292 一条**，其余 16 个文件各自归自己的立案轮（同前一条 re-anchor 任务的处置）。因为改的只是退出码、`expect` 与分支文本逐字不变，本条给出的形态是**可逐字复用**的。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：顶层 `grep -rn '^goal_ac: AC-292' tasks/*.md` ⇒ 5 命中，`gap-ac292-board-page-zh-chrome-nav-current-and-own-title`、`gap-ac292-criterion-cold-miss-30s-ttl-always-expired`、`gap-ac292-criterion-cmdline-port-literal-stale`、`gap-ac293-system-page-zh-chrome-nav-current-and-own-title`、`gap-ac294-manager-page-zh-chrome-nav-current-and-own-title`，**status 全为 done**；全仓 in-flight（todo/ready/needs-human）= 0 ⇒ 本 AC 无在飞主，本条不是重复立案。同机制、不同对象的既有任务全部 done 且**都不覆盖本条**：`gap-goal-gate-verdict-single-mapping-not-evaluated` 建立的是 exit 3 → not-evaluated 的**映射**（三个写入点），从未把任何**判据**迁到它上面；`gap-not-evaluated-harness-third-state` 修的是 harness 层；`gap-goal-criteria-bare-failing-exit-unattributable` 修的是「失败出口不写成因」。本任务是那条映射的**第一个判据侧消费者**，与本条互不重复。

### 四个修法的取舍

- ✗ `superseded` 本 AC：拒绝。GOAL-024 的退出条件要求切换机制在真实 Web 上可用（本 AC 的 `origin` 即该契约的可执行规格），这条保证**今天仍是本仓库的意图**。
- ✗ `long-term: true`：不解决。它只把本 AC 搬进 AC-216 复验域（每轮重跑），取值混淆原样保留。
- ✗ 只把活实例拉回来：**不完整**。实例今天能被拉起、明天会再死（09-25 → 09-29 已死 1 次且无人拉回），而判据仍会把每次缺席记成一处处「为假」并每轮立案。
- ✗ 只改 exit 3：**也不完整**。保证会在实例缺席时永久停在 not-evaluated，等于把守卫静默空转（硬规则 3b 的空转半边：判据恒真而什么也没验到，与「验过了」同形）。
- ✓ **① 地址派生那步的可评估性分支改 `exit 3`；② 从 HEAD 拉起一个 cwd=仓库根的活实例，使判据在新指纹下落一条真 `pass`；③ 以「接线破坏仍 `exit 1`」的负控制证明强度未减。** 两条缺一不可。

### 修法必须满足的性质（⛔ 缺一不可）

1. **只动可评估性分支，不动断言分支**：改退出码的**只有**地址派生那步里「无法派生 / 无法抵达 / 无实例」的四处块尾分支（`FAIL=workspace-root-unresolvable`、`FAIL=no-derivable-serve-address`、`FAIL=no-reachable-serve-address`、`CAUSE=no-running-serve-instance`）。断言分支 —— `CAUSE=en-fetch-failed`、`CAUSE=zh-fetch-failed`、`CAUSE=no-nav-region`、`CAUSE=no-nav-region-zh`、`CAUSE=english-baseline-missing`、`CAUSE=no-title-tag`、`CAUSE=no-title-tag-zh`、`CAUSE=html-lang-not-zh`、`CAUSE=nav-label-untranslated`、`CAUSE=title-unchanged` —— **逐字不动、仍 `exit 1`**。
2. **⛔ 不改 `expect`、不改作用域**：`<nav>…</nav>` 只对 nav 区块匹配、`<title>` 只对 title 匹配；⛔ 不新增第二份判据文件、不新增 `CAUSE=` 行（夹具里「恰好 11 条 CAUSE= 行」的断言必须继续绿）。
3. **判据仍能取假（正/负控制各一条）**：活实例 + 真接线 ⇒ `exit 0`；活实例 + 故意不翻译的 zh 响应 ⇒ **`exit 1`** 且以 `CAUSE=nav-label-untranslated`（或 `no-nav-region`）可区分。⛔ 只证明「不再报假」不够 —— 必须同时证明**该报假时仍报假**。
4. **新指纹落账**：经 `quay goal write AC-292 --criterion …` 落库（⛔ **不**手工 Edit `goals/AC-292-*.md`），随后 `quay goal gate AC-292` 在活实例上 `exit 0`，台账新增 `item_id=AC-292` / `gate=goal` / `verdict:"pass"` 且 `criterionHash` **≠** 修订前指纹的事件。
5. **逐字夹具同步**：`packages/quay/test/ac292-criterion-address-derivation.test.mjs` 用 `# >>> addr-derivation` / `# <<< addr-derivation` 把该块**逐字**抽出执行（它是一份测量，不是回声），其 11 个负例中 7 个断言 `code === 1` —— 必须同步改为 `3`；5 个 `assert.equal(r.code, 0, …)` 正例**逐字不动**。
6. **⛔ 不新增 `plugin/scripts/*.ts`**（会触发 outline + capability-catalog + laydown 三处登记）；本任务不需要新脚本。
7. **判据文本的 YAML 约束**：criterion 是 folded scalar，`#` 注释必须保持**单一逻辑行**（注释里一个硬换行折回后会变成语法错）。
8. **在主检出根上跑闸**：活实例、`.quay/server.json` 载体与 `.quay/gate-events.jsonl` 都在**主检出**，而任务 worktree 的 `.quay/` 是刷新快照 ⇒ `quay goal gate AC-292` 必须在主检出根上跑，⛔ 不在 worktree 里跑。

<!-- dedup-ref -->
**明确的非目标（观察项，不阻塞）**：`quay serve` **没有监督者**（web 不在 `driver-anchor.ts:DRIVER_KINDS` 的六类里；`start-drivers.ts` 只在**被调用时**判 staleness/down 并重启）—— 这是让判据连红 2 轮的**上游成因**。把 web 纳入 driver 活性面（或一条周期性 ensure-up）是一件独立的、会改变生产行为的事；它与 `gap-ac251-unified-server-web-control-same-process` / `gap-ac256-worker-restart-preserves-inflight-children` 的既有 server 生命周期工作的边界尚未裁定，落点也未选定 ⇒ **本任务只把它记为观察项 + 一条不阻塞的承接线**（②拉起实例，并在 Evidence 里记下「本实例无监督者、死亡后不会被自动拉回」），**⛔ 不把「必须有监督者」写成任何前置**（硬规则 12：拿不出落点与边界裁定的前置不得阻塞）。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json` ⇒ `verdict:"fail"` 且 reason 含 `CAUSE=no-running-serve-instance`；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 证明**无** cwd=仓库根的真实例；`kill -0 <server.json 里的 pid>` 非零。三行读数逐字进 Evidence。
2. **取修订前指纹**：`node packages/quay/bin/quay.js goal get AC-292 --json`（或读台账尾），记下 `criterionHash`，供 AC5 对照。
3. **改判据（四处退出码 → 3）**：从 `goals/AC-292-*.md` 抽出 criterion 全文，**只**把 `# >>> addr-derivation` 块内及块尾那四处 `exit 1` 改为 `exit 3`，其余逐字保留；经 `quay goal write AC-292 --criterion "$(cat <新判据文件>)"` 落库。⚠️ 注释保持单一逻辑行。⛔ 不手工 Edit `goals/*.md`。
4. **同步夹具**：`packages/quay/test/ac292-criterion-address-derivation.test.mjs` 的 7 个负例断言 `code` 由 `1` 改 `3`（带 message 的两处逐字保留），5 个正例不动；`node --test packages/quay/test/ac292-criterion-address-derivation.test.mjs` ⇒ 全绿。
5. **补一条断言侧负控制（仍在同一夹具文件内）**：让该文件除逐字块之外，再跑**整条 criterion**（同一 `criterionText()` 读法）对一个 scratch `git init` 根里的**serve 形进程 + 载体 + 一个真实监听但 zh 未翻译的 `/board`** ⇒ 断言 `exit 1` 且 `CAUSE` 可区分。⛔ **不得**为做这个负控制去改 `packages/quay/src/serve-*.ts`（不在本 Touches 内）；负控制的活面由夹具自造。
6. **拉起活实例（恢复可评估性）**：先用 `ps aux | grep -c '[q]uay-task-worker'` 确认无在飞 worker（⛔ 不与 peer 抢同一活面）；再用仓库既有启动器（`plugin/scripts/start-drivers.ts` 或 `quay serve`，⛔ 不手拼 `spawn`/`send-keys`）从**主检出 HEAD** 起一个 cwd=仓库根的实例，等它自报 listening。
7. **正控制**：`node packages/quay/bin/quay.js goal gate AC-292`（主检出根）⇒ **exit 0**，逐字贴出，并同一时刻四条断言各自独立可核（en nav `Board` 计数 ≥1 / zh 响应含 `<html lang="zh"` / zh nav `Board` 计数 =0 / zh `<title>` ≠ en `<title>`）；同时贴出 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd`。
8. **不可评估态控制**：停掉该实例后 `quay goal gate AC-292 --dry-run --json` ⇒ `verdict:"not-evaluated"`（⛔ 既不是 `fail` 也不是 `pass`），贴出逐字 JSON；随后按需再拉起。
9. **不回归**：`bash scripts/test.sh --for-task gap-ac292-criterion-carrier-absence-not-evaluated` 绿；家族枚举逐文件对照（`grep -rl` 三个 token 各 17 / 10 / 10，逐文件贴出），并逐字说明「本任务只改 AC-292 一条的退出码，其余 16 个文件原样」。

## AC

- [x] **AC1（可评估性分支已取 exit 3，断言分支逐字未动）**：贴出经 `quay goal write` 落库后的 criterion diff：**只有** `FAIL=workspace-root-unresolvable`、`FAIL=no-derivable-serve-address`、`FAIL=no-reachable-serve-address`、`CAUSE=no-running-serve-instance` 四处由 `exit 1` 变 `exit 3`；`expect` 与十条 `CAUSE=` 断言分支逐字相同；`CAUSE=` 行计数仍为 **11**。⛔ 未经 `quay goal write` 落库不算。
- [x] **AC2（夹具同步 + 该项是可取的假）**：`packages/quay/test/ac292-criterion-address-derivation.test.mjs` 的 7 个负例断言 `code === 3`、5 个正例仍 `code === 0`；`node --test <该文件>` 全绿；并贴出**修订前**该文件在 `code === 1` 断言下的运行（`git stash` 或 `git show <old>:<file>` 对照）证明这 7 条确实 1 → 3。
- [x] **AC3（正控制：活实例上真 pass）**：`node packages/quay/bin/quay.js goal gate AC-292` ⇒ **exit 0**，逐字贴出；四条断言各自独立可核；同一时刻 `pgrep -af 'quay.ts serve'` + `readlink /proc/<pid>/cwd` 指向一个 cwd=仓库根、cmdline 含 `packages/quay/bin/quay.ts serve` 的活进程。
- [x] **AC4（负控制：该报假时仍报假）**：一条**行为**证据（不是文本 diff）证明断言分支仍有牙 —— 对一个真实监听但 zh 未翻译的 `/board` 跑整条 criterion ⇒ **`exit 1`**，且 `CAUSE=` 可区分（`nav-label-untranslated` 或 `no-nav-region`），逐字贴出。⛔ 该证据的活面由夹具自造，⛔ 不得改 `packages/quay/src/serve-*.ts`。
- [x] **AC5（不可评估态与为假态可区分）**：无活实例时 `quay goal gate AC-292 --dry-run --json` ⇒ `verdict:"not-evaluated"`、`cause:"declared"`（⛔ 不是 `fail`）；活实例 + 真接线 ⇒ `verdict:"pass"`。两个 JSON 逐字贴出。
- [x] **AC6（新指纹落账 + 不回归 + 家族枚举）**：① `.quay/gate-events.jsonl` 中 `item_id=AC-292` 最新一条为 `verdict:"pass"`，其 `payload.criterionHash` **≠** 修订前指纹（两行都贴）；② `bash scripts/test.sh --for-task gap-ac292-criterion-carrier-absence-not-evaluated` 绿；③ 家族枚举逐文件贴出（`grep -rl` 三个 token 各 17 / 10 / 10），并说明本任务只改 AC-292 一条的退出码。
- [x] **AC7（非目标边界未被越过）**：`git diff --name-only` 对 Touches 之外为空；贴出证据说明**没有**改 `plugin/scripts/driver-anchor.ts` / `plugin/scripts/start-drivers.ts` / 任何 `plugin/scripts/*.ts` / 任何 `packages/quay/src/serve-*.ts`；Evidence 里记下观察项「本实例无监督者、死亡后不会被自动拉回」及其发生率读数（18 条台账事件 / 跨 2 日 / 涉 9 个 AC）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实运行的服务上为真、且三态可区分的判据落了账**：

1. **落地对象**：`goals/AC-292-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit）；**且**一个 cwd = 仓库根的 `quay.ts serve` 实例（从主检出 HEAD 起）在跑 —— 只改文本不算落地。
2. **三态齐备（同一条判据给出三个互不同形的取值）**：活实例 + 真接线 ⇒ **`exit 0` / `pass`**；可达但 zh 未翻译 ⇒ **`exit 1` / `fail`**；无实例 ⇒ **`exit 3` / `not-evaluated`（⛔ 非 fail、非 pass）**。三者各自的逐字读数进 Evidence。
3. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-292` / `gate=goal` / `verdict:"pass"` 的新事件，其 `criterionHash` 与修订前不同 —— **一条 dry-run 输出不算**。
4. **动机随判据进记录**：`quay goal write` 落库的 criterion 里带着「为什么改」的注释与读数（载体缺席 ≠ 为假；`exit 3` 是仓库在 `goal-store.ts:305-318` 写死的约定），而不是只留在本任务体里。

## Touches

- `goals/AC-292-board-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md`
- `packages/quay/test/ac292-criterion-address-derivation.test.mjs`
- `tasks/gap-ac292-criterion-carrier-absence-not-evaluated.md`

（说明：第一条是本任务的落地面 —— 地址派生那步的**退出码**，经 `quay goal write AC-292 --criterion …` 落库，`expect` 与分支文本逐字不变；第二条是与该块逐字绑定的夹具（7 个负例断言随之同步，并新增一条整条 criterion 的断言侧负控制）；第三条是 self-touch。⛔ `plugin/scripts/driver-anchor.ts`、`plugin/scripts/start-drivers.ts`、任何 `plugin/scripts/*.ts`、任何 `packages/quay/src/serve-*.ts` **均不在本 Touches 内**（前者是观察项非目标，后者是夹具自造活面的约束）。）

## Evidence

Round 2026-09-29 (**worker** `gap-ac292-criterion-carrier-absence-not-evaluated`; task worktree
`/data/home/yale/work/quay-worktrees/gap-ac292-criterion-carrier-absence-not-evaluated`, branch
`task/gap-ac292-criterion-carrier-absence-not-evaluated`; every gate reading below taken at the
**main checkout** root, per Plan 8, because the live instance / `.quay/server.json` / `.quay/gate-events.jsonl`
all live there).

### 0. Red baseline (taken, not assumed) and the pre-amendment fingerprint

```
$ node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json
{ "id":"AC-292","verdict":"fail","cause":null,
  "reason":"acceptance failed (exit 1) — AC-292 candidate readings (cwd=/data/home/yale/work/quay,
            nserve=0, ncand=1, nderived=0):; pid=3112620 addr=- cause=argv-no-serve-subcommand,carrier-pid-mismatch
            CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay;
            /board cannot be evaluated on a live surface (AC-179 probe pattern)",
  "timestamp":"2026-09-29T02:02:02.066Z","dryRun":true }
EXIT=1
$ for p in $(pgrep -f 'quay.ts serve'); do printf 'pid=%s cwd=%s\n' "$p" "$(readlink /proc/$p/cwd 2>/dev/null)"; done
pid=2973129 cwd=                    # another root (/data/home/tom/tom.zhao/1/quay) — not ours
pid=3113546 cwd=/data/home/yale/work/quay   # the acceptance runner's own `sh -c` (argv-no-serve-subcommand)
$ kill -0 1555141   # the `.quay/server.json` pid
kill: (1555141) - No such process   ⇒ exit=1
```

Pre-amendment `criterionHash` = `82c584f991cf3ee8` (computed with `criterionFingerprint`'s own
whitespace-normalised sha256 over the criterion text, and matching the last `goal-sweep` events
`2026-09-29T00:50:43.322Z pass` / `01:52:30.757Z fail`).

### AC1 — the four carrier-absence branches take exit 3; the assertion branches are byte-identical

Landed with `quay goal write AC-292 --criterion "$(cat <new criterion>)"` (⛔ no hand edit of
`goals/*.md`), in the worktree **and** at the main root — both stored texts are byte-identical to
the intended string (`criterion===intended: true`), fingerprint `05d67676ece2a75c`.

Criterion diff, line-by-line over the whole text (only the four blocks below differ; the amendment
prepends 29 comment lines):

```
--- line 23 ---  ...unreadable /proc/<pid>/cwd would compare equal to the empty root\n' "$(pwd)" >&2; exit 1; fi
+++ line 23 +++  ...unreadable /proc/<pid>/cwd would compare equal to the empty root\n' "$(pwd)" >&2; exit 3; fi
--- line 84 ---  ...up web service); per-candidate readings on stderr above\n' "$nserve" "$root" >&2; exit 1; fi
+++ line 84 +++  ...up web service); per-candidate readings on stderr above\n' "$nserve" "$root" >&2; exit 3; fi
--- line 85 ---  ...readings on stderr above\n' "$nderived" "$nserve" "$root" "$ROUTE" >&2; exit 1; fi
+++ line 85 +++  ...readings on stderr above\n' "$nderived" "$nserve" "$root" "$ROUTE" >&2; exit 3; fi
--- line 86 ---  ...cwd=$root; $ROUTE cannot be evaluated on a live surface (AC-179 probe pattern)" >&2; exit 1; fi
+++ line 86 +++  ...cwd=$root; $ROUTE cannot be evaluated on a live surface (AC-179 probe pattern)" >&2; exit 3; fi
```

- `differing body lines: 4` — nothing else in the 107-line body moved (criterion 107 → 136 lines).
- `CAUSE=` line count: **11** before and after (the header is written so it never contains the
  literal token — it says "the nav-label-untranslated token", not `CAUSE=nav-label-untranslated`;
  otherwise the fixture's own 11-line pin would have counted the comment).
- `exit 1` lines: **10**; `exit 3; fi` lines: **4**.
- `expect`, `origin`, `status`, `title`, `goal`, `kind` byte-identical across the write
  (`git diff 3c2aee6e7^ 3c2aee6e7 --numstat` = `85 4`, one file, and the field-level
  comparison prints `expect identical: true / origin identical: true / title identical: true`).
- DoD 4 (motive travels WITH the criterion): the new 29-line header records carrier-absence ≠ false,
  the `goal-store.ts:305-318` convention and the `acceptance-runner.ts:97-114` mapping, **and the
  cost reading**, re-taken rather than copied — see §AC6③ below.

### AC2 — the fixture is synchronised, and the 7 cases really moved 1 → 3

- The seven §④ negatives now assert `r.code === 3` (the two that carried a message keep it
  verbatim); the five §①/§② positives still assert `r.code === 0` and are byte-for-byte unchanged.
  `git diff` over the fixture removes exactly those seven lines and nothing else.
- `node --test packages/quay/test/ac292-criterion-address-derivation.test.mjs` ⇒ **16 pass / 0 fail**.
- Pre-amendment run of the SAME file against the AMENDED criterion (fixture restored from
  `git show HEAD:<file>`): **6 pass / 7 fail**, and the failures are exactly those seven:

```
AssertionError [ERR_ASSERTION]: a root whose only serve candidate has no carrier must not derive an address
3 !== 1
  at ...ac292-criterion-address-derivation.test.mjs:373:14
  actual: 3,
  expected: 1,
```

### AC3 — positive control on a live instance (`goal gate` exit 0)

```
$ node packages/quay/bin/quay.js goal gate AC-292
{ "id":"AC-292","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)",
  "timeoutMs":60000,"timestamp":"2026-09-29T02:11:57.403Z","dryRun":false }
EXIT=0
```

The four assertions, each read INDEPENDENTLY of the criterion (`addr` derived from the carrier's web
entry = `127.0.0.1:20119`):

```
① en nav "Board" occurrences            : 2
② zh response <html lang="zh" present   : 1
③ zh nav "Board" occurrences            : 0
④ en title = <title>quay — Board — three-source join</title>
   zh title = <title>quay — 看板 — 三源 join 看板</title>   → differs: YES
```

The live process, at the same moment:

```
$ pgrep -af 'quay.ts serve'      (+ readlink /proc/<pid>/cwd)
3652175 node --no-warnings --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts serve --host 127.0.0.1
   cwd=/data/home/yale/work/quay
$ cat .quay/server.json
{ "schemaVersion":1, "pid":3652175, "startedAt":"2026-09-29T02:07:52.833Z",
  "services":[{"name":"web","pid":3652175,"host":"127.0.0.1","port":20119,"up":true},
              {"name":"control","pid":3652175,"host":"127.0.0.1","port":16031,"up":false}] }
```

Started from the main checkout HEAD with the repo's own launcher verb — `quay server start --only web`
(idempotent; `--only web` so no driver is touched) — ⛔ not a hand-assembled spawn. The port is
kernel-assigned (`--port` absent on the cmdline), so the address is knowable only from the carrier —
which is exactly the path this criterion was re-anchored onto.

### AC4 — negative control: the assertion branches still bite (behaviour, not a diff)

The whole criterion — the same text `quay goal gate AC-292` executes — run against a **self-made**
live surface (a scratch `git init` root, a serve-shaped candidate with an explicit `--port N` on its
own argv and cwd = that root, and a real listener answering `/board` in two bodies by cookie).
⛔ No `packages/quay/src/serve-*.ts` was touched; the surface is built by the fixture.

```
############ POSITIVE CONTROL (wired zh) ############
derived addr = 127.0.0.1:3661  (candidate argv: quay.ts serve --host 127.0.0.1 --port 3661, cwd=root)
EXIT = 0
--- stdout ---
OK -- /board: default nav region carries "Board" and <title>="Board - quay"; under Cookie: lang=zh the
response is <html lang=zh>, that English nav label is gone from the nav region, and this page's own
<title> became "Kanban - quay"
--- stderr ---
(empty)

############ NEGATIVE CONTROL (untranslated zh) ############
derived addr = 127.0.0.1:4599  (candidate argv: quay.ts serve --host 127.0.0.1 --port 4599, cwd=root)
EXIT = 1
--- stderr ---
CAUSE=nav-label-untranslated -- the nav region of /board under Cookie: lang=zh still renders the
literal English nav label "Board"; the nav is not wired to the zh dictionary
```

Both readings come from the landed fixture too (§⑥, two tests that call `runCriterion()`):

```
$ node --test --test-name-pattern="whole criterion" packages/quay/test/ac292-criterion-address-derivation.test.mjs
✔ the whole criterion PASSES (exit 0) on a live surface whose zh nav really is translated (154.25ms)
✔ the whole criterion still FAILS (exit 1, nav-label-untranslated) on a reachable but unwired zh page (153.46ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0
```

⛔ The two states do not wear the same shape: the unwired case is **1**, never **3** (`assert.notEqual(r.code, 3)`).

### AC5 — not-evaluated and false are distinguishable (two JSONs, verbatim)

Withhold the surface (`quay server stop --only web` — the host process stays, the web face closes):

```
$ node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json
{ "id":"AC-292","verdict":"not-evaluated","cause":"declared",
  "reason":"not-evaluated (declared): acceptance failed (exit 3) — AC-292 candidate readings
            (cwd=/data/home/yale/work/quay, nserve=1, ncand=2, nderived=0):;
            pid=3652175 addr=- cause=argv-port-absent,carrier-web-down;
            pid=3807429 addr=- cause=argv-no-serve-subcommand,carrier-pid-mismatch
            FAIL=no-derivable-serve-address -- 1 quay.ts serve process(es) with cwd=/data/home/yale/work/quay,
            none yielded an address ...",
  "timestamp":"2026-09-29T02:11:32.727Z","dryRun":true }
```

With the surface back:

```
$ node packages/quay/bin/quay.js goal gate AC-292
{ "id":"AC-292","verdict":"pass","cause":null,"reason":"acceptance passed (exit 0)",
  "timestamp":"2026-09-29T02:11:57.403Z","dryRun":false }
```

A third reading, taken with **no** `quay.ts serve` process at all (before the instance was started),
exercises the `CAUSE=no-running-serve-instance` branch on the amended criterion:

```
$ node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json
{ "id":"AC-292","verdict":"not-evaluated","cause":"declared",
  "reason":"not-evaluated (declared): acceptance failed (exit 3) — AC-292 candidate readings
            (cwd=/data/home/yale/work/quay, nserve=0, ncand=2, nderived=0):; ...
            CAUSE=no-running-serve-instance -- no quay.ts serve process with cwd=/data/home/yale/work/quay; ...",
  "timestamp":"2026-09-29T02:07:31.477Z","dryRun":true }
```

⚠️ `quay goal gate`'s own **exit code** is 1 for both `fail` and `not-evaluated` — deliberate
(`goal-store.ts` at the gate return: "`pass` is the ONLY exit 0 … it is merely a different kind of
non-pass, **distinguishable in the ledger**"), and `goal-driver.ts`'s `runPrefilingRecheck` reads the
**verdict**, not this code. The distinction this AC cares about is the value, and it is present.

### AC6 — new fingerprint on the ledger, scoped gate green, family enumerated

① The ledger, newest last (`.quay/gate-events.jsonl`, at the main checkout):

```
2026-09-29T01:52:30.757Z | actor=goal-sweep | verdict=fail | criterionHash=82c584f991cf3ee8   ← PRE-amendment
2026-09-29T02:11:12.987Z | actor=goal-amend | verdict=pass | criterionHash=05d67676ece2a75c   ← POST-amendment
```

The sweep reached AC-292 **immediately** (actor `goal-amend`, not `goal-sweep`): its criterion text no
longer matches the fingerprint the last recorded verification pinned. `05d67676ece2a75c ≠ 82c584f991cf3ee8`.
(`goal gate`'s own event carries no `criterionHash` — only the sweep/amend writer does — so the
fingerprint-bearing event is the one quoted.)

② Scoped gate (the same command the driver's fan-in runs):

```
$ bash scripts/test.sh --for-task gap-ac292-criterion-carrier-absence-not-evaluated --allow-thin
warning: test-selection-thin: task ... resolved tests for 1/3 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway
... scoped static checks ...
✔ ... (all 16 ac292-criterion-address-derivation tests)
ℹ tests 16  ℹ pass 16  ℹ fail 0
EXIT=0
```

③ Family enumeration (`goals/`, at the main checkout):

```
$ grep -rl 'no-running-serve-instance'  goals/ | wc -l   ⇒ 17   (= GOAL-024 + AC-288..AC-303)
$ grep -rl 'no-derivable-serve-address' goals/ | wc -l   ⇒ 10
$ grep -rl 'no-reachable-serve-address' goals/ | wc -l   ⇒ 10
```

**This task changes AC-292 only.** The mechanical proof, not the prose: the not-evaluated exit status
appears in exactly ONE goal file —

```
$ grep -rl 'exit 3; fi' goals/ | wc -l   ⇒ 1
goals/AC-292-board-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
$ grep -c 'exit 3; fi' goals/AC-292-*.md   ⇒ 4
```

— so the other 16 files of the `no-running-serve-instance` family are untouched and each still exits 1
on carrier absence, to be re-anchored by its own filing round (as the prior re-anchor task did).

### AC7 — the non-goal boundary was not crossed

Branch delta against develop (`git diff --name-only develop...HEAD`), exactly the three declared Touches:

```
goals/AC-292-board-页面在-zh-下真实切换-导航当前项标签与该页面自己的-title-都相对英文基线发生变化.md
packages/quay/test/ac292-criterion-address-derivation.test.mjs
tasks/gap-ac292-criterion-carrier-absence-not-evaluated.md
```

Nothing outside them: ⛔ no `plugin/scripts/driver-anchor.ts`, ⛔ no
`plugin/scripts/start-drivers.ts`, ⛔ **no `plugin/scripts/*.ts` at all** (hence no
outline/capability-catalog/laydown registration was needed), ⛔ no `packages/quay/src/serve-*.ts`
(the AC4 negative control's live surface is built by the fixture).

**Observation, NOT a precondition** (硬规则 12 — no落点 or boundary ruling is offered, so this does
not block anything): `quay serve` has **no supervisor**. `plugin/scripts/driver-anchor.ts`'s
`DRIVER_KINDS` covers promotion/worker/outer/quality/meta/goal — **web is not among them**, so an
instance that dies is never pulled back, and this criterion then reads `not-evaluated` until
something starts one. Occurrence reading, re-taken at `2026-09-29T02:10:58Z` over
`.quay/gate-events.jsonl`: **24 events** carrying the `no-running-serve-instance` token, across
**2 dates** (2026-09-23 ×16, 2026-09-29 ×8) and **10 distinct ACs** (AC-288 .. AC-301) — up from the
18 / 2 / 9 measured at filing, i.e. it accrued for as long as the carrier stayed absent. The death
itself is visible in the carrier: `.quay/server.json` named pid 1555141, started
`2026-09-25T10:08:25.330Z`, and `kill -0 1555141` ⇒ `No such process`, with no shutdown line in
`.quay/serve.log`.

### Post-conditions left behind

- A live `quay.ts serve` (pid 3652175, cwd = the main root, `web` up on 127.0.0.1:20119) is **running**,
  so the criterion reads `pass` on the real production surface rather than only in fixtures.
  ⚠️ It has no supervisor (above): if it dies, this criterion goes back to `not-evaluated` — which is
  now a truthful reading instead of a spurious filing.