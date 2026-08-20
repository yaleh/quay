---
id: gap-ac107-cross-host-mechanized-verify
title: AC107 跨主机机制化验证：verify-deliver-coldstart.sh 对 B/C 各跑完整三步（直接量活性判据，非手工一次性）
status: ready
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

**来源**：当前阶段管线第 5 步。AC104（版本 bump）→ AC105（build tgz）→ AC106（dist-verify 真实运行）→ AC107（跨主机机制化验证）→ AC108（推送发布）→ AC109（记录）→ AC118/119（第三方验证）。AC104/AC105 已 land。人裁定「AC104-109 落笔归属 outer（立案/驱动）+ inner（产品代码）」。

**判据正本**：`orchestration/manager-phase-goal.md` AC107（:59-68）。

**核心要求**：`plugin/scripts/verify-deliver-coldstart.sh` 对 **B=orangevps** 与 **C=ad-arm1** 各跑一次完整三步（① 干净目录全新 .tgz 安装 ② 项目内 quay-init ③ outer+inner 双层冷启动活性），tgz 由该次验证自己从 develop-tip 现 build（`--build-root`），记录 commit sha + 产物 sha256。

**取假三条**：(a) 验证所用 commit sha 必须新于 2026-08-20；(b) 不得引用 08-06/08-11/08-16 历史验证；(c) 冷启动活性判据必须直接量（git 提交时刻 / /proc/<pid>/cwd / worktree），⛔ 不得用「进程存在」代理量（硬规则 4b）。

**已知前置（AC88 当年实测，需重新核实）**：B 机曾是 sync.sh 同步的开发树（有 .git，不满足非 git clone）；C 机曾无 quay 主检出。**本阶段第一步就是重新实测这两台机当前形态，不得沿用 08-16 记述**。

**⛔ 依赖 AC106**：AC106 确认当前 CI 流程能产出 dist-verify 真实 run 后，AC107 才做跨主机验证。

**为什么 inner 执行**：verify-deliver-coldstart.sh 属 plugin/scripts/（实现面），跨主机执行是 inner 域。

## Plan

1. 核实 B/C 两台机当前形态（B 是否仍有 .git、C 是否已有 quay 检出）——不得沿用 08-16 记述。
2. 对 B=orangevps 与 C=ad-arm1 各跑 `verify-deliver-coldstart.sh` 完整三步（`--build-root` 现 build tgz）。
3. 记录 commit sha + 产物 sha256 + 验证时刻（新于 2026-08-20）。
4. 冷启动活性判据用直接量（git 提交时刻 / /proc/<pid>/cwd / worktree）。
5. 记录写入 `.quay/productization-verification.jsonl`（`ac="AC107"`）。

## Acceptance Criteria

- [ ] AC1: B=orangevps 完整三步跑通（干净 .tgz 安装 + quay-init + 双层冷启动活性，直接量判据）。
- [ ] AC2: C=ad-arm1 完整三步跑通（同上）。
- [ ] AC3: 验证 commit sha 新于 2026-08-20 + 产物 sha256 已记录（取假：旧于切换或引历史验证 ⇒ 未达成）。
- [ ] AC4: 记录写入 `.quay/productization-verification.jsonl`（`ac="AC107"`）。

## Definition of Done

- [ ] B/C 两台机各完成完整三步跨主机验证（非手工一次性、非历史引用）；直接量活性判据；记录可复核。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh（跨主机验证入口——若实现有 bug 需修，inner 域）
- .quay/productization-verification.jsonl（记录）
- tasks/gap-ac107-cross-host-mechanized-verify.md（自身）
