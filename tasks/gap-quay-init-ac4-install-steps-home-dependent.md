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

- [x] AC4 测试改用隔离 HOME（grep 显示 `runInitEnv(ws, INIT_ARGS(ws), { HOME: ... })`），且本机 `node --test --test-name-pattern="AC4 — the output carries"` 绿
- [x] 负向控制：同一测试去掉 HOME 隔离仍红（`present` 分支），证明隔离是生效变量
- [x] `grep -n "marketplace add yaleh" packages/quay/src/init.ts` 命中（recipe 确实在产品源码，本任务不动它）

## Definition of Done

quay-init AC4 在本机（已装 quay@quay）与干净宿主都绿；recipe 留在产品源码未被删改；同文件其它 install-steps 断言按需同样隔离。

## 验证记录

- 基线（改动前，真 $HOME = 本机已装 quay@quay 0.24.0）：AC4 红，`printInstallSteps` 走 `present` 分支——与任务定位一致。
- 修复后：`{ HOME: <临时空目录> }` ⇒ `not-evaluated` ⇒ fresh recipe 打印；AC4 绿，整文件 18/18 绿。
- 负向控制：把 `{ HOME: home }` 去掉后重跑，**红在新增的 `doesNotMatch(/ALREADY INSTALLED/)` 上**（而不是「recipe 缺席」）——隔离确为生效变量，且该断言能取假（硬规则 2 的零计数半边）。
- Plan 第 3 步（同族 5b）：同文件 AC3（install note）的断言全部落在**两臂共有**的文本上，故无需隔离。实测（同一命令分别以真 $HOME 与隔离 $HOME 跑 `quay init`，统计 AC3 的四条谓词）：`plugin update` 2/1、`/quay:init` 1/1、`uninstall quay@quay` 0/0、false AC-161 claim 0/0 —— 两臂均满足 AC3；而两臂的差异恰好出现在 `ALREADY INSTALLED` 1/0 与 `marketplace add yaleh/quay` 0/1（谓词能取假的对照）。
- ⚠️ 合并 develop 时发现该修复**已由另一会话于 2026-10-28 11:45 落在 develop**（`2dfb4be6f`，内联 `const home = makeTmp()`）。冲突按 develop 的**机制**解决（不新增第二个 helper），只保留本分支的增量：`doesNotMatch(/ALREADY INSTALLED/)` 臂断言 —— 它让「隔离失效」以自己的名字报红，而不是伪装成「recipe 丢了」（硬规则 3b）。
- 退出时状态（develop=`390566853`）：本任务 delta 的自测绿，但 `scripts/test.sh --for-task gap-quay-init-ac4-install-steps-home-dependent --allow-thin` 的**静态层红**，且**不是本任务的改动**：①在 develop tip 的干净树上同样复现（`sh-census-check` exit=1）；②该 checker 自己的逐文件读数把 +3 归给 `plugin/scripts/manual-full-suite.sh`（`codeLines=3, embedded=["node"]`，由 develop 提交 `8401f8b95` 引入）；③本任务 delta 不触任何 `.sh`（`git diff develop --stat` = 1 个测试文件、+5 行）。该轮并行静态层只报 1 条 `STATIC_CHECK_FAILED`（其余 checker 全过）。修复（重锚 `plugin/sh-census-baseline.json` + `_reanchorLog` 理由，或由人裁定例外）属于那次提交的所有者，**不在本任务 Touches 内** ⇒ **未写 scoped-gate 缓存**（把没跑过的绿写成绿 = 硬规则 3b）。

## ADR-007 暗轴记录

该轴仍暗,理由:本任务只改 plugin/test/quay-init.test.mjs 一处子进程 HOME 注入（生产代码 0 文件、新增依赖边 0 条，复用文件已 import 的 fs/os/path），L_D/L_G 无本任务可归因的读数。

## Touches

- plugin/test/quay-init.test.mjs
- tasks/gap-quay-init-ac4-install-steps-home-dependent.md
