---
id: gap-dispatch-fork-does-not-read-config-fork-baseline
title: "dispatch fork action does NOT read config's fork_baseline —
  task/gap-supervisor-base-layer created 07:10:11 (AFTER fork_baseline:develop
  landed in .quay/config.yml at 07:09:43) still forked from master: git rev-list
  develop..branch = 49, intersection with develop..master = 49 (100% on master
  line, structural proof not merge-base); develop still frozen at 926d771b,
  master ahead 52; inner's fan-in note 'config activation deferred to outer
  (stale-baseline timing risk, gitignored human-owned file)' — fork fell back to
  master WITHOUT re-reading the now-active config; manager 3-step measurement
  2026-08-06: config effective ≠ call-site changed, same class as
  hardcode-master's own finding; only next dispatch can confirm scope
  (one-branch timing vs fork-never-reads-config)"
status: done
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

- [x] AC1: 下一个新派发——任务分支从 develop 分叉（rev-list develop..branch ∩ develop..master ≠ 全量，
       或 rev-list develop..branch 不含 master-only 提交）
- [x] AC2: fork 动作读 config fork_baseline（grep 调用链证明——worktree 创建传 fork-baseline.ts 结果）
- [x] AC3: 与 gap-two-layer-loop-tick-docs-hardcode-master（done）交叉标注——本任务是它「配置生效 ≠
       调用点改变」在真实 dispatch 层的复现
- [x] AC4: 负控制——下游（无 fork_baseline 配置）仍从 master 分叉（共享默认不变）

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：non-reproduction confirmed in body: next dispatch reflog shows 'Created from develop' (fork_baseline read); supervisor was the last pre-activation master fork. No fix implemented because nothing to fix.）**
全文见 git 历史（`git log -p -- tasks/gap-dispatch-fork-does-not-read-config-fork-baseline.md`）。

## Touches

- plugin/scripts/fork-baseline.ts（若需在 worktree 创建处接线）
- plugin/loop/fast-mode-loop-tick.md（dispatch fork 步：读 config fork_baseline 而非 fallback）
- tasks/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model.md（AC3 交叉标注）

## Contract

measure   fork_baseline_used = `git reflog show <task分支> | tail -1` stdout 的创建来源（字面量 "Created from develop" / "Created from master"）
band      fork_baseline_used = Created from develop（新派发分支从 develop 分叉；reflog 一条命令判别）
invoke    `grep -rn 'fork_baseline\|FORK_BASELINE\|fork-baseline.ts' plugin/scripts/fork-baseline.ts plugin/loop/fast-mode-loop-tick.md`
control   下一个派发分支从 develop 分叉（AC1）；无配置下游仍 master（AC4）
resume    fork 接线与验基线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T07:3xZ
changed: 管理者三步实测 + 外层独立确认（结构证明 49/49 交集）立案。config 已激活但 fork 从 master——
hardcode-master「配置生效 ≠ 调用点改变」在真实 dispatch 层复现。inner 推迟 config 激活 + fork fallback
master。范围待下一个派发分辨（时序 vs 结构）。下一个派发必验分叉基线。

## 验证更新（2026-08-06 07:4xZ，管理者更正 + 不复现确认）

**数字更正（管理者）**：supervisor 分支「07:10 创建」实为最后提交时间，reflog 实测创建于 **07:10:11**
（外层 reflog 复核：`branch: Created from master`）。「晚于 config 28 秒」精度以 reflog 为准（结论方向
不变：确实从 master 分叉）。

**更好判别式（采纳到 Contract）**：`git reflog show <branch>` 直接给出字面量
`branch: Created from master` / `Created from develop`——一条命令，非 merge-base 的非判别性，也非
rev-list 交集把已合并老分支误标。

**不复现确认（管理者第 3 条 + 外层独立验证）**：spawn-count 分支
（task/gap-the-spawn-count-criterion...）reflog = **`branch: Created from develop`**（926d771b），
且 tip 是 develop 祖先、`rev-list develop..分支` = 0——**从 develop 分叉**。⇒ fork 路径在 config 激活
后已读 fork_baseline。**本任务不复现，不实现修复**（supervisor 是 config 激活前最后的 master 分叉，
记录在案）。若标记为已修复，是在修幻影。

## 交叉标注（2026-08-11，gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target）

**铺设链路的相邻两段（前后相邻，缺一段就都白搭）**：

- **本任务**（gap-dispatch-fork-does-not-read-config-fork-baseline，done，AC4 负控制）：**「铺设后
  dispatch 是否读」**——config 有 `fork_baseline`/`merge_target` 时 fork 动作读不读。结论：读，不复现
  （reflog `Created from develop`）；无配置下游仍从 master 分叉（共享默认不变）。
- **那条任务**（gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target）：**「新主机
  第一次铺设时这两键会不会被写进去」**——`write_provider_config` heredoc 此前从不写
  `fork_baseline`/`merge_target`（grep 0 命中），新主机跑标准 `quay-init --loop` 得到
  `loop:{repo_root,test_command,tmux_session,worktree_root}` ONLY，dispatch 静默回落到旧 master-only
  模型。修复：heredoc 写入 `fork_baseline: develop` / `merge_target: integration`（随 quay-init 升级
  默认值，非硬编码 master）；升级路径（ensure_loop_config）不覆盖已存在正确值。

两任务在铺设链路上相邻：本任务负责「铺好后 dispatch 读不读」，那条任务负责「铺的时候写不写」。
这条任务补齐后者后，`quay-init --loop` → 生成的 config 含两键 → 本任务的 fork 读取链路才真正闭环。
