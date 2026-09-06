---
id: gap-meta-driver-concurrency-literal-cap-undeclared
title: meta-driver 两处 per-round cap 字面量未声明，concurrency-literal-check 红并挡全量 suite
status: ready
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

- [ ] `node plugin/scripts/concurrency-literal-check.ts --gate --root .` 退出 0（meta-driver.ts 两处不再判违规）
- [ ] 负控制：把这两处 cap 改回无标记的裸字面量后，checker 仍报违规 exit 1（证明没有放宽检查器本身）

## Definition of Done

meta-driver.ts 的两处 per-round cap 以声明方式合法化（`concurrency-default-fallback` 标记或定义点），`concurrency-literal-check --gate` 退出 0；全量 suite 的 failedCheckers 不再含 concurrency-literal-check。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/test/concurrency-literal-check.test.mjs
- tasks/gap-meta-driver-concurrency-literal-cap-undeclared.md
