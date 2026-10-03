---
id: gap-routine-semantic-dedup-scan-walkfiles-scan-surface-family
title: "semantic-dedup-scan: Three private walkFiles bodies are byte-identical
  (same SKIP_DIRS, same Dirent loop, same call site) and are the un-extracted
  remainder of the scan-surface fam"
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
Three private walkFiles bodies are byte-identical (same SKIP_DIRS, same Dirent loop, same call site) and are the un-extracted remainder of the scan-surface family that fs-walk.ts already absorbed for four sibling checks.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790995446200` · ts `2026-10-03T02:44:06.200Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walkFiles`
- 涉及文件：
- `plugin/scripts/registry-path-literal-check.ts:91`
- `plugin/scripts/serve-binding-literal-check.ts:111`
- `plugin/scripts/worktree-namespace-literal-check.ts:67`
- `plugin/scripts/fs-walk.ts:175`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `walkFiles-scan-surface-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790995446200`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

处置 = 修掉：三份 byte-identical 的私有 `walkFiles`（+ 同一个 `SKIP_DIRS` + 同一个 call site）抽进 `plugin/scripts/fs-walk.ts` 的新 `listFilesInRoots(root, relDirs, skipDirNames)`；三个检查器（registry-path / serve-binding / worktree-namespace）改为 import 它，各自的 `SCAN_ROOTS` 与 `SKIP_DIRS` 作为参数留下（沿用 `collectShellScripts`/`scanRoots` 的既约 convention：只共享遍历，不统一 policy）。两条承重轴（dirent 模式 ⇒ 符号链接不被记录；prune 只删目录 ⇒ 与 skip-dir 同名的文件仍被列出）由 `plugin/test/fs-walk.test.mjs` 新增的 control 钉住，并由一条「三检查器不得再定义 `function walkFiles`」的 body-count 断言证明单一定义点已落地（硬规则 4 推論三）。

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/registry-path-literal-check.ts`
- `plugin/scripts/serve-binding-literal-check.ts`
- `plugin/scripts/worktree-namespace-literal-check.ts`
- `plugin/scripts/fs-walk.ts`
- `plugin/test/fs-walk.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-walkfiles-scan-surface-family.md`