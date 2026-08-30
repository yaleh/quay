---
id: gap-observability-blocks-main-execution-audit
title: worker-driver 全程审计——观测性写入/闸门是否阻塞主执行（ledger 不得 gate 落地）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

原则（人裁定 2026-08-30）：**观测（ledger / 遥测 / 镜像写）不得阻塞主执行（merge→suite→flip→ff→land）**。「记录=落地前提」被否——账本本就是观测性的，不应 gate 主执行。

对 `runMechanicalFanIn`（plugin/scripts/worker-driver.ts）全程做观测性写入审计。**已确认两个命中**：

1. **writeSuiteCapture（:2036，调用 :2353/:2365）——观测写阻塞主执行的实锤。** 实现用 `fs.mkdirSync` + `fs.writeFileSync`，无 try/catch、无 best-effort；裸调用。写失败（磁盘/权限）⇒ 异常传播到外层 `catch (e) → failClean("exception")` ⇒ **整个 fan-in 失败，即使 suite 已绿**。capture 是 suite 结果的派生观测（ff 闸 fan-in-ff-merge.sh 读 suite_exit/suite_head）——观测载体写失败弄死落地。
2. **mirrorArchguardMetrics（:2326）——镜像写失败即 failClean。** `if (!mirrored.ok) return failClean("archguard-metrics", ...)`。archguard 结构闸本身是执行（该挡）；但 metrics 到生产载体的**镜像**是观测，写失败阻塞落地（注释自认「AC2：能产出≠已产出」）。

**已核为 best-effort 不阻塞的**：appendFanInStepTrace / appendFanInTrace（try/catch）、mirrorMechanicalFanInSuiteState（try/catch）、writeRedSuiteRecord（suite-driver best-effort）。

## Acceptance Criteria

- [ ] AC1（枚举）：列出 runMechanicalFanIn 每步中所有观测性载体写（verification-round / full-suite-state / suite-load / measure-history / fan-in-step-trace / fan-in 日志 / suite capture / archguard-metrics 镜像 / worker-outcome）及其失败语义（best-effort vs 阻塞）。
- [ ] AC2（判定）：对每个「观测写失败 ⇒ 阻塞/弄红落地」的点给出代码路径证据（行号 + 失败语义），并区分「执行闸（该挡）vs 观测写（不该挡）」。
- [ ] AC3（结论）：对每个命中点给出非阻塞化修法（移到主路径外 / fail-open + 独立载体 / ff 闸改读权威源），或证明其本就 best-effort。

## Definition of Done

审计结论列出全部观测性载体写的失败语义、命中清单（至少含 writeSuiteCapture 与 mirrorArchguardMetrics 两个实锤）与修法；不再有「观测写失败 ⇒ 阻塞落地」的静默点。

## Touches

- plugin/scripts/worker-driver.ts（审计对象）
- plugin/scripts/suite-driver.ts（writeRedSuiteRecord 审计）
- tasks/gap-observability-blocks-main-execution-audit.md（自身）