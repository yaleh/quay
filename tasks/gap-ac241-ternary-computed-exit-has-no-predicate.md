---
id: gap-ac241-ternary-computed-exit-has-no-predicate
title: AC-241 台账回归（第 7 次）：归因谓词对 JS 三元 computed exit（process.exit(cond?0:1)）结构性盲
  ⇒ 20 条在域判据被读成干净，AC-152 正在写不可归因 fail
status: todo
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

**回归（生产台账，逐字读数）** —— GOAL-009 的常设不变式 **AC-241**（`long-term: true`，2026-09-11T13:55:25.575Z achieved）在 **2026-10-16T18:01:45.884Z 第 7 次转红**。前 6 次各有一次立案、全部 `done`（`gap-goal-criteria-bare-failing-exit-unattributable` / `gap-criterion-attribution-write-gate-at-birth` / `gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit` / `gap-criterion-attribution-blind-to-silent-terminal-command` / `gap-ac241-frozen-bare-failure-exits-have-no-owner` / `gap-ac241-errexit-abort-silent-failures-have-no-predicate`）——**它们没有一条不成立，只是每次只补了上一个被撞到的形态**。台账里 AC-241 的 goal-gate 事件累计 12197 条（其中 fail 395 条）。

本立案轮**逐字复跑 AC-241 的 criterion 原文**（`goals/AC-241-*.md` 内嵌 python，本任务不改它）：

```
unattributable failing goal AC(s): AC-152: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout
EXIT=1
```

被点名的那条台账事件就是 `.quay/gate-events.jsonl` 的**尾行**：

```
{"item_id":"AC-152","pipeline_id":"AC-152","gate":"goal","actor":"goal-cli",
 "verdict":"fail","timestamp":"2026-10-16T18:01:45.884Z",
 "payload":{"reason":"acceptance failed (exit 1) — criterion wrote no output to stderr/stdout",
            "criterionHash":"d8f68d937e9cb2d9", …}}
```

AC-152 在此前 3 次 sweep 全绿（`2026-10-16T06:10:23.861Z` / `09:21:37.919Z` / `13:29:36.228Z`，均 `acceptance passed (exit 0)`），`18:00:37.867Z` 首次转红。两次读数之间落地的唯一相关提交 = `efb4c8e85`（GOAL-037 / AC-365）把 `TASK_FILTERS` 里 touch 那一格改名为 `touchesDisjointOrAged`。

### 肇事形态：JS 三元 computed exit 在共享谓词里没有任何表示

AC-152 判据的**唯一**失败出口（`goals/AC-152-filter-composable-predicate-list.md`）：

```
node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-filters.ts").then(m=>{const names=new Set(m.TASK_FILTERS.map(f=>f.name));const want=["notInFlight","depsSatisfied","touchesDisjoint","retryCapNotExhausted","notNeedsHuman"];process.exit(want.every(n=>names.has(n))?0:1)})'
```

本立案轮逐字复跑 ⇒ `BYTES=0`（stdout+stderr 合计 0 字节）、`EXIT=1`。出口是 `process.exit(<cond>?0:1)` —— 一条**三元 computed exit**。

共享谓词 `bareFailureExitsOfCriterion`（`packages/quay/src/goal-store.ts:1640`）对它返回 `[]`（实测，非推演）：

```
$ node --no-warnings --experimental-strip-types -e '…bareFailureExitsOfCriterion(<AC-152 判据原文>)…'
[]
```

三条类逐条接不住它（都是读数）：

| 类 | 判定入口 | 对 AC-152 | 为什么 |
|---|---|---|---|
| ① 显式失败出口 | `FAILURE_EXIT_RE`（`goal-store.ts:1152`） | 不匹配 | 只认 `exit(1` / `exit 1`；原文是 `exit(want.every(…)?0:1)` |
| ① 的 widening | `hasTrailingComputedFailureExit`（`:1164`） | 不匹配 | 深度计数**已经在**，但尾判据只有 python 的 `TRAILING_ELSE_NONZERO_RE = /\belse\s*[1-9]\d*\s*$/`，**没有三元尾 `:<nonzero>$` 这一支** |
| ② 隐式出口 | `implicitFailureExitLines`（`:1464`） | `[]` | 入口守卫 `hasFailureExit` 为 false 之后，`isSilentOnFailureSegment`（`:1325`）只认 `grep -q` / `[ … ]` / `>/dev/null` 一族谓词，**不把 `node -e …` 调用认作静默** |

⇒ 这正是硬规则 3b 的形态：**「我读不懂这个形态」与「这条判据干净」共用同一份输出**。

**产线读数（不是推演）** —— 改前，主检出：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --json
{"inDomain":211,"bareAcs":0,"bareLines":0,"ids":[],"baseline":0,"delta":0,"status":"pass","ok":true,
 "message":"criterion failure attribution intact: inDomain=211 bareAcs=0 ≤ baseline 0 (bareLines=0)"}
EXIT=0
```

`inDomain=211` / `bareAcs=0` / `exit 0`，**而同一个瞬间生产台账正在写不可归因的 fail**。

**与第 3 次立案的分工（同族、不同形态，⛔ 不是重复）** —— `gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit`（done）修的是 **python** 的尾 computed（`sys.exit(0 if ok else 1)`，尾词是 `else`）。本次是 **JS 的三元**：条件表达式里 `else` 的位置写的是 `:`，那条 `else` 尾判据逐字不匹配。同一个「尾 computed」意图，两种语言拼写。

### 同类枚举（机械，⛔ 非抽样）：20 条在域判据全部被读成干净

用**深度计数**（不是朴素正则——AC-152 的实参里有嵌套括号 `every(n=>names.has(n))`，朴素正则会漏）扫 `goals/AC-*.md` 中 status ∈ {active, achieved} 且有 criterion 的记录，找「exit CALL 实参**尾**为 `:<nonzero>`」的形态，再逐条问共享谓词：

```
ternary computed failure exits : 20
BLIND (predicate says clean)   : 20
AC-143 AC-144 AC-145 AC-146 AC-148 AC-150 AC-151 AC-152 AC-153 AC-154 AC-155
AC-188 AC-191 AC-192 AC-193 AC-304 AC-305 AC-306 AC-307 AC-308
```

**20 条全部零归因**，逐条查到失败分支所在行（⛔ 不是「判据里有 `console.error` 就算」）：

- **AC-143/144/145/146/148/150/151/153/154/155**（10 条）：单行 `node -e '…process.exit(<cond>?0:1)'`，**唯一**出口即此，全行无 `console.error` / `>&2` / `stderr`；
- **AC-188 `:11`** `process.exit(hit.length===need.length?0:1)`、**AC-193 `:21`** `process.exit(orphans.length===0?0:1)`：同上，无归因；
- **AC-191 `:21`** `process.exit(ok===need.length?0:1)`、**AC-192 `:33`** `process.exit(bad.length===0?0:1)`：这两条判据**别处**有成因（`:10` / `:28` 的 `console.error`），但**那些行不是这条出口** ⇒ 该出口仍零归因；
- **AC-304/305/306/307/308**：`:2`/`:3` 的 `CAUSE=…` 属别的出口；真正的断言出口是 `… --json 2>/dev/null | node -e '…process.exit(<cond>?0:1)'`，零归因。

**镜像形态（同样实测，⛔ 不静默略过）** —— `exit(<cond>?<nonzero>:…)`（非零在**头**支）在全域只有 1 条：**AC-330**（`props.includes("reconcile")?4:0`）。它**不是裸的**：`goals/AC-330-*.md:8` 用 `[ "$mrc" != 4 ] || { echo "CAUSE=mcp-init-still-has-reconcile-param …" >&2; exit 1; }` 把 rc=4 转写成成因。

⇒ **修法必须只认尾支 `:<nonzero>$`，⛔ 不认头支**——否则会对一条**已归因**的判据误报（硬规则 4：过度报告会指控一条合格判据；`goal-store.ts` 自己的注释把这条误差方向写死为「宁可少报」）。头支作为**已测量残量**记录在此（在域 1 条、且已归因），不假装它不存在。

### 为什么前 6 次都顶不住（机制形态，⛔ 不是「没做」）

写门（`evaluateCriterionAttribution`）、棘轮（本 checker）、台账不变式（AC-241）三者的接线**全是对的**；**写门与棘轮共用同一个谓词**。所以「谓词少一个形态」同时意味着两件事：①**存量**被读成干净；②**新生**也拦不住。这是一个**单点**，不是三处漏。前 6 次每次补的是「上一个被撞到的形态」，而形态空间是开放的（direct → trailing `else` → implicit terminal → errexit abort → **ternary**）。

### owner 边界（⛔ 本任务不抢别人的判断）

<!-- dedup-ref -->
与在飞任务 `gap-ac152-filter-carrier-renamed-criterion-stale`（`status: todo`、`goal_ac: AC-152`）**共享一个文件** `goals/AC-152-filter-composable-predicate-list.md`：AC-152 的**真值**（判据把符号名钉成字符串、合法改名后 stale）归它；本任务对该文件**只补归因**（失败出口写成因），⛔ 不改它点名哪个符号名。若 owner 已把成因写进去，本任务对该文件**不做任何写入**。该文件同时出现在两者的 Touches 里 ⇒ 由 `touchesDisjoint` 串行；各自的验收不依赖对方是否已落地。

**kept separate，⛔ 不与该 owner 合并**：不同 AC（AC-241 vs AC-152）、不同机制（归因谓词的形态盲区 vs 判据钉符号名）、独立验收。

## AC

- [ ] **AC1 谓词认出三元 computed exit（一处修，两个消费者同时修好）** —— `packages/quay/src/goal-store.ts` 的 `hasTrailingComputedFailureExit`：在既有 python 尾（`else <nonzero>$`）之外，对**深度平衡**的 exit CALL 实参再认 **JS 三元尾** `:\s*[1-9]\d*\s*$`（复用已有的深度计数，⛔ 不新增朴素正则、⛔ 不加嵌套上限）。读数（直接 `import` 调 `bareFailureExitsOfCriterion`，贴改前/改后两行）：AC-152 判据**原文** ⇒ 改前 `[]`、改后非空；20 条逐条 ⇒ 改后**全部**非空（贴 20 个 id）。**负控制（同批给，⛔ 缺一不算）**：`exit(c?0:0)` ⇒ `[]`；**AC-330 判据原文 ⇒ `[]`**（它的 `?4:0` 由下一行 `[ "$mrc" != 4 ] || { echo "CAUSE=…" >&2; exit 1; }` 转写成因，⛔ 不得被误报）；同一行带 `console.error` 的三元 exit ⇒ `[]`（归因优先于形态）。**三态不退化**：`--goals-dir` 指向不可读目录仍 `exit 3`（⛔ 不与 `exit 0` / `exit 1` 同形）。

- [ ] **AC2 在域类归零（5b：枚举同类，⛔ 抽样不算）** —— widened 检测器下 `criterion-failure-attribution-check.ts --json` 的 `ids` **不含**上列 20 条中的任何一条；并逐条给出「改前/改后**同载体**、**同退出码**」的读数（20 条全给，⛔ 抽样不算）：断言语义逐字不变（同条件退出同码），差别只在失败时 stderr 非空。⚠️ 其中 **AC-152 按 Finding 的 owner 边界处理**（已带成因则 0 写入，并在 Evidence 里写明「owner 已落地，本任务对该文件 0 写入」）。

- [ ] **AC3 棘轮未被抬高（⛔ 不许用 `--capture` 洗白）** —— `docs/analysis/criterion-failure-attribution.baseline.json` 的 `count` **仍为 0**、`entries` 仍为 `[]`；`--json` 的 `status=pass`、`delta≤0`。**反例判据（一条命令可查）**：若本任务把新暴露的成员记进基线而不是修掉它们，则 `count>0` ⇒ 本条取假。理由：`--capture` 会把「读不懂 / 没修」洗成「合格」，正是这条不变式连红 7 次的同一手法。

- [ ] **AC4 出生侧同源（未来不再长出同类）** —— 用**当前**（widened 后）的写门实测一次拒绝：构造一条含静默三元失败出口的新判据，走 `quay goal write`（或直接调 `evaluateCriterionAttribution`）⇒ **被拒**，且拒绝文案**具名列出该行**（硬规则 3：枚举而非布尔）。⛔ 不得只测「存量变干净」——写门与棘轮共用谓词，只修存量等于下次照样长出来。

- [ ] **AC5 接线与既有测试不退化** —— `node --test plugin/test/criterion-failure-attribution-check.test.mjs` 与 `node --test plugin/test/goal-store-write-gate-criterion-attribution.test.mjs` 全绿（含本任务新增的三元正/负控制）；`bash plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh` RC=0（A 基线绿 / B 注入必红 / C 恢复绿 / D 不可读 `exit 3`，四态互异）；`plugin/scripts/criterion-failure-attribution-check.ts` 头注释里「three ADDITIVE classes」的形态清单同步补上三元尾（硬规则 5b：⛔ 不留「已记录的限制」式静默——那句注释本身在第 3 次立案里就被判定为「它不是已记录的，它就是静默通过」）。

- [ ] **AC6 生产台账翻绿（待外部）** —— 主检出 `.quay/gate-events.jsonl` 中 AC-152 的**尾事件**其 `payload.reason` 携带判据自己写出的成因（或 `verdict=pass`），且在该台账上跑 AC-241 判据**原文** ⇒ `exit 0`；由落地后的常驻 goal-driver 轮次写出（AC-152 约每 3–4h 被 `goal-sweep` 一次）。⛔ 不得以 worktree 台账替代**生产**读数。（待外部）

## DoD

真实落地 = **机件在真对象上被操作过**，不是「文件改了 / 测试绿了」（DIR-026 Reading A）：

1. **谓词在真载体上被跑过**：`bareFailureExitsOfCriterion` 对 `goals/` 的**真实枚举**（211 条在域）跑出 AC1 的正/负控制读数；⛔ 不接受只跑夹具。**反向判据**：把 widened 的那一支注释掉，AC1 的正例读数必须回落到 `[]`（否则正例不是被新分支命中的，只是回声）。
2. **20 条判据被真的改写、且真的可写**：每条经 `quay goal write AC-NNN --criterion "<新判据>"` 落盘（⛔ 不手搓 `goals/*.md`；⛔ **不传 `--origin`**——`packages/quay/src/cli/goal.ts` 只在显式传入时才 patch origin，传了会覆盖 provenance），落盘后**回读**该判据并逐字复跑一次，给出「同条件同退出码 ∧ 失败时 stderr 非空」的读数。
3. **棘轮与写门在真 gate 路径上被跑过**：`criterion-failure-attribution-check.ts`（gate 模式）与 `checker-mutation-cases/criterion-failure-attribution-check.sh` 的 RC 是**真跑**出来的，不是断言出来的。
4. **反例可取假**：AC3 的反例判据（`count>0`）与 AC1 的负控制（AC-330 保持 `[]`）在本任务的 Evidence 里各有一条**实际读数**；缺任一条 ⇒ 视为「只修了被报出来的那一条」（硬规则 5b）。

## Touches

- packages/quay/src/goal-store.ts
- plugin/scripts/criterion-failure-attribution-check.ts
- plugin/test/criterion-failure-attribution-check.test.mjs
- plugin/test/goal-store-write-gate-criterion-attribution.test.mjs
- docs/analysis/criterion-failure-attribution.baseline.json
- goals/AC-143-observe-ledger-close-driven.md
- goals/AC-144-quality-gate-by-shape-driven.md
- goals/AC-145-semantic-subagent-manager-driven.md
- goals/AC-146-human-interface-explicit-owner.md
- goals/AC-148-inner-kernel-item-by-item-ownership.md
- goals/AC-150-promotion-driver-resource-control-alignment.md
- goals/AC-151-driver-two-level-layering.md
- goals/AC-152-filter-composable-predicate-list.md
- goals/AC-153-invariant-single-impl-not-evaluated.md
- goals/AC-154-claude-code-profile-separation.md
- goals/AC-155-config-merge-control-state-split.md
- goals/AC-188-goal-ac-criterion.md
- goals/AC-191-goal-ac-evidence-at.md
- goals/AC-192-ff-retry-counter-per-cycle.md
- goals/AC-193-no-orphan-suite-process.md
- goals/AC-304-仪器-0a-落地-import-graph-check-存在-selftest-的注入用例能取假-在真实仓库根给出-ev.md
- goals/AC-305-仪器-0b-落地-sh-census-check-存在-selftest-能取假-在真实仓库根给出-evaluated.md
- goals/AC-306-仪器-0c-落地-arch-coverage-report-存在-selftest-能取假-真实仓库根-json-给出.md
- goals/AC-307-产品层不再反向依赖上层-packages-plugin-或-experiments-的真实-import-边-0-由-i.md
- goals/AC-308-import-环清零-值级-scc-0-且类型级-scc-0-由-import-graph-check-读出.md
- tasks/gap-ac241-ternary-computed-exit-has-no-predicate.md
