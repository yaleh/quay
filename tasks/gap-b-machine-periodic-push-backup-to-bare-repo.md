---
id: gap-b-machine-periodic-push-backup-to-bare-repo
title: "B machine periodic push backup — low-frequency cron (every 10-15 min)
  running git push to ~/work/quay-sync.git, PURELY to prevent single-point
  loss (B's commits exist only on B's disk; disk death = work gone, incl new
  SKILL.md + test file); NARROW scope: periodic commit backup ONLY — does NOT
  involve claiming/authority/conflict-resolution (those stay in
  gap-two-machine-collaboration); B has the remote already (just never pushed);
  executor: manager on B (has context) or B's outer (one-line cron); verified
  2026-08-05: no narrow task exists, only mentioned within the larger claiming
  design — this should NOT wait for the claiming mechanism"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**B 机定期 push 备份——防止单点丢失的窄任务（管理者核实无独立任务，立案）。**

**【实测背景】**：B 机 origin = 本地裸仓库 ~/work/quay-sync.git（停在 8371d741，从未 push）；B 的 8 个
提交（含新 `plugin/skills/manager/SKILL.md` + 一个测试文件）只在 B 工作树——裸仓库/GitHub/A 机都没有。
**磁盘挂 = 工作直接消失**（单点风险）。

**【范围（窄）】**：低频 cron（每 10-15 分钟）执行 `git push` 到 ~/work/quay-sync.git。**纯粹备份提交**，
**不涉及**认领/权威/冲突解决（那些留给 gap-two-machine-collaboration-git-branch-claiming）。B 已有该
remote，只是从未用过。

**【为何不等认领机制】**：认领机制设计完成前，B 的提交暴露在单点丢失风险下。备份是一行 cron，独立可做。

**【执行者】**:管理者在 B 执行（已具上下文、有 remote）；或 B 机 outer 自主加（一行 cron）。

### 选定机制

1. B 机加 cron：每 10-15 分钟 `git push` 到 ~/work/quay-sync.git
2. 仅备份提交（不改动认领/权威/冲突逻辑）
3. push 可能暴露的冲突（fast-mode-loop-tick.md A/B 各改）留合并处理（two-machine-collaboration 范围）

## Acceptance Criteria

- [ ] AC1: B 机 cron 已加（每 10-15 分钟 git push 到裸仓库），实测一轮 push 成功
- [ ] AC2: 裸仓库更新到 B 的最新提交（B 的 8+ 提交可被 A 拉取）
- [ ] AC3: 范围窄——未触碰认领/权威/冲突逻辑（grep 无相关改动）

## Touches

- B 机 crontab（一行 cron）
- tasks/gap-two-machine-collaboration-git-branch-claiming.md（AC3 交叉标注——冲突/认领留其范围）

## Contract

measure   push_ok = B 机 `git push 2>&1 | grep -c 'To.*quay-sync\|up-to-date'` stdout 数字段
band      push_ok >= 1（push 成功或 up-to-date）
invoke    B 机 `crontab -l 2>&1 | grep -c 'git push'`
control   认领/权威逻辑零改动（AC3）
resume    单步（cron 一行）完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T23:3xZ
changed: 管理者核实无独立窄任务 → 立案。范围窄（纯备份），执行者管理者/B 机 outer。与 two-machine-collaboration
交叉（冲突/认领留其范围）。
