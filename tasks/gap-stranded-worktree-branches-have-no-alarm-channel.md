---
id: gap-stranded-worktree-branches-have-no-alarm-channel
title: Land fails closed and preserves the branch — but nothing ever tells
  anyone, so 25k lines sat stranded for a day
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

### 实跑输出（DoD 1 —— 机械输出，2026-08-03）

改后 `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --stranded` 在真实仓库：

```
stranded-branch-check: 3 STRANDED branch(es) — work is preserved on a branch NOT on master (a silent fail-closed: nothing reports these until this check runs)
  stranded: milestone/M239/iteration-0 (has-commits, 2 commit(s) ahead, +6901 lines, last commit 2026-08-01T14:28:13Z)
  stranded: task/gap-stranded-worktree-branches-have-no-alarm-channel (has-uncommitted, worktree holds uncommitted work, ...)
  stranded: task/gap-web-cannot-show-what-the-loop-is-doing-now (has-uncommitted, worktree holds uncommitted work, ...)
  → human review: merge or adjudicate the branch; do NOT --clean-stale it
```

- M239 是人裁定保留的已知例外（领先 2），**正是告警通道要持续报出直到合并/裁定**的对象。
- 两个 `has-uncommitted` 是真实在飞 worktree（本实现任务的 + 另一个任务的）——「worktree 里的活」第一次
  有了机械可见性。

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

**因此检测器不能只看提交数。** 判「已合并」必须同时满足：提交数为 0 **且**分支内容仍在 master 上。

**判据修正（2026-08-03，`gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion`）：** 上面
「两点 diff 为空」的提法不够准——两点 tree diff `git diff master..<branch>` 测的是「master 有没有前进」，
不是「分支是否已合并」。一个几天前合并的分支，master 之后前进几百个提交，两点 diff 必然非空，
于是 21 个**已合并**分支全部被误报成 `merged-then-reverted`，1.1G 永久留存。正确的测法是：

1. 分支的提交是否都在 master 里：`git merge-base --is-ancestor <branch> master`（直接回答，与 master 前进无关）
2. 分支引入的内容是否被 revert 撤掉：**分支创建的文件在 master 上是否仍存在**——
   `git diff --name-only --diff-filter=A master..<branch>`（两点）非空 = 分支内容被 revert 撤掉。
   M243 的信号正是 `workflow-replay.ts` 从 master 消失（`88e17bf2` revert 后 83 个文件缺失；
   `3dfba2c6` 恢复后为 0）。两点/三点 diff 都做不到这个区分。
3. worktree 里有没有未提交的活：该 worktree 内 `git status --porcelain`（见「追加二」）。

三条都为「安全」才可回收。

### 追加二：`--clean-stale` 会 `--force` 删掉未提交的工作（2026-08-02 实测，有活实例）

内层会话被 `/clear` 时暴露的。当时 `/tmp/quay-wt-costmodel`（在册 worktree，分支
`task/gap-suite-cost-model-…`）的状态是：

```
领先 master ......... 0
两点 diff ........... 空
git status --porcelain 3 条：measurements/、plugin/scripts/measure-suite.mjs（95 行）、
                              plugin/scripts/measure-suite-reporter.mjs（34 行）
```

`cleanStale` 的判据是「0 领先 **且** 两点 diff 为空 → 已证明无工作丢失」，**这两个条件都只看已提交
的内容**。工作树里 129 行未提交的交付物不在证明范围内。而它的删除动作是：

```js
const rm = _gitOk(workspace, ["worktree", "remove", rel, "--force"]);   // ← --force
```

**git 本身是保护这一点的**——实测（一次性 worktree，非在飞那个）：

```
$ git worktree remove /tmp/wt-probe-XXXX
fatal: '/tmp/wt-probe-XXXX' contains modified or untracked files, use --force to delete it
```

**代码显式绕过了这层保护。** 而且文件头注释（`milestone-worktree.ts:144-145`）写的正好相反：
「`--force` is deliberately NOT used on the worktree remove beyond what is needed」。
**注释与代码在一条安全属性上互相矛盾**，本仓库同族文件的既定原则是「THE CODE WINS」——
那么胜出的这一方会毁掉未提交的工作。

无任何测试 pin 住这一点（`grep force|dirty|untracked` 在 worktree 测试里零命中）。

**修法**：`cleanStale` 在删除前必须检查 `git status --porcelain`（在**该 worktree 内**，不是主
检出）。非空 → 返回新的 `has-uncommitted` 而不是 `cleaned`；删除时去掉 `--force`，让 git 的既有
保护成为最后一道闸。「0 领先」只证明没有已提交的工作，**不证明没有工作**。

## Acceptance Criteria

> 2026-08-03 外层重划：本任务的前提已被 retire 与 reclaim 抹掉大半——AC2b 的判据已由
> `gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion` AC1 实现（且更精确），AC2c-f 的目标文件
> `plugin/scripts/milestone-worktree.ts` 已被 retire（ADR-022）物理删除，AC3 期望实报的 M222/M243/M246
> 已回收。**仍然成立的缺口是**：滞留分支没有告警通道。以下按重划后的范围勾选。

- [x] AC1: 检查能列出全部带提交的滞留分支，输出分支名 / 领先提交数 / 插入行数 / 最后提交日期。
      宿主：`task-status-drift-check.ts --stranded`（枚举 `milestone/*` 与 `task/*` 分支）
- [x] AC2: 零领先 **且** 干净合并（`merged-clean`）的分支不出现在告警里
- [x] AC2b: `merged-then-reverted` 判据 —— **已被 reclaim AC1 吸收**（更精确：只有 --no-ff 合并进 master 的
      分支可 revert；merge-added 文件是否仍在 master 当前树）。本任务**复用**其三闸判据，不重写
- [x] AC2c: `--clean-stale` 拒绝清理 `merged-then-reverted` —— **已被 reclaim AC3 实现**；目标文件
      `milestone-worktree.ts` 已被 retire 物理删除（无对象）
- [x] AC2d: `cleanStale` 删除前检查 worktree 内 `git status --porcelain` —— **已被 reclaim AC3 实现**；
      目标文件已删除（无对象）
- [x] AC2e: `worktree remove` 去掉 `--force` —— **已被 reclaim AC4 实现**；目标文件已删除（无对象）
- [x] AC2f: 文件头注释与代码对齐 —— **已被 reclaim AC4/AC5 实现**；目标文件已删除（无对象）
- [x] AC3: 实报 M222 / M239 / M243 / M246 四分支 —— **过时**（外层 2026-08-03 裁定）：前三已回收、分支已删除，
      当前只剩 `milestone/M239/iteration-0`（人裁定保留的已知例外，领先 2，must 继续被报）。期望值改为
      双向负控制，见 AC3b
- [x] AC3b（重划后）: **双向负控制**——人造一个领先 master 的分支 → 必须被报（has-commits）；删掉 → 必须不报。
      测试用合成 git 仓库 pin 住，**不用真实仓库当前状态当期望值**
- [x] AC4: `restart-readiness-check.sh` 打印滞留分支；**存在滞留不阻断**（informational，`[info]` 不 tripping
      hard-fail），但输出中必须出现
- [x] AC5: `orchestration/orchestrator-loop-tick.md` 步骤 1 的观察命令包含该检查（`--stranded`）
- [x] AC6: `task-status-drift-check.ts` 新增 `stranded-not-merged` 类别；一个 `done` 任务的 code-root Touches
      文件出现在某个未合并分支的 **divergent diff**（`git diff --name-only master...<branch>`）时，报这一类
      而非 `reverse-drift-suspect`（处置相反：合并 vs 重建）
- [x] AC7: AC6 真值集用合成实例 pin 住（`fixture-stranded` 的 `code/impl.ts` 只在 `milestone/M243/iteration-0` →
      报 stranded-not-merged；合并后 → 不报）。真实仓库当前 M239 上：正确重分类
      `gap-prepare-milestone-noisy-agent-raw-json-parse`（prepare-milestone.js 只存在于 M239），**不**误分类
      DIR-073 / reclaim（其 Touches 文件不在 M239 divergent diff 内）
- [x] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [x] 在真实仓库上的实跑输出贴进任务体（改后是机械输出 `task-status-drift-check.ts --stranded`，见本任务
      Proposal 下的「实跑输出」；改前只能靠 `git worktree list` 偶然发现）
- [x] `scripts/test.sh` 绿（`--for-task gap-stranded-worktree-branches-have-no-alarm-channel` 全绿，34 项）
- [x] 明确记录：本任务**不合并**任何分支，合并决定在 `orchestration/escalations.md` #2

## Touches

- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- plugin/scripts/task-status-drift-check.ts
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs
- plugin/test/restart-readiness-check.test.mjs
- orchestration/orchestrator-loop-tick.md
- tasks/gap-stranded-worktree-branches-have-no-alarm-channel.md (本任务体，AC/DoD 按重划重写)
