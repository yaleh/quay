---
id: gap-ac925-admission-dispatch-criterion-test
title: AC-925 的判据文件 plugin/test/admission-dispatch.test.mjs 缺失 ⇒「Planner 的 C1
  准入按 admission 分派」没有独立、可取假的验收载体（GOAL-911）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-925
---
## Proposal

**事实一（立案当轮逐字跑 AC-925 criterion，不是读代码推测）**：

```
$ node --test plugin/test/admission-dispatch.test.mjs
Could not find 'plugin/test/admission-dispatch.test.mjs'
EXIT=1
```

AC-925 的判据是一个**专用测试文件**；该文件不存在 ⇒ criterion 恒 exit 1，AC-925 的 evidence 因此记作 `criterion-capability-unevaluable`（instrument-failure，⛔ 不是「不合格」）。`ls plugin/test/ | grep admission` 只有 `prepare-admission-check.test.mjs`，与准入分派无关。

**事实二（分派机制本身已落地，缺的只是验收载体）**：`docs/analysis/ownership-active-limited-proposal.mjs` 已导出 `CONCERN_ADMISSIONS`（`:343`）、`admissionRoute()`（`:489`），并在 `evaluateEntryBar()` 的 (1b) 段按 route 分派（`:662-668`）：`semantic-judged` 经注入的 `opts.semanticAdmission` 确认，`evaluateSemanticAdmission()`（`:559`）在结构上不读取机械 delta；mechanical 继续走既有 C2–C4 delta 路径。既有 `plugin/test/ownership-active-limited-proposal.test.mjs` 的 AC918-1..5 覆盖了同样的行为。**所以本条不是重实现分派，而是补上 AC-925 自己的判据载体**——⛔ 不得把既有测试块改名或复制一份当成交付（那会把判据变成回声）；新文件必须独立断言，并在分派被破坏时取假。

**事实三（为什么不能只是「让文件存在」）**：AC-925 的 expect 要求三条断言 + 反向臂：(1) mechanical kind 走既有 delta 路径，**不进入两段管线、不调用判断器**；(2) semantic-judged kind 走两段管线（线索 → 判断），且 mechanical 路径不直接确认；(3) 分派由 registry 的 `admission` 值决定，而不是 kind 名硬编码。反向：翻任一条目的 `admission` ⇒ 分派路径翻转、测试红；让两类都走同一路径 ⇒ 测试红；删掉测试文件 ⇒ criterion exit 1。因此测试必须用**注入的合成 registry**（同一 kind 只改 admission）与**判断器调用计数**来断言，不能只断言真实注册表的当前取值。

<!-- dedup-ref -->**与同 goal 其它验收面的关系**：`gap-c1-admission-dispatch-by-admission-token`（goal_ac AC-918，done）实现了分派，但其判据是源码文本代理；`gap-c1-entry-bar-rejects-illegal-admission-value`（AC-923，done）覆盖非法 admission 的拒绝；`gap-concern-kind-registry-admission-field`（AC-921，done）覆盖注册表取值；`gap-semantic-admission-contract-module`（AC-919，ready）交付两段契约模块；`gap-unencapsulated-state-clue-judge-e2e`（AC-924，todo）交付端到端。本条**只**补 AC-925 的判据文件，`docs/analysis/ownership-active-limited-proposal.mjs` 是**只读消费**——不改它；若新测试真的照出一个分派缺陷，停手另立 gap，不在本任务里顺手改（那会与 AC-924 的 Touches 串行面重叠）。

## Plan

1. 新建 `plugin/test/admission-dispatch.test.mjs`（沿用 sibling 的 `// @test-group engine` 标注），静态 `import` 真实模块的 `evaluateEntryBar` / `CONCERN_KIND_REGISTRY` / `CONCERN_ADMISSIONS` / `CONDITIONS` / `CONCERN_KIND_IN_SCOPE` / `concernKindEntry`；fixture 按 `plugin/test/ownership-active-limited-proposal.test.mjs` 的 `goodDelta()` / `rec()` 形态**自建**（合法 delta + 三条 live 记录 + `decision_memory:{status:"not-known"}` + evidence/envelope），⛔ 不 import 那个测试文件本身（测试互相 import 会把两个判据耦合成一个）。
2. 断言 (1) mechanical：真实 `package-cycle` 注册表 + 一个**计数的** `semanticAdmission` spy，断言 `eligible === true`、spy 调用次数 `=== 0`、`matchedConditions` 含 `CONDITIONS.DELTA`（走既有 delta 路径）、reason 不含 `admission=semantic-judged`。
3. 断言 (2) semantic-judged：合成 entry（复制 package-cycle 条目的 readers / threshold，仅 `kind` 改成唯一串、`admission:"semantic-judged"`、`mechanized:true`），记录带**完美机械 delta**（同一份 `goodDelta()`）。① 无判断器 ⇒ `CONDITION_1_SEMANTIC_NOT_EVALUATED` 且 `matchedConditions` 不含 DELTA / MEMORY / STREAK；② 判断器 `{admit:true, counterfactual}` ⇒ `eligible === true` 且 `matchedConditions` 恰为 `[CONDITIONS.KIND]`；③ 判断器 `{admit:false, verdict}` ⇒ 具名 `CONDITION_1_SEMANTIC_REFUSED`。
4. 断言 (3) 分派看 `admission` 不信 kind 名：同一合成 kind + 同一记录，只翻 `entry.admission` 的取值（mechanical ↔ semantic-judged）⇒ verdict/reason 翻转；再做交叉对照「admission 不变、kind 名替换」⇒ 分派不变，证明判据读的是 entry 的 `admission` 字段，不是 kind 串硬编码。
5. 反向臂（能取假）分两层：① **registry 注入层**——把 semantic entry 的 `admission` 改成 `mechanical`，期望值表随之改变，若被测实现无视 admission 则该断言必红；② **模块层（临时副本，⛔ 不动真树）**——把模块拷到临时目录并删掉 `evaluateSemanticAdmission` 分支 / 让两类都落机械路径，测试文件通过一个显式 seam（可选环境变量指定被 import 的模块路径，默认 = 真模块，用动态 `import()`）指向副本运行 ⇒ 必须红；恢复默认后真树运行 ⇒ 绿。
6. 逐字跑 `node --test plugin/test/admission-dispatch.test.mjs`（AC-925 criterion）⇒ exit 0；再跑 `node --test plugin/test/ownership-active-limited-proposal.test.mjs` 确认零回归；最后 `bash scripts/test.sh --for-task gap-ac925-admission-dispatch-criterion-test --allow-thin`。

## AC

- [x] AC1 判据逐字读绿：`node --test plugin/test/admission-dispatch.test.mjs` ⇒ exit 0；贴出改动前基线（`Could not find …` + `EXIT=1`）与改动后 `# pass N` / `# fail 0` 尾部，并写明 N。
- [x] AC2 mechanical 不调用判断器：测试对 `semanticAdmission` 用计数器 spy，真实 `package-cycle` 判定后断言 `calls === 0`、`eligible === true`、`matchedConditions` 含 `CONDITIONS.DELTA`；贴该断言源码与逐字运行输出。
- [x] AC3 semantic-judged 不直接确认：同一记录带**完美机械 delta**；无判断器时 verdict 为 `CONDITION_1_SEMANTIC_NOT_EVALUATED` 且 `matchedConditions` 不含 `CONDITIONS.DELTA` / `MEMORY` / `STREAK`；有合格判断器（admit + counterfactual）时 `matchedConditions` 恰为 `[CONDITIONS.KIND]`；贴两臂输出。
- [x] AC4 分派由 admission 值决定：同一合成 kind + 同一记录，只翻 `admission` 两值 ⇒ 一个 eligible 走 delta、一个 non-eligible 走 SEMANTIC_NOT_EVALUATED；再断言「admission 不变、kind 名替换」时分派不变；贴四组 `(admission, kind, eligible, reason 前缀)` 表。
- [x] AC5 负控制（测试能取假）：按 Plan 步骤 5② 在临时目录的模块副本上删掉 semantic 分派分支，通过 seam 指向副本运行同一测试文件 ⇒ exit 非 0 且失败断言具名；恢复默认路径后真树运行 ⇒ exit 0。贴两条命令、exit code 与失败原文；⛔ 真树源码零改动（`git status --porcelain docs/analysis/ownership-active-limited-proposal.mjs` 为空）。
- [x] AC6 零回归 + scoped 门：`node --test plugin/test/ownership-active-limited-proposal.test.mjs` 全绿（贴 pass/fail 计数）；`bash scripts/test.sh --for-task gap-ac925-admission-dispatch-criterion-test --allow-thin` ⇒ exit 0。

## DoD

- [x] 判据文件在真实仓库上逐字 exit 0，且它的三条断言各自**在被破坏时取假**：删掉模块的 semantic 分派分支（临时副本）⇒ 文件红；翻 admission ⇒ 结果翻转；mechanical kind 调用判断器 ⇒ 计数断言红。贴三次实际读数，⛔「测试文件存在」不算完成。
- [x] 新文件不是既有 AC918-1..5 的回声：用不同断言形态（判断器调用计数 + 合成 registry 的 admission/kind 交叉对照），不 import `plugin/test/ownership-active-limited-proposal.test.mjs`；贴 import 段与断言段。
- [x] Touches 纪律：本任务实际只改 `plugin/test/admission-dispatch.test.mjs` 与自己的任务文件；`git status --porcelain docs/analysis/ownership-active-limited-proposal.mjs` 为空，贴该命令与其空输出。

## Evidence

改动提交 `7d2606b9f test(ac925): the C1 admission-dispatch criterion carrier`；worktree `/home/yale/work/quay-worktrees/gap-ac925-admission-dispatch-criterion-test`，merge-target `develop` @ `a2754dbc5`（`git merge --no-edit develop` → Already up to date）。

### AC1 判据逐字读绿

改动前（主检出 = develop）：
```
$ node --test plugin/test/admission-dispatch.test.mjs
Could not find 'plugin/test/admission-dispatch.test.mjs'
BASELINE_EXIT=1
```

改动后（worktree）：
```
$ node --test plugin/test/admission-dispatch.test.mjs
✔ AC925-1(mechanical): the real package-cycle route clears C1-C4 through the delta path and never invokes the judge
✔ AC925-2(semantic-judged): a perfect mechanical delta never confirms a semantic-judged kind
✔ AC925-3(dispatch-by-admission): the 2x2 cross control — admission decides, the kind name does not
ℹ tests 3
ℹ pass 3
ℹ fail 0
EXIT=0
```
**N = 3**（tests 3 / pass 3 / fail 0，exit 0）。

### AC2 mechanical 不调用判断器

断言源码（`plugin/test/admission-dispatch.test.mjs`）：
```js
const judge = countingJudge(() => ({
  admit: true, verdict: "confirmed",
  counterfactual: "this judge must never be consulted on the mechanical route",
}));
const v = evaluateEntryBar(productionStreak(CONCERN_KIND_IN_SCOPE), { semanticAdmission: judge });
assert.equal(judge.calls.length, 0, `⛔ the mechanical route invoked the semantic judge ${judge.calls.length} time(s); ...`);
assert.equal(v.eligible, true, v.reason);
assert.deepEqual(v.matchedConditions, [CONDITIONS.KIND, CONDITIONS.DELTA, CONDITIONS.MEMORY, CONDITIONS.STREAK]);
assert.equal(v.reason.includes("admission=semantic-judged"), false);
```
spy 的 impl 故意返回 `admit:true`：若机械路径误调它，verdict 依然是 eligible，**只有调用计数能抓住**——这正是 AC5 负控制 B 实测到的红。

运行输出：`✔ AC925-1(mechanical): the real package-cycle route clears C1-C4 through the delta path and never invokes the judge`，随 AC1 的 `pass 3 / fail 0 / EXIT=0`。

### AC3 semantic-judged 不直接确认

直接对模块取三个臂的返回值（合成 registry 保留 package-cycle 的 readers/threshold，仅 kind 改名 + `admission:"semantic-judged"`；记录带 perfect delta）：
```
(a) no judge:
  eligible=false
  matchedConditions=[]
  reason=CONDITION_1_SEMANTIC_NOT_EVALUATED:concern_kind=ac925-synthetic-semantic — admission=semantic-judged but no semanticAdmission judge was injected; its mechanical signals are candidates only and can never confirm it
(b) admit+counterfactual:
  eligible=true
  matchedConditions=["C1_concern_kind"]
  reason=ELIGIBLE:concern_kind=ac925-synthetic-semantic admission=semantic-judged; semantic confirmation verdict=confirmed; counterfactual=if owned by the declaring module, admit:false
(c) admit:false refuted:
  eligible=false
  matchedConditions=[]
  reason=CONDITION_1_SEMANTIC_REFUSED:concern_kind=ac925-synthetic-semantic verdict=refuted — the semantic judge did not confirm this concern; its mechanical delta is a clue only
```
(a) 的 `matchedConditions` 为空 ⇒ 不含 DELTA / MEMORY / STREAK。三个臂在 `AC925-2` 里都被逐条 assert（含 judge 调用次数恰为 1 且拿到的是路由到这里的 entry）。

### AC4 四组交叉对照表

测试运行时打印：
```
AC925 cross-control table [{"admission":"mechanical","kind":"ac925-cross-a","eligible":true,"reasonPrefix":"ELIGIBLE:"},{"admission":"semantic-judged","kind":"ac925-cross-a","eligible":false,"reasonPrefix":"CONDITION_1_SEMANTIC_NOT_EVALUATED:"},{"admission":"mechanical","kind":"ac925-cross-b","eligible":true,"reasonPrefix":"ELIGIBLE:"},{"admission":"semantic-judged","kind":"ac925-cross-b","eligible":false,"reasonPrefix":"CONDITION_1_SEMANTIC_NOT_EVALUATED:"}]
```
| admission | kind | eligible | reason 前缀 |
|---|---|---|---|
| mechanical | ac925-cross-a | true | `ELIGIBLE:` |
| semantic-judged | ac925-cross-a | false | `CONDITION_1_SEMANTIC_NOT_EVALUATED:` |
| mechanical | ac925-cross-b | true | `ELIGIBLE:` |
| semantic-judged | ac925-cross-b | false | `CONDITION_1_SEMANTIC_NOT_EVALUATED:` |

上下两行一组：**只翻 admission** ⇒ 翻转；**只换 kind 拼写**（cross-a ↔ cross-b）⇒ 分派不变。

### AC5 负控制（测试能取假）

seam = `QUAY_ADMISSION_DISPATCH_MODULE`（默认 = 真模块路径）；副本在 `/tmp/ac925-negctl/`，⛔ 真树从不被写。

A. 删掉 semantic 分派分支（临时副本 `no-dispatch.mjs`，`diff` 显示只少这三行）：
```
$ QUAY_ADMISSION_DISPATCH_MODULE=/tmp/ac925-negctl/no-dispatch.mjs node --test plugin/test/admission-dispatch.test.mjs
✔ AC925-1(mechanical): ...
✖ AC925-2(semantic-judged): a perfect mechanical delta never confirms a semantic-judged kind
✖ AC925-3(dispatch-by-admission): ...
ℹ pass 1 / fail 2   EXIT=1
  AssertionError [ERR_ASSERTION]: ac925-cross-a: semantic-judged admission must NOT be mechanically confirmed
    actual: true, expected: false
```
B. 让每条 route 都走判断器（副本 `judge-on-mechanical.mjs`，条件改成 `if (true)`）：
```
$ QUAY_ADMISSION_DISPATCH_MODULE=/tmp/ac925-negctl/judge-on-mechanical.mjs node --test plugin/test/admission-dispatch.test.mjs
✖ AC925-1(mechanical): ...
✖ AC925-3(dispatch-by-admission): ...
ℹ pass 1 / fail 2   EXIT=1
  AssertionError [ERR_ASSERTION]: ⛔ the mechanical route invoked the semantic judge 1 time(s); the delta path is authoritative and no semantic confirmation may run
    actual: 1, expected: 0
```
恢复默认（真模块）：exit 0（即 AC1 那条运行）。

真树零改动：
```
$ git status --porcelain docs/analysis/ownership-active-limited-proposal.mjs
(空输出)   PORCELAIN_LINES=0
```

### AC6 零回归 + scoped 门

```
$ node --test plugin/test/ownership-active-limited-proposal.test.mjs
ℹ tests 43 / pass 43 / fail 0    EXIT=0

$ bash scripts/test.sh --for-task gap-ac925-admission-dispatch-criterion-test --allow-thin
... ℹ tests 3 / pass 3 / fail 0 ...    EXIT=0
```
同轮跑的 fan-in 硬门：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-ac925-admission-dispatch-criterion-test \
    --worktree /home/yale/work/quay-worktrees/gap-ac925-admission-dispatch-criterion-test --merge-target develop
ANTI-DRIFT OK: task gap-ac925-admission-dispatch-criterion-test — 1 actual file(s), all within declared Touches (2 glob(s))    EXIT=0
```

### DoD 三次取假读数

| 破坏 | 读数 |
|---|---|
| 删掉模块的 semantic 分派分支（临时副本） | AC5-A：`pass 1 / fail 2`，`EXIT=1`，断言具名（`semantic-judged admission must NOT be mechanically confirmed`） |
| 翻 admission | AC4 表：`mechanical → eligible=true / ELIGIBLE:`；`semantic-judged → eligible=false / CONDITION_1_SEMANTIC_NOT_EVALUATED:` |
| mechanical kind 调用判断器 | AC5-B：`pass 1 / fail 2`，`EXIT=1`，`actual: 1, expected: 0`（`the mechanical route invoked the semantic judge 1 time(s)`） |

### DoD 不是 AC918-1..5 的回声

import 段（只有 node 内置 + 对被测模块的一次动态 import；⛔ 无任何测试文件 import）：
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// the seam: default = the real module in THIS tree
const underTest = await import(pathToFileURL(MODULE_PATH).href);
```
（Plan 步骤 1 写的是「静态 import」，实际用动态 `import()`：Plan 步骤 5② 的 seam 要求如此。默认解析到同一个真实模块路径，语义等价；不设环境变量时跑的就是真树模块。）
断言段形态：`countingJudge(...)` 的 `judge.calls.length`（调用计数）+ `registryWith(syntheticEntry(kind, admission))` 的 2×2 交叉表——与 sibling 的「reason 前缀/registry 取值/源码文本」形态不同。

## ADR-007 暗轴记录

该轴仍暗，理由：本任务只新增一个测试文件 `plugin/test/admission-dispatch.test.mjs`，零生产代码、零依赖边改动（被测模块是只读消费），L_D/L_G 无本任务可归因的读数；archguard 主检出快照已陈旧（generatedAt 2026-10-22T21:42 早于 HEAD a2754dbc5），其读数不能归给本任务。

## Touches

- plugin/test/admission-dispatch.test.mjs (new)
- tasks/gap-ac925-admission-dispatch-criterion-test.md