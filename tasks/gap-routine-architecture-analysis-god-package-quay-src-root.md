---
id: gap-routine-architecture-analysis-god-package-quay-src-root
title: "architecture-analysis: fanIn 484 / fanOut 423, 296 entities in 29 files
  — root aggregates cli/core/kernel/serve/observation/gate."
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
fanIn 484 / fanOut 423, 296 entities in 29 files — root aggregates cli/core/kernel/serve/observation/gate.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793492325036` · ts `2026-11-01T00:18:45.036Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`dashboard-kernel`、`mcp-server`、`goal-merge`
- 涉及文件：
- `packages/quay/src/dashboard-kernel.ts:1`
- `packages/quay/src/mcp-server.ts:1`
- `packages/quay/src/goal-merge.ts:1`
- kind：`god-package`
- verdict：`god-package`

## Requested action
Move root-level modules into their owning sub-package, keeping only true barrel re-exports.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:18:45.036Z

## Disposition

复核时间 2026-11-01，worktree `gap-routine-architecture-analysis-god-package-quay-src-root` @ develop `3218e3914`。

### 1. 读数复核：finding 逐字命中；fanIn/fanOut 是根包的集中度读数，不是缺陷轴

| 量 | finding | 本次实测 | 来源 |
|---|---|---|---|
| `packages/quay/src` fanIn | 484 | 484 | `.archguard/metrics-history.jsonl` 最新 `packages/quay/src` 包行 @ 2026-11-01T00:19:53.746Z |
| `packages/quay/src` fanOut | 423 | 423 | 同上 |
| `packages/quay/src` entityCount | 296 | 296 | 同上 |
| `packages/quay/src` cycleCount | — | 0 | 同上 |
| 29 files | 29 | 29 | `ls packages/quay/src/*.ts \| wc -l` |
| 符号 `dashboard-kernel` / `mcp-server` / `goal-merge` 行数 | — | 144 / 643 / 448 | `wc -l` |

`packages/quay/src` 根包是核心 scope（`packages/quay/src`）里 fanIn 最高的**中枢**（484；`serve-render.ts`
=352、`gate-script-base.ts`=337、`core`=302 紧随其后），fanOut 423 也处于头部。但 fanIn 判的是「被多少
实体 import」；根包是本仓经三轮架构拆分后的 **core-root 共享层**（见 §2/§3），它的身份就是被 `cli/`、
`core/`、`serve/`、`kernel/`、`gate/` 共同 import——高 fanIn 是「共享原语确实被共享」的结构恒等式，与
sibling `god-package-serve-view` 对 `serve/view`（fanIn=563）的结论同形：叶子/中枢包的高 fanIn 不是集中度
缺陷。`cycleCount=0` 是本处唯一能取假的结构量，它确实为 0。

### 2. 复发诊断：同一根 god-package 的第三次立案；每轮符号集漂移，dedup 键不收敛

| 轮 | 任务 | runId | 读数 | 处置 |
|---|---|---|---|---|
| 1（2026-10-21） | `quay-src-serve-surface-flat-in-src`（done） | `architecture-analysis-1792599464308` | fanIn 259 / fanOut 662 / 52 顶层文件（24 个 serve*） | **已修**：24 个 serve* 模块 `git mv` 进 `serve/`，顶层 52→29 |
| 2（2026-10-29） | `core-src-flat-root-god-modules`（done） | `architecture-analysis-1793251760204` | 29 文件 / 334 实体，tooManyFiles+tooManyEntities | **部分修**：`init.ts` 按相位切开、`loaded-version.ts` 下沉 `core/`，实体 334→284；记 flag 不具判别力（41 包里 18 个被 flag） |
| 3（2026-11-01，本任务） | `god-package-quay-src-root` | `architecture-analysis-1793492325036` | fanIn 484 / fanOut 423 / 296 实体，符号 dashboard-kernel/mcp-server/goal-merge | 本处置（复核 + 记已有机制） |

根因同 sibling `god-package-plugin-scripts` 已记的结论：`routine-file-gate.ts` 的 dedup subject 键 =
**精确符号集相等**（该文件头注释已把此边界声明为刻意，非 bug）。god-package 的观测符号每轮随 archguard
采样漂移 ⇒ 同一根包跨轮**不被 dedup、只被 rate 兜底**。本轮 rate 闸确实兜底：6 候选 → 立案 3
（serve-view-7368b251 / quay-src-root / core）+ rate 拒绝 3（kernel / cli / plugin-scripts）。

### 3. 根包的真实形态：不是「无分组」，是三轮拆分后的刻意 core-root 共享层

根上 29 个模块分三类，各有文件内记录的 owner 理由（非「整理文件」）：

- **转发 shim（实现已下沉）**：`abi.ts` / `config.ts` / `loaded-version.ts`——`gate/**` 曾 import src 根
  （`gate → ""`）而根 import gate（`"" → gate`），构成目录级 SCC；实现已下沉 `core/`，根路径留作历史
  消费面的受支持 import surface。⛔ 不能再放回实现（`core/` 模块 import 此文件会重新成环）。
- **刻意的 core-root 落位（GOAL-033/AC-350）**：`driver-control.ts` / `driver-vocab.ts`——core（serve 宿主）
  与 CLI 共同消费的控制面词表/客户端，放 `cli/` 会制造 core→cli 边。
- **共享 core 叶子（单一真相源）**：`pad.ts` / `relative-time.ts` / `search-index.ts` / `runtime-artifacts.ts` /
  `task-parsing.ts` / `version.ts` / `worktree-deps.ts`——各是跨面共享的一个定义，叶子身份本就该在中枢。

finding 点名的三个符号各自有归属理由：

- `dashboard-kernel.ts`（144 行，10 导出）：发布为 `quay/dashboard-kernel` 子路径的跨项目契约
  （`packages/quay/package.json` `exports` + 旁侧 `dashboard-kernel-vectors.json` 等价向量），消费方是
  `cli/lanes.ts` 与 `serve/view/serve-dashboard.ts`；移动会改已发布子路径。
- `mcp-server.ts`（643 行，3 导出）+ `mcp-handlers.ts`（1228 行，11 导出）：Core 的 MCP consumer-layer
  binding（proposal §5「MCP projection → Agent」），15 个 `server.tool()` 注册的薄 wrapper + per-domain
  handler。二者是「MCP」面，但当前无 `mcp/` 子包。
- `goal-merge.ts`（448 行，18 导出）+ `goal-preview.ts`（869 行）+ `goal-ac-write-face.ts`（235 行）：
  goal 的人类 merge-request 面（SPEC-goal-branch-2026-10-03 §4.7/§4.10）；goal 的 store 已下沉
  `core/goal-store*.ts`，merge/preview 是与之相邻的 consumer 面。

### 4. 已有机制在管哪一部分、失败在哪一步

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| `import-graph-check.ts` | value/type SCC、层间越界、kernel/gate-layer 边界 | 本轮实测 valueSccs=0 / typeSccs=0 / reverseEdges=0 全绿。**无 domain / god-package 维度** |
| `archguard-runner.ts` 目录环闸 | 根↔子目录 SCC（`directoryCycleCount>0` ⇒ exit 1） | 只判环，不判 fanIn/fanOut 集中度；god-package 阈值**未接线**（头注释「留待数据积累」）。第 2 轮实测的失败点恰是「把根模块下沉」这个动作本身会造 `init ↔ ""` 环 ⇒ 搬家不能按清单批量搬，每步须先证目录环不变 |
| `routine-file-gate.ts` dedup 闸 | 防同一 subject 重复立案 | subject 键 = 精确符号集；god-package 符号跨轮漂移 ⇒ 不 dedup、退化为 rate 兜底（已声明残余，同 `god-package-plugin-scripts`） |

### 5. 处置结论

- 复核结论：finding 成立且未过期；**本任务不修布局**——与同轮 sibling `god-package-serve-view` /
  前序 `god-package-plugin-scripts` 相同的承重约束。第 1/2 轮已做完比例内的机械移动（serve* → `serve/`、
  `init.ts` 相位切分、`loaded-version` 下沉）；剩余根模块是刻意的 core-root 共享层，把三个符号模块下沉
  `mcp/` / `goal/` 是多文件移动（各带全仓 importer），且受目录环闸约束（第 2 轮实测 `init ↔ ""` 环）。
- 本 finding 的新价值 = 复发证据：根 god-package 跨轮以漂移符号集复发（dedup 键不收敛），由 rate 而非
  dedup 兜底——与 `god-package-plugin-scripts` disposition 同一残余。
- 可执行下一个增量（本任务不执行，顺序不可交换）：① `routine-file-gate.ts` 对 `dupKind: god-package`
  用包身份（package path / 已 disposition 包名抑制表）做 dedup 键；② 若仍要降根包 fanIn/fanOut 读数，
  先做 `mcp/`（mcp-server+mcp-handlers）与 `goal/`（goal-merge+goal-preview+goal-ac-write-face）两个
  SCC-proof 的包级下沉，每步先证目录环不变（`archguard-runner` 六 scope 全 `evaluated=true`）。
- 复发预期：本处置**不满足** `concept_recurs_after_merge=false`——在 dedup 键修复或包级下沉落地前同一
  subject 可能再立案，由 routine-file-gate 的 rate 闸兜底。

### 6. 复核命令（可重跑）

```bash
grep -o '{"name":"packages/quay/src","fanIn":[0-9]*,"fanOut":[0-9]*,"cycleCount":[0-9]*,"entityCount":[0-9]*}' .archguard/metrics-history.jsonl | tail -1
ls packages/quay/src/*.ts | wc -l
wc -l packages/quay/src/dashboard-kernel.ts packages/quay/src/mcp-server.ts packages/quay/src/goal-merge.ts
node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
git log --oneline -1 -- tasks/gap-routine-architecture-analysis-core-src-flat-root-god-modules.md
```

### 7. L_G 读数（ADR-007）
- L_G archguard: entityCount=296 fanIn=484 fanOut=423 cycleCount=0
- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-quay-src-root`（routine `architecture-analysis`，runId `architecture-analysis-1793492325036`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `tasks/gap-routine-architecture-analysis-god-package-quay-src-root.md`