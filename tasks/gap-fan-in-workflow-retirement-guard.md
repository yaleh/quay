---
id: gap-fan-in-workflow-retirement-guard
title: fan-in workflow 退役防回归——retirement checker + lock-events 非 wk-prod- 前缀红灯（L3）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-bootstrap-land-ff-merge-executor-first
---
**type:** execution

## Proposal

fan-in workflow 退役后的防回归（人裁定迁移序 L3）：
1. **retirement checker**（`gate-scripts-retirement` 同模式）：断言 `.claude/workflows/fan-in-execute.js` + `plugin/workflows/fan-in-execute.js` 两路径不存在 + 引用面归零（归档白名单除外）。
2. **套件红灯**：lock-events 出现非 `wk-prod-` 前缀 acquire 即红——能取假判据（出现即假），防旧路径复活；防伪造前缀靠 L1 token 闸，两者分级明确。

**前置（⛔ 硬依赖）**：L1 token 闸落地（随 `gap-execution-loop-productization-p2-p4` AC1 在 TS 模块 ff 入口实现）；AC2（断言双副本不存在）须在 SPEC P3 删除双副本（`gap-execution-loop-productization-p2-p4`）之后才可判。

## Plan

1. retirement checker：断言两 fan-in-execute.js 路径不存在 + 引用面归零（归档白名单除外）。
2. 套件红灯：lock-events 非 `wk-prod-` 前缀 acquire 即红。

## Acceptance Criteria

- [x] AC1（能取假，生产载体）：lock-events 非 `wk-prod-` 前缀 acquire 计数=0，窗口从 L1 落地起（⛔ 非 wk-prod- acquire ⇒ 假；⛔ fixture-only ⇒ 假——fixture 满足的判据不是测量，硬规则 4 推论三）。
- [ ] AC2（能取假，退役彻底）：两 fan-in-execute.js 路径不存在 + 引用面归零（归档白名单除外）；（⛔ 路径仍存在/引用未清零 ⇒ 假）。（待外部）
- [x] AC3（能取假，防复活）：出现非 `wk-prod-` 前缀 acquire ⇒ 套件红（⛔ 不红 ⇒ 假）。

## Definition of Done

退役 checker + 套件红灯落地；AC1-AC3 全勾；旧 workflow 路径不可复活。⛔ 注明：L1 落地后 L3 短期恒绿是结构性正确的（闸已挡），不是测量失效。

## Touches

- plugin/scripts/fan-in-workflow-retirement-check.ts（retirement checker，gate-scripts-retirement 同模式，断言两路径不存在 + 引用归零）
- plugin/scripts/capability-catalog.sh（新增机件六表注册面）
- plugin/scripts/runner-static-gate.ts（套件红灯接线——@static-tier full，AC3「非 wk-prod- 前缀 acquire ⇒ 套件红」的 run_static_checks 注册）
- plugin/scripts/checker-mutation-cases/fan-in-workflow-retirement-check.sh（retirement checker 的 mutation case——checker-mutation-check AC1b「新 checker 必须有 mutation case」）
- plugin/test/fan-in-workflow-retirement-check.test.mjs（retirement checker 测试 + 非 wk-prod- 前缀红灯负控制）
- tasks/gap-fan-in-workflow-retirement-guard.md（自身）