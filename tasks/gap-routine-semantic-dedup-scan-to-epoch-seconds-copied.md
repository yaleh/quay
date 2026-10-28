---
id: gap-routine-semantic-dedup-scan-to-epoch-seconds-copied
title: "semantic-dedup-scan: Byte-identical Math.floor(Date.parse(iso)/1000),
  and the copier's own comment says it is 'the same conversion
  full-suite-runner.toEpochSeconds uses'; accountin"
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
Byte-identical Math.floor(Date.parse(iso)/1000), and the copier's own comment says it is 'the same conversion full-suite-runner.toEpochSeconds uses'; accounting-emit.ts:100 is a different, richer resolver and is not part of this cluster.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793162251891` · ts `2026-10-28T04:37:31.891Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`toEpochSeconds`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:455`
- `plugin/scripts/mirror-full-suite-state.ts:50`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:37:31.891Z

## 处置（disposition, 2026-10-28，由派发链执行，⛔ 非例程代跑）

按 `extract` 修掉，不是一个「已注意到」的结案：

- 单一实现落在 `plugin/scripts/gate-script-base.ts`：`export function toEpochSeconds(iso: string): number`，
  函数体仍是 `Math.floor(Date.parse(iso) / 1000)`（行为逐字保持：向下截断而非四舍五入；不可解析 ⇒ `NaN`，
  不被吞成伪造的 epoch）。
- 两处私有副本删除，改为导入：
  - `plugin/scripts/full-suite-runner.ts` — `import { flagValue, toEpochSeconds } from "./gate-script-base.ts"`；
    四个调用点不变（`finishedAt` 写入路径）。
  - `plugin/scripts/mirror-full-suite-state.ts` — `import { readJsonOrNull, toEpochSeconds } from "./gate-script-base.ts"`；
    `buildMirrorState` 的 `finishedAt` 调用点不变。
- `plugin/scripts/accounting-emit.ts` 的 `toEpochSeconds(v: unknown): number | null` **不动** —— finding 原文
  已注明它是 richer resolver、不属于该簇（归一化函数体与簇内成员不同）。

### 判据可假（同一谓词修复前后各取一次读数）

谓词（= probe 规格第 ① 步的归一化体摘要法）：对 `plugin/scripts/` + `packages/*/src/` 的每个模块级 function
取「去注释 / 去空白后的函数体」的 SHA-256，报告成员数 ≥2 的等价簇。

- BEFORE（`git show develop:` 取两份副本，簇面 2 文件）：`toEpochSeconds_clusters=1`，成员
  `full-suite-runner.ts:454` / `mirror-full-suite-state.ts:49`，归一化体同为 `returnMath.floor(Date.parse(iso)/1000);`
- AFTER（本 worktree 全表面，497 文件）：`toEpochSeconds_clusters=0`（`duplicate_body_clusters=87` 与本任务无关）；
  `toEpochSeconds` 的定义只剩 2 处且函数体不同 —— `gate-script-base.ts:1084`（共享实现）与
  `accounting-emit.ts:99`（簇外 richer resolver）。
- 旁证：`identity-replication-check.ts --root . --json` 修复后 `byteIdentical.count=0`（该仪器不报本符号，
  结论以归一化体谓词为准）。

### 测试产物

`plugin/test/gate-script-base.test.mjs` 新增 `toEpochSeconds: shared ISO→epoch-seconds conversion, no private copy left`：
行为断言（截断语义 / 1970 零点 / `NaN` 不被吞）+ 去重棘轮（两个簇文件不得再出现 `function toEpochSeconds(`，
且必须从 `gate-script-base.ts` 导入）。`plugin/test/mirror-full-suite-state.test.mjs` 既有的 epoch `finishedAt`
断言保持不变并通过（该文件正是复用这条转换的消费者）。

实跑读数：`plugin/test/gate-script-base.test.mjs` 83 pass / 0 fail；`plugin/test/mirror-full-suite-state.test.mjs`
7 pass / 0 fail；`scripts/test.sh --for-task gap-routine-semantic-dedup-scan-to-epoch-seconds-copied --allow-thin`
exit 0（133 tests, 0 fail，静态检查 tier 全绿）。

## ADR-007 dark axis

- L_G archguard-runner: scopes_evaluated=6 entityCycles=0 directoryCycles=0 scripts_entities=4773 scripts_relations=10796
    （`node --experimental-strip-types plugin/scripts/archguard-runner.ts --root .` exit 0；六个 scope 全部
    `evaluated=true`，本改动只新增一条 `full-suite-runner.ts → gate-script-base.ts` 的既有同层导入边，未引入环）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `to-epoch-seconds-copied`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793162251891`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/mirror-full-suite-state.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-to-epoch-seconds-copied.md`
