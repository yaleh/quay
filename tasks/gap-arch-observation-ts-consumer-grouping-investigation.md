---
id: gap-arch-observation-ts-consumer-grouping-investigation
title: 架构调查：observation.ts（4671 行，扇入 105/扇出 112）消费者分组与可执行拆分方案——只调查，不动代码
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**先调查、后拆分，沿用 `gap-worker-driver-god-file-decomposition-investigation` 的先例：产出 `docs/analysis/observation-decomposition-investigation.md`，本任务不修改 `packages/quay/src/observation.ts`。**

**为什么**：`SPEC-architecture-consolidation-ts-and-shell-2026-09-19` §5 Phase 6 指出 `observation.ts` 是核心层里唯一「最被依赖 ∧ 最依赖别人」的模块（扇入 105、扇出 112，当前 4671 行），且 SPEC §10.2 明确 Phase 6 不立 GOAL、走「先调查任务后拆分任务」。至今没有这个调查任务。SPEC 建议的切分轴是视图域（dashboard / sessions / tests / 收敛观测），但那只是假说——须由消费者分组数据来检验，⛔ 不得照搬。

**判据纪律**：行数不是判据；拆分收益按「扇入×扇出乘积下降 ∧ 无新环 ∧ import-graph 棘轮不回升」衡量（SPEC §5 Phase 6）。调查必须给出这三项各自的**拆前读数**，供后续拆分任务作基线。

## AC

- [ ] AC1（现场基线，枚举非布尔）贴出真实命令与输出：`wc -l`、导出个数、导出的种类构成（函数/类型/常量/re-export 各多少），以及 import-graph 中该文件的真实扇入/扇出（按 import 语句位置判定）。与 SPEC 里「105/112」逐项对账，不一致写明原因。
- [ ] AC2（消费者分组表）每个导出 → 消费者文件清单（区分生产 / 测试）→ 所属功能区域；表须覆盖**全部**导出，缺一行即不合格。给出「仅测试消费的导出」个数。
- [ ] AC3（纠缠 vs 独立，两类都要证据）列出模块级私有可变状态清单（若无，明写「无」并贴检索命令），以及互相调用的导出组；再列出可安全外移的独立组，每组附依赖清单。
- [ ] AC4（至少一个可执行方案，或「不拆」证据）方案须具体到：候选子模块名、各含哪些导出、依赖、行数估计、回填方式（re-export 面是否保持）。若结论是「不该拆」，给出可被独立核实的具体证据（如纠缠导出占比），⛔ 不得是「看起来复杂」。
- [ ] AC5（对 SPEC 假说的检验）明确回答：SPEC 提的四个视图域切分轴与消费者分组数据是否吻合；不吻合处以数据为准并写明。
- [ ] AC6（可复核）文末附全部可复核命令，读者可独立重跑每个数字；⛔ 本任务的 diff 不得含 `observation.ts` 本身。

## DoD

调查文档落盘于 `docs/analysis/`，后续拆分任务可直接引用其方案作 Proposal 依据。`git diff --stat` 证明未改动 `packages/quay/src/observation.ts`。

## Touches

- docs/analysis/observation-decomposition-investigation.md (new)
- tasks/gap-arch-observation-ts-consumer-grouping-investigation.md
