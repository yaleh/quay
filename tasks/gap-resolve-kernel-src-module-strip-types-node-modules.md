---
id: gap-resolve-kernel-src-module-strip-types-node-modules
title: resolveKernelSrcModule 把动态 import 的 ff-merge.ts/gate-event-store.ts 解析到
  node_modules 下 .ts ⇒ ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING ⇒ 机械 fan-in
  ff 步在第三方项目必挂
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
goal_ac: AC-207
---
**type:** execution

## Proposal

**实证（位置判定，非关键词，2026-09-10 14:07Z）**：orangevps 第三方项目 `/home/yale/work/ac207-fresh-third-party` 的 e2e 任务 `e2e-verify-207` 机械 fan-in 在 `ff` 步失败，worker-outcome.jsonl 逐字：

```
"summary": "Stripping types is currently unsupported for files under node_modules, for \"file:///tmp/ac207-fresh-prefix/lib/node_modules/quay/src/fan-in/ff-merge.ts\""
```

本机复现（orangevps Node v25.2.0）：`node --experimental-strip-types -e 'import("file://<pkg>/src/fan-in/ff-merge.ts")'` → `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。同法 `src/gate/gate-event-store.ts` 亦抛。

**根因**：`worker-driver.ts` `resolveKernelSrcModule`(:3468) 在 shipped 打平布局下把动态 import 的模块解析到 `<包根>/src/<rel>`——两调用点 `ffMergeModule`(:3716, `fan-in/ff-merge.ts`) 与 `appendCompleteGateEvent`(:3491, `gate/gate-event-store.ts`)。Node ≥23.7 对 node_modules 下 `.ts` 拒绝 type-stripping ⇒ 两处动态 import 在第三方项目必抛。shipped 包只带 `src/*.ts` 与 `dist/quay.js`，`find` 实证无 `ff-merge.js`/`gate-event-store.js` 编译产物。

**缺陷来源**：`gap-fanin-gate-event-store-path-shipped-unsafe`（59f42b79e）把两处锚点从硬编码 `packages/quay/src/**`（shipped 下 MODULE_NOT_FOUND）改为 `resolveKernelSrcModule`→`src/**`（shipped 下 strip-types 拒剥）——修了【路径】没修【可 import 形态】。这是同一机制（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）在 worker-driver.ts 这个调用点的兄弟缺陷，与已 done 的 `gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy` 同源（那条修的是 init.ts mcp_entry→dist bundle）。

**影响**：机械 fan-in `ff` 步必挂 ⇒ 第三方项目任务永不 landed；即便 ff 修好，`append-complete-gate-event` 步会以同一错误再挂 ⇒ AC-207 e2e 的 `gate_events>0` 判据结构上不可满足（gap-ac207 AC2/AC3/AC5 的前置）。

## Plan

1. `resolveKernelSrcModule`（或其调用点）在 shipped 布局下改解析为 Node 运行时可 import 的形态（⛔ 不是 node_modules 下的 `.ts`）。方向三选一（实现者定）：(a) npm pack 把 `src/fan-in/ff-merge.ts`、`src/gate/gate-event-store.ts` 编译出 `dist/*.js` 并解析到 `.js`；(b) esbuild 把这两模块打进 `worker-driver.js`（消除运行时动态 import）；(c) 运行时把 `.ts` 复制到非 node_modules 临时目录再 import。
2. 补一条【穿过中间层】的测试：模拟 shipped 布局（模块路径位于 node_modules 下）真 `import()` 该模块并断言成功（⛔ 只断言 resolveKernelSrcModule 返回的路径字符串——那正是 59f42b79e 漏掉、让缺陷穿过判据的中间层）。
3. 第三方项目重跑机械 fan-in：`ff` 步 exit 0 且 `.quay/gate-events.jsonl` 出现 `complete` GateEvent（append-complete-gate-event ok=true）。

## Acceptance Criteria

- [ ] AC1 复现固化：贴出 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 实证（shipped 布局 import src/*.ts）+ resolveKernelSrcModule 两调用点行号。
- [ ] AC2 修复：shipped 布局下动态 import 的模块（ff-merge + gate-event-store）改为可 import 形态，`node --experimental-strip-types` 下 import 成功（贴出实测输出）。
- [ ] AC3 shipped 实跑：第三方项目机械 fan-in `ff` 步 ok:true、`append-complete-gate-event` ok:true、`.quay/gate-events.jsonl` 有 complete 记录（逐字贴出 step-trace/worker-outcome）。
- [ ] AC4 源树不回归：dev checkout 机械 fan-in 仍走源树 `packages/quay/src/**`（resolveKernelSrcModule 双向不变）。
- [ ] AC5 测试绿：`--for-task` scoped 门绿（含新穿过中间层的 import 测试）。

## Definition of Done

- [ ] AC1–AC5 全勾；`--for-task` scoped 门绿。
- [ ] 第三方项目（orangevps 全新 root）机械 fan-in 全链 ok（ff→append-complete-gate-event→task done→gate-events>0），作为 gap-ac207 AC2/AC3/AC5 的前置解除证据。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- packages/quay/scripts/build-plugin-dist.mjs
- tasks/gap-resolve-kernel-src-module-strip-types-node-modules.md
