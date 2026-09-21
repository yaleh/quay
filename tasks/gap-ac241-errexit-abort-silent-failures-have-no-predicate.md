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

- [ ] **AC-286 失败出口可归因（真 runner，逐字）**：修好后 `goals/AC-286-*.md` 的 criterion 在**它自己的失败分支**上运行时，向 stderr 写出点名成因的 `CAUSE=…`；以真 `runAcceptance`（`packages/quay/src/gate/acceptance-runner.ts`）跑出 `payload.reason` 逐字 —— 必须是判据自己写出的文本，⛔ 不是 `criterion wrote no output to stderr/stdout`。修前（空因）与修后（成因）两侧都贴
- [ ] **消除 errexit 静默中止路径（4 条，⛔ 不抽样）**：`AC-280 / AC-283 / AC-285 / AC-286` 每条中，**未守卫的命令替换赋值**都改为失败时**能走到自己的诊断写出**（`|| true`、`if ! VAR=$(…)`、局部关断 errexit，或等价形式）。逐条给出「文件:行 → 改法 → 该命令失败时实际打印什么」，并对 ≥2 条实跑失败分支贴真实输出
- [ ] **真值不变（逐条）**：四条 criterion 的**真值条件 / 退出码 / 被检查的路径与符号 / 期望值逐字不变**；`git diff` 中除**失败路径上的诊断可达性**改动外无语义改动。AC-286 因锚点漂移**必须重新锚到 `plugin/scripts/worker-fan-in.ts:1138` 的 `const mergeTarget = opts.mergeTarget ?? "develop"`** —— 贴出「旧锚点已不存在」与「新锚点是同一保证的当前载体」两侧读数，⛔ 不得把 criterion 改成恒真
- [ ] **谓词补第三类（只改共享单一实现）**：`packages/quay/src/goal-store.ts` 的**唯一**谓词（`bareFailureExitsOfCriterion` :1099 / `implicitFailureExitLines` :1064）扩展到 **errexit 中止类**：criterion 启用 errexit 时，**非 exit 语句**中自身非零即终止 shell 且不写诊断的位置，也是静默失败出口。⛔ 只改这一处（写门与棘轮共用它，二者自动同步）
- [ ] **取假（谓词不得恒真）**：对一份**已守卫**的同形态 criterion（如 `LINE="$(grep … || true)"` 或 `if ! LINE=$(…)`，且守卫分支写了 CAUSE）谓词必须判**干净**；对一份**未守卫**的合成 fixture 必须判**裸**。两侧 JSON 都贴
- [ ] **棘轮与新基线（必须为 0，⛔ 不留新豁免）**：扩展后 `criterion-failure-attribution-check.ts --json` 在四条都修好后报 `"bareAcs": 0`，并以 `--capture` 重记 `docs/analysis/criterion-failure-attribution.baseline.json`（`count` 保持 0）；棘轮 `exit 0`。⛔ **不得**用「把它们留在 baseline 里」取绿（第 5 次任务已证明基线豁免 = 无修复路径 = livelock）
- [ ] **出生面同步（写门 + 取假）**：经 `packages/quay/src/goal-store.ts write <id> --criterion …` 递交一条**带未守卫 errexit 中止**的合成 criterion ⇒ 写门 `exit ≠ 0` 并点名行号；递交已守卫版本 ⇒ 放行。两侧读数都贴
- [ ] **回归钉（new test）**：新增 `plugin/test/` 下断言「在域 errexit 中止类计数 = 0」的测试，并含一条**取假**：对合成的未守卫 fixture 该断言必须报红。贴 exit 0 与取假时 exit ≠ 0 两侧读数
- [ ] **AC-241 转绿且未被削弱**：`goals/AC-241-*.md` 与 `goals/AC-243-*.md` 的 `criterion`/`expect` **逐字未改**（贴 `git diff --stat` 为空）；刷新台账尾事件后逐字跑 AC-241 的 criterion ⇒ `exit 0`；并贴 `item_id=AC-286` 尾事件的 **before / after**（after 必须是 `pass`，或 `fail` 且 reason 携带成因）
- [ ] **检测器未被放宽（取假）**：向 AC-241 的判据喂一份**合成**台账（某 AC 尾事件 `verdict=fail`、reason 为空因模板）⇒ 判据必须仍 `exit 1`；两侧都贴
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac241-errexit-abort-silent-failures-have-no-predicate --allow-thin` 退出码 0

## DoD

- [ ] AC-241 判据在**真台账**上 `exit 0`，贴 `item_id=AC-241` 最新一条 `verdict=pass` 原始行
- [ ] 写清**为什么前五次修复没有守住**：① 五条各自只补「出口语句自己静默」的一种形态；② 第 2 条补的隐式出口被 `bareFailureExitsOfCriterion:1104` 的 `if (out.length === 0)` **互斥前提**挡在显式出口之外；③ 本轮的空因来自 errexit 在**非出口语句**上的静默中止，结构上落在两条分支之外
- [ ] 写清 **AC-286 的失败不是真值回归**：保证（merge target 默认 `develop`）仍成立，漂移的是探针锚点（`worker-driver.ts` → `worker-fan-in.ts:1138`），附两侧读数
- [ ] 点名残留：给出扫描后**在域 errexit 中止类的剩余计数与 id 清单**（目标 0）；⛔ 不得静默留下任何残留
- [ ] ⛔ 未改 AC-241 / AC-243 的判据；⛔ 未靠放宽 `ATTRIBUTION_RE` 或放宽 runner 的模板措辞取绿
- [ ] 已写明本任务与**全部 5 条 done 的 AC-241 前作**的关系（同一不变式的第 6 次回归，修复面是新的第三类，不是重复）

## Touches

- goals/AC-286-worker-机械-fan-in-的合并目标仍然是-develop-回归防护.md
- goals/AC-280-checker-mutation-check-sh-的80用例循环真正并行化-不再是单线程bash顺序for循环.md
- goals/AC-283-author-分支已推送到-origin-且是本地-author-的真实祖先-解决单点失效.md
- goals/AC-285-github-仓库默认分支实测为-master.md
- packages/quay/src/goal-store.ts
- docs/analysis/criterion-failure-attribution.baseline.json
- plugin/test/criterion-failure-attribution-check.test.mjs
- plugin/test/goal-store-write-gate-criterion-attribution.test.mjs
- plugin/test/errexit-abort-silent-exits-zero.test.mjs（new）
- tasks/gap-ac241-errexit-abort-silent-failures-have-no-predicate.md