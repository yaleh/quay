---
id: gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated
title: "semantic-dedup-scan: four copies of one wrapper (resolveGitRoot →
  commitStoreWrite with propagate:'none'); the only semantic difference is the
  kind string ('adr'/'docs-managed'/'me"
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
- [x] `.quay/routine-findings.jsonl` 中 finding `commit-kind-file-quadruplicated`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791821278116`）所描述的问题被复核并处置 —— 复核结论：**属实**，且是核对源码得出而非采信 finding。四份 wrapper（`adr-store.ts` `commitAdrFile` / `document-store.ts` `commitDocFile` / `meta-store.ts` `commitMetaFile` / `goal-store.ts` `commitGoalFile`）逐个读到：函数体逐行相同，唯一差异是 `kind` 字面量（`"adr"` / `"docs-managed"` / `"meta"` / `"goals"`）。finding 的第二半也被核实：`: \`"<kind>/"+fileName\`` 回退分支**不可达** —— `commitStoreWrite`（`store-commit.ts:156` 的 `if (!root) return { outcome: "not-in-git" … }`）在读到 `relPath`（`:161` 起）之前即返回，故 `root === null` 时该回退值永不被使用。处置 = **修掉（merge）**：`commitKindFile(dir,fileName,id,action,kind,propagate)` 落在 `store-commit.ts`，四个 store 各传自己的 `kind`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，四条可复跑读数：①**处置量是一个可读的数**（硬规则 2：按代码位置枚举）：在 `packages/quay/src/` 枚举四个 wrapper 声明名 —— base（`develop` = `ca5e14a2c`）= **4 处 / 4 文件**，本分支 = **0 处 / 0 文件**（`grep -rn 'commitAdrFile\|commitDocFile\|commitMetaFile\|commitGoalFile' packages/quay/src/ | wc -l` ⇒ `0`）；共享 home `grep -rn 'export function commitKindFile' packages/quay/src/store-commit.ts` ⇒ **1 处**（`store-commit.ts:210`）。②**行为保持**：`npx tsc --noEmit -p packages/quay/tsconfig.json` EXIT=0（scoped 门不做 typecheck，故自行跑）；五个 store 测试文件 **157/157**（`adr-store` / `document-store` / `meta-store` / `goal-store` / `store-commit`，`node --experimental-strip-types --test` EXIT=0）。③**kind 仍逐个穿透到提交对象**：新增 positional 回归 `commitKindFile: one shared wrapper …` —— 断言 `git log -1 --format=%s` 匹配 `^goals: AC-7 create by `（kind 到达 subject），且 non-git 根返回 `not-in-git`（即四个副本为之携回退分支的**那条不可达路径**，无需 kind 前缀 relPath）。④**单一入口**：四条调用点各带自己的 kind（`commitKindFile(adrDir,…,"adr")` / `commitKindFile(docDir,…,"docs-managed")` / `commitKindFile(metaDir,…,"meta")` / `commitKindFile(goalDir,…,"goals")`），唯一的 commit-after-write 包装现在只有一份。

## DoD
- [x] 上面的判据实跑通过 —— 上述读数均已实跑：四个 wrapper 声明名枚举（base **4 处/4 文件** → 本分支 **0 处/0 文件**）、`export function commitKindFile` = **1 处**、`npx tsc --noEmit -p packages/quay/tsconfig.json` EXIT=0、五个 store 测试文件 **157/157**、新 positional 回归（kind 穿透 subject + non-git 返回 `not-in-git`）通过。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated`，分支 `task/gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated`，提交 `943ef47f6`）；例程探针只往 `.quay/routine-findings.jsonl` 写 finding 记录并机械立案，未执行任何修复。

## Touches
- `packages/quay/src/adr-store.ts`
- `packages/quay/src/document-store.ts`
- `packages/quay/src/meta-store.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/src/store-commit.ts`
- `packages/quay/test/store-commit.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated.md`