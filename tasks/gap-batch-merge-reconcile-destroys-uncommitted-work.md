---
id: gap-batch-merge-reconcile-destroys-uncommitted-work
title: 批量合后的主检出对账步骤由调用方各自发明，inner 用 git reset --hard HEAD 销毁了 manager
  未提交的编辑（真实数据丢失一次，2026-08-08 08:08:24）——integration-batch-merge.sh 是 REF-LEVEL
  （update-ref CAS，主检出从不被脚本触碰），ref 被从底下换掉后主检出 HEAD/index 变陈旧【需要一步对账】，
  但脚本没提供这一步；调用方发明的 --hard 严格强于对账所需（--mixed 默认即刷新 index 不碰工作区， --hard
  额外覆盖工作区=唯一有害那件）；且与 Land 锁无关——锁防交错防不了销毁，共享主检出上
  「拿到锁就能动工作区」不成立；修法方向：对账步骤由脚本自己提供且不得用 --hard，若确需前置断言 git status --porcelain
  为空非空即失败并报出属主（管理者 2026-08-08 实测报告，损失已凭上下文重写 并提交 fa032ec7/49d18602——救回是运气不是机制）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**批量合后的主检出对账步骤由调用方各自发明，inner 用 `git reset --hard HEAD` 销毁了 manager
未提交的编辑——真实数据丢失一次。**

### 事实链（管理者 2026-08-08 实测取证，时刻读钟/原始记录）

- 08:07~08:08：manager 编辑 `orchestration/manager-phase-goal.md`（AC4 判据失效更正 + AC5 自报
  违反），未提交。
- 08:08:15：`7094ba88` 批量合（REF-LEVEL，update-ref CAS）。
- 08:08:24.132：会话 728a4610 = quay-0:inner 执行
  `cd /home/yale/work/quay; echo "=== reconcile primary checkout ==="; git reset --hard HEAD ...`
- 08:10：manager `git commit` → "nothing to commit, working tree clean"。grep 实测两处编辑内容
  0 命中，git fsck 无法恢复（从未 git add ⇒ 根本不在对象库里）。

**损失已由 manager 凭上下文重写并立即提交（fa032ec7 / 49d18602）——这次能救回是运气，不是机制。**

### 根因：不是 inner 手滑，是机制缺一步

`integration-batch-merge.sh` 是 REF-LEVEL 的，头部第 19/36-37 行明写
"the primary checkout is never touched"、291/358 行是 update-ref CAS。
**这个设计是对的**——但必然后果是：ref 被从底下换掉后，主检出的 HEAD/index 变陈旧，
**需要一步对账**。脚本没有提供这一步，于是调用方各自发明，inner 发明的是 `--hard`。

⇒ **脚本把一个必需的后续步骤留给了调用方，而该步骤的错误版本会静默毁数据。**

### `--hard` 严格强于「对账」所需

要修的是 index/HEAD 与新 ref 不一致；`git reset --mixed HEAD`（默认，无 --hard）即可刷新
index 而**不碰工作区文件**。`--hard` 额外做的那件事——覆盖工作区——正是唯一有害的那件，
且对账并不需要它。

### 与两线模型的 Land 锁的关系（这条更要紧）

CLAUDE.md 记的 Land 锁串行化的是【共享检出的变更次序】。
**锁防的是交错，防不了销毁**：inner 拿不拿锁，`--hard` 都会把共存会话的未提交内容抹掉。
⇒ 共享主检出上，"我拿到锁了所以可以随便动工作区"是不成立的前提。

### 修法方向（设计归外层+内层，管理者已给判据形态）

批量合后的对账步骤应当由脚本自己提供且不得使用 `--hard`；
若确需 `--hard`，前置断言 `git status --porcelain` 为空，非空即失败退出并报出属主。

## Contract

```
measure reconcile_hard_reset = `grep -cE "git reset --hard" <批量合调用日志/脚本>` stdout 数字段
band reconcile_hard_reset = 0（修复后批量合对账不用 --hard；当前=1：inner 08:08:24）
invoke `git reset --mixed HEAD`（对账正确形态，只刷新 index 不碰工作区）
control 负控制：--mixed 对账不丢工作区未提交内容；--hard 丢（已实测）；确需 --hard 时前置 git status --porcelain 为空断言
resume 若中断，先跑 measure 确认当前对账步骤是否含 --hard，不要假设已修
```

## Acceptance Criteria

- [x] AC1: **对账步骤由脚本提供**——`integration-batch-merge.sh` 新增 `--reconcile`（`reconcile_guard()` +
      `reconcile_index()`，REF-LEVEL 批量合后主检出 HEAD/index 对账），调用方不再各自发明。
      实跑：`integration-batch-merge.sh --root <repo> --reconcile` 在干净主检出上 guard 通过 → FF →
      `git reset --mixed <新 tip>`，index 刷新（`git diff --cached` 空）；测试
      `plugin/test/integration-batch-merge.test.mjs` 3 条新用例（clean / fail-closed / non-develop
      checkout no-op）全绿。
- [x] AC2: **不用 --hard**——对账用 `git reset --mixed <新 tip>`（只刷新 index 不碰工作区）；工作区
      未提交内容保留。实跑负控制对照：`--mixed` 后未提交编辑仍在（grep 命中 1），`--hard` 后丢失
      （命中 0）；测试断言 --reconcile 输出/stderr 绝不含 `reset --hard`。
- [x] AC3: **确需 --hard 的前置断言**——`reconcile_guard()` 在 ref 移动前断言
      `git status --porcelain` 为空，非空即失败退出（exit 1）、报出 porcelain 属主、不移动任何 ref。
      实跑：未提交 manager 编辑（`orchestration/manager-phase-goal.md`）→ FAIL-CLOSED，develop 未动、
      编辑保留、porcelain 属主上报。
- [x] AC4: **Land 锁边界**——`plugin/loop/orchestrator-loop-tick.md` 步骤 3b + `plugin/loop/
      fast-mode-loop-tick.md` 合并机制两处文档明确「锁防交错不防销毁——拿到锁≠能动工作区；共享主检出
      对账不得覆盖共存会话的未提交内容」。
- [x] AC5: 与 gap-batch-merge-gate-reads-stale-green / gap-batch-merge-gate-validates-tip-not-merge-result
      交叉标注（批量合家族：闸门/对象/对账）——已在两任务体加「交叉标注（gap-batch-merge-reconcile-…）」
      节。

## Definition of Done

- [x] AC1-AC5 实跑输出贴任务体（--mixed 对账保留未提交 + 前置断言非空拦截对照）——见各 AC 实跑注；
      另见测试 `plugin/test/integration-batch-merge.test.mjs`（11 用例全绿，含 3 条 --reconcile 新用例）。

## Touches
- plugin/scripts/integration-batch-merge.sh（提供对账步骤 / 后置命令）
- plugin/loop/orchestrator-loop-tick.md（批量合后的对账步骤：指向脚本提供，不用 --hard）
- plugin/loop/fast-mode-loop-tick.md（同步）
- tasks/gap-batch-merge-gate-reads-stale-green.md（AC5 交叉标注）
- tasks/gap-batch-merge-gate-validates-tip-not-merge-result.md（AC5 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T08:2xZ
changed: 管理者 2026-08-08 实测报告（inner 08:08:24 reset --hard 销毁未提交编辑，数据丢失一次；
  根因=脚本 REF-LEVEL 缺对账步骤 + 调用方发明 --hard；--mixed 足够；Land 锁防交错不防销毁；
  损失已重写提交 fa032ec7/49d18602）。外层独立复核：脚本头部 REF-LEVEL 自述（19/36-37 行、
  update-ref CAS）、inner transcript 08:08:24 reset --hard 命令、manager 重提交 49d18602——成立。
