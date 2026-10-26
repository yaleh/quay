---
id: gap-routine-semantic-dedup-scan-parse-frontmatter-completely
title: "semantic-dedup-scan: Both bodies are return (parseYaml(raw) ?? {}); the
  repo already admits the copy and pins it only with a parity test, while the
  same reduction was done for kern"
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
Both bodies are return (parseYaml(raw) ?? {}); the repo already admits the copy and pins it only with a parity test, while the same reduction was done for kernel/extract-section.ts and ac-checkbox-count.ts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793051606259` · ts `2026-10-26T21:53:26.259Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseFrontmatterCompletely`
- 涉及文件：
- `plugin/scripts/task-schema.ts:135`
- `packages/quay/src/task-parsing.ts:91`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract - move to packages/quay/src/kernel/frontmatter.ts and re-export from both layers.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:53:26.259Z

## Resolution
（2026-10-27，派发链 worker 执行；finding 已按 Requested action **修掉**，不是「已注意到」结案）

- 新 kernel 叶 `packages/quay/src/kernel/frontmatter.ts`：`parseFrontmatterCompletely` 的**唯一定义**（连同
  `TaskFrontmatter` 规范 schema 文档）。只 import 裸 npm 说明符 `yaml`，无仓库内回边。
- 两层改为 re-export **同一个函数对象**：
  - `plugin/scripts/task-schema.ts`（import 供本地 `parseTask` / `readDependsOn` / `readGoalAc` /
    `statusFromFrontmatter` 使用，再 `export { parseFrontmatterCompletely }`）
  - `packages/quay/src/task-parsing.ts`（`export { parseFrontmatterCompletely } from "./kernel/frontmatter.ts"`）
- 两处旧 body 与各自的 `import { parse as parseYaml } from "yaml"` 已删除（`grep -n parseYaml` 在两文件中只剩注释）。
- `plugin/test/task-parsing-parity.test.mjs` 从「行为等价」升级为**身份断言** `assert.equal(plugin, product)`，
  并补非空转断言（嵌套 `extra.depends_on` 存活、空文档 ⇒ `{}`）⇒ 再引入本地副本会结构性失败。
- `docs/references/task-schema-canonical.md` 的 SSoT 指针改指 kernel 叶，旧「两份拷贝」段落标注为已被本任务取代。

实跑读数（本任务 worktree，2026-10-27）：
- 身份：`plugin===product: true`、`kernel===product: true`（`node --experimental-strip-types` 直读三个 import 面）。
- `bash scripts/test.sh plugin/test/task-parsing-parity.test.mjs` ⇒ `tests 8 / pass 8 / fail 0`。
- `node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts` ⇒
  `PASS valueSccs=0 typeSccs=0 reverseEdges=0`，`kernelChecked=true (violations=0)`。

## Dark-axis record (ADR-007)
- L_D: valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0（`node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts` 实跑，2026-10-27，本 worktree）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parse-frontmatter-completely`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793051606259`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-schema.ts`
- `packages/quay/src/task-parsing.ts`
- `packages/quay/src/kernel/frontmatter.ts`
- `plugin/test/task-parsing-parity.test.mjs`
- `docs/references/task-schema-canonical.md`
- `tasks/gap-routine-semantic-dedup-scan-parse-frontmatter-completely.md`