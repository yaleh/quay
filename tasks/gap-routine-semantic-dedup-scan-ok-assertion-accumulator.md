---
id: gap-routine-semantic-dedup-scan-ok-assertion-accumulator
title: "semantic-dedup-scan: Both declare a module-level failures counter plus a
  byte-identical ok(cond,msg) PASS/FAIL printer and neither uses
  gate-script-base's emitPass/emitFail; the th"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Both declare a module-level failures counter plus a byte-identical ok(cond,msg) PASS/FAIL printer and neither uses gate-script-base's emitPass/emitFail; the third ok() in control-plane-http.ts is an unrelated MCP response helper.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794222946369` · ts `2026-11-09T11:15:46.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`ok`
- 涉及文件：
- `plugin/scripts/codex-stage1-live-proof-audit.ts:39`
- `plugin/scripts/codex-stage1-live-proof-check.ts:38`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-09T11:15:46.369Z

## Plan
`extract`（与 finding 的 requested action 一致，并与本仓库既有处置惯例一致 —— `sleep` / `norm` /
`appendJsonlLineStrict` / `appendJsonlRecords` 等 finding 都是把逐字相同的私有副本收进
`plugin/scripts/gate-script-base.ts`，载体导入共享定义）：

1. 在 `gate-script-base.ts` 新增 `createAssertionAccumulator()`：逐条断言打印器 + 失败计数 + 末尾汇总，
   **委托** `emitPass`/`emitFail` 发出每条 `PASS: `/`FAIL: ` 行（输出拼写与 stdout/stderr 分流保持单源），
   计数与退出码映射留在本处。
2. 两个载体删掉私有的 `let failures = 0` + `ok()`，改为 `const { ok, report } = createAssertionAccumulator()`
   并 `process.exit(report({pass, fail}))`；各自保留自己的汇总句（`AUDIT PASS:` / `SHAPE-ONLY PASS:` ——
   两句话含义不同，是载荷，不得统一）。
3. 在 `plugin/test/gate-script-base.test.mjs` 按既有抽取惯例补四类判据：谓词对抽取前样本的干跑（防空转）、
   family-wide「全树不再声明该打印器」、载体「导入且调用」而非删除、以及**逐字节 oracle**（新旧实现
   在同批断言上 stdout/stderr/退出码完全一致）。

⚠️ 为什么不是「直接改用 emitPass/emitFail」：`emitFail` 每次调用**返回**退出码 1，而 shape/tally 校验器必须
把**全部**违例报完再定结局 —— 退出码属于运行末尾，不属于单条断言。故共享件必须自带计数，只在**行**这一层
复用 verdict emitter。

## Evidence

**处置结论：已修掉（extract），非「已注意到」。** 主体提交 `f89cfa1c4`。

1. **重复确实存在、且已消失（同一谓词两侧都取过值，硬规则 2 两半都做）**：
   `if(cond)console.log(`PASS:${msg}`);else{failures++;console.error(`FAIL:${msg}`);}`（去空白后）
   对一个【已知为真】的样本干跑 —— `git show develop:plugin/scripts/<f>`：
   `codex-stage1-live-proof-audit.ts` 抽取前 `true` / 抽取后 `false`；
   `codex-stage1-live-proof-check.ts` 抽取前 `true` / 抽取后 `false`；`gate-script-base.ts` 抽取后 `false`
   （共享件已委托 emitter，不再复述打印体）。
2. **family-wide 零命中（硬规则 5b 的兄弟实例清扫）**：同一谓词扫 `plugin/scripts`(334) + `plugin/test`(707)
   + `packages/quay/src`(196) + `packages/quay-native/src`(6) + `packages/quay-github/src`(3) = **1246 个文件，
   命中 0**。该零不是空转：同一个谓词对两具已知为真的抽取前样本读 `true`。
3. **行为未漂移（逐字节 oracle）**：把 `develop` 上的抽取前三个文件还原到临时目录，与改动后同跑
   `.quay/codex-stage1-evidence-template.json`（该记录必然大量 FAIL）：
   - `codex-stage1-live-proof-check`：exit 均 1；stdout 46 行 **IDENTICAL**；stderr 2 行 **IDENTICAL**
   - `codex-stage1-live-proof-audit`：exit 均 1；stdout 1 行 **IDENTICAL**；stderr 11 行 **IDENTICAL**
   通过路径由既有 e2e `plugin/test/codex-stage1-adapter.test.mjs` 覆盖：**33/33 pass**（含 E1「完整记录 exit 0」
   与 F3「真记录过 truth audit」）。
4. **新判据自证可取值**：`plugin/test/gate-script-base.test.mjs` **98/98 pass**，其中新增 7 条 ——
   谓词干跑（含 3 个不同契约的负样本：`createSelftest` counters、`makeCliFail`、`control-plane-http` 的
   `ok(payload)`）、全树零声明、两载体「导入 + 调用 + `process.exit(report(`」、输出流与退出码、
   `ok()` 不 fail-fast、逐字节 oracle、以及「删掉共享导出则载体 import 链接失败」（机制为真）。
5. **未纳入本次抽取的三个 `let failures = 0`**（`malformed-task-check.ts:116` /
   `test-impl-census-check.ts:170` / `ci-red-attribute.ts:482`）：均为函数作用域的 `--selftest` 计数或
   归因计数，不携带 `ok(cond,msg)` PASS/FAIL 打印体（谓词对它们读 `false`），**契约不同，不折叠**。

## Dark axis (ADR-007)
- L_G archguard: cycles=0（`archguard-runner.ts --root .` exit 0；6/6 scope 均 `entitySccCount=0`、`directoryCycleCount=0`）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `ok-assertion-accumulator`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794222946369`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/codex-stage1-live-proof-audit.ts`
- `plugin/scripts/codex-stage1-live-proof-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-ok-assertion-accumulator.md`
