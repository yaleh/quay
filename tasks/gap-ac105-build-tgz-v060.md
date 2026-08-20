---
id: gap-ac105-build-tgz-v060
title: AC105 build 当前版本可用产物：package.sh 产出 0.6.0 tgz（锚 commit sha + 产物 sha256，非路径）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：当前阶段管线第二步。AC104（版本 bump 0.6.0）已 land（79be2769/b4572bb8）。AC105 是 AC107（跨主机机制化验证）→ AC118/119（第三方项目验证）的前置。人裁定「AC104-109 落笔归属 outer（立案/驱动）+ inner（产品代码）」；human 裁定「AC104 等 outer 自然轮到」——AC104 已轮完，现在轮到 AC105。

**判据正本**：`orchestration/manager-phase-goal.md` AC105（:44-49）。任务体只放指针 + 执行形态，不复制正本。

**为什么 inner 执行**：`packages/quay/scripts/package.sh` 属产品代码（D 段边界 outer 不改产品代码）→ inner 域。本任务不改产品代码（除非 package.sh 有 bug 需修，那也是 inner 修）。

**为什么现在**：AC104 land 释放管线。AC105 产出当前版本 tgz 后，AC107（跨主机，`verify-deliver-coldstart.sh` 用 tgz 现 build）与 AC118/119（安装源=本阶段产物）才可执行。当前 2 在飞（satisfy-then-check + bootstrap-stale），load 1.58 低。

## Plan

1. 从 develop tip（当前 b4572bb8 或其子提交）跑 `bash packages/quay/scripts/package.sh`。
2. `tar tzf <产物.tgz>` 校验 `plugin/` 条目非空。
3. 校验产物内 `package/plugin/.claude-plugin/plugin.json` 版本 = `0.6.0`。
4. 记录 build 时 `git rev-parse HEAD`（commit sha）+ 产物 sha256（`sha256sum <产物.tgz>`）——⛔ 不记文件路径（worktree 删除后 .tgz 路径不可解析，`.gitignore:21`）。

## Acceptance Criteria

- [x] AC1: `bash packages/quay/scripts/package.sh` 成功产出 `.tgz`（exit 0）。
- [x] AC2: `tar tzf <产物>` 显示 `plugin/` 条目非空（08-06 曾错把 npm pack 当入口得 0 条，此判据防复发）。
- [x] AC3: 产物内 `package/plugin/.claude-plugin/plugin.json` 版本 = `0.6.0`。
- [x] AC4: 达成证据 = build 时 `git rev-parse HEAD`（commit sha）+ 产物 `sha256sum`，⛔ 不记 .tgz 文件路径（判据不得引用生命周期短于判据本身的对象）。
  证据：commit sha=`64ca97df852c5a055c7dea33e9b841c2e7fe6443`，产物 sha256=`bbaf905d07842990f8b02357f4143fd10491c88afe0e808da8a321cf258fbfcb`。

## Definition of Done

- [x] 当前版本 0.6.0 tgz 已产出；commit sha + 产物 sha256 已记录（可复核）；三条取假判据（AC1-3）全满足。

## Touches

- packages/quay/scripts/package.sh（build 入口——若实现有 bug 需修，inner 域）
- tasks/gap-ac105-build-tgz-v060.md（自身）
