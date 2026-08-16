---
id: gap-ac86-dist-verify-node-floor-equivalent-path
title: "AC86: `dist-verify-node-floor` 在当前开发流程上有等价的真实执行路径（非只改 on: 触发条件）"
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

**来源**：人 2026-08-16 裁定新阶段（manager-phase-goal.md AC86）。

**核心发现（manager 实测）**：`dist-verify-node-floor`（ci.yml:66）**13 天没真实跑过**（gh run list
最近一次 = 08-03）。**根因**：触发只在 push/PR to master，本项目主线是 develop，从不合 master
（ADR-022 后）⇒ **结构上不可能被现在的开发流程触发**。

**判据（能取假，这是本阶段的核心发现）**：**不是要求"让它跑起来"这么简单**——
要么 ① 在 develop 上补一个等价触发（如 `scripts/test.sh` 之外的独立 CI job 挂 push-to-develop），
要么 ② 在本地/per-task suite 流程里补一个等价的本机 floor 验证步骤。
**⛔ 不得只改 `on:` 触发条件了事**——判据是"**真实运行过至少一次**且时间新于本次切换"，
不是"配置看起来对了"（同 SPEC gap-phase-boundary-differential-accounting 的推论三教训：
fixture/配置正确 ≠ 已产出）。

## Plan

1. 确认 `dist-verify-node-floor` 现状（ci.yml:66 触发条件、产物、Node 底限）。
2. 选路径 ①（CI 挂 develop）或 ②（本地 suite 补 floor 验证步）——需能取假：真实执行至少一次。
3. 落地该路径（.github/workflows/ 或 scripts/test.sh + plugin/scripts/）。
4. 触发一次真实运行，记录时间戳（新于 2026-08-16 切换）+ 输出。

## Acceptance Criteria

- [ ] AC1: `dist-verify-node-floor` 有等价路径在当前流程（develop 主线）上**真实执行过至少一次**，
      `gh run list` 或等价记录显示执行时间新于 2026-08-16。
- [ ] AC2: 判据不满足「只改 `on:`」——达成证据必须是**执行产物**（job run / 本地验证输出），
      不是配置 diff 本身。
- [ ] AC3: 等价路径覆盖原 `dist-verify-node-floor` 的语义（真 npm-pack 产物在 Node 底线上跑）。
- [ ] AC4: 执行结果落证据（run id / 输出日志），可机械核对。

## Definition of Done

- [ ] `dist-verify-node-floor` 的等价路径在当前开发流程上真实执行过且记录可核，不再结构上不可触发。

## Touches

- .github/workflows/ci.yml（若选路径①）
- scripts/test.sh（若选路径②，本机 floor 验证步）
- plugin/scripts/*（若选路径②，本机 floor 验证步；含 capability-catalog.sh——0a4e5c1f 转义 $TMUX 修 CI 下 package.sh 构建失败）
- plugin/test/*（对应测试）
- tasks/gap-ac86-dist-verify-node-floor-equivalent-path.md（自身）
