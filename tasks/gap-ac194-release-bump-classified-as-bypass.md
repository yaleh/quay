---
id: gap-ac194-release-bump-classified-as-bypass
title: AC-194 判据第四次变假（真 RED 非 NOT-EVALUATED）：release-cut 的 SPEC §4.3/§12 step-5
  版本 bump 直落 develop 被 bypass-check 判为 direct-commit-bypasses-fan-in；前三次靠人手加
  ruled one-off 行吸收，机制缺一个结构分类
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

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（题面：done 任务的判据后来变假而无人重评）。

**判据此刻取假，且是真 RED（不是 NOT-EVALUATED）。** 2026-10-01 主检出逐字重跑：

    $ node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts \
        --root . --baseline develop~100 --json ; echo EXIT=$?
    EXIT=1
    evaluated=true   ok=false   reason="direct-commit-bypasses-fan-in"   reasonSecondary=null
    unclassifiableCommits=0     classification: 100/100 (ratio 1)
    denominator: totalDirectCommits=1  codeSurfaceCommits=1  inLockWindowCommits=0
                 ac65AuthorizedCommits=0  ruledHistoricalCommits=0  unclassifiableCommits=0
    candidates[0].sha     = 64fd3cdba0d8831d9562abea888350d112eb009c
    candidates[0].subject = "release: bump version to 0.14.0 after v0.13.0 (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)"
    candidates[0].confirmedBypass = true

台账尾（`.quay/gate-events.jsonl`，`item_id=AC-194`，`criterionHash=d3eb8d7a6165b156`）由 pass 翻 fail：

    2026-10-01T05:32:45.110Z  actor=goal-sweep  verdict=pass  "acceptance passed (exit 0)"
    2026-10-01T06:33:01.298Z  actor=goal-sweep  verdict=fail  "… did not pass (--baseline develop~100) direct-commit-bypasses-fan-in"

### 根因（机制，非一次性）

`64fd3cdba` 是 **v0.14.0 切版的 step-5「下一版 bump」提交**，由 `plugin/scripts/release-cut.mjs:514-524` **直落 develop** 并 push。这是 **SPEC `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.3/§12 规定的机制**（§12：「⇒ 合回之后人只改 `VERSION` 一行（`X.Y.(Z+1)`）+ 跑生成器」；§12.3：「人侧的动作已机械化（2026-09-24）……由 `bash plugin/scripts/release-cut.sh <X.Y.Z>` 一条命令执行」），**不是任何人的偷懒绕过**。落痕可核：

    .quay/release-branch-finish.jsonl 尾行
    {"ts":"2026-10-01T05:33:00Z","branch":"release/v0.13.0","sha":"a71a7b816…","form":"cut",
     "tag":"v0.13.0","base":"develop","result":"deleted-local","remote_result":"remote-already-clean","exit":0}
    git reflog show develop 首行 → 64fd3cdba develop@{0}: commit: release: bump version to 0.14.0 …
    git log -1 --format=%p 64fd3cdba → a71a7b816   （正是上面 ledger 记的 cut merge point）

该 bump 的 code-surface 文件集**恰好等于版本载体集**（`scripts/version-carriers.ts`，13 条目 / 10 文件）：VERSION、delivery-manifest.json、package-lock.json、packages/{quay,quay-native,quay-github,quay-backlog}/package.json、plugin/.claude-plugin/plugin.json、plugin/README.md、plugin/VERSION、plugin/vendor/quay/package.json。其中无一条落在 `DESIGN_INTERNAL_RE`（`direct-to-develop-bypass-check.ts:147`）内 ⇒ `classifyCommit`（`:611`）得 `bypass=true` ⇒ RED。**这是机制的结构性冲突：SPEC 规定 release-cut 直落 develop，而 AC-194 的 checker 把任何非 design-internal 直投一律判 bypass。**

### 前三次都靠人手一行吸收（这就是它长期不被修的原因）

这是**第四次**同一形态：release bump 直投触发该判据。前三次各被人为往 `RULED_HISTORICAL_COMMITS`（`direct-to-develop-bypass-check.ts:243`）手工加一条 one-off sha 行：

    release 0.5.0  → sha 08e8ec55   （"release 0.5.0 版本 bump——人 … 逐字裁定的发布操作…"）
    release 0.6.1  → sha a388ca38   （"…release v0.6.1 已 gh 发布 …同形，先例 08e8ec55"）
    release v0.8.0 → 合回 + 下一轮 bump（"…本次是同一类事件的第三次"）

即：**每次切版都要人手再裁一次**，而 checker 自己的注释（`:238`）逐字写着「豁免表【有界】……任一未入表的新直投仍红（能取假——豁免不能被静默扩展）」。当前五条 AC-194 任务（全部 done：`gap-ac194-bypass-check-unclassifiable-window` / `gap-ac194-reflog-action-vocabulary-incomplete` / `gap-ac194-bracket-filter-drops-offspine-landing-tip` / `gap-ac194-frozen-verdict-predates-fix` / `gap-ac194-production-criterion-owner`）**没有一条覆盖 release-bump 这一类**——它们治的是 unclassifiable/refMove 家族、陈旧读数、与 fetch 形的钉子。⇒ 这一类从未有主。

### 方向（结构分类，非再手工加一行）

给 checker 补一个**结构判定**的直投类别（建议名 `releaseBump`），形态对齐既有的 `ac65Authorized`（谓词式，⛔ 非 sha 表），分类**可见 + 独立计数**（进 `denominator`，输出行可区分于 `AC65-AUTHORIZED` / `RULED-HISTORICAL`，⛔ 非静默掩盖）。谓词由**三个相互独立、可机核的事实**合取承担：

1. 提交标题匹配 `release-cut.mjs:516` 生成器的唯一字面模板（该 message 只由这一处生成）；
2. 该提交是 `.quay/release-branch-finish.jsonl` 中一条 `form:"cut"` ∧ `base:"develop"` 记录的**直接子提交**（parent == 该记录的 sha）——即它确实紧跟一次落痕在案的切版；
3. 它触及的 code-surface 文件集 ⊆ 版本载体集（从单源 `scripts/version-carriers.ts` / 版本判定器 `scripts/version-consistency-check.ts` 派生，⛔ 不手抄文件名清单）∪ closure-ratchet 基线。

⇒ 三条同时成立才 `releaseBump`（非 bypass）；**任一不成立仍 RED**——负控取假：标题相同但夹带一个载体外 code-surface 文件（如 `plugin/scripts/x.ts`）的直投，仍判 `direct-commit-bypasses-fan-in`。

⛔ 不放松 `DESIGN_INTERNAL_RE`、⛔ 不动 fan-in 锁机制、⛔ 不用「往 ruled 表再加一行」收尾（那正是本条要消灭的形态）。

## Plan

1. 读 `direct-to-develop-bypass-check.ts`：`classifyCommit`（:611）、`isDesignInternalPath`（:151）、`checkDirectCommits`（:651 起）、`ac65Authorized` 两谓词实现与输出渲染（`AC65-AUTHORIZED` 行）、`RULED_HISTORICAL_COMMITS` 读取点（`:411`）；确认 `denominator` 各计数字段与 `releaseBump` 的落点。
2. 读 `.quay/release-branch-finish.jsonl` 的读取侧（有无既有 parser；若无，新增一个只认 `form:"cut"` ∧ `base` 的最小读取），与 `release-cut.mjs:514-524` 的提交点，确认 parent 关系与 subject 模板的**唯一生成处**。
3. 读 `scripts/version-carriers.ts`（`VERSION_CARRIERS` / `carrierPaths()`）与 `scripts/version-consistency-check.ts` 的调用约定，确定「载体集」由结构表派生；若该表当前不可被 checker 直接引用（层次：`plugin/scripts` 不 import 仓根 `scripts/`），选一条单源路径（导出 / 上移到 kernel / 在 CLI 层向版本判定器取），⛔ 不新抄一份文件名清单。
4. 实现 `classifyReleaseBumpCommit(commit, {carrierPaths, cutParents})`（PURE，注入 files/subject/parent/message）与 `releaseBump` 字段 + `denominator.releaseBumpCommits`；`bypass` 合取式加入 `!releaseBump`。第二来源（版本判定器）不可用时按「未评估」独立取值，⛔ 不与合格同形（硬规则 3b）。
5. `plugin/test/direct-to-develop-bypass-check.test.mjs` 加钉子：（a）生产形态（真实 subject + 载体集 + cut parent）⇒ `releaseBump`（非 bypass）；（b）**负控**：同 subject 但多一个 `plugin/scripts/*.ts` ⇒ 仍 bypass RED；（c）**变异检验**：把谓词临时改回「只匹配 subject 字符串」⇒ 负控 (b) 必须变红。
6. scratch clone 复现（⛔ 不在真 develop 注入）：注入 release-bump 形直投 ⇒ `releaseBump`；注入同 subject 夹带 code-surface 文件的直投 ⇒ RED。
7. 生产核实：真 develop 上 AC-194 判据复跑 ⇒ `exit 0`；贴 `.quay/gate-events.jsonl` 里 AC-194 由 fail 转 pass 的新 goal-sweep 尾条（若本轮未发生，如实说明——它由生产 goal 环 ~42s 轮转产生）。

## AC

- [x] AC1（现状固化·生产载体）主检出逐字重跑 AC-194 判据，贴 `exit` / `evaluated` / `ok` / `reason` / `denominator.*` / `candidates[0].sha` / `codeSurfaceFiles` 读数；并贴 `.quay/gate-events.jsonl` 中 AC-194 的 pass（05:32:45Z）与 fail（06:33:01Z）两条原文与 `criterionHash`
- [x] AC2（根因归属）贴 `64fd3cdba` 的 `git show --name-only`、`git reflog show develop` 首行、`.quay/release-branch-finish.jsonl` 尾行、`release-cut.mjs:514-524` 直投代码原文；证明它是 SPEC §4.3/§12 的 step-5 bump，非绕过
- [x] AC3（**结构分类**·本条核心）`classifyCommit` 增 `releaseBump` 类别，谓词三条（subject 模板 ∧ cut-ledger parent ∧ 载体集子集）合取；分类可见并进 `denominator`（输出行可区分于 `AC65-AUTHORIZED` / `RULED-HISTORICAL`）；贴实现 diff 与生产读数
- [x] AC4（**负控可证伪**）scratch clone 注入一条**同 subject 但夹带载体外 code-surface 文件**的直投 ⇒ 同一 checker 仍 `exit 1` `direct-commit-bypasses-fan-in`，贴读数；证明分类不是「按标题放行」
- [x] AC5（**钉子 + 变异检验**）`plugin/test/direct-to-develop-bypass-check.test.mjs` 新增断言：生产形态 ⇒ `releaseBump`（非 bypass）∧ 负控形态 ⇒ bypass；变异检验——把谓词临时改回「只匹配 subject」⇒ 新断言必须变红，贴红/绿两次读数与恢复后 `git diff --stat` 为空
- [x] AC6（生产真值恢复）真 develop 上 AC-194 判据 `exit 0`，贴复跑读数
- [x] AC7（本任务自身的门）`bash scripts/test.sh --for-task gap-ac194-release-bump-classified-as-bypass` 绿

## Evidence

实现提交 `41a01ff0a`（分支 `task/gap-ac194-release-bump-classified-as-bypass`）；pre-merge 后 HEAD `aaa7719bf`（merge develop `e8b34916bcffce88c57fc90be83aeb44e3a001ea`）。

**AC1 修复前（主检出逐字重跑）**：`EXIT=1`、`evaluated=true ok=false reason=direct-commit-bypasses-fan-in reasonSecondary=null`、`unclassifiableCommits=0`、`classification 100/100 (ratio 1)`；`denominator: totalDirectCommits=1 codeSurfaceCommits=1 inLockWindowCommits=0 ac65AuthorizedCommits=0 ruledHistoricalCommits=0 unclassifiableCommits=0`；`candidates[0].sha=64fd3cdba0d8831d9562abea888350d112eb009c`，`codeSurfaceFiles=[VERSION, delivery-manifest.json, package-lock.json, packages/quay-backlog/package.json, packages/quay-github/package.json, packages/quay-native/package.json, packages/quay/package.json, plugin/.claude-plugin/plugin.json, plugin/README.md, plugin/VERSION, plugin/vendor/quay/package.json]`。
`.quay/gate-events.jsonl`（`item_id=AC-194`、`criterionHash=d3eb8d7a6165b156`）原文两条：
`{"item_id":"AC-194","gate":"goal","actor":"goal-sweep","verdict":"pass","timestamp":"2026-10-01T05:32:45.110Z","payload":{"reason":"acceptance passed (exit 0)","criterionHash":"d3eb8d7a6165b156"}}`
`{"item_id":"AC-194","gate":"goal","actor":"goal-sweep","verdict":"fail","timestamp":"2026-10-01T06:33:01.298Z","payload":{"reason":"acceptance failed (exit 1) — AC-194 fail - plugin/scripts/direct-to-develop-bypass-check.ts did not pass (--baseline develop~100) direct-commit-bypasses-fan-in","criterionHash":"d3eb8d7a6165b156"}}`

**AC2 根因归属**：`git show --name-only 64fd3cdba` = VERSION / delivery-manifest.json / docs/analysis/quay-init-closure-ratchet.baseline.json / package-lock.json / packages/{quay-backlog,quay-github,quay-native,quay}/package.json / plugin/.claude-plugin/plugin.json / plugin/README.md / plugin/VERSION / plugin/vendor/quay/package.json。
`git reflog show develop` 中该条：`64fd3cdba develop@{3}: commit: release: bump version to 0.14.0 after v0.13.0 (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)`。（任务立案时的 `develop@{0}` 现已是 `@{3}`——develop 又前进了两条 routine/promotion 提交；`commit:` action 不变。）
`.quay/release-branch-finish.jsonl` 尾行：`{"ts":"2026-10-01T05:33:00Z","branch":"release/v0.13.0","sha":"a71a7b816d32aa8f632dd8eaa189722633ac18b6","form":"cut","tag":"v0.13.0","base":"develop","result":"deleted-local","remote_result":"remote-already-clean","exit":0}`；`git log -1 --format=%p 64fd3cdba` = `a71a7b816`（== ledger 的 `sha`，即 cut merge point）。
生成器唯一模板 `release-cut.mjs:516`：``git(worktree, "commit", "-q", "-m", `release: bump version to ${nextVersion} after ${tag} (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)`)``。

**AC3 结构分类**：`plugin/scripts/direct-to-develop-bypass-check.ts` 新增 `RELEASE_BUMP_SUBJECT_RE`、`extractCutParents(events, base)`、`classifyReleaseBumpCommit(commit, {carrierPaths, cutParents})`（PURE）；`classifyCommit(commit, lockHoldIntervals, releaseBumpCtx)` 增 `releaseBump`(+`releaseBumpReason`/`releaseBumpEvidence`)，`bypass` 合取加入 `releaseBump !== true`（null 未评估 ⇒ 仍 fail-closed 为 bypass）；`checkDirectCommits` + `denominator` 增 `releaseBumpCommits` / `releaseBumpNotEvaluatedCommits`；文本输出行 `RELEASE-BUMP`（可区分于 `AC65-AUTHORIZED` / `RULED-HISTORICAL`）；`gitCommitParent` 读 `%P` 首父。载体集**单源派生**：`scripts/version-carriers.ts` 新增 `VERSION_SOURCE_PATH` + `versionBearingPaths()`（= `carrierPaths()` ∪ `VERSION`），checker 经**动态 import**（`new URL("../../scripts/version-carriers.ts", import.meta.url)`）取用，模块读不出 ⇒ `carrierPaths=null` ⇒ 未评估。release ledger 从**共享 git dir 属主**（主检出）解析（`mainCheckoutRoot`，与 `release-branch-finish.sh` 的 `ledger_root_of` 同一条规则 / AC-320）；ledger 缺失或含 malformed 行 ⇒ `cutParents=null` ⇒ 未评估。
生产读数（`--root <主检出> --baseline develop~100`）：`exit 0`、`ok=true reason=release-bump-direct-commits-only`、`denominator: totalDirectCommits=1 codeSurfaceCommits=1 releaseBumpCommits=1 releaseBumpNotEvaluatedCommits=0 ruledHistoricalCommits=0 ac65AuthorizedCommits=0`、`candidates[0].releaseBump=true confirmedBypass=false`、`releaseBump: {carrierPaths:11, cutParents:1, evaluated:true}`。在 worktree root 跑（同一 develop ref，属主解析）读数一致 ⇒ 修复不依赖跑在哪个检出。

**AC4 负控可证伪**（scratch clone `/data/home/yale/work/ac194-scratch`，未注入真 develop；两个实验提交的父都 == cut sha `a71a7b816`）：
· 同 subject（`release: bump version to 0.14.0 after v0.13.0 (SPEC §12: VERSION + stamp + closure-ratchet re-anchor)`）只碰 `VERSION`（载体）⇒ `exit 0`、`reason=release-bump-direct-commits-only`、`releaseBump=true confirmedBypass=false subjectMatches=true cutParentMatches=true carrierSubset=true`。
· 同 subject 夹带一个载体外 code-surface 文件 `plugin/scripts/x.ts` ⇒ `exit 1`、`reason=direct-commit-bypasses-fan-in`、`releaseBump=false confirmedBypass=true carrierSubset=false offCarrierFiles=["plugin/scripts/x.ts"]`。⇒ 分类**不是**「按标题放行」。

**AC5 钉子 + 变异检验**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 新增 6 个测试（PURE：`RELEASE_BUMP_SUBJECT_RE` / `extractCutParents` / `classifyReleaseBumpCommit`（含三谓词各自取假、第三态 null）/ `classifyCommit`+`checkDirectCommits`；CLI：生产形态 GREEN、负控 RED、ledger 缺席 ⇒ 未评估且 RED）。
绿读数（恢复后）：`ℹ tests 68 / pass 68 / fail 0`。
变异检验：把谓词临时改成「只匹配 subject」（`const releaseBump = notEvaluated ? null : subjectMatches;`）⇒ `ℹ tests 68 / pass 65 / fail 3`，变红的 3 条即新钉子（含 `CLI releaseBump 负控 — 同 subject 夹带载体外 code-surface 文件 ⇒ 仍 exit 1`）。
恢复后核实：`cp` 备份还原，`diff -q <backup> <file>` ⇒ IDENTICAL，`grep -c MUTATION` ⇒ 0，复跑 `68/68` 绿。（变异检验用 `cp` 备份还原，⛔ 不用 `git checkout --`——见 mutation-control 纪律。）

**AC6 生产真值恢复**：以 AC-194 判据的**逐字命令**（cwd=worktree、`root=git rev-parse --show-toplevel`、真 `develop` ref、属主解析 ledger）复跑 ⇒ `no direct-to-develop bypass in recent window (evaluated)` / `CRITERION EXIT=0`。
`.quay/gate-events.jsonl` 里 AC-194 由 fail 转 pass 的**新 goal-sweep 尾条**：**本回合尚未发生**——它由生产 goal 环（~42s 轮转）在本次改动经 fan-in 落地 `develop` 并由主检出加载之后产生；此刻主检出仍加载旧 checker，如实说明。**不**把本回合的本地读数冒充为该台账条目。

**AC7 本任务的门**：`bash scripts/test.sh --for-task gap-ac194-release-bump-classified-as-bypass --allow-thin` ⇒ `GATE EXIT=0`（`tests 68 / pass 68 / fail 0`，含 `PROMOTED: registered in run_static_checks()` 与 `NEGATIVE CONTROL on the REGISTERED argv` 两条注册面钉子）；scoped-gate cache 已写（`developSha=e8b34916bcffce88c57fc90be83aeb44e3a001ea`，写于 merge 时刻、是 HEAD 的祖先）。注：`scripts/stamp-version.test.ts` 有 1 条**与本次改动无关的既存红**（硬编码 `0.10.0-dev` 期望，脚本行 276；主检出同红），且 `scripts/*.test.ts` 不在 `scripts/test.sh` 的 test glob（`packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs`）内，不影响本任务门。

## DoD

**真实落地**：AC-194 判据在生产载体上恢复 `exit 0`（AC6），且这个「真」**不再依赖任何人再往 ruled 表加行**——下一条 release-cut bump 自动被判 `releaseBump`（AC3）；且分类**能取假**（AC4 的负控仍 RED、AC5 的变异检验把谓词改成「只认标题」后断言变红）。⛔ 只往 `RULED_HISTORICAL_COMMITS` 加一行 `64fd3cdba` ⇒ 不算完成（那是本条要消灭的形态）；⛔ 把 `DESIGN_INTERNAL_RE` 放宽到含 `VERSION`/`package.json`（会同时放过真直投）⇒ 不算完成。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts
- plugin/test/direct-to-develop-bypass-check.test.mjs
- scripts/version-carriers.ts
- scripts/version-consistency-check.ts
- tasks/gap-ac194-release-bump-classified-as-bypass.md

## Needs-Human

**执行 2026-10-01T07:09:54.655Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 45
- run_id：wk-prod-anchor
- session_id：78b0318f-0117-4e68-b12c-81c367c15a6e
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-ac194-release-bump-classified-as-bypass~wk-prod-anchor~1790838491027-a255a2.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-ac194-release-bump-classified-as-bypass-wk-prod-anchor.log
