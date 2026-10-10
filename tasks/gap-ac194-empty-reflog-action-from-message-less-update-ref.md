---
id: gap-ac194-empty-reflog-action-from-message-less-update-ref
title: "AC-194 判据第五次变假（NOT-EVALUATED 非真 RED）：develop reflog 出现【空 action】——本仓自己的
  batch-merge/downsync 落地通道以 `git update-ref`（无 -m）移动 develop ⇒
  `unsupported-reflog-action: (empty)` ⇒ 判据恒 fail"
status: ready
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

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（题面：done 任务的判据后来变假而无人重评——本条是同一形态的**第五次**）。

**判据此刻取假，且是 NOT-EVALUATED（不是真 RED）。** 2026-10-10 主检出逐字重跑：

    $ node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts \
        --root "$(git rev-parse --show-toplevel)" --baseline develop~100 --json ; echo EXIT=$?
    EXIT=3
    evaluated=false  ok=true
    reason="unsupported-reflog-action: (empty)"   reasonSecondary="unclassifiable-commits-in-range"
    unclassifiableCommits=1   unclassifiableSample=["99efed2c9495bb71a5061f3b968e22c7e01b19ca"]
    classification: classified=99  total=100  ratio=0.99  firstParent=100  offSpine=138

（`plugin/scripts/direct-to-develop-bypass-check.ts` 的三态：0=合格、1=RED、3=读不懂；AC-194 的 `expect: exit 0` 要求**既有评估、又无绕过**，NOT-EVALUATED 亦 fail-closed，见判据 `origin` 逐字。）

### 根因（机制，非一次性）

`99efed2c` 是 develop first-parent spine 第 6 条（`rev-list --first-parent develop~100..develop` 第 6 位置），其 **develop reflog 条目的 action 为空**：

    develop@{2026-10-10 10:22:10 +0800} 99efed2c9495bb71a5061f3b968e22c7e01b19ca develop@{…}    ← gs 为空
    git log -1 --format='%P %s' 99efed2c
      → e9358e97… f4600e9a…  Merge origin/develop into develop — reconcile the published CI fixes … (release-cut preflight: …)

空 action 的**产出者**是本仓自己的 ref-level 落地通道——`git update-ref`（**无 `-m`**）只移动 ref、不写 reflog 消息。本机 git 2.43.0 探针仓库实测（逐条贴 `%gs` 原文）：

    git merge --no-ff                        → merge <b>: Merge made by the 'ort' strategy.
    git merge --no-ff --no-commit + commit   → commit (merge): <自定义消息>
    git update-ref <ref> <new> <old>   (无 -m) → （空）

具名无 `-m` 站点（`硬规则 5b`：成簇，三处都要修）：

- `plugin/scripts/integration-batch-merge.ts:1165` — real-merge CAS：temp worktree 内 merge → `git("update-ref", refs/heads/develop, mergeCommit, developTip)`，**无 `-m`**（该文件 `:329` 逐字写着 "it has no message to annotate"）。
- `plugin/scripts/integration-batch-merge.ts:1281` — ff CAS，同形，无 `-m`。
- `plugin/scripts/sync-lag-check.sh:167` — downsync ff：`git -C "${repo_root}" update-ref "refs/heads/${branch}" "${origin_tip}"`，无 `-m`。

链路：空 gs → `classifyReflogAction("")`（`direct-to-develop-bypass-check.ts:579`）⇒ `"unknown"` → `classifySpineLandingMode`（`:688`）判该 tip `unclassifiable` → `:1430-1438` 把「核心 GREEN 但 unclassifiable>0」降级为 `evaluated=false` → **exit 3**。**判据真值没变**（没有 commit 在 develop 上被 `commit:` 创建），变的是**读面**——`git update-ref` 在 DAG 上与 `git push .` / `git merge --ff-only` 完全同形，只是没留下 action 词。⇒ 这正是 GOAL-007 的「前提变更（本仓落地通道改成 `update-ref` CAS）后判据变假而常驻测试结构上不可能发现」形态。

<!-- dedup-ref -->
前一轮 `gap-promotion-driver-blind-to-unsatisfiable-ac-block`（ready）的 worker 在机械 fan-in 归因时到达**同一结论**并逐字记于 `.quay/anchor.log:31733-31737`（"`integration-batch-merge.ts:1165` advanced develop with a bare `git update-ref` (no `-m` …) ⇒ form = \"(empty)\""），但它只修了被该 `(empty)` 形打红的**测试断言**（reason 的 dual-channel 契约），**未动判据真值**——本条与它机制不同、目标不同，不合并。

### ⛔ 不是「把空 action 归为 refMove」

空 action = 一次**无消息的 ref 移动**，它**不能**区分「commit 在 develop 上被创建」与「ref 移到已存在 commit」。两者都真实存在：

- 本仓 sanctioned 落地（batch-merge / downsync 的 CAS，如上）；
- **人手外科式直落 develop**（`394dbca5d`，其消息逐字 "人裁定外科 cherry-pick"）——**同样是空 action**。

⇒ 把空 action 一律 `refMove`（绿）会 **fail-open**：掩掉真直投。两条既有钉子逐字禁止此路：能力声明的失效前提（`plugin/scripts/capability-catalog-declarations.json` 的 `direct-to-develop-bypass-check.ts` INVALIDATION）**点名「空 actio[n]」为 NOT-EVALUATED 形**；`plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh:98-120` 把「读不懂的 action 形 ⇒ NOT-EVALUATED（exit 3）且 reason 逐字点名该形」钉成常驻证据。⇒ **保持 fail-closed**，改【生产者】让 sanctioned 落地**可读**。

### 前四次修复为何没兜住

`gap-ac194-bypass-check-unclassifiable-window`（扫窗+括注）/ `gap-ac194-reflog-action-vocabulary-incomplete`（第三种拼法）/ `gap-ac194-bracket-filter-drops-offspine-landing-tip`（括注准入）/ `gap-ac194-release-bump-classified-as-bypass`（release-bump carve-out）各治一类，**空 action 从未有主**——checker 词汇表（`:555`）早已把它逐字记为 `git update-ref（无 -m）→ （空 gs）⇒ unknown`，是一个**已知但未处理**的形，直到本回合生产窗里首次出现。

（同族先例：`gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check`（superseded）——同一形态「本仓自己的通道产生的 reflog 形认不出 ⇒ 恒红」，当时的纪律是「按结构判定，⛔ 不是往白名单加字符串」。）

### 方向（生产者可读 + checker 结构类；⛔ 非白名单、⛔ 非 ruled 加行）

1. **生产者补 `-m`**：`integration-batch-merge.ts:1165` / `:1281` 与 `sync-lag-check.sh:167` 的 `update-ref` 加 `-m "<稳定前缀>: <ff|real> …"`，使 sanctioned 落地**按结构可读**（对齐「每个落地通道都留一个 action 词」：`push` / `fetch …` / `merge …: Fast-forward` / `branch: Reset to`）。**CAS 语义不变**（expected old value 保留），只加消息。
2. **checker 结构类**：给该稳定前缀加一个**结构判定**的 sanctioned ref-level 落地类，形态对齐既有 `releaseBump` / `ac65Authorized`——**谓词式、可见 + 独立计数**，⛔ 不并入 fan-in 计数、⛔ 非静默掩盖。**负控可证伪**：`:98-120` 的「任意 `-m` 文本 ⇒ NOT-EVALUATED」钉必须保持——只认那个**具体前缀**，绝不退化成「任何 `-m` 都放行」（那是白名单形态）。
3. **历史空条目**：`99efed2c` 已在 `develop~100` 内、且已无 `-m`（补生产者**不能追溯**）；它按滑窗会在 develop 前进后自然滚出（实测当前推进 ~8 first-parent commit/时 ⇒ 约半天）。⇒ 判据真值**随窗口前进自动恢复**；本任务须给出该读数（滚出后 `unclassifiableCommits=0` ⇒ `exit 0`），并证明**新落地不再产生空 action**（修复后跑一次真实 batch-merge / fan-in，贴新 `%gs`）。⛔ 为求即时绿而把空 action 归 refMove ⇒ 违反上文 fail-open 约束，不算完成。⛔ 改 develop history 或放宽 fail-closed 求绿 ⇒ 不算完成。
   （可选、非必需：若人/manager 就 `99efed2c`（release-cut preflight reconcile）出裁决，可让它经 ruled 机制**可见**——但 ⛔ 不以此替代 1+2 的机制修复，⛔ 不得把 ruled 表当长期手段，那正是 `-release-bump` 一条要消灭的形态。）

## Plan

1. 读 `direct-to-develop-bypass-check.ts`：`classifyReflogAction`（:577）、`reflogActionForm`（:617）、`buildRefMoveBrackets`（:666）、`classifySpineLandingMode`（:688）、`unclassifiable` 降级（:1430-1438）、文本 `refMoveVocabulary`（:1470）；确定新类的落点（**独立于** `refMoveTips`，避免并入 fan-in 计数）。
2. 读 `integration-batch-merge.ts:1052-1187`（realMerge + ff CAS）与 `sync-lag-check.sh:150-175`（downsync），确认两处 `update-ref` 与既有 `say(...)` 文案；定稳定前缀（建议 `integration-batch-merge: `）。⛔ 不改 CAS 语义。
3. 实现 checker 侧结构类（判定只留一份：`classifyReflogAction` 增一类，`classifySpineLandingMode` 消费它；`--json` 增独立计数如 `denominator.sanctionedRefMoveCommits`；文本输出行可区分）。空/任意 `-m` **仍 `unknown`**。
4. `plugin/test/direct-to-develop-bypass-check.test.mjs` 加钉子：（a）带稳定前缀的 `update-ref -m` 落地 ⇒ 该 tip 可分类（GREEN，非 unclassifiable）；（b）**负控**：无 `-m`（空 action）⇒ 仍 NOT-EVALUATED / exit 3；（c）**负控**：任意其它 `-m` 文本 ⇒ 仍 NOT-EVALUATED（保持既有钉）；（d）**变异检验**：把新类临时退回「空/任意一律 unknown」⇒ (a) 必须变红。
5. `plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh`：把新形纳入 mutation 覆盖；若 `sync-lag-check.sh` 的改动影响 `sh-census-baseline.json` 的有效行数，优先**行中性**改法，否则同步 baseline。
6. scratch clone 复现（⛔ 不在真 develop 注入）：构造空 action 落地 ⇒ NOT-EVALUATED；构造带前缀落地 ⇒ 结构分类。
7. 生产读数：贴判据复跑（`--baseline develop~100`）+ `99efed2c` 滚出后 `unclassifiableCommits=0` ⇒ `exit 0`；并贴修复后一次真实 batch-merge / fan-in 的 develop reflog `%gs`，证明不再空。

## AC

- [ ] AC1（现状固化·生产载体）主检出逐字重跑 AC-194 判据，贴 `EXIT` / `evaluated` / `ok` / `reason` / `reasonSecondary` / `unclassifiableCommits` / `unclassifiableSample` / `classification.*` 读数；并贴 `git reflog show develop` 中 `99efed2c` 整条原文（gs 空）与 `git log -1 --format='%P %s' 99efed2c`
- [ ] AC2（根因归属）探针仓库逐条贴 `%gs` 实测三条（`git merge --no-ff` / `--no-commit`+`commit -m` / `update-ref` 无 `-m`），并点名三处无 `-m` 的 `update-ref`（`integration-batch-merge.ts:1165` / `:1281` / `sync-lag-check.sh:167`）的代码原文
- [ ] AC3（生产者可读）三处 `update-ref` 加稳定前缀 `-m`；贴 diff 与**修复后**一次真实（或 fixture 复现的）落地的 develop reflog `%gs`（不再空）；证明 CAS 的 expected-old-value 语义未变
- [ ] AC4（checker 结构类·本条核心）checker 增一个**结构判定**的 sanctioned ref-level 落地类，**可见 + 独立计数**（`--json` 与文本输出可区分，⛔ 不并入 fan-in 计数）；贴实现 diff 与生产读数（该形可分类，不再 unclassifiable）
- [ ] AC5（**负控可证伪**——空/任意仍 fail-closed）(a) 无 `-m` 的 `update-ref` 落地 ⇒ 仍 `evaluated=false` / exit 3 / reason 逐字点名 `(empty)`；(b) 任意其它 `-m` 文本 ⇒ 仍 NOT-EVALUATED（`checker-mutation-cases:98-120` 的钉保持绿）。贴两次读数
- [ ] AC6（**钉子 + 变异检验**）`plugin/test/direct-to-develop-bypass-check.test.mjs` 新增断言（生产形 ⇒ 可分类；负控 (a)(b) ⇒ NOT-EVALUATED）；变异检验——把新类临时退回「空/任意一律 unknown」⇒ 新断言必须变红，贴红/绿两次读数与恢复后 `git diff --stat` 为空
- [ ] AC7（判据真值恢复）AC-194 判据（`--baseline develop~100`）读 `exit 0`（`evaluated=true`、`unclassifiableCommits=0`）；若落地时 `99efed2c` 仍在窗内 ⇒ 贴当时读数说明「唯一剩余 unclassifiable 即该历史空 tip，且已无新空 action 产生」，并贴它滚出后判据转 `exit 0` 的读数。**（待外部）**（依赖 develop 窗口前进，非执行者可就地强改；⛔ 不得以改 history 或放宽 fail-closed 求绿）
- [ ] AC8（本任务自身的门）`bash scripts/test.sh --for-task gap-ac194-empty-reflog-action-from-message-less-update-ref` 绿

## DoD

**真实落地**：AC-194 判据在生产载体上恢复 `exit 0`（AC7），且这个「真」**不再依赖任何人往 ruled 表加行**——今后的 batch-merge / downsync 落地自动带可读 action 并被结构分类（AC3 + AC4）；且分类**能取假**（AC5 负控：空 / 任意 `-m` 仍 NOT-EVALUATED；AC6 变异检验把新类退回 unknown 后断言变红）。

⛔ 把空 action 一律归 `refMove`（fail-open，掩真直投——`394dbca5d` 同为空的**真直落**是反例）⇒ 不算完成。
⛔ 只往 `RULED_HISTORICAL_COMMITS` 加 `99efed2c` 一行 ⇒ 不算完成（那是 `gap-ac194-release-bump-classified-as-bypass` 一条要消灭的形态）。
⛔ 放宽 `DESIGN_INTERNAL_RE` 或改 develop history 求绿 ⇒ 不算完成。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/scripts/integration-batch-merge.ts
- plugin/scripts/sync-lag-check.sh
- plugin/test/direct-to-develop-bypass-check.test.mjs
- plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- tasks/gap-ac194-empty-reflog-action-from-message-less-update-ref.md