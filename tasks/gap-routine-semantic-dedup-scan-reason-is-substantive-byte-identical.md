---
id: gap-routine-semantic-dedup-scan-reason-is-substantive-byte-identical
title: "semantic-dedup-scan: Bodies are character-identical and both compare
  against a locally re-declared MIN_REASON_CHARS = 8;
  semantic-face-dispatch-record imports only isDirectEntry, s"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Bodies are character-identical and both compare against a locally re-declared MIN_REASON_CHARS = 8; semantic-face-dispatch-record imports only isDirectEntry, so the two thresholds can drift independently.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792647604889` · ts `2026-10-22T05:40:04.889Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`reasonIsSubstantive`、`MIN_REASON_CHARS`
- 涉及文件：
- `plugin/scripts/dispatch-record.ts:102`
- `plugin/scripts/semantic-face-dispatch-record.ts:89`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `reason-is-substantive-byte-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792647604889`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/dispatch-record.ts`
- `plugin/scripts/semantic-face-dispatch-record.ts`
- `plugin/scripts/gate-script-base.ts`
- `tasks/gap-routine-semantic-dedup-scan-reason-is-substantive-byte-identical.md`

## Evidence
**处置：修掉（merge，不是「已注意到」）。** finding 的两个 `reasonIsSubstantive` 函数体逐字相同，
两处各自 `export const MIN_REASON_CHARS = 8`，且互不引用 ⇒ 阈值可独立漂移。

- **单一真相源**：`MIN_REASON_CHARS` + `reasonIsSubstantive` 现在只在
  `plugin/scripts/gate-script-base.ts:587,589` 定义一次（两个调用方本来就 import 该模块的
  `isDirectEntry`，无新 import 边；与 `printJson` 抽取先例 79829f2b8 同处置）。
- **历史 import 面保留**：`dispatch-record.ts:51` 与 `semantic-face-dispatch-record.ts:85` 改为
  `export { MIN_REASON_CHARS, reasonIsSubstantive }` 再导出，checker
  (`dispatch-record-fingerprint-reason-check.ts:46`) 与两个测试文件的 import 路径不变。
- **漂移不再可能**：两处不再是两个权威，改任一处即同时改两处（本任务正是修掉「两个阈值可独立漂移」）。

**实跑证据（不是回显）**：
- 单测：`node --experimental-strip-types --test plugin/test/dispatch-record-fingerprint-reason-check.test.mjs plugin/test/semantic-face-dispatch-record.test.mjs` ⇒ tests 30 / pass 30 / fail 0。
- 行为保持（两个 writer CLI 直跑）：
  - `dispatch-record.ts --add --reason "x"` ⇒ exit 1（thin，fail-closed）；`--reason "这是一个足够长的真实理由"` ⇒ exit 0。
  - `semantic-face-dispatch-record.ts --add --kind learning --reason "x"` ⇒ exit 1；长理由 ⇒ exit 0。
- 实现提交：`6d74650fb`（worktree 分支 `task/gap-routine-semantic-dedup-scan-reason-is-substantive-byte-identical`）。

**硬规则 5b 扫描（同一原则，plugin/scripts + packages，排除 node_modules）**：
- 改前 `MIN_REASON_CHARS = ` 声明 3 处：`dispatch-record.ts:48`、`semantic-face-dispatch-record.ts:80`、
  `phase-declare.ts:106`。
- 改前 `function reasonIsSubstantive` 函数体 2 处：上述前两个文件。
- 改后：函数体 1 处（`gate-script-base.ts:589`）+ 2 处再导出；`MIN_REASON_CHARS` 1 处 + 2 处再导出。
- **声明的不合并点**：`phase-declare.ts:106` 的 `MIN_REASON_CHARS = 8` 治理的是**另一个对象**
  （phase 声明的 `--reason`），且没有 `reasonIsSubstantive` 函数体，不属本 finding 的
  `byte-identical-body` 类；强行耦合会让 phase-declare 的拒绝文案依赖 dispatch-record 的概念，
  故保留并在 `gate-script-base.ts:584` 就地写明理由。
