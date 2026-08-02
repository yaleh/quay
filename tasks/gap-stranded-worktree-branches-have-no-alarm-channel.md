---
id: gap-stranded-worktree-branches-have-no-alarm-channel
title: "Land fails closed and preserves the branch — but nothing ever tells
  anyone, so 25k lines sat stranded for a day"
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

2026-08-02 外层 tick 发现 **4 个 worktree 分支携带 24,989 行已验收但从未合并的工作**，全部滞留于
2026-08-01：

| 分支 | 任务 | 未合并行数 |
|---|---|---|
| `milestone/M243/iteration-0` | DIR-124-A2 | +8,351 |
| `milestone/M246/iteration-0` | DIR-124-A5 | +9,161 |
| `milestone/M239/iteration-0` | gap-prepare-milestone-no-size-aware-routing-A | +6,901 |
| `milestone/M222/iteration-0` | DIR-112 | +576 |

**机制本身没坏。** CLAUDE.md 写明：`milestone-worktree.ts --clean-stale` 只回收零领先的分支，
**带提交的分支 fail-closed 到 needs-human，绝不丢弃**。它正是这么做的——工作一行没丢。

**坏的是没有任何东西把这件事说出来。** fail-closed 保住了工作，然后：

- 没有告警通道。没有一个检查会在下一次运行时说「有 4 个分支带着未合并的提交」
- `restart-readiness-check.sh` 检查干净树、检查 mid-flight merge、检查 master 是否被别的 worktree
  占用——**不检查有没有带提交的滞留分支**
- 于是它被发现的方式，是一个人在一天后偶然运行 `git worktree list`

更糟的是它**主动制造了错误结论**：`task-status-drift-check.ts` 只看 master，把 A2/A5 报成
「done 但代码从未落地」。外层据此做了一次全链复核，得出「机制需要重建」——**完全反了**，代码就在
那儿，只需要合并。一个静默的 fail-closed 不只是没帮上忙，它把下游的判断带偏了。

这是本仓库反复出现的模式（`orchestration/orchestrator-loop-tick.md` 步骤 6 已列举四次）的一个新
变体：**这次不是「报警没人处理」，是「保护动作正确执行了但从不报警」**。

## Chosen mechanism

**把「带提交的滞留分支」做成一个会说话的机械检查，接进已有的两个入口。**

1. **一个具名检查**：枚举 `milestone/*` 与 `task/*` 分支，对每个算 `git rev-list --count master..<b>`。
   非零的即为**滞留分支**，报出分支名、领先提交数、`--shortstat` 的插入行数、最后提交日期。
   零领先的不报（那些是 `--clean-stale` 的常规回收对象，不是告警）。
2. **接进 `restart-readiness-check.sh`**：滞留分支存在时**不阻断**（那些工作可能本来就该等），
   但必须**打印出来**并要求人确认。它现在检查干净树与 mid-flight merge，唯独漏了这一类——补上。
3. **接进外层 tick**：`orchestration/orchestrator-loop-tick.md` 步骤 1 的观察命令里加一条，
   使每 20 分钟就会看到，而不是靠偶然。
4. **让 `task-status-drift-check.ts` 区分第三类**：当前它只有「done 但代码没落地」。
   代码**在某个未合并分支上**时，必须报成 `stranded-not-merged` 而**不是** `reverse-drift-suspect`
   —— 两者的处置完全相反（合并 vs 重建）。这是 [[gap-reverse-drift-check-buries-true-positives-in-noise]]
   的第三类，两个任务要一起把这三类分清。

**不做**：不自动合并任何滞留分支。合并是落地决定，且可能与在飞工作撞车
（本次的 `milestone/M222/iteration-0` 与 B5-1 都改 `packages/quay/test/cli.test.mjs`）。
本任务只负责**让它可见**。

### 追加：`--clean-stale` 的「0 ahead 即安全」规则在 revert-of-merge 之后不成立

2026-08-02 实证。内层合并 `milestone/M243/iteration-0`（`2c980b53`）后又 revert 了那次 merge
（`7b6e1100`）。此后：

```
git rev-list --count master..milestone/M243/iteration-0   →  0        ← 看起来已合并
git diff master...milestone/M243/iteration-0 --shortstat  →  （空）    ← 三点 diff 用 merge-base
git diff master..milestone/M243/iteration-0  --shortstat  →  91 files changed, 8220 insertions(+)
```

**提交数说已合并，内容说差 8,220 行。** 这是「revert 一个 merge」的标准后果：merge 提交仍在
master 历史里，所以 merge-base 前移，但内容被 revert 撤掉了。重新 `git merge` 会是 no-op。

`milestone-worktree.ts` 的 `--clean-stale` 判据是
`rev-list --count <branch> --not master`（`plugin/scripts/milestone-worktree.ts:184`），源码注释写着
「0 ahead → unambiguously safe to clean」。**对这个分支它现在是错的**——一次 `--clean-stale`
就会删掉承载那 8,220 行的唯一具名引用。

**因此检测器不能只看提交数。** 判「已合并」必须同时满足：提交数为 0 **且**两点 diff 为空。
两者不一致本身就是一个要报的状态（`merged-then-reverted`），因为它意味着有人 revert 了一次 merge，
而那份工作既不在 master 也不再被任何常规检查看见。

## Acceptance Criteria

- [ ] AC1: 检查能列出全部带提交的滞留分支，输出分支名 / 领先提交数 / 插入行数 / 最后提交日期
- [ ] AC2: 零领先**且**两点 diff 为空的分支不出现在告警里
- [ ] AC2b: **提交数为 0 但两点 diff 非空**的分支报为 `merged-then-reverted` —— 用
      `milestone/M243/iteration-0` 的真实状态 pin 住（8,220 行差异，0 提交领先）
- [ ] AC2c: `milestone-worktree.ts --clean-stale` 拒绝清理 `merged-then-reverted` 分支；
      当前它的 `rev-list --count <branch> --not master` 判据会把它当作可安全删除
- [ ] AC3: 在当前仓库实跑，恰好报出 M222 / M239 / M243 / M246 四个 —— 用真实仓库验证，不是 fixture
- [ ] AC4: `restart-readiness-check.sh` 打印滞留分支；**存在滞留不阻断**，但输出中必须出现
- [ ] AC5: `orchestration/orchestrator-loop-tick.md` 步骤 1 的观察命令包含该检查
- [ ] AC6: `task-status-drift-check.ts` 新增 `stranded-not-merged` 类别；一个 `done` 任务的代码若
      存在于某个未合并分支，报这一类而非 `reverse-drift-suspect`
- [ ] AC7: AC6 的真值集用本次的实例 pin 住：DIR-124-A2 与 DIR-124-A5 必须报 `stranded-not-merged`
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] 在真实仓库上的实跑输出贴进任务体（改前只能靠 `git worktree list` 偶然发现，改后是机械输出）
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：本任务**不合并**任何分支，合并决定在 `orchestration/escalations.md` #2

## Touches

- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- plugin/scripts/task-status-drift-check.ts
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs
- orchestration/orchestrator-loop-tick.md
