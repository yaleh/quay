---
id: gap-gate-script-base-behavior-contract-unusable
title: 共享基座的行为契约无人取用（emitPass/emitFail 0 处、parseArgs 5/88），120 个 checker
  各自手搓退出码——先修接口让它装得下真实 checker 形状，再谈迁移
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现场实测（2026-09-04）**：`plugin/scripts/` 有 **120 个 checker**，全部实现同一份契约（解析参数 →
求值 → 输出裁决 → 按约定退出码退出）。这份契约是**真实且被机械验证**的——实跑
`checker-mechanical-spine-check.ts --json` → `{"ok": true, "checkers": 114}`。共享基座
`gate-script-base.ts`（201 行）确实存在、被广泛 import。但取用分布是：

| 基座导出 | 取用文件数 | 性质 |
|---|---|---|
| `isDirectEntry` | 100 | 样板 |
| `helpExit` | 50 | 样板 |
| `parseArgs` | **5**（另 83 个手搓 `process.argv`） | **行为契约** |
| `emitPass` / `emitFail` | **0**（83 个手搓 `process.exit`/`exitCode`） | **行为契约** |

**⇒ 共享的是帮助文本和入口判断，不是行为。参数解析 94% 手搓，裁决输出 100% 手搓。**

**这个缺失的抽象有可点名的账单**：CLAUDE.md 硬规则 3b 记录，判定机件在**读不懂输入时**返回了与
**合格**同形的值——一天内三个互不相关的机件同时中招（`task-status-drift-check.ts:126`、
`slot-refill.ts:373`、`outer-tick-log-check.sh` 每条分支都跳过却打印 PASS）。**这三个缺陷之所以
可能发生，正是因为每个 checker 自己手搓裁决输出**；若裁决必须经由基座的
`emitPass`/`emitFail`/`emitNotEvaluated`（第三态是一等公民），"读不懂 ⇒ 输出得像合格"在结构上做不到。

**范围声明（本任务只做接口，不做 120 文件迁移）**：`emitPass`/`emitFail` 取用为 0，最可能的解释
**不是"大家偷懒"，而是接口装不下真实 checker 的形状**（多数 checker 要输出结构化 `--json`
verdict、要带 violations/exemptions 列表、要区分三态，而 `emitPass(message)` 只收一个字符串）。
**所以第一步是修接口，不是催迁移**——先让契约能装下现有 114 个通过机械验证的 checker 的真实输出
形状，迁移作为后续任务（其 Touches 宽度需分批，不在本任务内）。

**本任务不声明 `extra.consolidates`**：它本身不消灭任何重复实现，只是让后续消灭成为可能。
按 [[gap-dispatch-value-has-no-consolidation-axis]] 的反刷分要求，**没有真实收敛就不该拿那条轴的
权重**——此处按该纪律执行，作为该机制的第一个正面用例。

## AC

- [x] AC1（先量清楚接口为什么装不下）：抽样 ≥10 个现有 checker 的裁决输出路径，列出它们各自实际
      产出的形状（纯文本 / 结构化 JSON / violations 列表 / 三态），并对照 `emitPass(message)` 的
      现有签名，逐条说明装不下的具体原因——贴真实代码片段，不是概括
- [x] AC2：重设计基座的行为契约，使其能装下 AC1 列出的全部形状，且**必须包含 not-evaluated 第三态**
      （硬规则 3b：无法评估不得与合格同形）；新接口须能表达 `--json` 结构化 verdict
- [x] AC3（用真实 checker 验证接口可用，不是用 fixture）：把 **≥5 个真实 checker** 迁移到新接口
      （挑选覆盖 AC1 里不同输出形状的样本），迁移后它们的
      `checker-mechanical-spine-check.ts --json` 仍报 `ok:true`，且各自既有单测全绿
- [x] AC4（取用率真实上升，可核验）：`grep -rl "emitPass\|emitFail" plugin/scripts/*.ts | wc -l`
      从 **0** 升到 ≥5（贴改动前后真实输出）——这条是本任务是否真的落地的硬判据
- [x] AC5：`bash scripts/test.sh` 全量绿

## DoD

AC1 的形状清单（真实代码片段）、AC4 的 0→≥5 前后读数贴进任务体。**不是"改好了接口"就算**——
接口若无人取用，它就是今天这个状态的第二版；AC3/AC4 要求用 ≥5 个真实 checker 证明新接口装得下，
否则本任务的产出与现状不可区分。迁移剩余 checker 属后续任务，不在本 DoD 内。

## Evidence（落地实录）

### AC1 — 抽样 10 个 checker 的裁决输出形状 vs 旧 `emitPass(message: string): void`

旧签名只收一个字符串、只 `console.log` 一行、不返回退出码。以下 10 个真实 checker 的裁决输出
（均摘自当前 `plugin/scripts/*.ts` 真实代码）逐条说明装不下的原因：

| checker | 裁决输出形状（真实片段） | `emitPass(message)` 装不下的原因 |
|---|---|---|
| `checker-mechanical-spine-check.ts` | `--json` 出 `JSON.stringify({ ok, checkers, exemptions, violations, unexempted, ratchetAdded })`；人类态 `PASS: …` / `console.log(\`FAIL: ${result.unexempted.length} unexempted violation(s):\`)` + 逐条 `console.log(\`  - ${v.checker} (${v.dimension}): ${v.detail}\`)` | 只收字符串；violations 结构化列表 + 多行 detail + `--json` 都装不下 |
| `task-status-drift-check.ts` | 探测器恒 `return 0`；`--json` 出 `{suspects, reverse, closedWithoutWork, strandedTasks, stranded, scanned}`；三态靠 `countAcCheckboxes` 返回 `{ total: NaN, checked: NaN, unchecked: NaN, sectionFound: false }` | 无 pass/fail 二值（探测器）；第三态用 `sectionFound:false`+`NaN` 兜底，非一等公民 |
| `anti-drift-touches-check.ts` | 门禁 `process.stdout.write(\`ANTI-DRIFT OK: task ${taskId} — ${actualFiles.length} actual file(s)…\`)` / `ANTI-DRIFT HARD FAIL: … ${r.violations.length} violation(s)`，violation 形 `{type:"out-of-declared", build, file}` | violations 对象列表 + 自定义前缀装不下 |
| `task-contract-check.ts` | `--json` 出 `{violations:[{file,code,what}], info, ratchet:{…}}`；人类态 `console.log(\`VIOLATION: ${t.file} — ${v.code}: ${v.what}\`)` | violations 结构化列表 + ratchet 对象装不下 |
| `dual-source-check.ts` | `runCheck` 返回 `{ok, issues:string[]}`；人类态 `OK — …` / `console.error(\`dual-source-check: RED (${issues.length} issue(s))\`)` + 逐条 | issues 列表装不下（join 成串丢结构化） |
| `obligation-ledger-check.ts` | `checkLedger` 返回 `{ok, violations:string[], roundCount, notes}`；`PASS` / `FAIL — ${result.violations.length} ledger-integrity violation(s):` + 逐条 | violations 列表 + 计数装不下 |
| `check-set-after-change-check.ts` | `--json` 出 `{ok, failures, cases, declarations}`；人类态 `PASS — …` / `RED — …` | failures/cases 结构化装不下 |
| `concurrency-literal-check.ts` | 多模式 `--scan`/`--gate`；`--json` 出 `{mode, ok, surface, hits, violations}`；`PASS` / `FAIL — ${violations.length} undeclared concurrency literal(s)` | 多模式 + hits/violations 结构化装不下 |
| `spec-declaration-point-check.ts` | 三态 `{ok, evaluated, notEvaluatedReason, specs, declarationPoints}`；`return 3`（NOT-EVALUATED）/ `return 1` / `return 0`；人类态 `PASS:`/`RED:`/`NOT-EVALUATED:` | 无第三态；`--json` 手搓；三态 exit 3 手搓，与 usage-error 的 exit 2 分列靠人记 |
| `touches-orthogonality-check.ts` | 多模式 `DISJOINT: …` / `OVERLAP: …` / `RESOLVE …` / `SELF-TOUCH …` / `BENIGN (reason)`，`return 0/1/2` | 结构化 reason + 多模式装不下 |

共同根：**裁决输出 = 「三态状态 + 结构化 payload + 退出码」三件套，旧 `emitPass(message)` 只覆盖「一行
人类文本」这一件**。故 94% 参数解析、100% 裁决输出各自手搓是结构必然，不是偷懒。

### AC2 — 新接口（`gate-script-base.ts`，双副本 byte-identical）

```ts
export type VerdictStatus = "pass" | "fail" | "not-evaluated";
export interface Verdict { status: VerdictStatus; message: string; detail?: unknown; }
export interface EmitOptions { json?: boolean; stream?: "stdout" | "stderr"; }
export const VERDICT_EXIT_CODE = { pass: 0, fail: 1, "not-evaluated": 3 };
export function emitVerdict(verdict, opts?): number;   // 人类 `PASS:`/`FAIL:`/`NOT-EVALUATED:` 或 --json `{status,ok,message,...detail}`；返回退出码
export function emitPass(message, detail?, opts?): number;
export function emitFail(message, detail?, opts?): number;
export function emitNotEvaluated(message, detail?, opts?): number;
```

- 装得下全部形状：`detail` 任意结构化 payload 并入 `--json`（violations 列表 / 计数 / 三态字段）。
- 第三态一等公民：`emitNotEvaluated` → `NOT-EVALUATED:` + exit 3（harness 统一约定
  `gap-not-evaluated-harness-third-state`；机械脊柱词表 {0,1,2,3} 中 3=NOT-EVALUATED，与合格不同形、与 fail 也不同形）。
- 三态收敛既有 `driver-result.ts` 的 `DriverResult<T>` 词表（verified↔pass / failed↔fail /
  not-evaluated↔not-evaluated），非新造第三态。
- 退出码由基座持有（`emit*` 返回退出码），checker 不再自造三态 exit 码。

### AC3 — 迁移 5 个真实 checker（覆盖 AC1 不同形状）

| checker | 覆盖的形状 | 迁移点 |
|---|---|---|
| `dual-source-check.ts` | issues 列表（纯文本） | `main()` 终端 OK/RED → `emitPass`/`emitFail(…, {issues})` |
| `obligation-ledger-check.ts` | violations 列表 + fail-open | `PASS`/`FAIL` → `emitPass`/`emitFail(…, {violations, roundCount})` |
| `checker-mechanical-spine-check.ts` | 结构化 JSON + violations | 人类态终端 `PASS:`/`FAIL:` → `emitPass`/`emitFail`（`--json` 保留原 `JSON.stringify`） |
| `ac36-sortkey-criterion-check.ts` | `{ok, reason[], checks}` 结构化 + `--json` | 终端 PASS/FAIL（含 `--json`）→ `emitPass`/`emitFail(…, result, {json})` |
| `spec-declaration-point-check.ts` | **三态** pass/fail/not-evaluated + `--json` | `return 3`/`1`/`0` + 手搓 `NOT-EVALUATED:`/`PASS:`/`RED:` → `emitNotEvaluated`/`emitPass`/`emitFail` |

迁移后 `checker-mechanical-spine-check.ts --json` 仍 `{"ok":true,"checkers":114,"violations":[],"unexempted":[],"ratchetAdded":[]}`；
5 个 checker 的既有单测 + 新增 `gate-script-base.test.mjs`（10 例）全绿。

### AC4 — 取用率前后读数（真实输出）

```
# 改动前
$ grep -rl "emitPass\|emitFail" plugin/scripts/*.ts | wc -l
1        # 只有定义站 gate-script-base.ts 自身（0 个消费者）

# 改动后
$ grep -rl "emitPass\|emitFail" plugin/scripts/*.ts | wc -l
6
$ grep -rl "emitPass\|emitFail" plugin/scripts/*.ts
plugin/scripts/ac36-sortkey-criterion-check.ts
plugin/scripts/checker-mechanical-spine-check.ts
plugin/scripts/dual-source-check.ts
plugin/scripts/gate-script-base.ts
plugin/scripts/obligation-ledger-check.ts
plugin/scripts/spec-declaration-point-check.ts
```

消费者（排除定义站）从 **0 → 5**，满足 AC4 的 ≥5 硬判据。

## Touches

- plugin/scripts/gate-script-base.ts（行为契约重设计，vendored mirror）
- experiments/quay-perpetual-stream/scripts/gate-script-base.ts（vendored SOURCE，双副本一致）
- plugin/scripts/checker-mechanical-spine-check.ts（契约验证器随之对齐）
- plugin/scripts/dual-source-check.ts（迁移）
- plugin/scripts/obligation-ledger-check.ts（迁移）
- plugin/scripts/ac36-sortkey-criterion-check.ts（迁移）
- plugin/scripts/spec-declaration-point-check.ts（迁移，三态）
- plugin/test/gate-script-base.test.mjs（新）
- plugin/test/checker-mechanical-spine-check.test.mjs
- tasks/gap-gate-script-base-behavior-contract-unusable.md
