---
id: gap-suite-lock-slot-seam-asymmetry
title: "suite 槽数 seam 不对称——suiteLockSlotCount() 读 QUAY_MAX_CONCURRENT_SUITES 不读 RESOURCE_GATE_CONCURRENT_SUITES，QUAY_MAX=1 破 5 fixture 硬编码 S=2"
status: done
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

`suiteLockSlotCount()`（TS 侧 suite-lock-slots.ts）读 `QUAY_MAX_CONCURRENT_SUITES` 直接取 S，**不读 `RESOURCE_GATE_CONCURRENT_SUITES` seam**；而 bash 侧 `suite-slot-lib.sh` 认后者。seam 不对称 ⇒ 设 `QUAY_MAX_CONCURRENT_SUITES=1` 时 TS 侧读 1、测试 seam 无法覆盖，破 5 个硬编码 S=2 假设的 fixture（ac101-lane 对照轮 S=1 轮的 4 文件红即此族：full-suite-runner.test.mjs AC1/AC3/AC5 直接断言 `concurrentSuiteSlots`/`max(1,floor(nproc×oversub/S))` 公式 + resource-gate + worktree-process-reaper + pre-verified-round-record）。将来 S=2→1 落地前必须修（对照轮也因它拿不到干净结果）。

## Acceptance Criteria

- [x] AC1: `suiteLockSlotCount()` 与 bash 侧同源读 seam（`RESOURCE_GATE_CONCURRENT_SUITES` 优先，回退 `QUAY_MAX_CONCURRENT_SUITES`），两侧对称。
- [x] AC2: 负控制——`QUAY_MAX_CONCURRENT_SUITES=1` 时 5 个 fixture 不再因硬编码 S=2 假设红（读 seam 后断言自适应）。
- [x] AC3: TS==bash 槽数不变量保持（suite-slot-ssot-check I4）。

## Definition of Done

- [x] `QUAY_MAX_CONCURRENT_SUITES=1` 时 5 fixture 绿（seam 对称、断言不硬编码 S=2），scoped 绿（真实输出）。

## Touches

- tasks/gap-suite-lock-slot-seam-asymmetry.md（自身）
- plugin/scripts/suite-lock-slots.ts（suiteLockSlotCount 读 seam）
- plugin/scripts/suite-slot-lib.sh（bash 侧 seam 语义对齐）
- plugin/scripts/pre-verified-round-record.ts（第三个槽数读点改委托 canonical，消除同族 seam 不对称）
- plugin/scripts/suite-slot-ssot-check.ts（I4 注释随 seam 对称更新）
- plugin/test/suite-slot-ssot-check.test.mjs（seam 对称负控制 + I4 能取假改注入漂移）
- plugin/test/full-suite-runner.test.mjs（AC2 默认断言清 seam）
- plugin/test/resource-gate.test.mjs（AC5 断言自适应 S + 判据4 清 seam）
- plugin/test/worktree-process-reaper.test.mjs（fullSuiteLockFiles 断言自适应 S）
- plugin/test/pre-verified-round-record.test.mjs（concurrentSuiteSlots / concurrentSuitesRunning 断言自适应 S）
