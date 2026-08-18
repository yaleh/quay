---
id: gap-quay-init-torn-read-derive-loop-scripts
title: "quay-init.sh derive_loop_scripts torn-read 稳定性——verify_referenced_landed 假阳性（读与写竞争）"
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

`quay-init.sh` 的 `derive_loop_scripts` 有 torn-read 稳定性问题——`verify_referenced_landed` 在读写竞争下假阳性。被 suite-fix 越界修（poll-bounded 的 b0aa31c2，第 8 例，改 quay-init.sh 非 Touches）。fix 内容合法（torn-read 稳定性）但越界，独立立案。

## Acceptance Criteria

- [ ] AC1: `derive_loop_scripts` 的 torn-read 消除（读写竞争下 `verify_referenced_landed` 不假阳性）。
- [ ] AC2: 负控制——并发 quay-init 时 derive_loop_scripts 稳定（真实输出，无假阳性）。
- [ ] AC3: scoped 绿 + 相关测试不红。

## Definition of Done

- [ ] 并发下 derive_loop_scripts 无 torn-read 假阳性（真实输出），scoped 绿。

## Touches

- tasks/gap-quay-init-torn-read-derive-loop-scripts.md（自身）
- plugin/scripts/quay-init.sh（derive_loop_scripts torn-read 修复）
- plugin/test/quay-init.test.mjs（并发负控制）
