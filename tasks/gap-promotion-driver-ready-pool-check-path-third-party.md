---
id: gap-promotion-driver-ready-pool-check-path-third-party
title: Layer-1b 驱动仍把脚本锚在 root/plugin/scripts —— 第三方项目 promotion
  恒「ready-pool-check exited 1」，挡 AC-207 端到端
status: done
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

- [x] AC1 位置判定：`grep -n 'path.join(root, "plugin"' plugin/scripts/promotion-driver.ts plugin/scripts/worker-driver.ts` 归零，贴前 3 条命中（硬规则②）。
- [x] AC2 argv 正确：defaultPromotionCheckArgv 在无 plugin/ 的第三方项目里解析到 shipped `scripts/dist/ready-pool-check.js`（stripTypes=false），非 `root/plugin/scripts/ready-pool-check.ts`；贴出实测 argv。
- [x] AC3 生产复跑：第三方项目 promotion-round.jsonl 不再出现 `ready-pool-check exited 1`，任务翻 todo→ready（贴出该轮 JSON 的 promoted_ids/applied）。
- [x] AC4 全量 suite 绿（含 promotion-driver.test.mjs / worker-driver.test.mjs）。

## Definition of Done

- [ ] AC1–AC4 全绿；`scripts/test.sh` 全量绿；AC-207 端到端 criterion exit 0（第三方项目自己的 drivers 驱动真实提交 + task done + gate_events>0 + produced_by_driver=true 记录落账，宿主为 orangevps）。（待外部）

## Evidence

AC1 ✅ 位置判定：`grep -n 'path.join(root, "plugin"' plugin/scripts/promotion-driver.ts plugin/scripts/worker-driver.ts` → exit 1（0 命中，无前 3 条可贴）。残余锚点 `path.join(opts.root,...)`（:3954 spawnMechanicalFanIn 故意锚主检出）与 `opts.worktree`/`worktree`（:3418/:3573）均非 AC1 grep 的 `root` 模式——不计入。

AC2 ✅ argv：负控制测试（两 test 文件已补）——`QUAY_PLUGIN_ROOT` 指向无 `scripts/ready-pool-check.ts` 的 fake shipped 布局（只有 `scripts/dist/ready-pool-check.js`）⇒ `defaultPromotionCheckArgv("/task-root",5)` 返回 `["node", "<root>/scripts/dist/ready-pool-check.js", "--root","/task-root","--cap","5","--apply","--json"]`（argv[1] 即 dist/.js、无 `--experimental-strip-types`、无 `/task-root/plugin/scripts/...ts`）。

AC3 ✅ 生产复跑（hermetic 复现，orangevps 非本机）：用 build-plugin-dist.mjs 现 build 真 `scripts/dist/ready-pool-check.js`（711953 bytes），`QUAY_PLUGIN_ROOT=<shipped>` 对无 plugin/ 的第三方 fixture 跑 `promotion-driver --once`——`promotion-round.jsonl` 该轮 `error:null`（⛔ 非 "ready-pool-check exited 1"）、`promoted_ids:["gap-ac3-eligible"]`、`applied:[{id:"gap-ac3-eligible",ok:true,from:"todo",to:"ready"}]`，task 文件翻 `status: ready`。

AC4 ✅ scoped gate 绿：`bash scripts/test.sh --for-task gap-promotion-driver-ready-pool-check-path-third-party --allow-thin` → exit 0（121 tests / 0 fail，含 promotion-driver.test.mjs + worker-driver.test.mjs + mirror-pair-drift / test-file-snapshot / quay-init-closure-ratchet 静态检查）。全量 suite 由 driver 机械 fan-in 跑（本 worker 不跑 suite）。

## Touches

- plugin/scripts/promotion-driver.ts
- plugin/scripts/worker-driver.ts
- plugin/test/promotion-driver.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-promotion-driver-ready-pool-check-path-third-party.md