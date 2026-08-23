---
id: gap-ac142-llm-worker-spawn-chain-fix
title: AC142 LLM-worker spawn 链修复（fix-worker + selector 两坏例验证，阻塞项）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投立案（人 2026-08-23 逐字裁定「阶段0（阻塞）：修 LLM-worker spawn 链，用 fix-worker + selector 两个坏例验证」）。本条是**下一阶段全部 AC 的地基**——所有拟建 driver 都经同一条 `quay-launch.sh <role> --bare -p` 链起 LLM worker，该链当前 **13/13 全败**。

**发生率（manager 直读生产载体，⛔ 非旧值）**：fix-worker `action="fix"` 10 条 `result.ok` 全 False（`spawned exit=1`），连带 3 个真实任务被打 needs-human；selector 3/3 兜底（`no valid pick`）。合计 **13/13 = 100%**，非潜在风险，正在实时吃掉任务吞吐。

## Plan

1. **诊断面先行**：`spawnFixWorker`（`promotion-driver.ts:207` 当前 `stdio:["ignore","ignore","ignore"]` 无 timeout）+ selector spawn 均捕获 stdout/stderr + 设超时（对照 `runPromotionRound:221` 已有 `stdio:["ignore","pipe","ignore"]` + timeout）。
2. **根因附能区分对照**：同一 prompt 分别 `quay-launch.sh <role> --bare -p "<prompt>"` 与裸 `claude -p "<prompt>"` 各跑一次，用对照定案（⛔ 不接受自洽解释）。
3. **生产验证**：selector 非兜底 ≥2 + fix-worker ok=true ≥1，时间窗只计修复落地后。

## Acceptance Criteria

- [ ] AC1（诊断面）：spawnFixWorker 与 selector spawn 捕获 stdout/stderr + timeout 落进可查载体；取假：落地后 spawn 失败而载体无 stderr ⇒ 假。
- [ ] AC2（根因对照）：根因结论附「若假设为假则结果不同」的对照（quay-launch.sh vs 裸 claude）；取假：无对照的自洽解释 ⇒ 假。
- [ ] AC3（selector 生产验证）：修复落地后 `worker-outcome.jsonl` `selector_reason` 非兜底 ≥2 条（窗口只计落地后）；取假：仍全 fallback ⇒ 假。
- [ ] AC4（fix-worker 生产验证）：修复落地后 `promotion-outcome.jsonl` `action="fix"` 且 `result.ok=true` ≥1 条（窗口只计落地后）；取假：仍全 ok:false ⇒ 假。

## Definition of Done

- [ ] 诊断面 + 根因对照 + selector/fix-worker 生产验证；AC1-4 全勾；land 到 develop。

## Retires

- gap-fix-worker-spawn-zero-diagnostic-info（AC142-1 的 fix-worker 侧诊断，被本条吸收为 AC1）

## Touches

- plugin/scripts/promotion-driver.ts（spawnFixWorker stdio + timeout）
- plugin/scripts/worker-driver.ts（selector spawn stdio + timeout）
- plugin/test/promotion-driver.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-ac142-llm-worker-spawn-chain-fix.md（自身）

> **注意**：⛔ 不在本条裁定具体根因（AC2 要求对照后才有结论）；⛔ 不改 selector 排序策略（AC129 非目标）。
