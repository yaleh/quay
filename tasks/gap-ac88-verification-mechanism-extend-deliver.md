---
id: gap-ac88-verification-mechanism-extend-deliver
title: "AC88 前置：扩展交付验证机制覆盖 quay-init + 冷启动（outer+inner）——现状只到装 tgz + 端口探活"
status: todo
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

**来源**：AC88 跨主机验证的前置缺口（manager 2026-08-16 实测指出，commit `71677c8f`；outer 2026-08-16
复核确认）。

**现状缺口（实测）**：`plugin/scripts/develop-deliver-tgz.sh`（DIR-123）只覆盖
「`npm install -g <quay.tgz> <quay-native.tgz>` → `quay serve --port <p>` → curl http_code==200」。
**`grep quay-init` 该脚本 = 0 命中**——无初始化步骤；③冷启动也没有（只有 quay serve 端口 HTTP 探活，
不是 AC88 要求的「outer/inner 冷启动」）。

**AC88 要求**（人 2026-08-06 裁定范围，2026-08-16 复核仍适用）：①正确安装 ②正确初始化（项目内
`quay-init`）③正确冷启动（outer + inner，不含 manager）。安装源 = 本机 `package.sh` 产出的 `.tgz`。

**缺口后果**：outer 直接驱动 B/C 会退化成「验证这次做到了」而非「机制可重复」——正是要避免的形态。
**必须先有机件**：一个可重复的脚本覆盖 安装→初始化→冷启动 三步。

## Plan

1. 扩展 `develop-deliver-tgz.sh`（或新增等价验证脚本），在现有「装 tgz + 端口探活」之后补：
   - ② 项目内 `quay-init`（在一个干净的空目录做项目初始化，验证 init 成功）
   - ③ 冷启动：outer + inner（不含 manager）——用 quay 自身 shipped 的 cold-start/loop 机制起双层，
     验证两层都活（直接量：git commit / 心跳 / 进程，非仅 HTTP 探活）
2. 机器形态处理：
   - **B=orangevps**：当前 `~/work/quay` 是 sync.sh 同步的 git 开发树（有 .git）⇒ 是 AC88「⛔ 非 git clone」
     排除的形态。**决策（outer 2026-08-16）：git 开发树不满足 AC88 判据**——验证必须在干净目录从 `.tgz`
     全新安装，不复用 dev 树。
   - **C=ad-arm1**：`~/work/` 下无 quay 主 checkout，只有历史 worktrees ⇒ 从零安装（机制需支持 fresh
     install）。
3. 判据能取假：脚本跑完，B/C 各机可核对的产物（安装目录 + quay-init 输出 + 双层冷启动证据），
   验证时间新于 AC85 产物时间。
4. 结果写回 AC89 记录（.quay/productization-verification.jsonl）。

## Acceptance Criteria

- [ ] AC1: 机制（脚本）覆盖 ①安装 `.tgz` ②项目内 `quay-init` ③冷启动（outer+inner），三步顺序完整。
- [ ] AC2: ③冷启动判据是「双层（outer+inner）活性」的直接量（git 提交/心跳/进程），不是仅 `quay serve`
      端口 HTTP 探活。
- [ ] AC3: B=orangevps 验证在**干净目录全新 .tgz 安装**进行（不复用 sync.sh git 开发树——那是
      AC88「非 git clone」排除的形态）。
- [ ] AC4: C=ad-arm1 支持从零全新安装（当前无主 checkout）。
- [ ] AC5: 机制跑完产出可机械核对的证据，时间新于 AC85 产物时间。

## Definition of Done

- [ ] AC88 跨主机驱动有可重复的机制（安装→初始化→冷启动），B/C 两机的执行不再是手工一次性形态。

## Touches

- plugin/scripts/develop-deliver-tgz.sh（扩展）或新增等价验证脚本
- plugin/test/*（对应测试）
- tasks/gap-ac88-verification-mechanism-extend-deliver.md（自身）
