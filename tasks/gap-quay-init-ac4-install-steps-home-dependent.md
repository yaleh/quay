---
id: gap-quay-init-ac4-install-steps-home-dependent
title: quay-init AC4 红：install-steps 测试继承真实 HOME，已装机器上 present 分支不打印 fresh recipe
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

全量轮（127-lane）复现 quay-init.test.mjs AC4 红：「must print the FULL github recipe claude plugin marketplace add yaleh/quay」。定位：recipe 没丢（`packages/quay/src/init.ts:4071` 仍在 `printInstallSteps` 的 `freshInstallSteps` 分支），但 `printInstallSteps` 按 `userScopedInstallReading($HOME)` 三态分流——本机 user scope 已装 quay@quay ⇒ `present` 分支打印「ALREADY INSTALLED」而**不打印** fresh recipe。测试 `runInitEnv` 继承真实 `process.env.HOME`，于是本机恒 `present` ⇒ recipe 恒缺席 ⇒ 红。这是测试的宿主依赖（在已装机器上红、在干净机器上绿），不是产品回归。

## Plan

1. 在 quay-init.test.mjs 的 AC4（install-steps）测试里给 `runInitEnv` 传隔离 `HOME`（临时空目录，无 `.claude/plugins/installed_plugins.json`）⇒ 强制 `not-evaluated`/`absent` 态 ⇒ fresh recipe 打印。
2. 负向确认：隔离 HOME 后该测试在本机（已装 quay@quay）绿；不隔离时仍红（证明隔离是生效变量，不是空转）。
3. 检查同文件里其它依赖 install-steps 输出的断言是否也需隔离（同族 5b）。

## Acceptance Criteria

- [ ] AC4 测试改用隔离 HOME（grep 显示 `runInitEnv(ws, INIT_ARGS(ws), { HOME: ... })`），且本机 `node --test --test-name-pattern="AC4 — the output carries"` 绿
- [ ] 负向控制：同一测试去掉 HOME 隔离仍红（`present` 分支），证明隔离是生效变量
- [ ] `grep -n "marketplace add yaleh" packages/quay/src/init.ts` 命中（recipe 确实在产品源码，本任务不动它）

## Definition of Done

quay-init AC4 在本机（已装 quay@quay）与干净宿主都绿；recipe 留在产品源码未被删改；同文件其它 install-steps 断言按需同样隔离。

## Touches

- plugin/test/quay-init.test.mjs
- tasks/gap-quay-init-ac4-install-steps-home-dependent.md
