---
id: gap-ownership-replay-rich-evidence-and-tool-replay-benchmark
title: "Ownership replay benchmark: rich evidence dossier and historical tool replay"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增的是只读 corpus/评测器/测试与 docs/analysis 产物，不 import/不改变任何生产包间依赖边，也不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

前一版两阶段 benchmark 修好了 gold（investigate-vs-goal 由 0/8 变 8/8），但两组模型仍 0/8 达到 `sufficient` granularity，且 Flash/Opus 在几乎所有维度持平。主因是 evidence 过薄：模型只收到 1–2 KB 的静态 JSON，而人在真实决策时有整个仓库与 ArchGuard 可查。把能力评测压成 1–2 KB 的 static completion，测的是「在极少信息下猜」，不是 meta-driver 真实要做的「自己决定查什么再分解」。本任务新增两种更接近真实场景的 replay：A. rich evidence bundle（cutoff-safe dossier，10–50 KB/case，带逐段 provenance）；B. historical repository/tool replay（固定到历史 cutoff commit 的只读 worktree，agent 自己 Read/Grep/查 ArchGuard，记录 tool trace）。

## Plan

1. **A. rich dossier**：为 GOAL-030..033 各自从 cutoff commit 的 git 对象（`git show <commit>:path`）抽取与 case 直接相关的源码片段、grep 命中、callers/imports、duplicate 组、ArchGuard SCC/边表/包指标，加上前序 Goal/方法论正文；每段记录 repo commit、路径、行范围/查询来源。T0 与 T1 两阶段各一份（T1 = 在 T0 之上追加下钻原料与已完成调查结论）。⛔ 不含 reference/outcome/后验 commit。
2. **integrity tests**：provenance 逐段可重放（`git show` 字节一致）、commit 不晚于 cutoff、outcome 中「cutoff 处不存在」的标识符零命中、reference/outcome 句子 shingle 零命中、目标 Goal 自身正文不入 dossier、T0 不含 T1 调查结论。
3. **评测器**：新增 `unsupported_mentions`（响应里出现但 dossier 不含的文件路径/符号）；切片判定改看「推荐的首个切片」而非并集；旧 baseline 同口径重打分以便可比，旧结果文件保留不改。
4. **A/B（rich-bundle）**：A=`claude-fjdac`/`v4.1flash-anthropic`，B=`claude`/`opus`，同 case/cutoff 仅 runtime/model 不同，fixture profile 承载，⛔ 不改 `.quay/profiles.yml`。
5. **B. tool replay 原型**：GOAL-032、GOAL-033 先做；cutoff commit 的临时 detached worktree + 只读工具（Read/Grep/Glob + 受限 ArchGuard query 包装器），禁止写、禁止读 reference/outcome 与主检出，`--output-format stream-json` 记录 tool trace 摘要（读了哪些文件/查询、轮数、最终用到的证据）；同样 A/B。
6. 分开报告 rich-bundle 与 tool replay，⛔ 不合成单一总分；旧 1–2 KB 结果仅作 baseline，不再扩大样本。

## Touches

- plugin/fixtures/meta-driver-replay/GOAL-030/rich_a.json
- plugin/fixtures/meta-driver-replay/GOAL-030/rich_b.json
- plugin/fixtures/meta-driver-replay/GOAL-031/rich_a.json
- plugin/fixtures/meta-driver-replay/GOAL-031/rich_b.json
- plugin/fixtures/meta-driver-replay/GOAL-032/rich_a.json
- plugin/fixtures/meta-driver-replay/GOAL-032/rich_b.json
- plugin/fixtures/meta-driver-replay/GOAL-033/rich_a.json
- plugin/fixtures/meta-driver-replay/GOAL-033/rich_b.json
- docs/analysis/rich-dossier-spec.json
- docs/analysis/gen-rich-dossier.mjs
- docs/analysis/ownership-rich-ab.mjs
- docs/analysis/ownership-tool-replay.mjs
- docs/analysis/ownership-two-stage-evaluator.mjs
- docs/analysis/ownership-rich-ab-results.json
- docs/analysis/ownership-tool-replay-results.json
- docs/analysis/ownership-rich-and-tool-replay.md
- plugin/test/ownership-rich-dossier.test.mjs
- docs/analysis/dossier-evidence/GOAL-032-duplicates.txt
- tasks/gap-ownership-replay-rich-evidence-and-tool-replay-benchmark.md
- docs/analysis/ownership-blind-judge.mjs
- docs/analysis/ownership-blind-judge-results.json
- docs/analysis/summarize-rich-and-tool.mjs
- docs/analysis/ownership-tool-replay-results-probe.json
- docs/analysis/ownership-two-stage-ab.mjs
- docs/analysis/ownership-two-stage-ab.md
- docs/analysis/ownership-shadow-ab-runtime-model.mjs
- docs/analysis/dossier-evidence/GOAL-031-literal-dispersion.txt

## AC

- [x] 四例各有 `rich_a.json` 与 `rich_b.json`，每段含 commit/路径/行范围或查询来源；每个 dossier 10–50 KB 量级。 **Verified**: 8 dossiers, 19.5–70.5 KB, provenance per section
- [x] integrity tests 全绿：provenance 重放字节一致、commit ≤ cutoff、cutoff 处不存在的 outcome 标识符零命中、reference/outcome shingle 零命中、目标 Goal 正文不入 dossier。 **Verified**: 33/33 integrity tests incl. 4 mutation negative controls
- [x] rich-bundle A/B 完成（16 run），结果写入 `docs/analysis/ownership-rich-ab-results.json`，且自检 `prompts_identical_across_groups_per_cell` 为真。 **Verified**: 16 runs, prompts identical per cell, ownership-rich-ab-results.json
- [x] GOAL-032/033 tool replay 在只读 worktree 内完成，写出 tool trace 摘要；已验证 agent 无法读 reference/outcome 且无写权限。 **Verified**: 8 tool-replay cells, sandbox probed for both runtimes (all forbidden actions denied, nothing written), trace summaries recorded
- [x] 报告分开呈现 rich-bundle 与 tool replay，含与旧 1–2 KB baseline 的同口径对比与 production meta-driver 的 evidence/tool 访问建议。 **Verified**: docs/analysis/ownership-rich-and-tool-replay.md separates the two modes, compares to the 1–2 KB baseline, gives production recommendations

## DoD

结果见 docs/analysis/ownership-rich-and-tool-replay.md（提交 b40779bf1）。要点：① 前一版词法 granularity 判定是人为产物（按较短串归一，长答案饱和），已在旧报告追加勘误；改以盲评语义判官（Sonnet，16/16 对照通过）为准。② 盲评下 Stage B 切片可接受率：紧凑基线 Flash 3/4 / Opus 4/4，rich bundle 两组均 4/4——证据展开带来的是可审计性（每例引用 14–15 个 section），不是准确率。③ tool replay（GOAL-032/033）：GOAL-033 stage B 两组都从零找到 root→cli 恰好 2 条边并给出等价切法；GOAL-032 因 archq/CLI 没有 duplicates 查询（仅 MCP 有）而结构性不可达（Flash 触顶 46 次无答案，Opus 分析了另一组重复）。④ 模型质量差异未建立；过程差异一致：Opus 4/4 个 cell 工具调用更少（均值 24 vs 36）。⑤ 建议：补齐 CLI/MCP 工具面（duplicates、literal-dispersion），Read/Grep/Glob+单一查询命令的 dontAsk 沙箱可复用，外部强制工具调用预算，不以『与人选一致』评 Stage A 发现，不据此切换 Opus。⛔ 未改线上自治、未切生产模型配置；结果 JSON 经凭证扫描 0 命中。