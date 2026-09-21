---
id: gap-ac241-errexit-abort-silent-failures-have-no-predicate
title: AC-241 台账回归（第 6 次）：errexit 下【非 exit 语句】的静默中止是新的空因来源 —— 谓词把显式/隐式出口当互斥，4
  条共享此岸的在域判据静态 bare=0（本轮 AC-286 实证）
status: ready
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Finding

**回归（生产台账，逐字读数）** — GOAL-009 的常设不变式 AC-241（`long-term: true`，2026-09-11T13:55:25.575Z achieved）在 **2026-09-20T23:50:57.067Z 第 6 次转红**，由 **两次独立的 AC-286 失败读数**确认（第 5 次是 2026-09-14 的 AC-179）：

```
2026-09-20T23:45:39.394Z  AC-241  pass   goal-cli    ← 最后一次绿
2026-09-20T23:48:17.878Z  AC-286  fail   goal-sweep  reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"   ← 读数 1
2026-09-20T23:50:57.067Z  AC-241  fail   goal-cli    reason="acceptance failed (exit 1) — unattributable failing goal AC(s): AC-286: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
2026-09-20T23:51:14.439Z  AC-286  fail   goal-sweep  reason=（与读数 1 逐字相同）                                                     ← 读数 2
```

本立案轮逐字复跑 AC-241 的 criterion（正本 `goals/AC-241-*.md`，criterion 未改）⇒ `unattributable failing goal AC(s): AC-286: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`，`EXIT=1`。

### 肇事判据：AC-286 的每条失败出口都写了成因，却仍以零输出死掉

`goals/AC-286-worker-机械-fan-in-的合并目标仍然是-develop-回归防护.md` 的 criterion **三条失败出口全部把 `CAUSE=…` 写到 stderr**（criterion 第 5 / 9 / 13 行）。逐字复跑它：

```
$ bash <<'CRIT' … CRIT     # AC-286 criterion 逐字，主检出
EXIT=1          ← 且【零输出】：三条 CAUSE 一条都没打印
```

成因是 **errexit 中止**，不是缺 `CAUSE`：

1. criterion 第 2 行 `set -euo pipefail`；
2. 第 7 行 `LINE="$(grep -nE 'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget' "$SRC" | head -1)"`；
3. 该 grep 现在**匹配不到任何行**（实测 `grep` exit 1、空输出）⇒ 管道非零 ⇒ **`set -e` 在【赋值语句】就中止了整个脚本**，第 8 行的守卫 `if [ -z "$LINE" ]` 与它第 9 行的 `echo "CAUSE=default-assignment-not-found …" >&2; exit 1` **从未执行**；
4. ⇒ runner 走第三分支，写出空因模板。

最小复现（同形态，一条命令，本轮实测）：

```
$ bash -c 'set -euo pipefail; line="$(grep -nE "NO-SUCH-ANCHOR" /dev/null | head -1)"; if [ -z "$line" ]; then echo "CAUSE=anchor-not-found" >&2; exit 1; fi'
EXIT=1          ← 零输出：守卫与 CAUSE 从未运行
```

**锚点为什么匹配不到，且这不是真值回归**：`const mergeTarget = opts.mergeTarget ?? …` 这条默认赋值**已从 `plugin/scripts/worker-driver.ts` 移到 `plugin/scripts/worker-fan-in.ts:1138`**（`const mergeTarget = opts.mergeTarget ?? "develop";`，本轮实测）。AC-286 的**保证仍然成立**（机械 fan-in 的 merge target 仍默认 `develop`）；漂移的是它的**探针锚点**。⇒ 判据此刻报的是「探针随重构坏了」，却以「真值回归」的形态零输出地进了台账。

### 这是第 6 类：谓词把「显式出口」与「隐式出口」当作互斥，而 errexit 中止落在两者的缝里

`packages/quay/src/goal-store.ts` 的 `bareFailureExitsOfCriterion`（:1099）只有两条分支：

```ts
criterion.split("\n").forEach(...)                                      // ① 显式裸失败出口（行内判定）
if (out.length === 0) out.push(...implicitFailureExitLines(criterion));  // ② 隐式出口，⛔ 仅当【没有】显式失败出口
```

而 `implicitFailureExitLines`（:1064）**第一行就返回 `[]`**：`if (criterion.split("\n").some(l => hasFailureExit(...))) return [];` —— 注释逐字写着「the two classes are disjoint by construction」。

⇒ **AC-286 有显式失败出口（且都带归因）⇒ 分支① 判它干净，分支② 被结构上跳过。** 共享谓词本轮实测：

```
$ node --experimental-strip-types … evaluateCriterionAttribution(AC-286.criterion)
evaluated: true | bare count: 0 | []
```

⇒ **静态上「完全可归因」，运行时却零输出死掉。** 同批棘轮读数：

```
$ node … criterion-failure-attribution-check.ts --json
{"inDomain":155,"bareAcs":0,"bareLines":0,"baseline":0,"delta":0,"status":"pass","ok":true}
```

**棘轮 exit 0、baseline 已降到 0。** 第 5 次修复（`gap-ac241-frozen-bare-failure-exits-have-no-owner`）「把 30 条存量裸出口修完、baseline 32 → 0」的目标**确实达成了** —— 可是 AC-241 仍然红。**因为新的空因根本不出自「裸出口」，而出自同一个谓词看不见的第三类：errexit 之下的静默中止。**

### 缺陷是成簇的（硬规则 5b：机械枚举，非抽样）

对全部 155 条在域 criterion 逐条扫描「启用 errexit ∧ 存在【未守卫的命令替换赋值】」（这类赋值一旦非零，`set -e` 即在该行中止，其后的守卫 + `CAUSE` 永不执行）：

```
in-domain criteria with non-empty criterion: 155
  of those, using errexit (set -e*): 7
  with an UNGUARDED assignment-with-command-substitution (candidate silent-abort shore): 4
    AC-280(13) bare=0
    AC-283(4)  bare=0
    AC-285(3)  bare=0
    AC-286(7)  bare=0      ← 本次轮转到的就是它
```

四条**共享同一条岸**，且**四条静态 `bare=0`**（谓词全看不见）。`AC-280 / AC-283 / AC-285` 是同族**潜伏**实例：轮转一旦转到它们且其命令非零，就往台账再写一条不可归因的 fail —— **这就是第 7、8、9 次的现成来源。**

### 为什么前五次修复都没有守住（机制形态，不是「没做」）

五次全落在**检测面**或**出生面**，且每次只补「上一类」：

- `gap-goal-criteria-bare-failing-exit-unattributable`（done）：造检测器 + shrink-only 棘轮（baseline 32）。
- `gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit`（done）：补 `exit(...)` 尾参非零形态。
- `gap-criterion-attribution-blind-to-silent-terminal-command`（done）：补「无 exit 语句、退出码被行尾静默命令继承」形态。
- `gap-criterion-attribution-write-gate-at-birth`（done）：判定搬进 `goal-store.ts` 写面，**新** criterion 的裸出口在出生时被拒。
- `gap-ac241-frozen-bare-failure-exits-have-no-owner`（done）：把存量 30 条修完，baseline 32 → 0。

**这五条覆盖的出口形态（裸 exit / 尾参 / 隐式行尾 / 出生 / 存量）都是「出口语句自己静默」；本轮这一类是「出口语句有归因，但脚本在【非出口语句】上被 errexit 中止」。** 它落在分支②的**互斥前提**（`if (out.length === 0)`）之外 ⇒ 前五条任何一条都不覆盖它；第 2 条补的「隐式出口」形态恰恰被这个互斥前提挡在门外 —— 这正是本次漏网的结构原因。

### 与在飞任务的关系（机制不同，不是重复）

<!-- dedup-ref --> 现存 claim `goal_ac: AC-241` 的任务**全部 `done`**（`grep -rl '^goal_ac: AC-241' tasks/` 得 5 条，逐条 `status: done`）；同批机械枚举**无任何在飞（todo/ready/needs-human）任务** claim AC-241 或 AC-286（命中 0）。⇒ 本任务不是重复，是把同一个不变式**第 6 次**修回真，且修复面是前五次未覆盖的第三类。

## AC

- [x] **AC-286 失败出口可归因（真 runner，逐字）**：修好后 `goals/AC-286-*.md` 的 criterion 在**它自己的失败分支**上运行时，向 stderr 写出点名成因的 `CAUSE=…`；以真 `runAcceptance`（`packages/quay/src/gate/acceptance-runner.ts`）跑出 `payload.reason` 逐字 —— 必须是判据自己写出的文本，⛔ 不是 `criterion wrote no output to stderr/stdout`。修前（空因）与修后（成因）两侧都贴 —— **E1**
- [x] **消除 errexit 静默中止路径（4 条，⛔ 不抽样）**：`AC-280 / AC-283 / AC-285 / AC-286` 每条中，**未守卫的命令替换赋值**都改为失败时**能走到自己的诊断写出**（`|| true`、`if ! VAR=$(…)`、局部关断 errexit，或等价形式）。逐条给出「文件:行 → 改法 → 该命令失败时实际打印什么」，并对 ≥2 条实跑失败分支贴真实输出 —— **E2**
- [x] **真值不变（逐条）**：四条 criterion 的**真值条件 / 退出码 / 被检查的路径与符号 / 期望值逐字不变**；`git diff` 中除**失败路径上的诊断可达性**改动外无语义改动。AC-286 因锚点漂移**必须重新锚到 `plugin/scripts/worker-fan-in.ts:1138` 的 `const mergeTarget = opts.mergeTarget ?? "develop"`** —— 贴出「旧锚点已不存在」与「新锚点是同一保证的当前载体」两侧读数，⛔ 不得把 criterion 改成恒真 —— **E3**
- [x] **谓词补第三类（只改共享单一实现）**：`packages/quay/src/goal-store.ts` 的**唯一**谓词（`bareFailureExitsOfCriterion` :1099 / `implicitFailureExitLines` :1064）扩展到 **errexit 中止类**：criterion 启用 errexit 时，**非 exit 语句**中自身非零即终止 shell 且不写诊断的位置，也是静默失败出口。⛔ 只改这一处（写门与棘轮共用它，二者自动同步）—— **E4**
- [x] **取假（谓词不得恒真）**：对一份**已守卫**的同形态 criterion（如 `LINE="$(grep … || true)"` 或 `if ! LINE=$(…)`，且守卫分支写了 CAUSE）谓词必须判**干净**；对一份**未守卫**的合成 fixture 必须判**裸**。两侧 JSON 都贴 —— **E5**
- [x] **棘轮与新基线（必须为 0，⛔ 不留新豁免）**：扩展后 `criterion-failure-attribution-check.ts --json` 在四条都修好后报 `"bareAcs": 0`，并以 `--capture` 重记 `docs/analysis/criterion-failure-attribution.baseline.json`（`count` 保持 0）；棘轮 `exit 0`。⛔ **不得**用「把它们留在 baseline 里」取绿（第 5 次任务已证明基线豁免 = 无修复路径 = livelock）—— **E6**
- [x] **出生面同步（写门 + 取假）**：经 `packages/quay/src/goal-store.ts write <id> --criterion …` 递交一条**带未守卫 errexit 中止**的合成 criterion ⇒ 写门 `exit ≠ 0` 并点名行号；递交已守卫版本 ⇒ 放行。两侧读数都贴 —— **E7**
- [x] **回归钉（new test）**：新增 `plugin/test/` 下断言「在域 errexit 中止类计数 = 0」的测试，并含一条**取假**：对合成的未守卫 fixture 该断言必须报红。贴 exit 0 与取假时 exit ≠ 0 两侧读数 —— **E8**
- [x] **AC-241 转绿且未被削弱**：`goals/AC-241-*.md` 与 `goals/AC-243-*.md` 的 `criterion`/`expect` **逐字未改**（贴 `git diff --stat` 为空）；刷新台账尾事件后逐字跑 AC-241 的 criterion ⇒ `exit 0`；并贴 `item_id=AC-286` 尾事件的 **before / after**（after 必须是 `pass`，或 `fail` 且 reason 携带成因）—— **E9**
- [x] **检测器未被放宽（取假）**：向 AC-241 的判据喂一份**合成**台账（某 AC 尾事件 `verdict=fail`、reason 为空因模板）⇒ 判据必须仍 `exit 1`；两侧都贴 —— **E10**
- [x] scoped 门 `bash scripts/test.sh --for-task gap-ac241-errexit-abort-silent-failures-have-no-predicate --allow-thin` 退出码 0 —— **E11**

## DoD

- [x] AC-241 判据在**真台账**上 `exit 0`，贴 `item_id=AC-241` 最新一条 `verdict=pass` 原始行 —— **E9**（⛔ 读法逐字限定在 E9：用的是生产台账快照 + 本次修复产出的真 `goal-store gate AC-286` pass 事件，即合并所诱导的那份台账状态；**活文件**的尾事件此刻仍是合并前的旧判据 fail，收敛条件写在 E9 末尾）
- [x] 写清**为什么前五次修复没有守住**：① 五条各自只补「出口语句自己静默」的一种形态；② 第 2 条补的隐式出口被 `bareFailureExitsOfCriterion:1104` 的 `if (out.length === 0)` **互斥前提**挡在显式出口之外；③ 本轮的空因来自 errexit 在**非出口语句**上的静默中止，结构上落在两条分支之外 —— **E12**
- [x] 写清 **AC-286 的失败不是真值回归**：保证（merge target 默认 `develop`）仍成立，漂移的是探针锚点（`worker-driver.ts` → `worker-fan-in.ts:1138`），附两侧读数 —— **E3**
- [x] 点名残留：给出扫描后**在域 errexit 中止类的剩余计数与 id 清单**（目标 0）；⛔ 不得静默留下任何残留 —— **E13**
- [x] ⛔ 未改 AC-241 / AC-243 的判据；⛔ 未靠放宽 `ATTRIBUTION_RE` 或放宽 runner 的模板措辞取绿 —— **E9 / E10**
- [x] 已写明本任务与**全部 5 条 done 的 AC-241 前作**的关系（同一不变式的第 6 次回归，修复面是新的第三类，不是重复）—— **E12**

## Touches

- goals/AC-286-worker-机械-fan-in-的合并目标仍然是-develop-回归防护.md
- goals/AC-280-checker-mutation-check-sh-的80用例循环真正并行化-不再是单线程bash顺序for循环.md
- goals/AC-283-author-分支已推送到-origin-且是本地-author-的真实祖先-解决单点失效.md
- goals/AC-285-github-仓库默认分支实测为-master.md
- packages/quay/src/goal-store.ts
- plugin/scripts/criterion-failure-attribution-check.ts
- docs/analysis/criterion-failure-attribution.baseline.json
- plugin/test/criterion-failure-attribution-check.test.mjs
- plugin/test/goal-store-write-gate-criterion-attribution.test.mjs
- plugin/test/errexit-abort-silent-exits-zero.test.mjs（new）
- tasks/gap-ac241-errexit-abort-silent-failures-have-no-predicate.md

## Evidence

落地读数，2026-09-21，工作树 `/home/yale/work/quay-worktrees/gap-ac241-errexit-abort-silent-failures-have-no-predicate`（分支 `task/gap-ac241-…`，fork 自 develop `3244381d7`）。落地提交：`7611c46fa`（谓词第三类 + 四条判据守卫 + 基线 + 测试）、`d9a8b3bd0`（写门拒绝语按类给修复）。

### E1 — AC1：AC-286 失败出口可归因（真 `runAcceptance`，两侧逐字）

同一份「锚点消失」fixture（`plugin/scripts/worker-driver.ts` 存在但无该赋值），同一条判据的**修前/修后**版本，都经真 `runAcceptance`（`packages/quay/src/gate/acceptance-runner.ts`）：

**修前**（`git show develop:goals/AC-286-….md` 的 criterion 逐字）：
```
{"ok":false,"reason":"acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"}
```
（同一条修前 criterion 在**真实工作树环境**上也是这同一句 —— 这正是生产台账 23:48:17 / 23:51:14 那两条读数。）

**修后**（工作树 criterion，同一 fixture）：
```
{"ok":false,"reason":"acceptance failed (exit 1) — CAUSE=default-assignment-not-found — no line in plugin/scripts/worker-fan-in.ts assigns 'const mergeTarget = opts.mergeTarget ?? ...' — the mechanical fan-in's default merge-target expression may have been refactored; this criterion needs updating, not silently passed"}
```

修后另两条失败出口（真 runner，同一判据）：
```
{"ok":false,"reason":"acceptance failed (exit 1) — CAUSE=default-not-develop — plugin/scripts/worker-fan-in.ts's mergeTarget default assignment no longer defaults to \"develop\": const mergeTarget = opts.mergeTarget ?? \"master\";"}
{"ok":false,"reason":"acceptance failed (exit 1) — CAUSE=source-absent — plugin/scripts/worker-fan-in.ts does not exist"}
```
修后 happy path（真环境）：`{"ok":true,"reason":"acceptance passed (exit 0)"}`

### E2 — AC2：四条，逐条「criterion 行 → 改法 → 该命令失败时打印什么」

| 判据 | criterion 行 | 改法 | 失败时实际打印（真 runner 实跑） |
|---|---|---|---|
| AC-286 | 7（`LINE="$(grep -nE … "$SRC" \| head -1)"`） | 尾部加 `\|\| true`（**并且** `SRC` 重新锚到 `worker-fan-in.ts`，见 E3） | `CAUSE=default-assignment-not-found — no line in plugin/scripts/worker-fan-in.ts assigns …` |
| AC-280 | 13（`CALL_LINE="$(grep -n … \| head -1)"`） | 尾部加 `\|\| true` | `CAUSE=call-site-not-found — no line in plugin/scripts/checker-mutation-check.sh calls run_one_case "$name" "$workdir" verbatim; …` |
| AC-283 | 4（`sha_remote="$(git ls-remote … \| awk …)"`） | `awk` 后加 `\|\| true` | `CAUSE=origin-author-absent — origin has no 'author' branch yet; push it first (git push -u origin author)` |
| AC-285 | 3（`line="$(git ls-remote --symref … \| head -1)"`） | 尾部加 `\|\| true` | `CAUSE=symref-unreadable — git ls-remote --symref origin HEAD returned nothing; cannot determine GitHub's current default branch` |

`|| true` 的作用经实测确认（不是推断）：`set -euo pipefail; X="$(false)"` ⇒ exit 1 零输出；`X="$(false || true)"` 与 `X="$(false)" || true` ⇒ exit 0 且后续语句执行。**四条全部实跑失败分支并贴真实输出**（⛔ 不抽样）。

侧证：四条修后 happy path 全绿 ——
```
AC-286 EXIT=0 OK — plugin/scripts/worker-fan-in.ts's mergeTarget default assignment is:   const mergeTarget = opts.mergeTarget ?? "develop";
AC-280 EXIT=0 OK — run_one_case is backgrounded (line 390) and reaped via a wait within 40 lines after it
AC-283 EXIT=0 OK — origin/author exists (e27f111ed4b8a5feca7b8579d831c2d95f8aa476) and is an ancestor of local author
AC-285 EXIT=0 OK — origin's default branch (HEAD symref) is master: ref: refs/heads/master	HEAD
```

### E3 — AC3：真值不变 + AC-286 重新锚定的两侧读数

AC-280 / AC-283 / AC-285：`git diff` 只有「失败路径上的诊断可达性」一处改动（赋值尾部加 `|| true`），⛔ 被检查的路径、符号、期望值、退出码逐字未变。

AC-286 的锚点迁移，两侧读数：

**旧锚点已不存在**（`plugin/scripts/worker-driver.ts`）：
```
$ grep -nE 'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget' plugin/scripts/worker-driver.ts
（无输出）EXIT=1        # 该文件里现在只有 `4306:      mergeTarget: mechMergeTarget,`
```
**新锚点是同一保证的当前载体**（`plugin/scripts/worker-fan-in.ts`）：
```
$ grep -nE 'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget' plugin/scripts/worker-fan-in.ts
1138:  const mergeTarget = opts.mergeTarget ?? "develop";
```
⇒ 保证（机械 fan-in 的 merge target 默认 `develop`）**未变**，漂移的只是探针落点；criterion 的真值条件、退出码、`case` 期望值（`*'"develop"'*`）逐字未变。⛔ 未改成恒真：`grep` 仍必须有匹配、`case` 仍必须在 `"develop"` 上命中。

### E4 — AC4：谓词补第三类（⛔ 只改共享单一实现）

`packages/quay/src/goal-store.ts` 新增 `errexitAbortSilentExits(criterion)`（errexit 状态机 + 条件区豁免 + 赋值值位命令替换 + 未守卫判定），并让 `bareFailureExitsOfCriterion` **叠加**它 —— ⛔ 不在 `if (out.length === 0)` 之后（那个互斥前提正是漏网的结构原因）。`BareLine` 增 `errexitAbort` 标记，`formatBareFailureExits` 按类报修复方向。

⛔ 只改了 `goal-store.ts` 这一处：`plugin/scripts/criterion-failure-attribution-check.ts` 用 re-export 引用同一函数对象（`C1` 测试用 `===` 钉住身份），写门与棘轮自动同步 —— 无第二份实现。

### E5 — AC5：取假（谓词不得恒真），两侧 JSON

```
UNGUARDED (must be bare)   : {"evaluated":true,"bareCount":1,"bare":[{"line":2,"errexitAbort":true}]}
GUARDED || true  (clean)   : {"evaluated":true,"bareCount":0,"bare":[]}
GUARDED if !     (clean)   : {"evaluated":true,"bareCount":0,"bare":[]}
```
未守卫形态：
```
set -euo pipefail
LINE="$(grep -nE 'anchor' "$f" | head -1)"                      ← 判裸，且点名第 2 行
if [ -z "$LINE" ]; then echo "CAUSE=anchor-not-found" >&2; exit 1; fi
```
已守卫形态（两条都判干净）：`LINE="$(grep … | head -1 || true)"` · `if ! LINE=$(grep …); then echo CAUSE=… >&2; exit 1; fi`

### E6 — AC6：棘轮与新基线

```
$ node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --json
{"inDomain":155,"bareAcs":0,"bareLines":0,"ids":[],"baseline":0,"delta":0,"fixed":[],"status":"pass","ok":true}
EXIT=0
```
`docs/analysis/criterion-failure-attribution.baseline.json`（`--capture` 重记）：
```
{"count": 0, "inDomain": 155, "entries": [], "generatedAt": "2026-09-21T00:11:18.222Z"}
```
⛔ **四条全部实修**（E2），⛔ 未把它们留在 baseline 里取绿（`entries` 为空、`count` 保持 0）。

### E7 — AC7：出生面（写门 + 取假）

未守卫合成 criterion（`LINE="$(grep … | head -1)"`，第 3 行）经 `packages/quay/src/goal-store.ts write AC-990 --criterion …`：
```
$ node --experimental-strip-types packages/quay/src/goal-store.ts write AC-990 --dry-run --goal GOAL-023 --expect "exit 0" --origin … --criterion "$(cat …)"
goal-store: write failed: AC-990: criterion carries 1 failure exit(s) that write no cause — refused at the write surface. Offending: line 3 (errexit abort — under `set -e` this assignment's command substitution ends the shell here, so the cause written below never runs; guard it with `|| true` or move it into a condition): LINE="$(grep -nE 'anchor' plugin/scripts/worker-fan-in.ts | head -1)". Accepted forms: (a) a WRITTEN failure exit whose line also writes to stderr/stdout …; (b) for a line marked "errexit abort", GUARD the assignment — `VAR="$(cmd || true)"`, …
EXIT=2
```
已守卫版本（`… || true`，同形态）：`EXIT=0`，写出记录。⛔ 推送语按类给出可行修复 —— 对 errexit 类说「在同一行写成因」是错建议（成因已写在下面、errexit 永远到不了那行）。

### E8 — AC8：回归钉（new test）+ 取假

新增 `plugin/test/errexit-abort-silent-exits-zero.test.mjs`（`@test-group engine`）：断言「在域 errexit 中止类计数 = 0」+ 逐条读回四条被修判据 + 三条取假（合成未守卫必须报裸 / 已守卫必须干净 / 该类必须叠加生效）。

```
$ node --no-warnings --test plugin/test/errexit-abort-silent-exits-zero.test.mjs
ℹ tests 5   ℹ pass 5   ℹ fail 0        EXIT=0
```
取假（同一断言对未守卫样本必须报红）—— 把 scratch `goals/` 里的 AC-286 还原成**修前**形态后，整体聚合闸必须转红：
```
$ node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --root <scratch-holding-pre-fix-AC-286> --json
{"inDomain":155,"bareAcs":1,"bareLines":1,"ids":["AC-286"],"baseline":0,"delta":1,"added":["AC-286"],"status":"fail","ok":false}
EXIT=1
```
两侧：真树 `EXIT=0` / 未守卫样本 `EXIT=1`。

### E9 — AC9：AC-241 转绿且未被削弱

**(a) 判据未被改**（`git diff --stat` 为空）：
```
$ git diff --stat -- goals/AC-241-*.md goals/AC-243-*.md
（无输出，EXIT=0）
```

**(b) `item_id=AC-286` 尾事件的 before / after**（原始行）：

before（生产台账，逐字）：
```
{"id": "90b4834d-7ac5-4ec9-883c-9c77d1f17185", "item_id": "AC-286", "pipeline_id": "AC-286", "gate": "goal", "actor": "goal-cli", "verdict": "fail", "timestamp": "2026-09-20T23:51:14.439Z", "payload": {"reason": "acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"}}
```
after（真 `goal-store gate AC-286` 对**修后** criterion 产出的事件）：
```
{"id": "d222e29d-05db-4f3b-a5ba-88ff56dd13ee", "item_id": "AC-286", "pipeline_id": "AC-286", "gate": "goal", "actor": "goal-cli", "verdict": "pass", "timestamp": "2026-09-21T00:14:12.089Z", "payload": {"reason": "acceptance passed (exit 0)"}}
```

**(c) AC-241 的 criterion 逐字两侧**（正本 `goals/AC-241-*.md`，未改）：
```
BEFORE  生产台账快照（sha256 9487302d8b325518403cf7c78703972a60d78ebf9009bd86616347ade2d63cfa，34,730,352 B）
  $ (cd <snapshot> && bash <crit-AC-241>)   →  unattributable failing goal AC(s): AC-286: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout
  EXIT=1
AFTER   同一份快照 + 上面那条真 AC-286 pass 事件
  $ (cd <refreshed> && bash <crit-AC-241>)  →  （无输出）
  EXIT=0
```
**(d) `item_id=AC-241` 最新一条 `verdict=pass` 原始行**（真 `goal-store gate AC-241` 在同一份台账上跑出）：
```
{"id": "871889d1-5806-4739-ae4e-96b922fec7a2", "item_id": "AC-241", "pipeline_id": "AC-241", "gate": "goal", "actor": "goal-cli", "verdict": "pass", "timestamp": "2026-09-21T00:14:30.330Z", "payload": {"reason": "acceptance passed (exit 0)"}}
```

⛔ **读法限定（不许含糊）**：上面 (b)/(c)/(d) 用的是**生产台账的逐字快照**，加上本次修复经真 `goal-store gate` 产出的那条事件 —— 即**合并所诱导的那份台账状态**。**活文件** `.quay/gate-events.jsonl` 此刻的 AC-286 尾事件仍是 **2026-09-21T00:13:58.542Z 的 `fail`**（空因模板），因为生产 goal-sweep 读的是**主检出** `goals/` 里那份**尚未合并**的旧 criterion；本分支的修复要经 fan-in 落到 develop、再由主检出（author）同步 goals/ 之后，下一次 AC-286 轮转才会写上 `pass`。**收敛条件 = 该同步发生**；在那之前 AC-241 在活台账上仍红 —— 这不是本次修复没做完，是本 worker 不得直落 develop 的边界。

### E10 — AC10：检测器未被放宽（取假）

向 AC-241 的判据喂一份**合成**台账（某 AC 尾事件 `verdict=fail`、reason 为空因模板）：
```
$ (cd <synthetic-ledger-dir> && bash <crit-AC-241>)
unattributable failing goal AC(s): AC-999: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout
EXIT=1
```
两侧：真台账 `EXIT=0`（E9c）/ 合成空因台账 `EXIT=1`。⛔ 未改 `ATTRIBUTION_RE`，⛔ 未改 runner 的模板措辞。

### E11 — AC11：scoped 门

```
$ bash scripts/test.sh --for-task gap-ac241-errexit-abort-silent-failures-have-no-predicate --allow-thin
warning: test-selection-thin: … resolved tests for 5/11 Touches entries (0.45) < 0.5; pass --allow-thin to run anyway
ℹ tests 211   ℹ pass 211   ℹ fail 0   ℹ skipped 0   EXIT=0
```
⛔ 选取非零（新测试确实在选中集里，`+ plugin/test/errexit-abort-silent-exits-zero.test.mjs`）—— 不是「绿在 0 个测试上」那种假绿。
scoped-gate cache 已按**当时的 develop tip**（`git rev-parse develop`）记入 `.quay/scoped-gate-cache.json`（cache key = `<task>\t<develop-sha>`，⛔ 不是硬编码在本任务体里）：
```
$ node --experimental-strip-types plugin/scripts/worker-driver.ts --write-scoped-gate-cache --task gap-ac241-… --develop-sha "$(git rev-parse develop)" --root /home/yale/work/quay
{"event":"scoped-gate-cache-written","developSha":"e15bed1943439de223ee1a6f3caa4c232d3d9639","cacheFile":"/home/yale/work/quay/.quay/scoped-gate-cache.json"}
```
（`3244381d7` 是本分支的 fork 点；期间 develop 前进到 `e15bed194`，故按**门实际跑的那棵树**重记。）

### E12 — DoD：为什么前五次没守住 + 与前作的关系

① 五条各自只补「出口语句**自己**静默」的一种形态（裸 exit / 尾参 / 隐式行尾 / 出生 / 存量）；
② 第 2 条补的「隐式出口」被 `bareFailureExitsOfCriterion` 的 `if (out.length === 0)` **互斥前提**结构上挡在显式出口之外，所以一条**带归因的** criterion 永远走不到那一支；
③ 本轮的空因来自 errexit 在**非出口语句**（赋值）上的静默中止 —— 它既不是出口语句，也不在「没有出口」的那一支，结构上落在两条分支之外。

与前作关系：同一不变式（AC-241）的**第 6 次**回归，修复面是新的第三类；现存 claim `goal_ac: AC-241` 的 5 条任务全部 `done`，同批枚举无在飞任务 claim 它 ⇒ **不是重复**。

### E13 — DoD：残留点名

```
$ node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --json
{"inDomain":155,"bareAcs":0,"bareLines":0,"ids":[],"baseline":0,"delta":0,"status":"pass","ok":true}
```
在域 errexit 中止类**剩余计数 = 0，id 清单为空**（修前为 4：`AC-280 / AC-283 / AC-285 / AC-286`）。⛔ 无静默残留，⛔ 无新增豁免（baseline `entries: []`）。
