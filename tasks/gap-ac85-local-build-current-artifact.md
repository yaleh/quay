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

- [ ] AC1: `package.sh` 运行产出 `.tgz` 文件（记录产物路径 + 大小 + 时间戳）。
- [ ] AC2: `tar tzf <产物> | grep 'plugin/'` 非空（不是 0 条 plugin 条目的错误入口）。
- [ ] AC3: 产物内 `package/plugin/.claude-plugin/plugin.json` 的 `version` 字段 == 仓库当前
      `plugin/.claude-plugin/plugin.json` 的 `version`（证明是当前版本，非陈旧产物顶替）。
- [ ] AC4: 产物时间新于本次切换（2026-08-16），Evidence 记录完整可复核。

## Definition of Done

- [ ] 本机存在当前版本的可用 `.tgz` 产物，版本号与仓库一致，AC88 可直接引用该产物进行跨主机验证。

## Touches

- packages/quay/scripts/package.sh（仅执行，如需修正才改）
- 产物输出目录（`.tgz` 产物本身）
- tasks/gap-ac85-local-build-current-artifact.md（自身）
