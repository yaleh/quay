---
id: gap-routine-semantic-dedup-scan-doc-check-cache-vs-scoped-gate-cache
title: "semantic-dedup-scan: Bodies byte-identical modulo name/cast and the
  entry interfaces are structurally identical; worker-fan-in.ts:67 ALREADY
  imports the doc-check-cache pair yet re"
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
Bodies byte-identical modulo name/cast and the entry interfaces are structurally identical; worker-fan-in.ts:67 ALREADY imports the doc-check-cache pair yet re-implements it 1500 lines later

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791733865369` · ts `2026-10-11T15:51:05.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readDocCheckCache`、`writeDocCheckCache`、`readScopedGateCache`、`writeScopedGateCache`
- 涉及文件：
- `plugin/scripts/doc-check-cache.ts:113`
- `plugin/scripts/worker-fan-in.ts:1568`
- kind：`identity-replication`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `doc-check-cache-vs-scoped-gate-cache`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791733865369`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
复核结论 = 真实重复（verdict `real-duplication` 核实无误），处置 = **extract**，落在
`plugin/scripts/doc-check-cache.ts`（两面中较低层的那一个；`worker-fan-in.ts` 本就 import 它，
反向边会是值环）：

- 新增单一实现 `GreenCacheEntry` + `readGreenCache` / `writeGreenCache`（原 `doc-check-cache.ts` 的函数体）。
- `readDocCheckCache` / `writeDocCheckCache` → `export { readGreenCache as …, writeGreenCache as … }`（别名）；
  `readScopedGateCache` / `writeScopedGateCache` → `const` 别名；`ScopedGateCacheEntry` → 类型别名。
  ⇒ 复制掉的函数体归零，**两个模块的对外 import 面逐字不变**（既有测试零迁移）。
- 复核判据（可核，非声明）：`wfi.readScopedGateCache === dcc.readGreenCache === dcc.readDocCheckCache`
  （同一函数对象，四条名字全部相等 —— 证明是「一处实现」而非又一份雷同副本）。

实跑：
- `node --experimental-strip-types --test plugin/test/doc-check-cache.test.mjs` → 5/5 pass。
- `node --experimental-strip-types --test --test-name-pattern "gap-worker-premerge-scoped-gate-cache" plugin/test/worker-driver.test.mjs` → 5/5 pass（含 scoped-gate 缓存三分支 + 命中跳过/未命中照跑两条集成）。
- scoped 门 `bash scripts/test.sh --for-task <本任务> --allow-thin` → EXIT=0（含 `import-graph-check`，无新环）。

## Touches
- `plugin/scripts/doc-check-cache.ts`
- `plugin/scripts/worker-fan-in.ts`
- `tasks/gap-routine-semantic-dedup-scan-doc-check-cache-vs-scoped-gate-cache.md`
