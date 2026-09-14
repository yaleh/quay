---
id: gap-dist-closure-missing-driver-anchor-js
title: 打包 dist entry 集对 driver-anchor 的动态路径引用盲 → dist/driver-anchor.js 不进
  tarball，任何第三方安装的 driver 自 2026-09-13 起结构上起不来
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
## Finding

**证据来源（⛔ 本条不重新取证，全部引自已实测的一次远程隔离对照实验，见该任务的 "### ⛔ AC3 / AC4 / AC5 / AC6 未达成" 一节）**：`gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger`（当前 `needs-human`，因这个缺陷阻断了它的 AC-239 半边）。以下每一条都是那次调查里已经独立可复现的实测，本条只是把「这是另一个机制、需要另立任务」的划界落成任务。

**真机器实测（orangevps，隔离安装副本，`driver start` 输出未被重定向）**：

```
$ node <installed>/quay/dist/quay.js driver start --kind promotion --root <copy>
start-failed: kind=promotion — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (/home/yale/quay-verify-upgrade-fb0301b8.npm/lib/node_modules/quay/plugin/scripts/dist)
PROMOTION_RC=1
start-failed: kind=worker — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (...)
WORKER_RC=1
```

**根因链（每一环均已实测，非推断，详见引用任务）**：

1. `plugin/scripts/driver-runtime.ts:831 preferredAnchorKernel()` 在两处找 anchor：与运行中内核**同目录**的 `driver-anchor.{ts,js}`（`dist/` 下），或内核所在仓库**主检出**的同名路径（`mainCheckoutKernelDir()`，注释自述仅在"内核跑在 linked worktree 里"时生效）。
2. 交付物 `.../quay/plugin/scripts/dist/` 里有 `driver-runtime.js`，**没有** `driver-anchor.js`（远端 `ls` 实测 + 本机 staging 实测同样确认缺失）。
3. 安装形态下 `mainCheckoutKernelDir()` 返回自身安装目录，两处均不存在该文件 ⇒ `preferredAnchorKernel()` 返回 null ⇒ `spawnAnchor` 报 `"driver-anchor module not found next to driver-runtime"` ⇒ **任意 kind 的 `driver start` 在任何已安装/已打包形态下 rc=1**。
4. 疑似成因（待本任务实现者对着当前 `develop` 重新核实，⛔ 不要照抄）：`driver-anchor.ts` 的引用路径是**动态拼接**构造的（形如 `path.join(here, "driver-anchor.ts")`），不是静态 `import`/`require`，导致打包脚本（`packages/quay/scripts/package.sh`）的 dist-entry 闭包推导（一个走静态引用扫描的机制）看不见它——这正是此前三条 `done` 任务已经修过、但每次都只覆盖被发现的那一处引用形状的同一类缺陷（硬规则 5b）。`driver-anchor.ts` 落地于 `3f2384de0`（2026-09-13T20:19:33Z，AC-255/SPEC §7 阶段 C：单 anchor 进程承载六个 kind），晚于此前三次修复。

**时间界限（实测，非推断）**：GOAL-009-AC-239 的 e2e（需要一个全新安装项目自己的 driver 能起来）最后一次成功是 `2026-09-13T17:11:09Z`，早于 `3f2384de0`（20:19:33Z）落地 3 小时 8 分；此后再无一次成功（引用任务里独立两次跨机运行均复现，run4 与 run5）。

**影响面**：不是 AC-239 测试专属问题——它意味着**任何**通过 npm-pack 通道（`packages/quay/scripts/package.sh` 产出的 tarball，`npm install -g` / `quay-init` 路径）安装 quay 的第三方项目，跑 `quay driver start` 时**任意 kind 都会 rc=1**。这是自 2026-09-13 晚间以来对每一个全新第三方部署的一次性阻断——drivers 这一核心能力在生产上跑不起来。

**查重（机制维度，⛔ 非关键词）**：已 grep `driver-anchor` / `dist-closure` 全库，同类缺陷 CLASS 已有 3 条 `done` 修复（`gap-delivery-laydown-dist-closure-gap`、`gap-driver-kinds-table-literal-not-in-dist-entry`、`gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs`），但均不覆盖 `driver-anchor.ts`/`.js` 这个具体文件；`task_list(search: "driver-anchor module not found")` 仅命中引用任务本身（该任务明确声明此缺陷不在其 Touches 范围、需另立任务）。无重复。

## Plan

1. 读 `packages/quay/scripts/package.sh` 的 dist-entry/闭包推导与 `plugin/scripts/driver-runtime.ts` 的 `preferredAnchorKernel()` sibling-lookup，对着**当前 develop**确认引用被闭包扫描漏掉的确切形状（动态 `path.join`/`require.resolve` 拼接，或其它——须验证，不得照抄本条描述直接假设）。
2. 修闭包推导，使其能**通用地**捕获这类被漏掉的引用形状（不要只针对 `driver-anchor.ts` 特判——4 个实例的共同教训是"闭包扫描漏掉某种引用形状"这一类问题，优先修形状识别本身），并把 `driver-anchor.ts` 显式加为回归钉子（无论如何都要加）。
3. 补一个能捕获本次缺陷的 mutation/负控制测试：构建 dist 闭包，断言 `driver-anchor.js`（或修复后实际的文件）存在，**并且**对打包产物做一次真实 `driver start` 验证其成功（不能只验证"文件存在"——存在但截断/不兼容的文件同样能"存在"，是更弱的仪器）。
4. 真机验证：全新打包安装（`--verify-upgrade` 那套 AC-239 e2e 相同形态），在**已安装（非主检出）**副本上确认 `quay driver start --kind promotion` 与 `--kind worker` 均 rc=0。

## Acceptance Criteria

- [ ] AC1：对着当前 `develop`（非假设、非照抄本任务描述）确认根因——闭包推导漏掉 driver-anchor 引用的确切代码位置。
- [ ] AC2：修复落地为通用形式（闭包推导捕获被漏掉的引用形状本身，不是仅针对文件名的特判补丁）。
- [ ] AC3：负控制——在修复前的提交上，一次干净的打包+安装副本，`driver start` 可复现地报出本条引用的错误（prefix-swap 式负控制，参照既有先例 `prefix-code-swap-for-red-control`）。
- [ ] AC4：修复后，一次**真实**全新 npm-pack 安装（隔离副本，非主检出）上 `driver start --kind promotion` 与 `--kind worker` 均 rc=0——真机器读数，不是仅夹具通过（硬规则 4 推论三：只由夹具满足的判据不是生产修复的证据）。
- [ ] AC5：存在一个能捕获本次缺陷的测试（针对打包产物做真实 driver-start 成功性断言，不是仅文件存在性断言）。

## Definition of Done

真实落地的判据：一次全新的、非主检出的 npm-pack 安装副本上，`quay driver start --kind promotion` 与 `--kind worker` 均 rc=0；且有测试能在修复被回退时重新报红（而不仅仅是"文件存在"这种更弱的信号）。⛔ 不接受：只在主检出或 fixture 内验证通过、不做真实隔离安装验证；只补文件存在性检查而不验证真实启动成功。

## Touches

- `packages/quay/scripts/package.sh`
- `plugin/scripts/driver-runtime.ts`（只读引用核对，除非修复本身也需要改动引用写法）
- 实现者最终确定的新增/改动测试文件（用以捕获真实 driver-start 成功性，而非仅文件存在）
- `tasks/gap-dist-closure-missing-driver-anchor-js.md`（自身文件：勾 AC + 贴实跑证据）