---
id: gap-driver-resource-gate-path-anchored-at-root-third-party
title: resource-gate.sh 路径仍锚在 opts.root —— 第三方无 plugin/ 项目驱动每轮 WAIT(exit 127) 永不派发
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

AC-207 端到端生产复跑（host B=orangevps，第三方项目 /home/yale/work/ac207-third-party，develop-tip 0.6.1 tgz 现 build）实测：`driver_alive=1`（AC-203 的 driver-runtime 迁移已生效，driver 真活）、`has_plugin_dir=0`、goals/ 7/7 双载体（AC-206 已生效），但 promotion-driver 每轮 `error: ready-pool-check exited 1` + `gate: {go:false, reason:"resource-gate WAIT (exit 127)"}`、worker-driver 每轮 `stop_reason:"resource-gate-wait: resource-gate WAIT (exit 127)"`——任务 e2e-verify-207 永久停在 todo，永不晋升、永不派发。

**根因（读代码，位置判定）**：`plugin/scripts/driver-shared.ts:212` `resourceGateCheck` 缺省 argv = `["bash", path.join(root, "plugin", "scripts", "resource-gate.sh"), "--for", "full-suite", "--json"]`——仍锚在 `opts.root`。AC-203 的 AC2 判据只扫了 `driver-runtime.ts`（`grep 'path.join(.*"plugin"' plugin/scripts/driver-runtime.ts` 命中 0），**没有覆盖 `driver-shared.ts`**。第三方项目 quay-init 闭集无 plugin/ ⇒ `bash <不存在路径>` ⇒ exit 127 ⇒ resource-gate 恒 WAIT（fail-closed）⇒ 两 driver 判停 ⇒ 永不派发。

**修法**：resource-gate.sh 路径锚到 kernel 自身安装位置（⛔ 非 opts.root）。注意与 AC-203 resolveScript 的差异：resource-gate.sh 是 .sh、**不是** .ts，不进 dist bundle——installed artifact 里它留在 `<pkg>/plugin/scripts/resource-gate.sh`，而 kernel（driver-runtime.js）bundle 在 `<pkg>/dist/`，两者不同目录（实测 /tmp/ac207-prefix/lib/node_modules/quay/plugin/scripts/resource-gate.sh 在位）。dev tree 里 driver-shared.ts 与 resource-gate.sh 同目录。修法须覆盖两种形态（dev-tree 同目录 / installed-artifact 上跳 pkg 根再进 plugin/scripts），保留 QUAY_PLUGIN_ROOT 覆盖。

## Plan

1. `plugin/scripts/driver-shared.ts` 的 `resourceGateCheck` 缺省 argv 不再 `path.join(root, "plugin", ...)`，改为从本模块安装位置解析 resource-gate.sh（dev-tree 同目录 / installed 上跳 pkg 根进 plugin/scripts，`QUAY_PLUGIN_ROOT` 覆盖），找不到 ⇒ fail-closed 报「找不到」非静默 GO。
2. 同族审计（硬规则 5b）：grep 全 `plugin/scripts/*.ts` 还有谁 `path.join(root, "plugin", "scripts", "resource-gate.sh")`——`cap-from-gate.ts:273/:292` 是 inner 机制（第三方项目不跑 inner），记入 Touches 一并迁移或显式判「不属本任务」。
3. 负控制复现（读生产形态）：无 plugin/ 临时项目跑 driver，改前 round 记录逐字含 `resource-gate WAIT (exit 127)`；改后同一项目 resource-gate 报 GO（或按真实负载 WAIT，但不再是 exit 127 command-not-found）。
4. 单测：resourceGateCheck 在「root 无 plugin/scripts/resource-gate.sh、kernel 安装位置有」时非 127；kernel 侧也没有 ⇒ fail-closed 报找不到。

## Acceptance Criteria

- [x] AC1 机制迁移：`grep -n 'path.join(.*"plugin".*resource-gate' plugin/scripts/driver-shared.ts` 命中数为 0，且新路径解析函数存在（贴零命中对照 + 前 3 条新解析命中，硬规则②）。
- [x] AC2 负控制复现（改前）：无 plugin/ 第三方项目 round 记录逐字含 `resource-gate WAIT (exit 127)`；改后同一项目 `driver status` 报 `alive=1` 且 round 记录 `gate.reason` 不再含 `exit 127`（读载体，非自述）。
- [x] AC3 单测：`plugin/test/driver-shared.test.mjs`（或既有 driver-runtime.test.mjs 加例）覆盖「kernel 侧有 resource-gate ⇒ 非 127」与「kernel 侧无 ⇒ fail-closed 报找不到」双向。
- [x] AC4 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

AC1–AC4 全绿；第三方无 plugin/ 项目里 promotion/worker driver 每轮不再因 resource-gate exit 127 而 WAIT，任务能晋升并派发（读 round 记录 `gate.reason` 不含 `exit 127`、`action` 不再是全 error/stop）。端到端生产记录（AC-207）由 gap-ac207 任务在本缺陷落地后复跑完成——本任务只到「resource-gate 不再 command-not-found」这一层。

## Touches

- plugin/scripts/driver-shared.ts
- plugin/scripts/cap-from-gate.ts
- plugin/test/driver-shared.test.mjs
- tasks/gap-driver-resource-gate-path-anchored-at-root-third-party.md