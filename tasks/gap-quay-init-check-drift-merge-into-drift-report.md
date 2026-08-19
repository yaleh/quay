---
id: gap-quay-init-check-drift-merge-into-drift-report
title: "check-drift.test.mjs 并入 drift-report.test.mjs——同一 gap 重复覆盖，退休 check-drift 省 ~370s/轮"
status: todo
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`quay-init-check-drift.test.mjs` 与 `quay-init-drift-report.test.mjs` 重复覆盖**同一个 gap**（`gap-delivery-surface-grows-but-target-freezes-no-upgrade`），断言同一段生产代码（`compute_drift_report` / `--check-drift` / `--loop` 升级路径），AC 编号逐条对应。2026-08-06 A/B 两台机器各自独立实现同一 gap，merge commit `8e2e49b9` 时两边测试文件因文件名不同未冲突、都被留下，此后无人去重。

`gap-serial-install-family-shared-prebuilt-fixture`（9578de67）把共享 fixture 摊销接进了 drift-report.test.mjs，唯独没接 check-drift.test.mjs——后者至今每 test 全新复制整个 plugin 树 + 独立起 `--loop` 安装，是同族四个文件里最重的。实测：check-drift 372079ms vs drift-report 209597ms，且 check-drift 没有任何 drift-report 未覆盖的独有场景。

## Acceptance Criteria

- [ ] AC1: check-drift.test.mjs 并入 drift-report.test.mjs——保留双方各自独有断言细节（check-drift 的独立 before/after 对照、drift-report 的 fresh-target 只读+幂等），退休 check-drift.test.mjs。
- [ ] AC2: 负控制落在生产载体——并入后一轮真实 suite 里，原 check-drift 覆盖的 gap（delivery-surface 冻结不更新）仍有测试断言（读真实 suite 日志，非 fixture），覆盖率不丢。
- [ ] AC3: scoped 绿 + 单轮该族耗时显著下降（check-drift 372079ms 的独有开销消除）。

## Definition of Done

- [ ] check-drift.test.mjs 退休、其覆盖并入 drift-report.test.mjs，单轮省 ~370s、覆盖率不丢（真实输出，非 mock）。

## Touches

- tasks/gap-quay-init-check-drift-merge-into-drift-report.md（自身）
- plugin/test/quay-init-drift-report.test.mjs（并入 check-drift 独有断言）
- plugin/test/quay-init-check-drift.test.mjs（退休/删除）
