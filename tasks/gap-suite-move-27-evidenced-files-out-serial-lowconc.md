---
id: gap-suite-move-27-evidenced-files-out-serial-lowconc
title: 27 个有证据文件直接移出 serial/lowconc 降并发名单（fail=0 高负载验证，不抽查）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

人裁定：27 个文件证据在手（22-60 次独立重复、fail=0、round-level load 覆盖 29.0-45.3 真实高负载），**不用走 ③ 计划里的「抽查」步骤，直接移出 serial/lowconc 降并发名单**。含 `stage-receipt.test.mjs`（从「待观察」转证据组——41 次 bucket-path 记录 fail=0，已并入）。默认组按 `scripts/test.sh:70-96` 文档规则：`packages/*/test/` → product、`plugin/test/` 其余 → engine（`experiments/` 默认 engine），逐个核实。

清单（27，刚拉取最新数据逐个 fail=0）：见 ③ 历史/manager 移交清单——packages/quay/test（sea-artifact-consumer-e2e、npm-pack-e2e、install-config-driven-e2e、install-config-driven-e2e-upgrade、install-config-driven-e2e-runtime、build-dist-smoke、goal-gate、delivery-standalone-smoke-gate、sea-bundle-plugin-sidecar、acceptance、verify-sea-artifact）、packages/quay-github/test（create、create-mcp）、packages/quay-native/test（relation-sync）、plugin/test（measure-suite、session-liveness-restart、quay-init-loop-vendor、fan-in-materialize-check、fan-in-workflow-check、productization-verification-record-check、rhythm-consumer-check、worktree-root-fs-check、quay-init-loop-driver、quay-init-loop、session-liveness、quay-init-loop-runtime）、experiments/quay-perpetual-stream/test/stage-receipt。

## Plan

27 文件头部 `// @test-group serial` / `// @test-group lowconc` 改为默认组（product/engine，按规则逐个核实）；suite 仍绿。

## Acceptance Criteria

- [ ] AC1（能取假，移出降并发）：27 文件 @test-group 从 serial/lowconc 改为默认组（⛔ 仍标 serial/lowconc ⇒ 假）。
- [ ] AC2（能取假，suite 仍绿）：改后 suite 绿（行为不变）；（⛔ suite 红 ⇒ 假）。

## Definition of Done

27 个有证据文件已移出 serial/lowconc 降并发名单：@test-group 由 serial/lowconc 改为默认组（product/engine，按 scripts/test.sh 规则逐个核实）；AC1、AC2 全勾；改后 suite 仍绿；无文件残留 serial/lowconc 标记。

## Touches

- packages/quay/test/
- packages/quay-github/test/
- packages/quay-native/test/
- plugin/test/
- experiments/quay-perpetual-stream/test/stage-receipt.test.mjs
- tasks/gap-suite-move-27-evidenced-files-out-serial-lowconc.md（自身）