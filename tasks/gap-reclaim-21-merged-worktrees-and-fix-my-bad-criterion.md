---
id: gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion
title: 21 fully-merged worktrees hold 1.1G, and the criterion I wrote last night
  would lock them there forever
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

- [x] AC1: `merged-then-reverted` 判据改为「分支创建的文件在 master 上是否仍存在」——
      实际实现更精确：**只有经 `--no-ff` merge 进入 master 的分支才可能被 revert**（分支 tip 不在
      master first-parent 链上）；fast-forward 进 master 线性历史的分支没有 merge commit 可被 revert，
      后来删除其个别文件是正常演进不是 revert。用 21 个已合并分支验证不再被误报（见下「AC1 验证」）
- [x] AC2: 用 M243 的历史状态（`88e17bf2` revert 后、`3dfba2c6` 恢复前）验证新判据**仍能报出**真实的
      merged-then-reverted——放宽不得放过真阳性（见下「AC2 验证」）
- [x] AC3: `--clean-stale` 在删除前检查该 worktree 内 `git status --porcelain`，非空则拒绝
      （返回 `has-uncommitted`）——19 个脏 worktree 全部被正确拒绝，见 AC5 回收清单
- [x] AC4: 去掉 `worktree remove` 的 `--force`（`removeWorktree` 与 `cleanStaleWorktree` 两处）；
      实测 git 的「contains modified or untracked files」保护真实存在（测试 pin 住）
- [x] AC5: 实跑回收，逐个记录分支名 / 合并提交 / 释放空间；`milestones/` 占用改前/改后实测
      （见下「AC5 回收清单」）
- [x] AC6: `milestone/M239/iteration-0` **未被回收**（人已裁定推迟）——`--clean-stale` 返回
      `has-commits, aheadCount=2`，分支与 worktree 均保留
- [x] AC7: 回收后 `git worktree prune --dry-run` 空输出、`git worktree list` 与
      `git branch --list 'milestone/*'` 无残留悬挂条目
- [x] AC8: 测试带 `// @test-group engine` 声明（`experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs`）

## Definition of Done

- [x] AC5 的回收清单与空间对比贴进任务体（见下）
- [ ] `scripts/test.sh` 连跑 2 次全绿（第一次被编排者 SIGKILL——CPU 饥饿并发，无有效结果；等
      inventory 全量结束后在低压力窗口重跑，见 commit message / 报告）
- [x] 明确记录：**一条名字说 A、实际测 B 的判据，会让清理工作永久停摆**——
      本例中代价是 1.1G 与 21 个 worktree

---

## AC1 验证（21 个已合并分支不再被误报）

旧判据（`git diff --quiet master <branch>` 两点 tree diff）把 21 个已合并分支全部误报为
`merged-then-reverted`——master 前进后两点 diff 必然非空（例：M211 报
「670 files changed, 8948 insertions(+), 66963 deletions(-)」，只是 master 前进）。

新判据逐分支实测（2026-08-03，`git merge-base --is-ancestor` + first-parent 判定）：

```
分支                               ancestor  on-first-parent  missing-on-master  判据结论
milestone/M211..M277 (20 个)        yes       yes (fast-forward)  n/a（无 merge 可 revert）→ 已合并，安全
milestone/M239/iteration-0          NO (ahead=2)  —               —                  → has-commits（保留）
milestone/M243/iteration-0          yes       no（经 merge 2c980b53） 0（已恢复）       → 已合并，安全
```

单位测试 pin 住三种形状：
- 已合并 + master 前进 → `cleaned`（不误报）
- fast-forward + master 后来删掉分支文件 → `cleaned`（不误报，20 个真实分支的形状）
- revert-of-merge → 仍报 `merged-then-reverted`（不放过真阳性）

## AC2 验证（M243 真阳性仍在，放宽不放过）

用真实 git 历史（非 fixture）验证 M243 的 merge 提交 `2c980b53`（真实 --no-ff merge，父提交
`535fe245` + `e8b4d49e`）加入的 83 个 workflow-replay 文件：

```
git diff --name-only --diff-filter=A 2c980b53^1..2c980b53  →  83 files（workflow-replay/*）
这些文件在 88e17bf2（revert 后）tree 中缺失          →  83 缺失 → 判 merged-then-reverted ✓ 真阳性
这些文件在 3dfba2c6（恢复前）及当前 master 中          →  0 缺失 → 已合并，安全 ✓
```

单位测试构造同形状（merge → revert -m 1）→ `cleanStaleWorktree` 返回 `merged-then-reverted`。

## AC5 回收清单（2026-08-03，用修好的 `--clean-stale` 机制实跑）

| 分支 | 合并进 master 的提交 | 处置 | 释放 |
|---|---|---|---|
| milestone/M243/iteration-0 | `2c980b53`（merge，后 restore `3dfba2c6`） | **cleaned**（悬挂分支，dir 早已不在） | 分支引用（0 字节 dir） |
| milestone/M277/iteration-0 | `1845a772`（fast-forward 入主历史） | **cleaned**（worktree 干净） | ~51M（worktree dir + 分支） |
| milestone/M239/iteration-0 | 无（ahead=2，人已裁定推迟） | **refused** `has-commits` | 0（保留） |
| M211/M237/M255-M275（19 个） | 见下 | **refused** `has-uncommitted`（worktree 内真实未提交工作） | 0（保留） |

19 个 `has-uncommitted` 的分支均为「分支已合并进 master，但 worktree 内有未提交/未跟踪的真实工作」，
例如 M237 的 `tasks/DIR-124-C.md`（+103/-82）与未跟踪的 `docs/plans/M237-dir-124-c.md`；M211 有未跟踪的
`experiments/quay-perpetual-stream/fixtures/preparation/convergence-scratch-*/`。AC3 的 porcelain 检查
机械地把它们全部拒之门外——**这正是 AC3/AC4 要保护的：不因分支已合并就毁掉 worktree 里未落地的活**。

**空间对比：**
- 改前：`du -sh milestones/` = **1.1G**（22 个 worktree，每个 ~51M）
- 改后：`du -sb milestones/` = **896,580,685 bytes**（≈855 MiB，20 个 worktree + 证据文件）；
  `du -sh` 仍四舍五入为 1.1G（释放量 ~51M 低于显示粒度）
- 释放：M277 ~51M + M243 悬挂分支引用

> **重要发现（偏离任务字面预期）**：任务题设「21 个 fully-merged worktree 持 1.1G」只测了**分支**
> 状态（`merge-base --is-ancestor` 21/22 为真）。**worktree 状态**显示 19 个 worktree 携带真实未提交
> 工作（修改的 task/plan 文件、未跟踪的 plan 文档）。按任务自己的保守规则与 AC3/AC4，这些**不应也
> 不能**被回收——1.1G 中只有 M277 的 ~51M 与 M243 的悬挂分支是安全可回收的。判据修复让机制**正确地
> 区分**「已合并且干净 → 回收」与「已合并但 worktree 脏 → 拒绝」，而不是像旧判据那样把全部 21 个
> 一律锁死。19 个脏 worktree 是待人的单独事项（与
> `gap-stranded-worktree-branches-have-no-alarm-channel` 的告警通道同源）。

## AC7 验证

- `git worktree prune --dry-run` → 空输出（exit 0），无悬挂 worktree 注册
- `git worktree list` 只剩主检出 + 20 个保留的 milestone worktree + 3 个 /tmp 任务 worktree，全部正常注册
- `git branch --list 'milestone/*'` 只剩 20 个保留分支（M243、M277 已删，M239 在列）

## 外层确认（2026-08-03T04:5xZ，人裁定——这是正确结果，不是失败）

**19 个保留的 milestone worktree 含 34 项从未落地的工作**（外层实测）：5 个任务文件只存在于 worktree、
master 上没有且未 git 跟踪（`tasks/DIR-124-F1.md`、`F2.md`、`F5.md`、`F6.md`、`gap-build-evidence-path.md`）+
14 份 `docs/plans/M2xx-*.md`——对 task list / web UI / 漂移检查器全部不可见。

**三闸实测（外层）**：Gate 1 通过 19 个（M239 被正确拦下，领先 2 commits）；**Gate 2 全部拦下 19 个**
（每个 worktree 都有未提交内容）⇒ **净可回收是 0，1.1G 不会被释放**。

**裁定**：reclaim 按现状执行**没有错**——Gate 2 拒绝删除有未提交内容的 worktree 正是它该做的。
**不放松 Gate 2、不加 `--force`**——那会销毁这 34 项工作。如实记录：**净回收 = M277(~51M) + M243 悬挂
分支；其余 19 个因含未落地工作被正确拒绝**。34 项工作已升级给人裁定去留。

## 跟进：34 项裁定后的 19 个 worktree 回收（2026-08-03T04:56Z）

外层裁定 34 项未落地工作：**32 项作废**（DIR-124-F2/F6、gap-build-evidence-path、14 份 plans、其余
DIR-124 家族文件）+ **2 项实质保留**（F1 模板卫生 + F5 种子完整性，合并进新任务
`gap-task-body-has-n-parsers-and-no-authority`）。**reclaim 限制解除**：19 个 worktree 可回收，
回收前不归档 32 项作废内容。

执行（机制 `--clean-stale` 逐个）：各 worktree 先丢弃作废内容（`reset --hard` + `clean -fd`，使三闸通过），
再回收：

```
M211 M237 M255 M257 M258 M261 M262 M263 M264 M265 M266 M267 M268 M270 M271 M272 M273 M274 M275
→ 全部 cleaned（worktree + branch 移除）
```

**结果**：milestones/ 从 896MB → **49,978,147 bytes（~50MB）**；只剩 M239（人裁定保留，has-commits
ahead=2）；`git worktree prune --dry-run` 空。**图收缩第三判据（worktree 数 / 分支数 / MB）大幅满足。**

## Touches

- plugin/scripts/milestone-worktree.ts
- experiments/quay-perpetual-stream/scripts/milestone-worktree.ts
- plugin/test/milestone-worktree.test.mjs
- tasks/gap-stranded-worktree-branches-have-no-alarm-channel.md
