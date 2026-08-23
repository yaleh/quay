---
id: gap-ac142-llm-worker-spawn-chain-fix
title: AC142 LLM-worker spawn 链修复（fix-worker + selector 两坏例验证，阻塞项）
status: ready
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

**根因（已确认，⛔ 非假说）**：判别变量是 `--bare`。生产自然对照——`task-worker`（无 bare）3/3 `exit=0`；`selector`（bare）3/3 null；`fix-worker`（bare）10/10 exit=1，除 bare 外三者完全一致（同 wrapper/model/settings/构造路径）。机理：`claude --bare` 不读 `ANTHROPIC_AUTH_TOKEN`，而 `claude-fjdac` wrapper 显式置空 `ANTHROPIC_API_KEY=""`（第三方代理惯用）⇒ bare 下完全无凭据 ⇒ 认证失败 exit 1。**已证否的旧假说**：❌「`--settings` 缺失致权限提示退出」❌「wrapper 未生效」——三者 settings/wrapper 一致而 task-worker 成功。

**修复已落地**：`18956cad`（2026-08-23 09:37:10Z）把 `selector`/`fix-worker` 的 `bare: true` 置 `false`。**AC3/AC4 时间窗起点 = 该提交时刻**（只计落地之后）。

## Plan

1. **诊断面先行**：`spawnFixWorker`（`promotion-driver.ts:207` 当前 `stdio:["ignore","ignore","ignore"]` 无 timeout）+ selector spawn 均捕获 stdout/stderr + 设超时（对照 `runPromotionRound:221` 已有 `stdio:["ignore","pipe","ignore"]` + timeout）。
2. **根因对照**（已由生产数据满足，⛔ 无需新实验）：上面的 task-worker vs selector/fix-worker 表即判别性对照——AC2 的「若假设为假则结果不同」由「同 wrapper 同 model 同 settings、仅 bare 不同 → 结果 3/3 成 vs 13/13 败」承担。
3. **生产验证**：selector 非兜底 ≥2 + fix-worker ok=true ≥1，时间窗只计 `18956cad`（09:37:10Z）之后。

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
