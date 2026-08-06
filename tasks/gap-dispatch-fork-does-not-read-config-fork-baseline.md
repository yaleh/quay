---
id: gap-dispatch-fork-does-not-read-config-fork-baseline
title: "dispatch fork action does NOT read config's fork_baseline — task/gap-supervisor-base-layer created 07:10:11 (AFTER fork_baseline:develop landed in .quay/config.yml at 07:09:43) still forked from master: git rev-list develop..branch = 49, intersection with develop..master = 49 (100% on master line, structural proof not merge-base); develop still frozen at 926d771b, master ahead 52; inner's fan-in note 'config activation deferred to outer (stale-baseline timing risk, gitignored human-owned file)' — fork fell back to master WITHOUT re-reading the now-active config; manager 3-step measurement 2026-08-06: config effective ≠ call-site changed, same class as hardcode-master's own finding; only next dispatch can confirm scope (one-branch timing vs fork-never-reads-config)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**dispatch 的 fork 动作没读 config 的 fork_baseline——config 已激活，任务仍从 master 分叉。**

**【实测（管理者三步 + 外层独立确认，2026-08-06）】**：
- `task/gap-supervisor-base-layer` 创建于 **07:10:11**，而 `.quay/config.yml` 的 `fork_baseline: develop`
  落地于 **07:09:43**（外层 commit ab541024）——**分支晚于 config 28 秒**，不是时序。
- **结构性证明（非 merge-base，merge-base 对两者都返回 926d771b 不可用）**：`git rev-list develop..branch`
  = **49**，与 `git rev-list develop..master` 的交集 = **49**——分支超出 develop 的每个提交都在 master
  线上，**只能从 master 分叉**。
- develop 仍冻结在 926d771b，master 领先 **52**。
- **inner fan-in 注记**：「config activation (fork_baseline:develop) deferred to outer (stale-baseline
  timing risk, gitignored human-owned file)」——inner 知道 config 要激活但推迟，**fork 时 fallback 到
  master 没重读已激活的 config**。

**【性质】**：hardcode-master 标题「配置生效 ≠ 调用点改变」在**上一层复现**——AC 都满足（measure=0、
config 有 fork_baseline、AC2 scratch 跑通），但**真实 dispatch 的 fork 动作没读 config**。inner 把
.gitquay/config.yml 视为 gitignored human-owned 而不读（或读了但没接到 fork 调用）。

**【范围确认】**：可能是「这一个分支在 config 激活前被 inner 视为未激活而 fallback」，也可能是「fork
动作结构上从不读 config」。**只有下一个新派发能分辨**——若下一个分支仍从 master 分叉，则是结构缺陷；
若从 develop 分叉，则是这个分支的时序。

### 选定机制

1. **确认 fork 调用链**：dispatch 创建 worktree 时读 config 的 `fork_baseline`（或调 fork-baseline.ts
   传 `--develop $FORK_BASELINE`），不再 fallback master
2. **下一个派发验分叉基线**：管理者的判别法（rev-list develop..branch ∩ develop..master 全交集 =
   master 分叉）——验证修复是否生效

## Acceptance Criteria

- [ ] AC1: 下一个新派发——任务分支从 develop 分叉（rev-list develop..branch ∩ develop..master ≠ 全量，
       或 rev-list develop..branch 不含 master-only 提交）
- [ ] AC2: fork 动作读 config fork_baseline（grep 调用链证明——worktree 创建传 fork-baseline.ts 结果）
- [ ] AC3: 与 gap-two-layer-loop-tick-docs-hardcode-master（done）交叉标注——本任务是它「配置生效 ≠
       调用点改变」在真实 dispatch 层的复现
- [ ] AC4: 负控制——下游（无 fork_baseline 配置）仍从 master 分叉（共享默认不变）

## Touches

- plugin/scripts/fork-baseline.ts（若需在 worktree 创建处接线）
- plugin/loop/fast-mode-loop-tick.md（dispatch fork 步：读 config fork_baseline 而非 fallback）
- tasks/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model.md（AC3 交叉标注）

## Contract

measure   fork_baseline_used = `git rev-list develop..<下一个task分支> | wc -l` 与 `git rev-list develop..master` 交集数
band      fork_baseline_used 交集 < 分支超出数（分支含 non-master 提交 = 从 develop 分叉）
invoke    `grep -rn 'fork_baseline\|FORK_BASELINE\|fork-baseline.ts' plugin/scripts/fork-baseline.ts plugin/loop/fast-mode-loop-tick.md`
control   下一个派发分支从 develop 分叉（AC1）；无配置下游仍 master（AC4）
resume    fork 接线与验基线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T07:3xZ
changed: 管理者三步实测 + 外层独立确认（结构证明 49/49 交集）立案。config 已激活但 fork 从 master——
hardcode-master「配置生效 ≠ 调用点改变」在真实 dispatch 层复现。inner 推迟 config 激活 + fork fallback
master。范围待下一个派发分辨（时序 vs 结构）。下一个派发必验分叉基线。
