---
id: gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red
title: fan-in baseline comparison parses only TAP 'not ok' — spec-reporter ✖ /
  'test at file:line' ⇒ not-evaluated ⇒ develop-wide red misparked as
  unattributable needs-human
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Fan-in misattributes a develop-wide red as "unattributable" and parks a healthy task (2026-10-13 02:21 +0800).** After a red suite, fan-in compares the failure signatures against a develop baseline run, so that a red develop already carries is exempt. `plugin/scripts/worker-fan-in.ts` `parseFailureSignatures` (:1007) extracts signatures only from TAP shapes (`^not ok [N] - <head>: <detail>` …). The real suite output is node's spec reporter: `✖ <test name> (<ms>)` under `✖ failing tests:`, and identity is given by `test at <file>:<line>:<col>`.

Production reading:
- the suite log `.quay/fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~1791828953643-00613d.log` has 0 `^not ok` lines, 5 `✖` lines and 2 `test at plugin/test/prod-data-audit.test.mjs:<line>` lines;
- the baseline log `…~baseline-1791829214376-1ab3bd.log` has the SAME 2 `✖` failing tests.

Even so, the fan-in step `baseline-red` returned `verdict:"not-evaluated", reason:"baseline-side signatures unevaluable: no-failure-signature-lines"`. Two rounds later the task was stopped and flipped to needs-human with the text 「失败无法归因」. In the same breath that text says the parser attributed 1 failing file. A red develop already carries should have been recognised as develop-wide (identical on both sides), not as an infrastructure mystery.

## Plan
1. The signature extractor recognises spec-reporter output:
   - the `✖ failing tests:` block;
   - each `test at <file>:<line>:<col>` paired with its following `✖ <name>` line;
   - the error code line (e.g. `code: 'ERR_…'`) as detail where present.
   Identity = (file, test name); `:line` is informative only, because line numbers drift between branches.
2. The TAP path stays unchanged. Mixed output (TAP + spec) yields the union, deduplicated.
3. The stop/needs-human text must not say "could not be attributed" when the parser attributed ≥1 file. Name the true state, e.g. `baseline comparison not evaluated: <reason>`.

## Acceptance Criteria
- [x] AC1: a unit test feeds the extractor a verbatim excerpt of the production spec-reporter block (two `test at …prod-data-audit.test.mjs:N:1` + `✖` pairs) ⇒ `evaluated:true` with 2 signatures. The same excerpt on both sides ⇒ the comparison reports develop-wide (identical). Paste.
- [x] AC2: format negative controls, each pasted:
  - (a) a spec log with NO `✖` and no `test at` ⇒ still `not-evaluated: no-failure-signature-lines`, so an absent signal is never read as "identical";
  - (b) a branch-side spec failure that the baseline lacks ⇒ NOT exempt;
  - (c) existing TAP fixtures give byte-identical results;
  - (d) remove the spec branch from the extractor ⇒ AC1 goes red.
- [x] AC3: replay of the real 2026-10-13 pair: running the comparison on the two production logs named above yields "identical / develop-wide". Paste the verdict JSON.
- [x] AC4: the needs-human/stop wording no longer contains 「无法归因」 when the attributed-file count is ≥ 1. Unit test plus pasted rendered text.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.
- The anti-drift, suite and baseline gates are not softened: a branch-only red still blocks.

## Touches
- tasks/gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red.md
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-fan-in-baseline-red.test.mjs

## 证据（每条 AC 的真实读数）

实现提交 `6c0d1d0cc`（分支 `task/gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red`；其后并入 `develop` 的合并提交 `a523c9ab4`）。测试文件 `plugin/test/worker-fan-in-baseline-red.test.mjs` 新增 6 条用例（AC1 / AC2(a,b,c) / Plan-2 / AC4），全文件 15 条全绿。

### AC1 — 生产 spec 块的逐字摘录 ⇒ 2 条签名；两侧相同 ⇒ develop-wide

摘录用例内常量 `PROD_SPEC_BLOCK` = 生产日志 `…~1791828953643-00613d.log` 第 6005–6056 行的 `✖ failing tests:` 块逐字副本（2693 B / 34 行，两对 `test at …prod-data-audit.test.mjs:N:1` + `✖`）。解析读数：

```
task  = { "evaluated": true, "signatures": [
  { "file": "plugin/test/prod-data-audit.test.mjs",
    "text": "AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks [code: ERR_STRING_TOO_LONG]" },
  { "file": "plugin/test/prod-data-audit.test.mjs",
    "text": "AC1 explicit carriers are always reported even at zero position-based refs [code: ERR_STRING_TOO_LONG]" } ] }
base  = 同一份摘录（root 换成另一棵树）⇒ 逐字相同
compareFailureSignatures(task, base) =
  { "kind": "exempt", "unchanged": 2,
    "signature": "plugin/test/prod-data-audit.test.mjs\u0000AC1 explicit carriers are always reported even at zero position-based refs [code: ERR_STRING_TOO_LONG]\nplugin/test/prod-data-audit.test.mjs\u0000AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks [code: ERR_STRING_TOO_LONG]" }
```

`:line`（227 / 309）与耗时（15439.958259ms / 17136.819347ms）都**不**入身份——用例逐字断言 `doesNotMatch(/15439/)` 与 `doesNotMatch(/:227/)`：前者每次运行都变，后者跨分支漂移。用例另断言**真实形态**（任务侧是整份 suite 日志、多一条 `__PERFILE__ … passed=false`；基线侧是失败文件重跑、没有它）仍给出同一签名集合。

### AC2 — 四个格式负控

(a) 无 `✖`、无 `test at` 的 spec 形态日志：

```
parseFailureSignatures("ℹ tests 10\nℹ pass 10\nℹ fail 0\nℹ duration_ms 100\n") = { "evaluated": false, "reason": "no-failure-signature-lines" }
parseFailureSignatures("✖ failing tests:\n\n✖ some failing name (12.5ms)\n")     = { "evaluated": false, "reason": "no-failure-signature-lines" }
```

第二行是「不伪造」那一半：**没有 `test at` 配对的 `✖` 行不落签名**（文件级汇总里的独立 `✖` 行与块头 `✖ failing tests:` 都不带文件身份）。

(b) 分支侧独有的一条 spec 失败 ⇒ `hard-red / task-introduced-red`，`added = ["plugin/test/mine.test.mjs"]`；同一 spec id 但错误码变了（`ERR_STRING_TOO_LONG` → `ERR_OUT_OF_MEMORY`）⇒ `hard-red / changed-assertion`，`changed` 点名两个文件（⛔ 不折成新 id）。

(c) 既有 TAP / `__PERFILE__` 夹具逐字不变（`redLog` 单签名、两行 `not ok` 双签名、混合行序、三态 reason），**且本用例刻意不依赖 spec 分支**——见 (d) 的变异臂，它在变异下仍绿。

(d) 变异臂：把 `plugin/scripts/worker-fan-in.ts` 的 `SIG_TEST_AT_RE` 换成永不匹配的 `/^(?!)/`（= Plan 第 1 条被移除后的解析器），在同目录跑同一份用例：

```
=== MUTATION ARM (spec branch REMOVED: SIG_TEST_AT_RE => /^(?!)/) ===
✖ AC1 (spec positive control) — ... reads develop-wide (exempt)
✔ AC2(a) (negative control) — ... stays not-evaluated (an absent signal is never read as 'identical')
✖ AC2(b) (negative control) — ... is NOT exempt (task-introduced-red)
✔ AC2(c) (negative control) — the existing TAP/__PERFILE__ fixtures give byte-identical results
✖ Plan-2 (mixed output) — ... the deduplicated union of both extractors

  AssertionError [ERR_ASSERTION]: spec block must be evaluable,
    got {"evaluated":false,"reason":"no-failure-signature-lines"}

=== CONTROL ARM (unmutated) ===
✔ ×5（同上五条）
```

失败值 `{"evaluated":false,"reason":"no-failure-signature-lines"}` 就是生产事故里基线侧的**同一个**读数——变异臂逐字复现了缺陷。

### AC3 — 真实 2026-10-13 那一对日志的重放

对 `.quay/` 下两条生产日志（只读，+0800 2026-10-13 02:21 那次 fan-in 写下的那两份）跑本分支的 `parseFailureSignatures` + `compareFailureSignatures`：

```
{
 "task log": "fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~1791828953643-00613d.log",
 "baseline log": "fan-in-suite-gap-discovery-method-per-round-quota-verify-reserve-deep-reflection~wk-prod-anchor~baseline-1791829214376-1ab3bd.log",
 "taskSide":  { "evaluated": true, "signatures": [ …2 条，与 AC1 逐字相同… ] },
 "baselineSide": { "evaluated": true, "signatures": [ …同 2 条… ] },
 "verdict": { "kind": "exempt", "unchanged": 2,
   "signature": "plugin/test/prod-data-audit.test.mjs\u0000AC1 explicit carriers are always reported even at zero position-based refs [code: ERR_STRING_TOO_LONG]\nplugin/test/prod-data-audit.test.mjs\u0000AC1/AC2/AC3/AC5/AC6 REAL-CARRIER — audit against production reproduces manager re-checks [code: ERR_STRING_TOO_LONG]" },
 "develop-wide?": true
}
```

逐字等于 fan-in 的 `baseline-red-exempt` 出口（`verdict.kind === "exempt"` ⇒ 落绿块、继续 typecheck/ff），即事故里的 `not-evaluated: no-failure-signature-lines` 已被消掉。同一次运行里任务侧的 **3** 条候选签名收敛为 **2** 条：文件级 `__PERFILE__ … passed=false`（无测试身份、`text` 为空串）被同文件的测试级 spec 签名**吸收**——那只是「整份 suite 日志 vs 失败文件重跑」的**记录粒度差**，⛔ 读成 `task-introduced-red` 会造出假红。

### AC4 — 归因到 ≥1 个失败文件时判词不再说「无法归因」

用例用生产那条 outcome 的**逐字**形状（`mechanical_fan_in.baselineEquivalence.verdict = {"kind":"not-evaluated","reason":"baseline-side signatures evaluable…"}` 的实际值 `baseline-side signatures unevaluable: no-failure-signature-lines`；`failingTestFiles = ["plugin/test/prod-data-audit.test.mjs"]`；上一轮同类 prior ⇒ 落 stop-terminal），渲染两臂：

```
AC4 arm A (failingTestFiles 非空):
exited-not-landed：suite 红已归因到 1 个失败文件（plugin/test/prod-data-audit.test.mjs）——这些红点没能被判为既存红（基线比较 / 落地未通过）⇒ 停止重派，⛔ 不再拿新会话撞同一堵墙：suite red was attributed to 1 failing file(s) (plugin/test/prod-data-audit.test.mjs) but could not be cleared as pre-existing red in 2 consecutive rounds (bounded to at most one retry) — baseline comparison not evaluated: baseline-side signatures unevaluable: no-failure-signature-lines — stopping instead of spending another worker session

AC4 arm B (failingTestFiles 为空):
exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect; stopping instead of spending another worker session
```

臂 A 断言 `doesNotMatch(/无法归因/)` 且 `match(/baseline comparison not evaluated: …/)`；臂 B 是反向控制（确实一个也没归因出 ⇒ 旧措辞仍在），两臂输出必须不同。⛔ 词表按**字面量**查，故臂 A 里连「不是『无法归因』」这种否定式引用都不写——否则该词仍「在场」。

### DoD

`bash scripts/test.sh --for-task gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red --allow-thin` ⇒ `ℹ tests 152 / ℹ pass 152 / ℹ fail 0`，exit 0。anti-drift：`ANTI-DRIFT OK — 3 actual file(s), all within declared Touches (4 glob(s))`，exit 0。**闸没被放宽**：AC2(b) 证明分支侧独有的一条 spec 失败仍然硬红（`task-introduced-red`），`exempt` 出口逐字未动。
