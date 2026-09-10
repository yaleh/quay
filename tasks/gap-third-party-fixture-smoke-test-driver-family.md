---
id: gap-third-party-fixture-smoke-test-driver-family
title: driver 家族缺一个「无 plugin/、工作分支非 author」的第三方最小夹具冒烟测试——本轮 6 个同类缺陷全靠真实生产环境试错才发现
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-09-09/10 的 GOAL-009 AC-207 端到端复跑，先后在真实的 orangevps 第三方项目上撞出 6 个独立缺陷（`resource-gate.sh` 锚点、shipped `profiles.yml` 缺 role、`promotion-driver.ts`/`worker-driver.ts` 三处同锚点、`worker-driver.ts` 另 3 处 + `cap-from-gate.ts` 1 处同锚点、`DOC_BRANCH` 硬编码 `"author"`）——**全部靠在真实第三方机器上跑一次才发现，全部同属两个根因类别**：

- **A 类（4 个实例）**：driver 家族文件把脚本路径锚在 `<var>/plugin/scripts/*`，第三方项目（quay-init 布下的面，无 `plugin/`）恒 `Cannot find module`/exit 127。
- **B 类（1 个实例，`DOC_BRANCH`）**：把仓库自己的具体配置值（工作分支名 `"author"`）当成协议常量硬编码，第三方项目工作分支不叫这个名字时静默失效。

**这两类缺陷有一个共同特征：本仓库自己永远测不出来**——A 类因为本仓库自己就有 `plugin/`；B 类因为本仓库工作分支恰好就叫 `author`。**任何只在本仓库上跑的单测，无论写多细，都无法覆盖这两类缺陷**——需要的是一个真正「不像本仓库」的环境。

**系统检查已验证的两个事实（本任务立案前实测，非猜测）**：
1. 全仓 90 个检查器（`bash plugin/scripts/capability-catalog.sh`）里，**零个**覆盖「driver 家族文件锚死在 `root/plugin/scripts`」这一维度。
2. A 类缺陷的静态检测本身是可行的（round2 立案时一次全仓 grep 就找全了剩余实例）——**说明批量发现完全可以替代逐次试错**，只是此前没人做过一次性扫描。

## Plan

1. 建一个**最小合成夹具**：临时目录，`git init`，创建 `main` 分支（⛔ 不叫 `develop`/`author`）+ `develop` 分支（quay-init 的标准约定），**无 `plugin/` 目录**，最小 `.quay/config.yml` + 一条 todo 任务。
2. 针对该夹具跑 driver 家族的关键函数（`resourceGateCheck`/`defaultPromotionCheckArgv`/`analyzeTasks`/`applyPromotions`/`syncDocDevelopBidirectional`/`readBudgetFromGate` 等），断言：不抛 `Cannot find module`/exit 127；`syncDocDevelopBidirectional` 不因分支名不是 `author` 就短路 `no-refs`；一次晋升写入后 `develop` ref 上能读到新状态（不需要人工 `git branch -f`）。
3. 接入 `scripts/test.sh`（新增测试文件，走既有泳道，不新建机制）。
4. 双向负控制：本仓库自身场景（有 plugin/、分支 author）行为不变；合成夹具场景（无 plugin/、分支 main）不再报本轮列出的任一类错误。

## Acceptance Criteria

- [x] AC1 夹具最小可用：合成夹具目录结构与 quay-init 产物的关键特征一致（无 `plugin/`、`main`+`develop` 双分支、`.quay/config.yml` 存在），一条命令可重建。
- [x] AC2（A 类回归）：针对夹具跑 `resourceGateCheck`/`defaultPromotionCheckArgv`/`readBudgetFromGate`/`analyzeTasks` 均不抛路径解析错误（本轮 6 处缺陷若任一复现，该测试必须先红）。
- [x] AC3（B 类回归）：针对夹具跑 `syncDocDevelopBidirectional`，返回值 ≠ `"no-refs"`（`DOC_BRANCH` 缺陷若复现，该测试必须先红）。
- [x] AC4：`scripts/test.sh` 全量绿，新增测试文件纳入现有泳道（不新建并发/超时机制）。

## Definition of Done

- 合成夹具 + 断言已接入 `scripts/test.sh` 常规跑批，任何未来的「driver 家族锚死在本仓库特征」类缺陷会在这个测试里先红，不必等到下一次真实第三方项目复跑才发现。
- 全量绿。

## Touches

- plugin/test/driver-third-party-fixture.test.mjs
- plugin/scripts/driver-shared.ts
- plugin/scripts/driver-filters.ts
- tasks/gap-third-party-fixture-smoke-test-driver-family.md