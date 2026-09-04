---
id: gap-suite-duration-exceed-check-not-wired
title: "suite-duration-exceed-check.ts 未接线 scripts/test.sh/ci.yml——suite 超时不报"
status: done
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`suite-duration-exceed-check.ts`（检测 suite 超时的判据）**未接进 `scripts/test.sh` 或 `.github/workflows/ci.yml`**——grep 零命中，与它自己头部注释的自陈一致（只有「怎么跑」的说明，没有挂载点）。它本身能取假，但因为没有调用者，suite 超时（如「把测试挪出 suite 以绕过时间限制」的一种表现形式）不会触发任何报出。

## Acceptance Criteria

- [x] AC1: `suite-duration-exceed-check.ts` 接线进静态检查相（`run_static_checks` 或等价每轮执行路径）。
- [x] AC2: 负控制——一个超时场景使检查 exit 非 0（真实触发，非 fixture）。
- [x] AC3: grep 命中 ≥1 个生产调用点（非注释/declaration）。

## Definition of Done

- [x] suite 超时被机械报出（真实输出）。
- [x] `grep -rn suite-duration-exceed-check` 显示 ≥1 个执行调用点。

## Touches

- tasks/gap-suite-duration-exceed-check-not-wired.md（自身）
- plugin/scripts/suite-duration-exceed-check.ts
- scripts/test.sh
- plugin/scripts/checker-mutation-cases/suite-duration-exceed-check.sh
- plugin/scripts/capability-catalog.sh
- plugin/test/suite-duration-exceed-check.test.mjs
