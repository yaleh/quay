---
id: gap-routine-semantic-dedup-scan-canonical-buckets
title: "semantic-dedup-scan: Identical three-line bodies plus an identical
  private BUCKET_ORDER array in each file, and the kernel re-export pattern
  already used for regex-escape is a reac"
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
Identical three-line bodies plus an identical private BUCKET_ORDER array in each file, and the kernel re-export pattern already used for regex-escape is a reachable shared placement.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792560001684` · ts `2026-10-21T05:20:01.684Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`canonicalBuckets`
- 涉及文件：
- `plugin/scripts/suite-bucket-attribution.ts:354`
- `packages/quay/src/serve-tests.ts:481`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `canonical-buckets`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792560001684`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/suite-bucket-attribution.ts`
- `plugin/scripts/suite-bucket-select.ts`
- `packages/quay/src/serve-tests.ts`
- `packages/quay/src/kernel/canonical-buckets.ts`
- `packages/quay/test/kernel-canonical-buckets.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-canonical-buckets.md`

## Evidence
处置 = 修掉（extract），不是「已注意到」。

- 新 kernel 叶 `packages/quay/src/kernel/canonical-buckets.ts`：唯一持有 `Bucket` / `BUCKET_ORDER` /
  `canonicalBuckets`；kernel 是两侧都能到达的落点（`packages/**` → `plugin/**` 是 reverse edge，
  `import-graph-check` 基线 0 —— 本任务实跑 `reverseEdges=0 kernelChecked=true violations=0`）。
- 三处副本收敛：
  - `plugin/scripts/suite-bucket-attribution.ts`：本地 `Bucket`/`BUCKET_ORDER`/`canonicalBuckets` 定义删除，
    改为对 kernel 叶的 re-export（既有 `./suite-bucket-attribution.ts` 消费者导入面不变）。
  - `packages/quay/src/serve-tests.ts`：本地 `Bucket`/`BUCKET_ORDER`/`canonicalBuckets` 删除，直接 import kernel 叶。
  - `plugin/scripts/suite-bucket-select.ts`：第三种拼写 `BUCKET_ARTIFACT_ORDER`（其注释自述与 attribution 的
    `BUCKET_ORDER` 同序）删除，改用 kernel 的 `BUCKET_ORDER`（硬规则 5b：同族实例一并收敛）。
- 单一声明读数（生产面 `plugin/scripts` + `packages/*/src`，排除 test）：
  `function canonicalBuckets|const canonicalBuckets` 命中 1 处（kernel 叶）；
  `BUCKET_ORDER` 形数组声明命中 1 处（kernel 叶）；`BUCKET_ARTIFACT_ORDER` 声明 0 处。
- 新测试 `packages/quay/test/kernel-canonical-buckets.test.mjs` 4/4 PASS：① 单一声明位（含控制样本干跑：
  `export { canonicalBuckets }` / import 不算声明，重命名数组仍被捕获）；② plugin re-export 与 kernel 是
  同一个函数对象 / 同一个数组对象；③ 行为（canonical 顺序、插入序不泄漏、空集 UNRESOLVED、非空集负控制）；
  ④ 重跑 finding 自身谓词（原 body/guard 拼写已从生产树消失）。
- 既有相关测试 101/101 PASS（`suite-bucket-attribution` / `suite-bucket-select` / `suite-bucket-drift-check` /
  `serve-handlers`）；`npx tsc --noEmit` 四个 package 全绿。
