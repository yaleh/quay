---
id: gap-routine-semantic-dedup-scan-mergeenv-cross-layer-byte-identical-under-rename
title: "semantic-dedup-scan: digest-identical 8-line body across the
  plugin/product boundary, declared in the product copy as a deliberate 复刻, and
  the rename is exactly what hid it from na"
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
digest-identical 8-line body across the plugin/product boundary, declared in the product copy as a deliberate 复刻, and the rename is exactly what hid it from name-based scans; it bakes no host-dependent literal (only the empty-string sentinel) so the no-hardcoded-limit rule is not implicated

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790417424782` · ts `2026-09-26T10:10:24.782Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`mergeEnv`、`mergeProfileEnv`
- 涉及文件：
- `plugin/scripts/profile-policy.ts:91`
- `packages/quay/src/goal-store.ts:2840`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract mergeEnv to a module both layers reach and delete the renamed copy

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `mergeenv-cross-layer-byte-identical-under-renamed-symbol`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790417424782`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/profile-policy.ts`
- `packages/quay/src/goal-store.ts`
- `tasks/gap-routine-semantic-dedup-scan-mergeenv-cross-layer-byte-identical-under-rename.md`