---
id: gap-ac194-release-preflight-reconcile-unreadable-landing
title: AC-194 第六次为假：前一条生产者修复只覆盖 3 个 script 站点；pre-fix 的 release-cut preflight
  reconcile 合并（空 action，无任何脚本/散文载体产出它）仍在 develop~100 窗内 ⇒ evaluated=false ⇒ 判据恒假
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-194
---
**type:** execution

## Proposal

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（题面：done 任务的判据后来变假而无人重评——本条是同一形态的**第六次**）。前一条 `gap-ac194-empty-reflog-action-from-message-less-update-ref`（done，2026-10-10T12:26:42+08:00 由 driver 机械 fan-in 翻 done，提交 `8346c62a1`）修了**生产者**与 **checker 结构类**，但**判据此刻仍为假**。

### 现状（本轮逐字重跑，主检出 /data/home/yale/work/quay）

criterion 原文逐字跑：

    EXIT=1
    evaluated=false   ok=true
    reason="unsupported-reflog-action: (empty)"   reasonSecondary="unclassifiable-commits-in-range"
    unclassifiableCommits=1   unclassifiableSample=["99efed2c9495bb71a5061f3b968e22c7e01b19ca"]
    unclassifiedActionForms=[{form:"(empty)",count:1,sampleShas:["99efed2c…"]}]
    classification: classified=99 total=100 ratio=0.99 firstParent=100 offSpine=146
    sanctionedRefMoveIntroducedTotal=0

`99efed2c` 原文：

    $ git reflog show --date=iso develop | grep 99efed2c
    99efed2c9 develop@{2026-10-10 10:22:10 +0800}:            ← gs 为空
    $ git log -1 --format='%P %s' 99efed2c
    e9358e97ae3f9ac63640a3bf18f7d68338c0e878 f4600e9acd0f30fb91438bf1662b13ab191f40b0  Merge origin/develop into develop — reconcile the published CI fixes with the loop's local commits (release-cut preflight: local develop must not be behind origin/develop)

⇒ 它是 `develop~100` 窗内**唯一**的 unclassifiable，且是**空 action 的 merge**。深度：`git rev-list --count --first-parent 99efed2c..develop` = **14**（需再前进 ~86 条 first-parent 提交才滚出窗；实测 develop 推进 ~7/hr ⇒ 判据靠自身老化转绿需 ~12h，且窗口随时可能再被同类 tip 污染）。

### 前一条修复为何没兜住（机制，非读数）

前一条逐字列出三处**无 `-m` 的 `update-ref`**（`plugin/scripts/integration-batch-merge.ts:1170` 附近的 real-merge CAS、`:1289` 的 ff CAS、`plugin/scripts/sync-lag-check.sh:172` 的 downsync）并给它们加了保留前缀 `quay-ref-landing:`。**但那三处都不是 `99efed2c` 的产出者。** 证据：

    $ grep -rn "must not be behind origin/develop\|release-cut preflight\|reconcile the published" \
        plugin/ packages/ experiments/ scripts/ docs/ orchestration/ .claude/
    0 命中（唯一命中在 tasks/gap-ac194-empty-reflog-action-from-message-less-update-ref.md 的任务体里）

⇒ 产出 `99efed2c` 的**不是任何脚本**，是一次**散文/agent 通道的手搓 git 动作**：为满足 `plugin/scripts/release-cut.mjs:337-355` 的 `release-cut-develop-behind-remote` 前置（该脚本**拒绝**在 develop 落后 origin/develop 时切版），agent/人临时 `git merge origin/develop` 后用**裸 `git update-ref`**（无 `-m`）移动了 develop。**硬规则 5b**：修的人只枚举了三个 **script** 站点，而这一整类生产者（**散文通道**）结构上不在枚举里 ⇒ 修复对它是盲的；且**同类可复发**——下一次 release-cut preflight 若再由 agent 手搓，仍写空 action。

### 为什么不把空 action 一律归 refMove（继续 fail-closed 的理由，逐字沿用前一条）

空 action 一次**无消息**的 ref 移动**不能区分**「commit 在 develop 上被创建」与「ref 移到已存在 commit」，本仓**两者都真实发生过**：sanctioned 落地（如上）与**人手外科式直落 develop**（`394dbca5d`，`nparents=1`、subject 逐字「…人裁定外科 cherry-pick」、develop reflog 亦为空 action）。⇒ ⛔ 一律 refMove = **fail-open**，会掩掉真直投。

### 方向（本条要做的）：给「并入一条**已发布**外部线」的空 action 落地一个**结构类**，并保持单亲形 fail-closed

`99efed2c` 与 `394dbca5d` 在 **DAG 上可结构区分**：

| tip | 形 | 是否引入本地新 commit |
|---|---|---|
| `394dbca5d`（真直投） | **单亲**（`nparents=1`） | 是——本地 cherry-pick 的新 commit |
| `99efed2c`（release reconcile） | **merge**（2 父），非首父 `f4600e9a` 是 `origin/develop` 的祖先 | 否——被并入的线**已经发布**（`git merge-base --is-ancestor f4600e9a origin/develop` → 真） |

⇒ 新增一个与 `refMove` / `sanctionedRefMove` **并列、可见、独立计数**的结构类：

  **`publishedReconcile`**：一条**空 action** 的 ref-level 落地，其 moved-to commit 是 **merge**（≥2 父），且**所有非首父**都 reachable from 某个 **remote-tracking ref**（被并入的线已发布）。

⛔ 判定按结构（父数 + 远端可达性），⛔ 不是 sha 白名单、⛔ 不是 message 匹配（`394dbca5d` 与 `99efed2c` 的 message 都不可作判据——人手可写任意 message）。⛔ 独立计数、⛔ 不并入 fan-in 计数（同 `refMoveIntroduced` / `sanctionedRefMoveIntroduced` 的既有形态）。⚠️ **如实标注残余风险**：merge 可携带手写冲突解（本地内容变更），故该类**必须可见可审计**（独立计数 + 带入窗内的 commit 清单），⛔ 不得静默豁免。

**备选（若实现者证明上述结构谓词不可靠/不可取，需在任务体逐字写理由）**：把滑窗下界锚定到「可读落地 epoch」并显式声明 pre-epoch 历史 out of scope——但⛔ 它更宽（会把 pre-epoch 的真直投一并 out of scope），故**非首选**。

### 与既有任务的关系

<!-- dedup-ref -->
`gap-ac194-empty-reflog-action-from-message-less-update-ref`（done，`8346c62a1`）是**上一环**：它修生产者（3 个 script 站点）+ 加保留前缀类 `sanctionedRefMove`；本条是**它没兜住的那一类**（散文通道 + 空 action merge），机制不同、目标不同，不合并、不重做它的三站点修复。另与 `gap-ac194-release-bump-classified-as-bypass`（done）同族：那条给 release **bump** 一个结构类（`releaseBump`），本条给 release **preflight reconcile** 一个结构类（`publishedReconcile`）——同一形态（release 流程的落地通道产生了 checker 读不懂的形），不同主体。

## Plan

1. 读 `plugin/scripts/direct-to-develop-bypass-check.ts`：`classifyReflogAction`（四态）、`buildRefMoveBrackets`、`classifySpineLandingMode`（`unclassifiable` 判定）、`gitDevelopDirectCommits`、`unclassifiedActionForms` 与 `--json` 输出块。确定新类落点：**只加一类**，由 `classifySpineLandingMode` 消费；空/任意 `-m` 仍 `unknown`。
2. 实现 **`publishedReconcile`**：对「空 action 且未被任何括注/ledger 覆盖」的 tip 追加一次结构判定——`git rev-list --parents -n1 <tip>` 得父数 ≥2 ∧ 每个非首父 `git merge-base --is-ancestor <p> <remote-tracking-ref>` 为真（远端 ref 用 `origin/develop`；读不出 ⇒ NOT-EVALUATED，⛔ 不折叠成「非 reconcile」）。`--json` 增独立计数（如 `denominator.publishedReconcileCommits` / `classification.publishedReconcileIntroduced`），文本输出行可区分，⛔ 不并入 fan-in 计数。
3. 负控（必须**先红后绿**地钉住，见 AC4）：(a) 空 action 移到一个**单亲** commit（`394dbca5d` 形）⇒ 仍 `unknown` / `evaluated=false` / exit 3，reason 逐字点名 `(empty)`；(b) 空 action 移到一个 merge 但**非首父不 reachable from 任何 remote-tracking ref**（本地分支 merge）⇒ 仍 `unknown`；(c) 任意 `-m` 文本（不含保留前缀）⇒ 仍 `unknown`（既有钉，`checker-mutation-cases:114`）。
4. `plugin/test/direct-to-develop-bypass-check.test.mjs` 加断言（生产形 ⇒ `publishedReconcile`；(a)(b) ⇒ NOT-EVALUATED）；`plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh` 加一条 mutation case（fixture 里构造一个两亲 merge ref-move ⇒ 该 tip 被分类且独立计数 ≥1）。
5. 变异检验：把新类临时退回「空一律 unknown」⇒ 新断言必须变红；贴红/绿两次读数 + 恢复后 `git diff --stat` 为空。
6. 若 `plugin/scripts/capability-catalog-declarations.json` 的 `direct-to-develop-bypass-check.ts` 能力声明/失效前提因新类而变（它此刻逐字点名「含【空 action】…⇒ NOT-EVALUATED」），同步更新该声明使其与实现一致（同文件既有的「保留前缀」表述是模板）。⚠️ 该文件是 whole-tree 静态检查的对象：改完跑一次对应静态检查。
7. 生产读数：判据逐字跑 ⇒ `exit 0` / `evaluated=true` / `unclassifiableCommits=0`；两次取样（≥25 min）`criterionHash` 一致。⛔ 不改 develop history、⛔ 不放宽 fail-closed、⛔ 不加 `RULED_HISTORICAL_COMMITS` 一行。

## AC

- [x] AC1（现状固化·生产载体）主检出逐字重跑 AC-194 判据（`goals/AC-194-no-direct-to-develop-bypass.md` 的 criterion 原文，⛔ 不改写）⇒ 贴 `EXIT` / `evaluated` / `ok` / `reason` / `reasonSecondary` / `unclassifiableCommits` / `unclassifiableSample` / `unclassifiedActionForms` / `classification.*` 读数；并贴 `git reflog show --date=iso develop | grep 99efed2c` 整条原文（gs 空）、`git log -1 --format='%P %s' 99efed2c`、`git rev-list --count --first-parent 99efed2c..develop`
- [x] AC2（根因归属·三 script 站点之外的散文通道）贴 `grep -rn "must not be behind origin/develop\|release-cut preflight\|reconcile the published" plugin/ packages/ experiments/ scripts/ docs/ orchestration/ .claude/` 的逐字读数（零计数时必须**逐字贴命令**并把该谓词对任务体里那行已知为真的 message 干跑一次——硬规则②的零计数配套动作），并贴 `plugin/scripts/release-cut.mjs:337-355` 的 `release-cut-develop-behind-remote` 拒绝逻辑原文 ⇒ 证明 `99efed2c` 的**产出者是 agent/散文手搓 git**，前一条枚举的三处 script 站点结构上覆盖不到它
- [x] AC3（结构类·本条核心）贴实现 diff：新增 `publishedReconcile`（空 action + merge ≥2 父 + 全非首父 reachable from remote-tracking ref）结构类，`--json` 与文本输出**可区分**、有独立计数、⛔ 不并入 fan-in 计数；贴生产读数（`99efed2c` 被判为该类，`unclassifiableCommits=0`）
- [x] AC4（负控可证伪——单亲/本地 merge/任意 -m 仍 fail-closed）在 scratch clone（⛔ 不在真 develop 注入）逐条贴读数：(a) 空 action 移到**单亲** commit ⇒ `evaluated=false` / exit 3 / reason 逐字点名 `(empty)`；(b) 空 action 移到 merge 但非首父**不** reachable from remote-tracking ref ⇒ 仍 `unknown`；(c) `git update-ref -m "<任意其它文本>"` ⇒ 仍 `unknown`（既有钉保持绿）
- [x] AC5（钉子 + 变异检验）`plugin/test/direct-to-develop-bypass-check.test.mjs` 与 `plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh` 各新增覆盖（生产形 ⇒ 分类 + 独立计数；负控 (a)(b) ⇒ NOT-EVALUATED）；变异检验——把新类临时退回「空一律 unknown」⇒ 新断言**必须变红**，贴红/绿两次读数与恢复后 `git diff --stat` 为空
- [x] AC6（判据真值恢复）AC-194 判据（`--baseline develop~100`）读 `exit 0`（`evaluated=true`、`unclassifiableCommits=0`、`ratio=1`），两次取样间隔 ≥25 min、`criterionHash` 一致；⛔ 不得以改 history 或放宽 fail-closed 求绿
- [x] AC7（声明与实现一致）`plugin/scripts/capability-catalog-declarations.json` 的 `direct-to-develop-bypass-check.ts` 能力声明/失效前提已更新为含 `publishedReconcile`（或贴出「无需更新」的可核理由）；贴该文件对应的 whole-tree 静态检查读数
- [x] AC8（本任务自身的门）`bash scripts/test.sh --for-task gap-ac194-release-preflight-reconcile-unreadable-landing` 绿

### Evidence（本轮 · 2026-10-10，主检出 /data/home/yale/work/quay）

**AC1 现状固化（改前）**：criterion 逐字跑 ⇒ criterion 脚本 `exit 1`（checker `exit 3`）`evaluated=false ok=true` `reason="unsupported-reflog-action: (empty)"` `reasonSecondary="unclassifiable-commits-in-range"` `unclassifiableCommits=1` `unclassifiableSample=["99efed2c9495bb71a5061f3b968e22c7e01b19ca"]` `unclassifiedActionForms=[{"form":"(empty)","count":1,"sampleShas":["99efed2c…"]}]` `classification={classified:99,total:100,ratio:0.99,firstParent:100,offSpine:146}` `sanctionedRefMoveIntroducedTotal=0`。
- `git reflog show --date=iso develop | grep 99efed2c` ⇒ `99efed2c9 develop@{2026-10-10 10:22:10 +0800}: `（gs 空）
- `git log -1 --format='%P %s' 99efed2c` ⇒ `e9358e97ae3f9ac63640a3bf18f7d68338c0e878 f4600e9acd0f30fb91438bf1662b13ab191f40b0 Merge origin/develop into develop — reconcile the published CI fixes with the loop's local commits (release-cut preflight: local develop must not be behind origin/develop)`
- `git rev-list --count --first-parent 99efed2c..develop` ⇒ `17`

**AC2 根因归属**：`grep -rn "must not be behind origin/develop\|release-cut preflight\|reconcile the published" plugin/ packages/ experiments/ scripts/ docs/ orchestration/ .claude/` ⇒ **0 命中**（grep exit=1）。零计数配套干跑（硬规则②）：同一谓词对 `tasks/`（含已知为真的 message）⇒ 命中 `gap-ac194-empty-reflog-action-…:40` 与本任务 `:38` 两条。`plugin/scripts/release-cut.mjs:352-357` 的 `release-cut-develop-behind-remote`：`rev-list --count develop..refs/remotes/<remote>/develop !== 0` ⇒ `fail(… 'the cut would tag a tree missing already-published commits (fetch + merge, …)')` ⇒ 产出 `99efed2c` 的是 agent/散文通道手搓 `git merge` + 裸 `update-ref`，前一条枚举的三处 script 站点结构上覆盖不到它。

**AC3 结构类**：新增 `classifyPublishedReconcile`（PURE 三态）+ `gitDevelopDirectCommits` 结构检测 + `--json`/文本独立读数（`denominator.publishedReconcileCommits` / `classification.publishedReconcileIntroduced`，文本行 `published-reconcile landings …` + `PUBLISHED-RECONCILE`）。生产读数（改后）：`exit 0` `evaluated=true ok=true` `reason="no-direct-commits-in-range"` `unclassifiableCommits=0` `ratio=1` `publishedReconcileCommits=1` `publishedReconcileIntroduced=[{tip:99efed2c…,prev:e9358e97…,introduced:[{sha:99efed2c…,codeSurface:true}]}]`；`refMoveIntroducedTotal=0` / `sanctionedRefMoveCommits=0` / `totalDirectCommits=0`（⛔ 未并入 fan-in 计数）。

**AC4 负控（scratch clone，⛔ 未在真 develop 注入）**：
- (a) 空 action 单亲 ⇒ `{"exit":3,"evaluated":false,"reason":"unsupported-reflog-action: (empty)","unclassifiableCommits":1,"publishedReconcileCommits":0}`
- (b) 空 action merge 但非首父不 reachable from origin/develop（本地 merge）⇒ `{"exit":3,"evaluated":false,"reason":"unsupported-reflog-action: (empty)","unclassifiableCommits":1,"publishedReconcileCommits":0}`
- (c) `git update-ref -m "mutation-unknown-form"` ⇒ `{"exit":3,"evaluated":false,"reason":"unsupported-reflog-action: mutation-unknown-form","unclassifiableCommits":1,"publishedReconcileCommits":0}`

**AC5 钉子 + 变异检验**：新增 PURE 断言（生产形 ⇒ publishedReconcile；单亲 / 本地 merge / 任意 -m ⇒ unknown；读不出 ⇒ null）+ CLI 断言 + mutation case ⑤（正向 + 独立计数）/⑥（本地 merge 负控）。变异（`classifyPublishedReconcile` 末行退回 `return "unknown"`）⇒ PURE 断言 ✖、CLI 断言 ✖、mutation case ⑤ RED（`publishedReconcile landing judged NOT GREEN`）、生产读数退回 `exit 3 unclassifiable=1`；`git checkout -- <file>` 恢复后 `git diff --stat` **为空**。

**AC6 判据真值恢复**：两次取样（间隔 ≥25 min）`criterionHash` 一致 = `d3eb8d7a6165b156`（goal blob `64d53fa641aca92a78753b84a893d92d91901f87` 未变），两次均 `exit 0 evaluated=true ok=true unclassifiableCommits=0 ratio=1 publishedReconcileCommits=1`。⛔ 未改 develop history、⛔ 未放宽 fail-closed、⛔ 未加 `RULED_HISTORICAL_COMMITS` 行。
- sample-1（{"ts":"2026-10-10T05:12:16.123Z","criterionHash":"d3eb8d7a6165b156","goalBlob":"64d53fa641aca92a78753b84a893d92d91901f87","checkerExit":0,"evaluated":true,"ok":true,"reason":"no-direct-commits-in-range","unclassifiableCommits":0,"ratio":1,"publishedReconcileCommits":1,"develop":"91fa3d142fe8fd2f4b289fc6226f199af4addecf"}）
- sample-2（{"ts":"2026-10-10T05:38:48.973Z","criterionHash":"d3eb8d7a6165b156","goalBlob":"64d53fa641aca92a78753b84a893d92d91901f87","checkerExit":0,"evaluated":true,"ok":true,"reason":"no-direct-commits-in-range","unclassifiableCommits":0,"ratio":1,"publishedReconcileCommits":1,"develop":"b79bc07efc85708deaba46ddc7430b9aa45a81b4"}）

**AC7 声明与实现一致**：`plugin/scripts/capability-catalog-declarations.json` 的 QUESTION 与 INVALIDATION（`direct-to-develop-bypass-check.ts`）已含 `publishedReconcile`（三谓词 + fail-closed 残余 + 单亲/本地 merge/任意 -m 仍 unknown）。静态检查：`bash plugin/scripts/capability-catalog.sh` ⇒ `exit 0`（`summary: 372 scripts | 372 declared | 0 unclassified | 367 ship`）；`node --test plugin/test/capability-catalog.test.mjs` ⇒ `18 pass / 0 fail`。

**AC8 本任务自身的门**：`bash scripts/test.sh --for-task gap-ac194-release-preflight-reconcile-unreadable-landing --allow-thin` ⇒ `exit 0`（含 `sh-census-check` / checker-mutation 负控 / 静态检查全绿）。

## DoD

**真实落地**：AC-194 判据在生产载体上恢复 `exit 0`（AC6），且这个「真」**不再依赖滑窗滚过某个特定 tip**——`99efed2c` 被**按结构**分类（AC3），今后的同类散文通道落地（空 action merge 一条已发布外部线）自动可分类且**可见**（独立计数 + 带入窗内 commit 清单）；且分类**能取假**（AC4：单亲 / 本地 merge / 任意 `-m` 仍 NOT-EVALUATED；AC5 变异检验把新类退回 unknown 后断言变红）。

⛔ 只往 `RULED_HISTORICAL_COMMITS` 加 `99efed2c` 一行 ⇒ 不算完成（one-off sha 行是 `gap-ac194-release-bump-classified-as-bypass` 一条要消灭的形态）。
⛔ 把空 action **一律**判 `refMove`/`publishedReconcile` ⇒ 不算完成（掩掉 `394dbca5d` 形真直投，fail-open）。
⛔ 按 message 文本（"Merge origin/develop into develop …"）判类 ⇒ 不算完成（白名单/text-match 形态，人手可写任意 message）。
⛔ 放宽 `DESIGN_INTERNAL_RE` / 改 develop history 求绿 ⇒ 不算完成。
⛔ 以「窗口前进后自然会绿」结束（把 AC6 标（待外部）再翻 done）⇒ 不算完成——那正是本条立案的成因（前一条的 AC7 逐字如此，`8346c62a1` 仍翻 done）。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-ac194-release-preflight-reconcile-unreadable-landing.md
