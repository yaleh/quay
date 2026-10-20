---
id: gap-arch-cycle-report-record-artifact-timestamp
title: arch-cycle-report 读陈旧 query artifact 却不明说——记录里加 artifact 时间戳，让「读旧数」可识别
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`arch-cycle-report` 例程读的是最近一次 `archguard analyze` 留下的 query artifact（`moduleGraph.cycles`），但 `archguard-runner` 是 on-demand、自 2026-10-11 未在主检出跑过 analyze ⇒ 例程连续 3 天读同一份陈旧 artifact，src scope 永远报旧 4 元环 `[gate/config,gate/factories,gate,""]`（既不含 task 1 已落地的 gate/shared，也不反映 core/ 重构）。记录里**不带 artifact 时间戳**，读者无法分辨「当前树读数」与「旧数」。

## Plan

1. 在 arch-cycle-report 的记录里加 artifact 新鲜度字段：所读 arch.json 的 `timestamp`（或 manifest 的 `generatedAt` / 对应 scope 的 `generatedAt`），最好再加 `gitHead`（若有）。
2. 顶层加 `stale: boolean`（或 `artifactAgeMs`），让「读旧数」在记录里一眼可辨。
3. （可选，重）改为每轮真跑 analyze——本任务只做「至少可识别」，不强制真跑。

**实现备注（落地时）**：
- `readDirectoryCycles` 返回 `artifactTimestamp` = arch.json `timestamp`，缺失时回退 manifest scope 的 `generatedAt`；`readDirectoryCycleReading` 的聚合值取**已 evaluate 的各 scope 中最旧**的一个（读数是「in the report 的那些数」的新鲜度；未评估 scope 的旧 artifact 不计入，否则 `stale` 恒真、零信息）。`gitHead`：arch.json 里没有该字段（已取证：`Object.keys(arch.json)` 无 `gitHead`/`commitSha`），故不记录，不伪造。
- 记录与 Fact 同时带 `artifactTimestamp` / `artifactAgeMs` / `staleIntervalMs` / `stale`；`stale` 三值：无法计算年龄时为 `null`，⛔ 不回退成 `false`（硬规则 3b）。
- 真实产物取证（主检出 `.archguard`，只读）：`artifactTimestamp=2026-09-06T06:26:41.707Z`（= 已评估 scope 中最旧 arch.json 的 `timestamp`），`artifactAgeMs=3791046588 > staleIntervalMs=21600000` ⇒ `stale:true`。

## Acceptance Criteria

- [x] AC1（能取假·字段在场）`.quay/arch-cycle-history.jsonl` 每条记录含 `artifactTimestamp`（非空）且等于其读的 arch.json 的 `timestamp`；字段缺席即假。
- [x] AC2（陈旧可辨）当 artifact 早于当前树（如 >1 个 interval）时，记录含 `stale:true` 或等价的非空陈旧标记。
- [x] AC3（无回归）`bash scripts/test.sh --for-task <本任务id> --allow-thin` 绿。

## Definition of Done

记录带 artifact 时间戳与陈旧标记（AC1/AC2）、scoped 测试绿（AC3）。

## Touches

- plugin/scripts/quality-gate-driver.ts（arch-cycle-report run 体加 artifactTimestamp/stale）
- plugin/scripts/archguard-runner.ts（若需导出所读 artifact 的 timestamp）
- plugin/test/quality-gate-driver.test.mjs（记录字段断言）
- tasks/gap-arch-cycle-report-record-artifact-timestamp.md