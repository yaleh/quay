---
id: gap-ac88-cross-host-verify-current-version
title: "AC88: 跨主机（B=orangevps, C=ad-arm1）验证当前版本 `.tgz` 的安装/初始化/冷启动（外驱，非 inner）"
status: todo
labels:
  - gap
  - mechanism
  - outer-driven
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac85-local-build-current-artifact
---

**type:** execution

## Proposal

**来源**：人 2026-08-16 裁定新阶段（manager-phase-goal.md AC88）。**归属：outer 驱动远端会话**
（B/C 两台机器），非 inner 实现。本任务在 board 上跟踪状态，执行主体是 outer。

**人 2026-08-06 原始裁定范围（仍适用，未被推翻）**：
- 两台机器：**B=orangevps、C=ad-arm1**。
- **安装源 = 本机 `package.sh` 产出的 `.tgz`**（非 git clone、非 GitHub release 资产）。
- 验证：① **正确安装** ② **正确初始化**（项目内 `quay-init`）③ **正确冷启动**（outer + inner，**不含 manager**）。

**判据（能取假）**：验证时刻**新于 AC85 产出的当前产物**；⛔ **不得引用 08-06/08-11 的历史验证记录**
作为本 AC 的达成证据（那些针对旧版本或单个 scoped fix，不是当前完整版本的全流程）。

**依赖**：AC85 先产出当前版本 `.tgz`，本任务才能开始。

## Plan

1. 等 AC85（本机 build）产出当前版本 `.tgz`。
2. outer 驱动 B=orangevps 会话：安装 `.tgz` → 项目内 `quay-init` → 冷启动（outer+inner）。
3. outer 驱动 C=ad-arm1 会话：同上三项。
4. 结果（成功/失败 + 证据）写回 AC89 的记录（.quay/productization-verification.jsonl）。
5. 判据：验证时间新于 AC85 产物时间。

## Acceptance Criteria

- [ ] AC1: B=orangevps 上用当前版本 `.tgz` 安装成功（安装源 = 本机产物，非 git clone/release 资产）。
- [ ] AC2: B 机项目内 `quay-init` 初始化成功。
- [ ] AC3: B 机冷启动 outer + inner 成功（不含 manager）。
- [ ] AC4: C=ad-arm1 上同样三项（安装/初始化/冷启动）成功。
- [ ] AC5: 验证时间新于 AC85 产物时间，且证据（各步输出）可机械核对——不引用 08-06/08-11 历史记录。

## Definition of Done

- [ ] 当前版本 `.tgz` 在 B/C 两机完成安装→初始化→冷启动三项验证，结果写入 AC89 记录。

## Touches

- （无代码改动的实现面——本任务为 outer 跨主机驱动执行）
- .quay/（AC89 记录文件）
- tasks/gap-ac88-cross-host-verify-current-version.md（自身）
