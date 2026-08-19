---
id: gap-npm-file-copy-amortize
title: "npm/文件复制类摊销——smoke-gate 3 test 重复 pack+install + capability-catalog 5 test 复制 261 脚本"
status: ready
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

两处「验证机制本身不变、只是复现方式没摊销」的同模式浪费：

1. `packages/quay/test/delivery-standalone-smoke-gate.test.mjs`：A2/C1/D1 三个 test 各自独立重跑「npm pack → npm install --omit=dev → 2 次 CLI」全链路，验证三个不同接入面但产物状态相同。可仿 `quay-init-loop-helpers.mjs` 手法摊销一次 pack+install，预计省 ~2/3 npm 操作耗时。
2. `plugin/test/capability-catalog.test.mjs`：5 个 test 各自把 `plugin/scripts` 全部 261 个脚本 `fs.copyFileSync` 复制进新 tmp 目录（共 ~1300+ 次文件复制）。可摊销成 1 份共享只读基线 + 每 test 单文件 patch。

两处机制（真跑 npm / 真跑 bash 脚本，不 mock）不能改，负控制可信度不受影响——问题只在「复现方式重复做同一件昂贵的事」。

## Acceptance Criteria

- [x] AC1: smoke-gate 三个 test 摊销一次 npm pack+install（产物状态相同，只验证不同接入面）。
- [x] AC2: capability-catalog 摊销成 1 份共享只读基线 + 每 test 单文件 patch（不再 5×261 次全量复制）。
- [x] AC3: 机制不变（真跑 npm / 真跑 bash，不 mock），scoped 绿 + 负控制可信度不降（真实输出）。

## Definition of Done

- [x] 两处摊销落地，npm/复制耗时显著下降、机制不变，scoped 绿（真实输出）。

## Touches

- tasks/gap-npm-file-copy-amortize.md（自身）
- packages/quay/test/delivery-standalone-smoke-gate.test.mjs（摊销 pack+install）
- packages/quay/test/delivery-standalone-smoke.sh（smoke-gate 脚本，QUAY_DELIVERY_SMOKE_BASE 落点）
- plugin/test/capability-catalog.test.mjs（摊销共享基线）
