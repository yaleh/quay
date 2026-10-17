---
id: gap-archguard-runner-missing-not-evaluated-state-and-version
title: archguard-runner 读数缺「未评估」态与版本来源——路径错/空分析/版本漂移都与「0 环通过」同形
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

`plugin/scripts/archguard-runner.ts:143` `sccCount: Number(mv.sccCount ?? 0)`：产物路径错、分析为空、metricVector 缺失时都得 0 并通过——「读不到」与「无环」同形（硬规则 3b）。`HistoryRecord`（:66）无 `archguardVersion`，而 archguard 0.1.35→0.1.40 间 `detect_cycles` 返回形状与 scope 解析已变，跨版本记录不可比。也无 `sourceFiles`/`entityCount` 校验——symlink 双重解析（实测 454+46=500）这类问题在读数里不可见。

## Plan

1. `readScopeSignal` 增 `evaluated: boolean` + `reason`：产物缺失/不可解析/无 metricVector ⇒ 记 `evaluated:false` 并 fail-closed（不冒充 0）。
2. `HistoryRecord` 增 `archguardVersion`（`archguard --version`）、`sourceFiles`、`entityCount`。
3. fail-closed 校验：source 目录应有 `.ts/.tsx` 文件而分析出 0 实体 ⇒ exit 1（「该有文件却 0 实体」）。
4. `sourceFiles` 与 `git ls-files <source>` 独立口径对账，差异记入 `reason`（如 symlink 重复解析）。
5. 负控制：注掉 analyze 调用或指向错产物路径 ⇒ exit 1 且 `evaluated:false`，不是 exit 0。

## Acceptance Criteria

- [ ] AC1（能取假·读不到≠干净）把 readScopeSignal 的产物路径指向不存在文件 ⇒ exit 1 且记录 `evaluated:false`；仍 exit 0 即假。
- [ ] AC2（版本入记录）metrics 记录含非空 `archguardVersion` 且等于 `archguard --version` 输出。
- [ ] AC3（0 实体 fail-closed）一个含 `.ts` 文件但被分析成 0 实体的 scope ⇒ exit 1。
- [ ] AC4（对账可见）`sourceFiles` 与 `git ls-files <source> | wc -l` 不一致时，`reason` 非空且点名差异。

## Definition of Done

runner 的每条 metrics 记录带 evaluated/reason/sourceFiles/entityCount/archguardVersion；读不到产物与 0 实体都 fail-closed；AC1–AC4 勾。

## Touches

- plugin/scripts/archguard-runner.ts（readScopeSignal + appendHistory + main + HistoryRecord）
- plugin/test/archguard-structural-gate-fan-in.test.mjs（读不到/0 实体负控制）
- tasks/gap-archguard-runner-missing-not-evaluated-state-and-version.md