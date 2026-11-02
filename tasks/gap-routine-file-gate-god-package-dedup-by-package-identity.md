---
id: gap-routine-file-gate-god-package-dedup-by-package-identity
title: "routine-file-gate: god-package dedup 键用包身份而非精确符号集（4 sibling 已点名、0 次立案的缺口）"
status: ready
labels:
  - gap
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
`plugin/scripts/routine-file-gate.ts` 的 dedup subject 键 = 精确符号集（`findingSubjectKey`，
`routine-file-gate.ts:84-92`，边界声明 :60-68）。对 `dupKind: god-package` 这一键不收敛：archguard
每轮对同一根 god-package 采样出不同的观测符号集 ⇒ 同一包跨轮不被 dedup、只被 rate 兜底。

实证（`.quay/routine-findings.jsonl`，可重放）：`god-package-plugin-scripts` 三轮三个符号集
（10-22 `…readjsonlines,readjsonllines` / 10-30 `…isstaticcheckfailureline,extractstaticcheckdetail` /
11-02 `runopensemanticdiscovery,runresidentloop,withperfilecpupreload`），两两无整集相等；
`god-package-quay-src-root` 同样第三轮立案。4 个 sibling disposition（flat-god-directory /
god-package-plugin-scripts / god-package-quay-src-root / god-package-core）均已点名本增量，
但从未立成任务 ⇒ 缺口跨轮存活、由 rate 而非 dedup 兜底。

## Requested action
`routine-file-gate.ts` 对 `dupKind: god-package` 用包身份（`files` 的公共目录前缀，如
`plugin/scripts`）做 dedup subject 键，不再用精确符号集；已 disposition 的包名走抑制表。

## AC
- [x] `routine-file-gate.ts` 对 `dupKind: god-package` 的 finding 用包身份（公共目录前缀）计算 dedup 键，`findingSubjectKey`/`findingKey` 对 god-package 不再返回 `symbols:<set>` 形键
- [x] 可核回放：`.quay/routine-findings.jsonl` 里 `god-package-plugin-scripts` 的三轮 finding 记录（runId `architecture-analysis-1792599464308` / `-1793401956536` / `-1793622670475`）在新键下收敛为同一键（`recurrenceByKey` 或等价读法把三轮归为 recurrence≥3）
- [x] 单测覆盖 god-package 键收敛 + 非 god-package 键不变（fixture-pinned，`routine-file-gate.test.mjs`）

## DoD
- [x] 上面的判据实跑通过
- [x] 修复后的 dedup 键对既有 `god-package-plugin-scripts` / `god-package-quay-src-root` 三轮记录收敛为同一键（可重放 `recurrenceByKey`）
- [x] ⛔ 探针只立案不执行：本修复由派发链（worker）执行，不由例程代跑

## Touches
- `plugin/scripts/routine-file-gate.ts`
- `plugin/test/routine-file-gate.test.mjs`
- `tasks/gap-routine-file-gate-god-package-dedup-by-package-identity.md`

## ADR-007 dark axis
- 该轴仍暗,理由:本修复只改 routine-file-gate 的 dedup 键（god-package→包身份），不移动包/依赖结构，L_D/L_G 读数不因本任务变化