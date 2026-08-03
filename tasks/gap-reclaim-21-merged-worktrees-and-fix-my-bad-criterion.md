---
id: gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion
title: "21 fully-merged worktrees hold 1.1G, and the criterion I wrote last
  night would lock them there forever"
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

`milestones/` 占 **1.1G**，21 个在册 `milestone/*` worktree。实测（2026-08-03）：

```
git merge-base --is-ancestor <branch> master  →  21/22 为真
git cherry master milestone/M211/iteration-0  →  0 个未合并提交
git rev-list --count master..milestone/M211/iteration-0  →  0
```

**21 个分支的提交已全部在 master 历史里**，唯一例外是 `milestone/M239/iteration-0`
（领先 2，人已裁定推迟，保留）。

### 而我昨夜写进任务的判据会把它们全部锁死

`gap-stranded-worktree-branches-have-no-alarm-channel` 的 AC2b 写的是：

> 提交数为 0 **但两点 diff 非空** 的分支报为 `merged-then-reverted`

**这条是错的。** `git diff master <branch>`（两点）比的是两棵树——一个几天前合并的旧分支，
master 之后前进了几百个提交，两点 diff 当然非空。实测：21 个分支**全部**被这条判成
`merged-then-reverted`，而其中只有 M243 曾经真的是（且已恢复）。

按这条判据，`--clean-stale` 会拒绝清理全部 21 个，**1.1G 永久留存**。

**这是「仪器名不符实」的又一个实例**（`docs/analysis/instrument-failure-mode.md`）：
判据的名字说「被合并后又被 revert」，实际测的是「master 有没有前进」。

### 正确的判据

| 问题 | 正确测法 | 为什么 |
|---|---|---|
| 分支的提交是否都在 master 里 | `git merge-base --is-ancestor <b> master` | 直接回答，与 master 前进无关 |
| 分支引入的内容是否被 revert 掉了 | **分支创建的文件在 master 上是否仍存在** | M243 的信号正是 `workflow-replay.ts` 消失；两点/三点 diff 都做不到这个区分 |
| worktree 里有没有未提交的活 | 该 worktree 内 `git status --porcelain` | 昨夜已确认 `--clean-stale` 用 `--force`，会直接毁掉未提交内容 |

三条都为「安全」才可回收。

## Chosen mechanism

1. **先修判据**（`gap-stranded-worktree-branches-have-no-alarm-channel` 的 AC2b/AC2c），
   再回收。**顺序不能反**——判据错着的时候回收，等于用一把坏尺子决定删什么。
2. 回收对象：`merge-base --is-ancestor` 为真 **且** 该 worktree 无未提交改动的分支与目录。
3. **M239 不动**（人已裁定推迟，领先 2 个提交）。
4. 回收前**逐个记录**分支名、合并进 master 的提交、释放的空间——删除是不可逆的，
   记录是唯一的事后追溯。

**不做**：不用 `--force`。让 git 自己的「contains modified or untracked files」成为最后一道闸
（昨夜实测该保护存在且当前被显式绕过）。

## Acceptance Criteria

- [ ] AC1: `merged-then-reverted` 判据改为「分支创建的文件在 master 上是否仍存在」，
      不再用两点 diff；用 21 个已合并分支验证**它们不再被误报**
- [ ] AC2: 用 M243 的历史状态（`88e17bf2` revert 后、`3dfba2c6` 恢复前）验证新判据**仍能报出**真实的
      merged-then-reverted——放宽不得放过真阳性
- [ ] AC3: `--clean-stale` 在删除前检查该 worktree 内 `git status --porcelain`，非空则拒绝
- [ ] AC4: 去掉 `worktree remove` 的 `--force`
- [ ] AC5: 实跑回收，逐个记录分支名 / 合并提交 / 释放空间；`milestones/` 占用改前/改后实测
- [ ] AC6: `milestone/M239/iteration-0` **未被回收**（人已裁定推迟）
- [ ] AC7: 回收后 `git worktree list` 与 `git branch --list 'milestone/*'` 无残留悬挂条目
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC5 的回收清单与空间对比贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**一条名字说 A、实际测 B 的判据，会让清理工作永久停摆**——
      本例中代价是 1.1G 与 21 个 worktree

## Touches

- plugin/scripts/milestone-worktree.ts
- experiments/quay-perpetual-stream/scripts/milestone-worktree.ts
- plugin/test/milestone-worktree.test.mjs
- tasks/gap-stranded-worktree-branches-have-no-alarm-channel.md
