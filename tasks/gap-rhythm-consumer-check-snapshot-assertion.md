---
id: gap-rhythm-consumer-check-snapshot-assertion
title: "rhythm-consumer-check.test.mjs:134 快照常量断言——assert nbs.length===2 把「当前恰好 2 个 --no-block checker」瞬态当不变式"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`plugin/test/rhythm-consumer-check.test.mjs:134` 断言 `assert.equal(nbs.length, 2)`——把「当前恰好 2 个 `--no-block run_checker`」这个【瞬态】当成不变式。`gap-suite-duration-exceed-check-not-wired` 的 AC1 正确接线（`scripts/test.sh:781` 加 `run_checker "suite-duration-exceed-check" ... --no-block`，`--no-block` 集合 2→3）暴露了它：新增**任何** `--no-block` checker 都会破坏该断言。

**硬规则 4 推论二/C12 形态**：把「当前恰好 N 个」的字面值当不变式——换一台机器/加一个 checker 就失效，且静默。这是既有测试缺陷，不是 suite-duration 实现错误（suite-duration 的接线是对的）。

## Acceptance Criteria

- [ ] AC1: `rhythm-consumer-check.test.mjs:134` 改动态断言（`nbs.length >= 2` 或明确列举期望的 checker 集合），不再硬编码「恰好 2 个」。
- [ ] AC2: 负控制落在生产载体——新增一个 `--no-block` checker 后该断言不破（读真实 suite 输出，非 fixture）。
- [ ] AC3: scoped 绿 + rhythm-consumer-check 相关测试不红。

## Definition of Done

- [ ] 新增 `--no-block` checker 不再破坏 rhythm-consumer-check 断言（真实输出），scoped 绿。

## Touches

- tasks/gap-rhythm-consumer-check-snapshot-assertion.md（自身）
- plugin/test/rhythm-consumer-check.test.mjs（:134 快照断言改动态）
