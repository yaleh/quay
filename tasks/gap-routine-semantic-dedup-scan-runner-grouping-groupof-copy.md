---
id: gap-routine-semantic-dedup-scan-runner-grouping-groupof-copy
title: "semantic-dedup-scan: normalized bodies are byte-identical (18 tokens)
  across a .mjs and a .ts that already share a filename stem — one
  suite-grouping classifier implemented twice o"
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
normalized bodies are byte-identical (18 tokens) across a .mjs and a .ts that already share a filename stem — one suite-grouping classifier implemented twice on two module dialects.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791821278116` · ts `2026-10-12T16:07:58.116Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`groupOf`
- 涉及文件：
- `plugin/scripts/runner-grouping-metadata.mjs:31`
- `plugin/scripts/runner-grouping.ts:53`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge — one implementation, imported by the other (TS imports .mjs fine)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `runner-grouping-groupof-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791821278116`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
复核 = **真实重复**（verdict `real-duplication` 核实无误）：`plugin/scripts/runner-grouping-metadata.mjs` 的
`groupOf` 与 `plugin/scripts/runner-grouping.ts` 的 `groupOf` 归一化后逐字节同体，且 `.mjs` 还另带 `failClosed` /
`RECOGNIZED` / NUL 二进制探测 —— 整簇都是 `.ts` `classifyFile` 的私有副本。处置 = **merge**（一份实现，另一份 import 它）。

- **不适用 leave：「已有机制在管」不成立。** 这一对文件自 2026-09-15 起被 `semantic-dedup-scan` 反复立案 **14 次**
  （`groupof-runner-grouping` / `groupof` / `small-helper-copies` / `runner-grouping-mirror` /
  `runner-grouping-metadata-carve-out` / … / 本次 `runner-grouping-groupof-copy`），判词在 real-duplication 与
  coincidental「sanctioned carve-out」之间摆动。**核过：没有任何机制在管它** ——
  `plugin/{import-graph,sh-census,shipped-set}-baseline.json` 与 `capability-catalog-declarations.json` 都不钉 `groupOf`；
  `mirror-pair-drift-check.ts` 管的是 plugin/scripts ↔ experiments/quay-perpetual-stream/scripts 的**文件级**镜像，
  而实验树那侧全是 symlink（实测 `0 pairs`），与函数体重复无关。两次 leave 判词给出的唯一理由
  ——「`.mjs` 是 test.sh 的独立子进程，import 不了 `.ts`」——**逐字为假**（下一行是证伪读数）。
- **前提证伪（实测）**：`scripts/test.sh:969` 以
  `node --no-warnings --experimental-strip-types …/runner-grouping-metadata.mjs` 调用它，类型剥离同样作用于被 import 的 `.ts`：
  `node --no-warnings --experimental-strip-types -e 'const m=await import("./plugin/scripts/runner-grouping.ts"); …'`
  → `imported classifyFile: function | classifyFile(probe)=serial | groupOf=lowconc | 39ms`。
  同目录既有先例（`.mjs` 静态 import `.ts`）：`workflow-event-schema.mjs` / `workflow-invariant-ownership.mjs` /
  `workflow-metadata-conformance.mjs`。
- **改法**：`runner-grouping-metadata.mjs` 删去私有 `groupOf` / `failClosed` / `RECOGNIZED` / NUL 探测，
  改为 `import { classifyFile } from "./runner-grouping.ts"`，自身只剩 realpath 去重 + 输出（80 → 58 行，分类实现体归零）。
  `runner-grouping.ts` 头部原写「该 helper 的 groupOf 就是本模块的 groupOf」——那是**手工维持的镜像声明**，同一份正本两处写法，
  现已改为「本模块是唯一实现，helper 由它 import，⛔ 不要再复制」。

实跑（可核，非声明）：
- **等价性（旧 vs 新，同一完整 canonical glob）**：旧体取自 `git show develop:plugin/scripts/runner-grouping-metadata.mjs`，
  两者跑同一 996 个 argv 文件（986 行去重输出）：`diff` 为空 ⇒ stdout 逐字节相同；两者 `exit 0`；stderr 均 0 字节。
- `node --test plugin/test/runner-grouping-metadata.test.mjs` → **4/4 pass**（realpath 去重 / 未声明→engine /
  二进制→engine / 未知组 fail-closed exit 3）。
- scoped 门 `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-runner-grouping-groupof-copy --allow-thin`
  → **EXIT=0**（含 `import-graph-check`（files=461 edges=1294，无新环）、`mirror-pair-drift-check`、`task-contract-check`）。

⛔ 探针只立案不执行：本修复由派发链（worker worktree）执行，例程未改树。

## Touches
- `plugin/scripts/runner-grouping-metadata.mjs`
- `plugin/scripts/runner-grouping.ts`
- `tasks/gap-routine-semantic-dedup-scan-runner-grouping-groupof-copy.md`
