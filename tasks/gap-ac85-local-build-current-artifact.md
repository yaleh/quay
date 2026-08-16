---
id: gap-ac85-local-build-current-artifact
title: "AC85: 本机 `package.sh` 产出当前版本的可用 `.tgz` 产物（版本号一致性核对防陈旧产物顶替）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：人 2026-08-16 裁定新阶段「产品化 build 与实际验证」（manager-phase-goal.md AC85-89，commit `3d201bd1`）。

**背景（manager 实测，非猜测）**：本机当前**无任何 `.tgz` 产物**（08-06 的已清理）；`dist-verify-node-floor`
13 天没真实跑过（触发只在 push/PR to master，本项目主线是 develop）。**AC85 是本阶段第一块积木**——
AC88（跨主机验证）与 AC89（验证记录）都依赖「当前版本的本机产物」存在。

**判据（能取假）**：`bash packages/quay/scripts/package.sh` 产出 `.tgz`；`tar tzf` 校验其 `plugin/`
条目**非空**（08-06 曾错把 `npm pack` 当入口，得 0 条，教训见 archive）；产物的
`package/plugin/.claude-plugin/plugin.json` **版本号与仓库当前 `plugin/.claude-plugin/plugin.json`
一致**（证明不是陈旧产物）。

**⛔ 不得引用 08-06 的旧产物作为达成证据**——那个 `.tgz` 已不存在，且早于今天落地的多个改动。

**不覆盖**：不改 `package.sh` 本体（若它已能正确产出）；不涉及 CI/跨主机（那是 AC86/AC88）。

## Plan

1. 检查 `packages/quay/scripts/package.sh` 当前入口与输出路径。
2. 运行 `bash packages/quay/scripts/package.sh` 产出当前版本 `.tgz`。
3. `tar tzf <产物>` 校验 `plugin/` 条目非空。
4. 比对产物内 `package/plugin/.claude-plugin/plugin.json` 版本号 vs 仓库当前
   `plugin/.claude-plugin/plugin.json`——一致才判通过。
5. 产物路径与版本号写进任务 Evidence（供 AC88/AC89 引用）。

## Acceptance Criteria

- [x] AC1: `package.sh` 运行产出 `.tgz` 文件（记录产物路径 + 大小 + 时间戳）。
- [x] AC2: `tar tzf <产物> | grep 'plugin/'` 非空（不是 0 条 plugin 条目的错误入口）。
- [x] AC3: 产物内 `package/plugin/.claude-plugin/plugin.json` 的 `version` 字段 == 仓库当前
      `plugin/.claude-plugin/plugin.json` 的 `version`（证明是当前版本，非陈旧产物顶替）。
- [x] AC4: 产物时间新于本次切换（2026-08-16），Evidence 记录完整可复核。

## Definition of Done

- [x] 本机存在当前版本的可用 `.tgz` 产物，版本号与仓库一致，AC88 可直接引用该产物进行跨主机验证。

## Evidence

**构建入口**：`bash packages/quay/scripts/package.sh`（在工作树
`/home/yale/work/quay-worktrees/gap-ac85-local-build-current-artifact`，HEAD `348b2a85`）。
**package.sh 无需修改**：其版本同步闸（`package.sh:83-92`）在打包时已强制
`plugin/.claude-plugin/plugin.json` version == `package.json` version，且将仓库根 `plugin/` 原样
物化进 `packages/quay/plugin/`（`package.sh:94-96`），故产物内版本 == 仓库当前版本由构造保证。

**前置准备**：工作树无 `node_modules`、缺 vendored runtime bundles —— 已跑根 `npm install`
（postinstall 触发 `plugin/scripts/sync-vendor.sh`，构建 `plugin/vendor/quay/dist/quay.js` +
`plugin/vendor/quay-native/dist/quay-native.js`）。

**AC1 — 产物路径/大小/时间戳**：
```
路径:    /home/yale/work/quay-worktrees/gap-ac85-local-build-current-artifact/packages/quay/quay-0.4.0.tgz
大小:    3,214,065 bytes（3.2 MB，npm pack package size；unpacked 13.2 MB）
时间戳:  2026-08-16 03:58:17.867120084 +0000（UTC）
sha256:  05ada1eca6111bb5959584e7b6bbaaa3e0ca045ebd7c17a1bd14347b354b4eca
```
产物为 gitignored（根 `.gitignore:21` `*.tgz`），**不提交二进制**；上述路径即 AC88/AC89 的消费路径。

**AC2 — tar 内 plugin/ 条目非空**：
```
$ tar tzf packages/quay/quay-0.4.0.tgz | grep 'plugin/' | wc -l
321
```
非 0 条（绝非 `npm pack` 空 plugin 的 08-06 错误入口）。样本条目：
`package/plugin/.claude-plugin/plugin.json`、`package/plugin/scripts/dist/*.js`（esbuild 打包产物）、
`package/plugin/workflows/fan-in-execute.js`、`package/plugin/gate-scripts/dist/drain-scheduler.js` 等。

**AC3 — 版本一致性（产物内 vs 仓库当前）**：
```
产物内 package/plugin/.claude-plugin/plugin.json version = 0.4.0
仓库   plugin/.claude-plugin/plugin.json        version = 0.4.0
仓库   packages/quay/package.json               version = 0.4.0
比对:  MATCH（inner=0.4.0 == repo=0.4.0）⇒ 当前构建，非陈旧产物顶替
```

**AC4 — 产物时间新于本次切换**：
```
产物 mtime:            2026-08-16 03:58:17 UTC
phase-goal 切换提交:   3d201bd1 2026-08-16 03:51:57 UTC（AC85-89 新阶段）
任务晋 ready 提交:     348b2a85 2026-08-16 03:56:17 UTC（HEAD）
产物晚于二者（+6m20s / +2m）⇒ 本次切换后新构建
```

**作用域闸**：`scripts/test.sh --for-task gap-ac85-local-build-current-artifact --allow-thin`
EXIT **0**；`task-contract-check` no violations；selector 对 Touches 解析出 0 个测试文件
（thin-allowed，0/3 < 0.5 阈值——Touches 主要是脚本/产物/任务文件，非测试文件 glob），
全套仍由 fan-in 阶段跑。

## Touches

- packages/quay/scripts/package.sh（仅执行，如需修正才改）
- 产物输出目录（`.tgz` 产物本身）
- tasks/gap-ac85-local-build-current-artifact.md（自身）
