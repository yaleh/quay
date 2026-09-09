---
id: gap-promotion-driver-ready-pool-check-path-third-party
title: Layer-1b 驱动仍把脚本锚在 root/plugin/scripts —— 第三方项目 promotion
  恒「ready-pool-check exited 1」，挡 AC-207 端到端
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra: {}
goal_ac: AC-207
---
## Proposal

AC-207 端到端（目标项目自己的 *-drivers 驱动真实提交）第 6 轮实测暴露第三个阻塞：orangevps 第三方项目（quay-init 布下的面，无 plugin/，裁定 6 不复制脚本；shipped 包只有 dist/*.js 无 .ts）里，promotion-driver 每轮 `error="ready-pool-check exited 1"`（promotion-round.jsonl round 8–13）。根因（位置判定）：`plugin/scripts/promotion-driver.ts` `defaultPromotionCheckArgv`（develop 版 :120-126）用 `path.join(root, "plugin", "scripts", "ready-pool-check.ts")` 拼脚本路径——root 是目标项目根，而目标项目无 plugin/scripts/。已复现：`node --experimental-strip-types <third-party>/plugin/scripts/ready-pool-check.ts` → `Cannot find module` exit 1。对照：Layer 0 `driver-runtime.ts` `resolveKernelSibling("ready-pool-check.ts")` 已正确解析到 shipped `scripts/dist/ready-pool-check.js`（含 .ts→dist/.js 回退 + stripTypes 判定），driver-shared.ts（resource-gate）也已走正确解析器——只有 Layer-1b 两驱动漏迁。同层 `worker-driver.ts` 有同形锚点（:1175 自入口 worker-driver.ts / :1201 dispatch-worktree-setup.sh / :3531 suite-slot-lib.sh）。这是 `gap-plugin-root-resolution-remaining-callsites`（done）遗漏的调用点、与 `gap-driver-resource-gate-path-anchored-at-root-third-party`（done）同族。本缺陷不修，AC-207 端到端永不推进（promotion 不翻 todo→ready ⇒ worker 不派发 ⇒ 无实现提交 / 无 gate events / 无 done）。

## Plan

1. `promotion-driver.ts` `defaultPromotionCheckArgv` 改用从 driver-runtime.ts import 的 `resolveKernelSibling("ready-pool-check.ts")`（⛔ 不能只换路径：shipped 包只有 dist/.js，必须用含 .ts→dist/*.js 回退的解析器）。
2. `worker-driver.ts` 三处 `path.join(root, "plugin", "scripts", …)` 锚点（:1175/:1201/:3531）同法改用 kernel sibling 解析（或等价 resolver），缺脚本 fail-closed。
3. 负控制测试：promotion-driver.test.mjs / worker-driver.test.mjs 补「第三方项目无 plugin/ 时 argv 解析到 shipped dist/*.js（stripTypes=false），非 root/plugin/scripts/*.ts」断言（判据能取假）。
4. 全量 suite 绿后，从 develop tip 现 build tgz 重装进第三方项目、重启 driver，复跑 AC-207 端到端（promotion 翻 todo→ready → worker 派发 → 实现提交 → fan-in → done → gate events）使 AC-207 criterion exit 0。

## Acceptance Criteria

- [ ] AC1 位置判定：`grep -n 'path.join(root, "plugin"' plugin/scripts/promotion-driver.ts plugin/scripts/worker-driver.ts` 归零，贴前 3 条命中（硬规则②）。
- [ ] AC2 argv 正确：defaultPromotionCheckArgv 在无 plugin/ 的第三方项目里解析到 shipped `scripts/dist/ready-pool-check.js`（stripTypes=false），非 `root/plugin/scripts/ready-pool-check.ts`；贴出实测 argv。
- [ ] AC3 生产复跑：第三方项目 promotion-round.jsonl 不再出现 `ready-pool-check exited 1`，任务翻 todo→ready（贴出该轮 JSON 的 promoted_ids/applied）。
- [ ] AC4 全量 suite 绿（含 promotion-driver.test.mjs / worker-driver.test.mjs）。

## Definition of Done

- [ ] AC1–AC4 全绿；`scripts/test.sh` 全量绿；AC-207 端到端 criterion exit 0（第三方项目自己的 drivers 驱动真实提交 + task done + gate_events>0 + produced_by_driver=true 记录落账，宿主为 orangevps）。

## Touches

- plugin/scripts/promotion-driver.ts
- plugin/scripts/worker-driver.ts
- plugin/test/promotion-driver.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-promotion-driver-ready-pool-check-path-third-party.md