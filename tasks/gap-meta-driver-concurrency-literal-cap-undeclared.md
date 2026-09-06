---
id: gap-meta-driver-concurrency-literal-cap-undeclared
title: meta-driver 两处 per-round cap 字面量未声明，concurrency-literal-check 红并挡全量 suite
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/meta-driver.ts:978`（`driveItems(..., { cap: 1, dryRun, at })`，autoDrive 每轮至多 1 条）与 `:981`（`fileDecisions(..., { cap: 2, dryRun, at })`，decisions 每轮至多 2 条）是两处未声明的并发数值字面量：P4 object-literal concurrency key `cap: <num>`，既不在 `QUAY_MAX_*` 定义点、也无 `concurrency-default-fallback` 标记。`concurrency-literal-check --gate` 判其违规 exit 1。两处今日 2026-09-06 11:11-11:30 由 commits 163825dfa1 / 1abea2b70e 引入 meta-driver（gap-writestate 任务实现者实测撞到）。

代价：全量 suite 现红（`.quay/full-suite-state.json` state=red，failedCheckers 含 concurrency-literal-check exit=1；另有 quay-init-closure-ratchet exit=1 是另一条机制，不属本任务），且任何 Touches 含 plugin/scripts/ 文件的任务 scoped 门都会被拉入该 repo-level 检查而红。

修法（择一，实现者定）：给这两处 per-round cap 加 `concurrency-default-fallback` 标记（正当化：每轮 auto-drive 至多 1 条 / decisions 至多 2 条是语义上限，非机器规格依赖）；或路由到唯一定义点（QUAY_MAX_* env 读派生）。

## Acceptance Criteria

- [x] `node plugin/scripts/concurrency-literal-check.ts --gate --root .` 退出 0（meta-driver.ts 两处不再判违规）
- [x] 负控制：把这两处 cap 改回无标记的裸字面量后，checker 仍报违规 exit 1（证明没有放宽检查器本身）

## Definition of Done

meta-driver.ts 的两处 per-round cap 以声明方式合法化（`concurrency-default-fallback` 标记或定义点），`concurrency-literal-check --gate` 退出 0；全量 suite 的 failedCheckers 不再含 concurrency-literal-check。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/test/concurrency-literal-check.test.mjs
- tasks/gap-meta-driver-concurrency-literal-cap-undeclared.md
## Needs-Human

**执行 2026-09-06T15:43:12.340Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: # fail 1
- run_id：wk-prod-1788700330
- session_id：ba5b4ba3-2dad-4112-a3f7-1c6ad8ad156e
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-meta-driver-concurrency-literal-cap-undeclared~wk-prod-1788700330~1788709290059-77c6ce.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-meta-driver-concurrency-literal-cap-undeclared-wk-prod-1788700330.log
