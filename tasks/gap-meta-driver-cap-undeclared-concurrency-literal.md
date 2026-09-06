---
id: gap-meta-driver-cap-undeclared-concurrency-literal
title: meta-driver.ts cap:1/cap:2 未声明并发字面量 → concurrency-literal-check 红，挡触及
  plugin/scripts 的 fan-in
status: ready
labels:
  - gap
  - gate
parent: null
children: []
extra:
  acceptance: node --experimental-strip-types
    plugin/scripts/concurrency-literal-check.ts --gate --root .
---
## Finding

`plugin/scripts/meta-driver.ts:978,981` 的 `driveItems(..., { cap: 1, ... })` 与 `fileDecisions(..., { cap: 2, ... })` 是两处未声明并发数值字面量（P4 object-literal `cap:` 键），由 2026-09-06 的 meta-driver 提交（163825dfa1「加自动驱动通道」11:11、1abea2b70e「humanAttention 改成路由通道」11:30）引入，未带 `concurrency-default-fallback` 标记、也未从 QUAY_MAX_* 定义点派生。concurrency-literal-check --gate 实测 322 文件扫描报 2 违规（其余 10 处均已声明），使任何 Touches 含 `plugin/scripts/` 的任务 scoped gate 红——本任务 gap-shape-section-tables-dual-copy-no-single-source 即因此两次 exited-not-landed（缺陷在 develop，非该任务自身）。语义上这两处是「每轮至多 1 条自动驱动 / 至多 2 条决策」的语义节流（justified default，非机器规格派生值），正是 `concurrency-default-fallback` 标记覆盖的形态。

## AC

- [ ] `plugin/scripts/meta-driver.ts:978` 与 `:981` 两处 `cap:` 字面量各带 `concurrency-default-fallback` 标记注释（说明是语义节流默认值而非机器规格派生），或改为从 QUAY_MAX_* 定义点派生。判据：`node --experimental-strip-types plugin/scripts/concurrency-literal-check.ts --gate --root .` exit 0。
- [ ] --gate 输出的 violations 恰为 0 条（不是「仅剩这两条」，是 0）。
- [ ] `plugin/test/concurrency-literal-check.test.mjs` 全绿（declared-exception 机制已被既有测试覆盖，本次不新增测试）。

## DoD

- [ ] 上述 --gate 判据实跑通过并贴出输出（非转述、非「应该会过」）。
- [ ] 未新增任何周期性/定时检查机制；修法是给既有检查器的「已声明例外」机制补标记（或改定义点派生），非新造机件。

## Touches

- `plugin/scripts/meta-driver.ts`
- `tasks/gap-meta-driver-cap-undeclared-concurrency-literal.md`
