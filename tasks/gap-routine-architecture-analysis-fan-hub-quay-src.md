---
id: gap-routine-architecture-analysis-fan-hub-quay-src
title: "architecture-analysis: packages/quay/src has fanIn=486 fanOut=424 across
  30 files incl. 3907-line observation.ts and 2965-line init.ts"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
packages/quay/src has fanIn=486 fanOut=424 across 30 files incl. 3907-line observation.ts and 2965-line init.ts

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622670475` · ts `2026-11-02T12:31:10.475Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`liveSessionIdForPid`、`classifyConfig`
- 涉及文件：
- `packages/quay/src/observation.ts:221`
- `packages/quay/src/init.ts:177`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
Split observation/init monoliths and remove the re-export barrel so subpackages import each other directly

## Disposition（处置结论，可核）

复核时间 2026-11-02，worktree `gap-routine-architecture-analysis-fan-hub-quay-src`，develop `15329d8f4`（archguard scope `b4f87b21`，生成于 `2026-11-02T12:31:52Z`）。

### 1. 读数复核：finding 属实、无漂移

| 量 | finding | 本次实测 | 命令/来源 |
|---|---|---|---|
| `packages/quay/src` fanIn | 486 | 486 | archguard `get_package_metrics(packageName="packages/quay/src")` |
| `packages/quay/src` fanOut | 424 | 424 | 同上 |
| `packages/quay/src` cycleCount | （未提） | 0 | 同上 |
| `packages/quay/src` fileCount | 30 | 30 | archguard `summary(outputScope="package")` |
| observation.ts 行数 | 3907 | 3907 | `git show develop:packages/quay/src/observation.ts \| wc -l` |
| init.ts 行数 | 2965 | 2965 | `git show develop:packages/quay/src/init.ts \| wc -l` |

### 2. 处置：不做手拆 monolith —— 已有机制在管，且失败在哪一步可点名

`suggestedAction`（拆 observation/init monolith + 去 re-export barrel）不是本任务新发现的未管地带：两条 monolith 都已由派发链切片过一轮，re-export barrel 是**有意设计**。

**（a）observation.ts：已切四缝，barrel 是刻意 facade**
- `gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module`（done，2026-10-22）已把 4 个职责抽进 `observation/`（events / liveness / blocking / records，over import-free `model.ts`），4797→3907 行；文件头注释逐字记录「re-exports every moved symbol so `from "./observation.ts"` remains the single import surface for all 64 consumers」。
- 本任务前一轮 worker 曾试图在其上再切三缝（task-status-ref / live-state / needs-human-ledger），撞上三道常设守卫并制造 `.`↔`observation` 环：`ancestry.test.mjs` §8 断（observation.ts 不再 `from "./core/ancestry.ts"`）、`directory-cycle.test.mjs` 红（`live-state.ts` 的 `../driver-vocab.ts` 根级回边）、`architecture-boundaries.test.mjs` P3 红（同一条根级 import）。本轮已 revert（`e3fbcbd56`）。**结论：naive 手拆已不再安全，再切必须走 extension-point 判据（DIR-133），否则只是搬行数、把环搬进来。**

**（b）init.ts：已切多个 seam，DIR-133 管着后续切法**
- `gap-init-ts-4214-line-slice-with-extension-point-first`（done）按 DIR-133 切了 provider 注册轴（抽出 `init-provider-registry.ts`），4214→4167，AC7 断言 `archguard_detect_cycles(package)` 前后 `cycles=[]`。
- 此后又切出 `init/carrier-env.ts`、`init/delivery-surface.ts`、`init/provider-maintenance.ts`；init.ts 现 2965 行 / 50 exports。**「怎么切」已有机制（DIR-133 四臂判据），不是「该不该切」没结论。**

**（c）失败在哪一步（诚实点名，⛔ 非「已注意到」）**
1. **fanIn/fanOut 是包级 hub 读数，拆文件不降它**：486/424 是 `packages/quay/src` 作为**目录/包**的出入度；把 observation.ts 拆成更多子文件仍在同一目录，486/424 不变。suggestedAction 的两条手段（拆 monolith、去 barrel）都作用于**文件内**，对**包级**读数无效——routine 的 god-package 建议与实际量纲之间有缺口。
2. **fanIn/fanOut 无阈值棘轮**：环有 `directory-cycle.test.mjs`（AC-916 常设守卫）、责任边界有 `architecture-boundaries.test.mjs`（AC-917 常设守卫），但 fanIn/fanOut 只有 archguard `get_package_metrics` **记录**、无**判定** ⇒ god-package 只能被本例程**检出**、不能被**挡住**（与 sibling `god-module-worker-driver` 的「只记录不判定」同一缺口）。
3. **去 barrel 的取舍无人裁定**：去 barrel 会把 64 个消费者从单一 facade 改成子包直连，降 observation.ts 的 fan-in，但 64 处 import 面散开——是「稳定 facade」换「fanIn 数字好看」，需单独裁定，非本 finding 单独能定。

**下一步执行增量（本任务不执行——顺序不可交换，落到可执行动作）**：
① 立「fanIn/fanOut 阈值棘轮」任务：照 AC-916/917 常设守卫形状（正臂=实树读数、负臂=合成 fixture、第三臂=仪器失效独立取值），把「只能检出」升级成「能挡住」；② 或立「去 re-export barrel」任务（先裁定 64 消费者迁移口径，再机械迁移 + 常设守卫）。
⛔ 本任务只复核 + 落可核结论，不代跑产出者（DoD 第 2 条）。

### 3. 复核命令（可重跑）

```bash
node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json    # L_D（packages/quay/src 环）
# L_G（archguard MCP）：get_package_metrics(packageName="packages/quay/src") → fanIn/fanOut/cycleCount
#                        summary(outputScope="package") → packages/quay/src fileCount/entityCount
git show develop:packages/quay/src/observation.ts | wc -l    # 3907
git show develop:packages/quay/src/init.ts | wc -l           # 2965
grep -m1 '^status:' tasks/gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module.md  # done
grep -m1 '^status:' tasks/gap-init-ts-4214-line-slice-with-extension-point-first.md                             # done
```

### 4. 读数（ADR-007）
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=555 edges=1711
- L_G archguard: packages/quay/src fanIn=486 fanOut=424 cycleCount=0 fileCount=30 entityCount=298

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:31:10.475Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `fan-hub-quay-src`（routine `architecture-analysis`，runId `architecture-analysis-1793622670475`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `tasks/gap-routine-architecture-analysis-fan-hub-quay-src.md`