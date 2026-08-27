---
id: gap-suite-force-color-ansi-test-sh-normalize
title: FORCE_COLOR=3 环境雷——test.sh 整个运行归一（输出确定性是断言测试的前提，一行先落地）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`FORCE_COLOR=3` 在环境里、且没有任何代码清洗，是**确定性**测试雷（区别于静默看门狗的间歇竞态）：

- `fan-in-workflow-lock.test.mjs:171` 的 `spawnSync` 子 node 继承 `FORCE_COLOR=3`；
- `console.log` 即使在管道下也吐 ANSI 色码（`\x1B[33m…\x1B[39m`）；
- ⇒ `'\x1B[33m1\x1B[39m' !== '1'` 断言确定性失败（suite 日志逐字吻合）。

**类级**：任何「输出断言」测试在 FORCE_COLOR=3 下都不可信——输出确定性是断言测试的前提。前例：`instrument-failure-check.sh:61-62` 同根假红（曾用 `env -u FORCE_COLOR` 单点补丁）。

**supersedes** `gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi`（round parser 是同一根因的另一个症状，其 ANSI-aware 解析是补丁；本任务在 test.sh 层一次性归一，两症状一起消失）。

## Plan

1. **test.sh 整个运行 FORCE_COLOR 归一**（一行先落地）：`export FORCE_COLOR=0` 或 `unset FORCE_COLOR`（在 test.sh 入口，覆盖所有子进程/spawnSync 继承）。
2. 修完负控制：归一后 `fan-in-workflow-lock.test.mjs:171` 断言在 FORCE_COLOR=3 环境里也绿（真实读环境，⛔ 非 fixture-only）。

## Acceptance Criteria

- [ ] AC1（能取假，归一已生效）：FORCE_COLOR=3 环境下 `scripts/test.sh` 跑 `fan-in-workflow-lock.test.mjs` 绿（⛔ 仍 `'\x1B[33m1\x1B[39m' !== '1'` ⇒ 假）。
- [ ] AC2（能取假，全运行覆盖）：test.sh 入口归一覆盖所有子进程/spawnSync 继承（⛔ 只修单点 ⇒ 假）。

## Definition of Done

test.sh 入口 FORCE_COLOR 归一落地；AC1-AC2 全勾；输出断言测试在 FORCE_COLOR=3 下确定性绿。

## Touches

- scripts/test.sh（入口 FORCE_COLOR 归一）
- plugin/test/fan-in-workflow-lock.test.mjs（输出断言负控制）
- plugin/scripts/checker-mutation-cases/instrument-failure-check.sh（同根单点补丁，归一后回退 env -u 单点，若涉）
- tasks/gap-suite-force-color-ansi-test-sh-normalize.md（自身）
