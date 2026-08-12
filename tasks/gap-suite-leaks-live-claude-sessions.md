---
id: gap-suite-leaks-live-claude-sessions
title: 套件/teardown 泄漏活 Claude 会话（4 孤儿 109-120h）— 需 teardown 完整 + 孤儿检测器
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**机制缺陷（manager 042500 实测）**：套件/teardown 泄漏活的 Claude Code 会话进程。

**实测（可复现）**：
```
$ ps -eo pid,etimes,args | grep -F 'claude ' | grep -vF ugrep
1517742  存活 109h35m  RSS 178MB  claude --settings /tmp/quay-suite-int/.claude/launch.settings.json ... -n quay-inner
1517749  存活 109h35m  RSS 179MB  同上
2625322  存活 119h41m  RSS 164MB  claude --settings /home/yale/work/quay-worktrees/manager-productization2/... -n quay-inner
2625327  存活 119h41m  RSS 167MB  同上
```
工作区已删：`/tmp/quay-suite-int` 目录不存在、`manager-productization2` worktree 已注销。**两次运行各起一对真会话，teardown 没回收进程**。

**为什么是缺陷**：本机 claude 总占 3.7GB/15GB，4 孤儿占 ~688MB（18%）；孤儿还可能挂 MCP 子进程（未逐个查）；109h/120h 说明非偶发且无机件发现过。

**根因**：① `/tmp/quay-suite-int` 集成夹具起真会话，teardown 只删目录不回收进程；② worktree 注销路径没有「先停该 worktree 里的会话」一步。

**修法（outer 裁定 → inner 实现）**：
1. 夹具 teardown 完整（删目录 + 回收进程）
2. worktree 注销前停其会话
3. **孤儿检测器**：枚举 `claude --settings <path>` 进程，`<path>` 工作区目录不存在则计孤儿，孤儿数 > 0 即红（硬规则 9 可区分）

**验证锚**：修后 (a) 孤儿检测器报孤儿数；(b) teardown 完整回收；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 4 孤儿实测（两对 109h/119h，工作区已删）（本任务 Proposal 已含）
- [ ] AC2: **teardown 完整**——夹具/worktree teardown 删目录 + 回收进程（不只删目录）
- [ ] AC3: **孤儿检测器**——枚举 `claude --settings <path>` 进程，工作区目录不存在计孤儿，孤儿>0 即红
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：孤儿检测器读数（当前 4 → 修后 0）贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/orphan-session-check.ts（新：孤儿检测器）
- plugin/scripts/provision-verify-worktree.sh（teardown 完整）
- plugin/scripts/full-suite-runner.ts（夹具 teardown 回收进程）
- plugin/scripts/integration-batch-merge.sh（worktree 注销前停会话）
- plugin/test/（孤儿检测用例）
- tasks/gap-suite-leaks-live-claude-sessions.md（自身：勾 AC + 贴证据）

## Contract

measure   orphan_sessions = `node --no-warnings --experimental-strip-types plugin/scripts/orphan-session-check.ts --json` 的 orphan_count 字段
band      orphan_sessions = 0（修后无孤儿；当前 4）
invariant teardown_kills_processes = 1（teardown 删目录 + 回收进程）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/orphan-session-check.ts --json`（贴孤儿计数）
control   无孤儿；teardown 完整；既有不回归
resume    孤儿检测器 / teardown / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 042500 实测（4 孤儿 109-120h）。teardown 不完整 + 无孤儿检测器。outer 裁定修法。实现归 inner。
