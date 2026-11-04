---
id: gap-routine-semantic-dedup-scan-invoked-directly-guard
title: 'semantic-dedup-scan: Identical
  isDirectEntry(import.meta,undefined,"<file>") try/catch-to-false guard
  differing only in filename literal across four files.'
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
Identical isDirectEntry(import.meta,undefined,"<file>") try/catch-to-false guard differing only in filename literal across four files.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793780123988` · ts `2026-11-04T08:15:23.988Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`invokedDirectly`
- 涉及文件：
- `plugin/scripts/freshness-producer-coverage-check.ts:611`
- `plugin/scripts/probe-fallback-path-check.ts:390`
- `plugin/scripts/serve-binding-literal-check.ts:232`
- `plugin/scripts/worktree-namespace-literal-check.ts:146`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:15:23.988Z

## 处置记录
- 复核：finding 点名的 4 个文件各带一份逐字相同（仅文件名字面量不同）的 `const invokedDirectly = (() => { try { return isDirectEntry(import.meta, undefined, "<file>"); } catch { return false; } })(); if (invokedDirectly) process.exit(main(process.argv.slice(2)));` 入口守卫；同 pattern 还存在于 finding 未点名的 `ls-mutation-reading.ts` 与 `registry-path-literal-check.ts`（后者为 `function invokedDirectly(): boolean` 声明形态），共 6 处（硬规则 5b 同载体 grep 命中数 = 6）。
- 处置：在共享底座 `gate-script-base.ts` 新增 `isDirectEntrySafe(expectedBase)`（try/catch-to-false 的单一实现），6 处调用点全部改为 `if (isDirectEntrySafe("<file>")) process.exit(main(process.argv.slice(2)));`，删除各自私有 `invokedDirectly`。6 处调用方本就 import `./gate-script-base.ts`，故无新增 import 边；处置后 `plugin/scripts/*.ts` 中已无任何 `invokedDirectly` 私有定义，唯一 try/catch 守卫留在共享 helper 内。
- 二次修复（suite 回归 `step=suite: oom-killed (4)` → `added=experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs`）：首版 `isDirectEntrySafe` 内部写成 `isDirectEntry(import.meta, undefined, expectedBase)`，`symlink-mirror-invocation.test.mjs` 的 `GUARD_PATTERN`（`/isDirectEntry\(import\.meta/`，按**代码位置**匹配，`buildNonCodeMask` 只屏蔽注释/字符串）因此把纯库 `gate-script-base.ts`（有 symlink mirror、无 CLI 块）误判为受守卫 CLI，其 no-args symlink 调用静默 exit 0 被断言为 silent no-op 而红。修复：`isDirectEntry` 的 `importMeta` 参数被刻意忽略（identity 按名字不按 URL，见其契约注释），wrapper 改传 `undefined as unknown as ImportMeta`、不再拼写 `import.meta`；实跑 `symlink-mirror-invocation.test.mjs` 49 pass 0 fail，`gate-script-base.ts` 不再被 `discoverMirroredTsSymlinks` 发现。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `invoked-directly-guard`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793780123988`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴

该轴仍暗,理由:本任务为纯去重抽取——gate-script-base.ts 新增共享 isDirectEntrySafe、6 处私有 try/catch 入口守卫改为调用它,未新增包间依赖边(6 处调用方本就 import gate-script-base.ts)、未新增/合并包,依赖结构与 god-package 两轴无可归因变化

## Touches
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/scripts/probe-fallback-path-check.ts`
- `plugin/scripts/serve-binding-literal-check.ts`
- `plugin/scripts/worktree-namespace-literal-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/ls-mutation-reading.ts`
- `plugin/scripts/registry-path-literal-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-invoked-directly-guard.md`