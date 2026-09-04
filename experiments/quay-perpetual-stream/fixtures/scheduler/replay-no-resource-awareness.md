# Fixture — replay-no-resource-awareness (AC5: 2026-08-03 03:37Z inner dispatch replay; faithful copy of tasks/gap-no-resource-awareness-heavy-ops-run-blind.md's `## Touches`)
**type:** execution
## Touches
- scripts/resource-gate.sh（新增，本任务核心产出）
- scripts/test.sh
- plugin/test/resource-gate.test.mjs（新增，AC11）
- orchestration/orchestrator-loop-tick.md
- docs/analysis/fast-mode-loop-tick.md
- plugin/test/select-tests-for-touches.test.mjs（AC5 改了 exec 行，结构性断言同步更新）
- plugin/test/runner-grouping.test.mjs（同上）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（AC9 记录）
- .github/workflows/ci.yml（AC5 推导默认并发后，CI 的 10 分钟预算需要显式 `--test-concurrency=8`，
  否则推导值 1 会把全量推到预算外——显式覆盖正是本任务保留的逃生口）
- CLAUDE.md（测试条目里的「默认 --test-concurrency=8」改为「推导并发 + 资源闸」，防漂移）
