---
id: gap-adr-gate-test-fixture-isolation-live-task-store
title: adr-gate.test.mjs 把一次性 fixture 写进 live tasks/ 与 store 全量 scan 竞态 ENOENT——test-isolation 缺陷
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`packages/quay/test/adr-gate.test.mjs`（Stage 3，~:262）把一次性 fixture task `T-ADR001-e2e-fixture.md` 写进 **live `REPO_ROOT/tasks/`**（非隔离 tmp），`finally` 里 `rmSync`。16-lane 满负载下与 `packages/quay-native/test/store.test.mjs` AC5 全量 scan（`readdirSync(tasksDir)` → 逐文件 `readFileSync`）竞态：readdir 列出 fixture → adr-gate `finally` rmSync → store `readFile` ENOENT。实证 2026-08-30 20:21 gap-retire-governance fan-in suite 2 fail 之一（store.test.mjs AC5 ENOENT `tasks/T-ADR001-e2e-fixture.md`，`in_family=null` 非已知族）。

**这是 `gap-r1-cannot-see-tests-writing-into-the-live-task-store`（done）的漏网实例**——gap-r1 只修了 R1 那一个写 live task store 的测试、没 grep 全族（硬规则 5b「修好一个 ≠ 只有那一个」）。本任务补 adr-gate 这个实例。

**约束（⛔ 非 trivial「写 tmp」）**：adr-gate 测试的 fixture 之所以放 live tasks/，是注释自证——`adr-<id>` gate「always runs inside the repo the ADR governs」，孤立 tmp workspace 会让 enforcement command（`quay gate T-ADR001-e2e-fixture --gate adr-001`）unresolvable（exit-127，注释已证）。故修复必须**既隔离 fixture、又不破坏 gate 在真实 repo 内的解析**——两者缺一不可。

## Plan

1. 修 adr-gate.test.mjs：fixture 不再写进 live `REPO_ROOT/tasks/`。方向（实现方按约束择一，⛔ 不得继续写 live tasks/）：① 隔离 tmp workspace（自带 config + tasks dir + adr dir，adr dir 指向或拷自真实 repo 的 `adr/`），让 adr-001 gate 在 tmp 内可解析；② 或 fixture 写进 repo 内一个**不与 live tasks/ 重叠**的临时目录，gate 命令 cwd/参数显式指向它。参照 gap-r1 已确立的隔离手法。
2. 全族 grep（硬规则 5b）：枚举所有把一次性 fixture 写进 live `tasks/` 或 `REPO_ROOT` 共享目录的测试（不止 adr-gate、R1），逐个确认已隔离或已豁免——把命中数与前 3 条贴进提交。
3. 负控制：16-lane 满负载下 store.test.mjs AC5 与 adr-gate 并发多次，无 ENOENT。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：adr-gate.test.mjs 不再写 live `tasks/`——grep 无 `REPO_ROOT.*tasks` 的 fixture 写、fixture 路径是隔离 tmp；（⛔ 仍写 live tasks/ ⇒ 假）。
- [ ] AC2（能取假，全族）：grep 全仓写 live task store 的测试 fixture，仅剩已隔离/已豁免者，命中数贴提交；（⛔ 还有漏网实例 ⇒ 假）。
- [ ] AC3（能取假，负载）：16-lane 满负载下 store.test.mjs AC5 + adr-gate 并发 20 连跑 0 ENOENT；（⛔ 仍 ENOENT ⇒ 假）。

## Definition of Done

adr-gate fixture 隔离落地（不写 live tasks/ 且 gate 可解析）；全族 grep 无漏网实例；16-lane 负载负控制无 ENOENT；AC1-AC3 全勾；全量 suite 绿。

## Touches

- packages/quay/test/adr-gate.test.mjs（fixture 隔离，不写 live tasks/）
- packages/quay-native/test/store.test.mjs（如需：scan 容忍/过滤 transient fixture）
- tasks/gap-adr-gate-test-fixture-isolation-live-task-store.md（自身）
