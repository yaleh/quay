---
id: gap-test-file-snapshot-no-production-caller
title: "test-file-snapshot.sh「删测试文件必红」判据无生产调用者——删测试文件不触发任何红"
status: todo
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

`test-file-snapshot.sh`（「删测试文件必红」的相对 baseline 判据）**没有生产调用者**——全仓 grep 只在 `rhythm-consumer-check.ts:106-107`（自陈 `"maintenance utility, cadence aspirational"`）、`red-window-triage.ts`/`known-load-sensitive.ts` 的**注释**、`capability-catalog.sh` 的**声明条目**里被提及，三处都不是执行调用。纯函数核 `test-file-baseline.ts` 存在且能取假，但**没有持久化 baseline 文件、没有挂进 `scripts/test.sh` 或 CI**。

⇒ 删一个测试文件不会触发任何机械红，与「有守卫」的认知相反（硬规则 3b 镜像：一个看起来覆盖了、实际未接线的检查）。

## Acceptance Criteria

- [ ] AC1: `test-file-snapshot.sh` 接线进 `run_static_checks`（或等价每轮执行路径），含持久化 baseline 文件。
- [ ] AC2: 负控制——删除一个测试文件（且不在 baseline 的 --expect-added）⇒ 检查 exit 非 0。
- [ ] AC3: 检查有真实生产调用者（grep 命中一个执行调用点，不是注释/声明）。

## Definition of Done

- [ ] 删测试文件被机械挡下（真实输出，非 fixture）。
- [ ] `grep -rn test-file-snapshot.sh` 显示 ≥1 个执行调用点（非注释/declaration）。

## Touches

- tasks/gap-test-file-snapshot-no-production-caller.md（自身）
