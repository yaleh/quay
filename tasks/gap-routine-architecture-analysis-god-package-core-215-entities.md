---
id: gap-routine-architecture-analysis-god-package-core-215-entities
title: "architecture-analysis: core mixes ADR store, gate/acceptance verdicts,
  ancestry, config, and contract validation in one package"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
core mixes ADR store, gate/acceptance verdicts, ancestry, config, and contract validation in one package

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793780643192` · ts `2026-11-04T08:24:03.192Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createAdrStore`、`verdictFromAcceptance`、`ancestry`
- 涉及文件：
- `packages/quay/src/core/adr-store.ts:80`
- `packages/quay/src/core/acceptance-runner.ts:121`
- kind：`god-package`
- verdict：`god-package: fanIn=302, fanOut=124, 215 entities / 28 files`

## Requested action
split into core/gate, core/adr, core/config submodules

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:24:03.192Z

## Disposition（处置结论，可核）

**已有机制在管、失败在哪一步 —— 不是「已注意到」。** 复核载体记录：`.quay/routine-findings.jsonl` 里
runId `architecture-analysis-1793780643192` 共 9 条，其中 findingId `god-package-core-215-entities`
verdict `god-package: fanIn=302, fanOut=124, 215 entities / 28 files`、suggestedAction
`split into core/gate, core/adr, core/config submodules` 与任务体 `## Finding`/`## Requested action`
逐字一致 ⇒ 观测对象存在且属实（`grep -c "architecture-analysis-1793780643192" .quay/routine-findings.jsonl` → 9）。

**复核结论：该 finding 是 god-package 检测器把「循环约束下的共享叶层」误读成缺陷；suggestedAction 的拆分
会重闭目录 SCC，故不执行拆分。** 这些文件住在 `core/` 不是职责堆积，而是有意的破环落点（每处文件头注释
逐字记载）：

| 文件 | 为何必须留在 `core/` |
|---|---|
| `core/acceptance-runner.ts`（`verdictFromAcceptance`） | `gate/shared/acceptance-runner.ts` 是 forwarding re-export；实现「moved DOWN to core」因为 `core/goal-store.ts` 在 gate 之下、`core/` 不得 import `gate/`（tasks/gap-src-root-gate-cycle-break）。消费面 `grep -rln`：同被 `gate/**`（engine/registry/factories）与 `core/**`（goal-store / goal-store-sweep / goal-store-rotation / goal-store-checks / criterion-capability）import ⇒ 结构上不能搬进 `gate/`。 |
| `core/adr-store.ts`（`createAdrStore`） | 独立于任何 task store 的 generic frontmatter store，住 Core 而非 Provider；`gate/factories/adr.ts` 反向往 core import，永不反向。 |
| `core/ancestry.ts` | 若放 src 根会形成 `core → .` 边，与既有 `. → core` 闭合成 7 目录 SCC；留在 core 使 branch-model import 同目录、零新增边。 |
| `core/config.ts` | `src/config.ts` 是 forwarding re-export；gate 曾 import src 根造成 `gate ⇄ ""` SCC。 |

`core/` 的相对 import 全部是 `./`（同目录）或 `../kernel/`（叶子层），零 `../gate/`、零 `../`（src 根）——
层向正确（fan-out 是实体级计数、方向全向下）。

读数（本轮在 worktree 上实测，非引用）：

- L_D: valueSccs=0 typeSccs=0 reverseEdges=0 files=555 edges=1711 valueEdges=1553 typeEdges=158（`plugin/scripts/import-graph-check.ts . --json`，exit 0，PASS；kernel/gate-layer 均 checked、零违规）
- L_G: entitySccCount=0 directoryCycleCount=0 scopes=6（`plugin/scripts/archguard-runner.ts --root .`，exit 0「PASS — no dependency cycles in any scope」）

- `node --test packages/quay/test/directory-cycle.test.mjs` → 5/5 pass，arm 1「the real packages/quay/src has ZERO directory cycles (AC-916)」。

**已有机制**：目录 SCC 破环纪律（tasks/gap-src-root-gate-cycle-break、tasks/gap-gate-directory-cycle-
break-by-extracting-shared-leaves）+ 常驻守卫 `packages/quay/test/directory-cycle.test.mjs`（AC-916）+
L_D/L_G 仪器（import-graph-check.ts / archguard-runner.ts）—— 它们已经管住「哪些文件该在 core、哪些边
不许出现」。

**失败在哪一步**：`architecture-analysis` 探针的 god-package 判定（ArchGuard 包级 fanIn/fanOut 启发式）
不建模目录 SCC 约束。它把「core 的 fan-in 高（302，本就该高——provider-agnostic 核心层）」与「共享叶为
破环而聚居」读成「该拆」，给出的 remediation 恰会重闭 core⇄gate / root↔gate SCC。即检测器的 remediation
是 cycle-blind 的，而常驻的 directory-cycle 守卫只能在拆完之后红、不能事先拦住建议。

**处置动作（本轮落地，非仅诊断）**：把这条约束写进探针规格 `plugin/probes/architecture-analysis.md`——
指示探针在建议 `split` 前先对拍 directory-cycle 守卫，凡搬家会重闭 SCC 的 god-package 一律报
`suggestedAction: leave`、⛔ 不报 split。这样同一 subject（`package:core`）在 merge 后不再复发
（Effect Prediction: concept_recurs_after_merge = false）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-core-215-entities`（routine `architecture-analysis`，runId `architecture-analysis-1793780643192`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/probes/architecture-analysis.md`
- `tasks/gap-routine-architecture-analysis-god-package-core-215-entities.md`