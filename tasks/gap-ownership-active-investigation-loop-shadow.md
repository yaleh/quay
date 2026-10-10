---
id: gap-ownership-active-investigation-loop-shadow
title: "ownership active investigation loop: production shadow with bounded
  evidence requests and ArchGuard slice-delta"
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

**PARKED** — 由主会话交互执行中，勿派发/勿晋升；完成时由主会话在【同一次】task_write 里去掉本行并置 done。

该轴仍暗，理由：本任务只新增 docs/analysis 下的只读 shadow 模块与测试，不 import/不改变任何生产包间依赖边，也不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

ownership/architecture 的 benchmark 已证明：给 agent 受限的只读工具后，它能在 22–34 次调用内从零找到 GOAL-033 的 root→cli 两条边并给出等价切法；但 GOAL-032 因 CLI 没有 duplicates 查询而结构性不可达（Flash 触顶 46 次无答案）。现有 production shadow（ownership-shadow-semantic）仍是「一次性喂 JSON 再一次性回答」，不会主动取证、不会在证据不可达时诚实停下，也不消费 ArchGuard 已 landed 的 Refactor Slice / Expected Delta 原语（目前仅是 ArchGuard 仓库里的实验脚本 slice-delta.mjs，未随 0.1.38 发布、无 CLI/MCP 入口）。需要把「主动调查环」做成 Quay 的 production shadow 能力：每轮一个声明式 evidence request，经确定性 gate 与有界只读执行器，带 provenance 追加证据，直到 investigate-more / abstain / propose-slice；propose-slice 时由原语计算 delta，只写 shadow carrier。

## Plan

1. **contract**（纯函数）：三种 evidence request（read_file / grep / archguard_query）的 schema、硬预算（rounds / requests / bytes / 单次结果 / 读行数 / grep 命中）、路径域与 deny 清单（reference/outcome/benchmark 产物/.quay/.git）、去重、step 校验；duplicates 与 literal_dispersion 作为已声明但不可达的 kind，返回显式 capability_gap。
2. **executor**：只读，read_file/grep 钉在 commit 上（git show / git grep），archguard_query 用 CLI query 于临时 work-dir；每条证据带 tool/ref/path+range 或 scope+flags/ts/hash；预算耗尽、不可达证据只能 abstain / not-enough-evidence。
3. **slice adapter**：从模型给的【结构化】moves 构造 slice.json，负对照由图确定性推出（不让模型选边），调用 slice-delta.mjs；原语缺失即 capability gap；LLM 不得自述 delta，delta 文本由 JS 渲染。
4. **loop**：复用 ownership-shadow-proposer 的 envelope 与 deterministicGate；judge 无工具（--tools ""）；额度（24h 内 propose 上限）与去重；写入现有 shadow carrier；契约内记录 resolved launcher/model 作为将来 Opus 升级的接缝，不切生产模型。
5. **测试**：schema、budget、tool allowlist、provenance、no-write guard、reference/outcome 泄漏 guard、deterministic gate、ArchGuard adapter、abstain on unreachable evidence。
6. **回归与实跑**：GOAL-032/033 historical replay（T0/T1 树）；Quay 当前仓库 live shadow 若干轮；报告写入 docs/analysis/ownership-active-replay.md。

## Touches

- docs/analysis/ownership-active-contract.mjs
- docs/analysis/ownership-active-executor.mjs
- docs/analysis/ownership-active-slice-adapter.mjs
- docs/analysis/ownership-active-loop.mjs
- docs/analysis/ownership-active-replay.md
- docs/analysis/ownership-active-replay-results.json
- plugin/test/ownership-active-loop.test.mjs
- tasks/gap-ownership-active-investigation-loop-shadow.md

## AC

- [ ] 契约与预算：每轮至多 1 个 evidence request；rounds / requests / bytes 硬预算耗尽时终态为 abstain（not-enough-evidence），不产生猜测式提案；deny 路径与越界路径被 gate 拒绝。
- [ ] 每条证据都带 provenance（tool、repo ref/commit、path+range 或 ArchGuard scope+flags、时间戳、内容 hash）；不可达证据（duplicates 等）返回显式 capability_gap，而不是伪造或静默为空。
- [ ] propose-slice（package-cycle）的 delta 由 ArchGuard Refactor Slice / Expected Delta 原语计算，模型自述 delta 被 gate 拒绝；原语不可用或负对照未被证伪时提案降级为 investigate。
- [ ] 全部输出只写 shadow carrier；模块不 import fileProposals / driveItems / fileDecisions，不创建 task/goal，不改代码；judge 无工具。
- [ ] GOAL-032/033 replay 已跑并记录：GOAL-033 是否主动请求 package-level cycle 查询；GOAL-032 在 duplicates 不可达时是否诚实暴露 capability gap 而非漫游至调用上限。
- [ ] Quay 当前项目 live shadow 已实跑若干轮，读数记录在报告中；测试全绿。

## DoD

报告 docs/analysis/ownership-active-replay.md 给出：模块与数据流、live shadow 实际读数、GOAL-032/033 replay 结果、仍缺的 ArchGuard tool surface（duplicates / literal-dispersion 的 CLI 查询、slice-delta 的发布入口）、以及是否具备 limited-proposal 的前提。⛔ 不在线创建 task/goal、不自动改代码、不切生产模型配置；结果 JSON 经凭证扫描。
