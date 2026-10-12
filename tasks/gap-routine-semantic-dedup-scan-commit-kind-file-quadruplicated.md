---
id: gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated
title: "semantic-dedup-scan: four copies of one wrapper (resolveGitRoot →
  commitStoreWrite with propagate:'none'); the only semantic difference is the
  kind string ('adr'/'docs-managed'/'me"
status: todo
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
four copies of one wrapper (resolveGitRoot → commitStoreWrite with propagate:'none'); the only semantic difference is the kind string ('adr'/'docs-managed'/'meta'/'goals'), and the `"<prefix>/"+fileName` fallback branch is dead code because commitStoreWrite returns not-in-git before relPath is read when root is null.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791821278116` · ts `2026-10-12T16:07:58.116Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`commitAdrFile`、`commitDocFile`、`commitMetaFile`、`commitGoalFile`
- 涉及文件：
- `packages/quay/src/adr-store.ts:272`
- `packages/quay/src/document-store.ts:204`
- `packages/quay/src/meta-store.ts:82`
- `packages/quay/src/goal-store.ts:1729`
- kind：`real-duplication`
- verdict：`real-duplication`

## Requested action
merge — one commitKindFile(dir,fileName,id,action,kind,propagate) near store-commit.ts, each store passing its kind

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `commit-kind-file-quadruplicated`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791821278116`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/meta-store.ts`
- `packages/quay/src/goal-store.ts`
- `tasks/gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated.md`