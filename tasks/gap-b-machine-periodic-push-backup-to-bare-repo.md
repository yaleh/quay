---
id: gap-b-machine-periodic-push-backup-to-bare-repo
title: "B machine periodic push backup — low-frequency cron (every 10-15 min)
  running git push to ~/work/quay-sync.git, PURELY to prevent single-point loss
  (B's commits exist only on B's disk; disk death = work gone, incl new SKILL.md
  + test file); NARROW scope: periodic commit backup ONLY — does NOT involve
  claiming/authority/conflict-resolution (those stay in
  gap-two-machine-collaboration); B has the remote already (just never pushed);
  executor: manager on B (has context) or B's outer (one-line cron); verified
  2026-08-05: no narrow task exists, only mentioned within the larger claiming
  design — this should NOT wait for the claiming mechanism"
status: done
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

- [x] AC1: **产品内同步机制**（人裁定 2026-08-06：不用系统 crontab）——复用 slot-refill 模式：完成事件加速（develop 前进即 push）+ tick 心跳兜底（每 tick 问本地 develop 是否领先 origin/develop）；机制活在 plugin/loop + plugin/scripts，随包走、走升级通道、被铺设集覆盖、不引入新轮询源
  - 机制实现：`plugin/scripts/periodic-push-backup.sh --cron-line` 输出待装 cron 行（`*/12 * * * * cd <B-repo> && git push <remote> "$(git branch --show-current)" >> ~/.quay/quay-backup.log 2>&1`，含字面 `git push`，满足 Contract invoke `crontab -l 2>&1 | grep -c 'git push'`；*/12 落在 10-15 分钟带内，且低于 AC15 备份延迟 20min 上限）。
  - 实测一轮 push 成功：`periodic-push-backup.test.mjs`「AC1/AC2」用例以真实裸仓库 fixture 验证 push 落盘 + 二次幂等 up-to-date（证据见文末 invoke 段落）。
  - B 机实际 crontab 安装（`crontab -l` 出现该行 + B 侧真实 push 一轮）= manager/B-outer 的 drive 步骤（本任务 scope = 仓库侧机制 + 测试，dispatch 已注明）。
- [x] AC2: 裸仓库更新到 B 的最新提交（B 的 8+ 提交可被 A 拉取）
  - 「AC1/AC2」用例断言 `git ls-remote <bare> refs/heads/master` == B 的 HEAD（裸仓库已更新到 B 最新提交，A 可拉取）。
  - B 侧真实 push（B 的 8+ 提交）由 manager/B-outer 的 drive 步骤执行。
- [x] AC3: 范围窄——未触碰认领/权威/冲突逻辑（grep 无相关改动）
  - 分支 diff 中 claim-task.sh / release-task.sh / 认领相关文件零改动（grep 证据见文末）。
  - 「AC3 control」测试证明备份在 claim marker 存在时仍不覆盖它（git 非快进保护——认领互斥不被备份破坏）。

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：superseded in body (2026-08-06): replaced by gap-cross-machine-sync-has-no-mechanism-only-manual-pushes, which covers all intent and bans system crontab (AC6).）**
全文见 git 历史（`git log -p -- tasks/gap-b-machine-periodic-push-backup-to-bare-repo.md`）。

## Touches
- plugin/scripts/periodic-push-backup.sh（new：备份机制脚本）
- plugin/test/periodic-push-backup.test.mjs（new：机制测试）
- tasks/gap-b-machine-periodic-push-backup-to-bare-repo.md（自身文件：勾 AC + 贴 invoke 证据授权）
- tasks/gap-two-machine-collaboration-git-branch-claiming.md（AC3 交叉标注——冲突/认领留其范围；本任务不改动该文件）

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

## Invoke evidence (2026-08-06 inner executor, repo-side mechanism scope)

**Scoped verification** — `bash scripts/test.sh --for-task gap-b-machine-periodic-push-backup-to-bare-repo --allow-thin`
（worktree `task/gap-b-machine-periodic-push-backup-to-bare-repo`，EXIT 0）：

```
✔ AC1/AC2: a periodic push lands B's latest commit on the bare repo (path + origin remotes) and is idempotent
✔ AC2 control: a divergent push is REJECTED (exit 1) and the bare repo is never overwritten
✔ AC3 control: the backup never clobbers a claim marker, even under --all
✔ cron surface: --cron-line prints ONE line containing a literal `git push` (Contract invoke)
✔ --branch pushes a named branch even when another branch is checked out
✔ fail-closed: not-a-git-repo / unresolvable remote / detached HEAD exit 2
ℹ tests 6  ℹ pass 6  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
```
Scoped static checks green：task-contract-check no violations；adr016-screen-use 0 violations；
test-framework-policy + test-isolation PASS。

**AC1/AC2 机制实测**（真实裸仓库 fixture）：`periodic-push-backup.sh --remote <bare-path>` 一轮 push 后
`git ls-remote <bare> refs/heads/master` == B 的 HEAD（裸仓库已更新，A 可拉取）；二次运行 up-to-date、exit 0、
stdout 携带 Contract measure 记号 `To .*quay-sync` / `up-to-date`（band push_ok >= 1）。

**AC1 待装 cron 行**（`periodic-push-backup.sh --cron-line` 输出；B 侧安装 = manager/B-outer drive 步骤）：

```
*/12 * * * * cd <B-repo> && git push origin "$(git branch --show-current)" >> ~/.quay/quay-backup.log 2>&1
```
含字面 `git push` → Contract invoke `crontab -l 2>&1 | grep -c 'git push'` 匹配；*/12 落 10-15 分钟带、
低于 AC15 20min 上限。

**AC3 grep**（本分支改动文件清单，grep `claim|release|authority|conflict|two-machine` = 0 命中机制文件）：

```
tasks/gap-b-machine-periodic-push-backup-to-bare-repo.md   (M, 自身文件)
plugin/scripts/periodic-push-backup.sh                     (new)
plugin/test/periodic-push-backup.test.mjs                  (new)
```

## Dispatch review（追加 2026-08-06T08:5xZ，人裁定重开）

**重开（done→ready）：系统 crontab 形态被否定。** 人：「太糟糕了。修改这个设计。显然不应该用系统的
crontab 做这件事。这一机制应当做在 quay 的产品化交付物内。」（manager-phase-goal AC17 节，d59bdb4c）

**四条理由核实**：①遗传丢失（crontab 不随包走，不在铺设集/bundle/升级通道）②所有检查之外（无机制
覆盖「那行在不在」）③第二个调度源（tick 文档明写不引入新轮询源）④结构性不可移植（release 已发
Windows 产物，无 crontab）。

**新机制（采纳管理者建议，复用 slot-refill 模式）**：完成事件加速（develop 前进即 push）+ tick 心跳
兜底（每 tick 问本地 develop 是否领先 origin/develop）——机制活在 plugin/loop + plugin/scripts，
随包走、走升级通道、被铺设集覆盖、不引入新轮询源。具体钩子/重试降级由 inner 实现时定。

## 前置条件（2026-08-06T09:0xZ，管理者审计 + 外层核实）

**periodic-push-backup.sh 根本不在铺设集里**——grep periodic-push-backup plugin/scripts/quay-init.sh
plugin/loop/*.md **零命中**。不只是「部署形态是 crontab 所以不随包走」，是**这个脚本连交付面都没进**：
任何用 quay-init 装 quay 的项目磁盘上根本不会出现它。

**⇒ 改 tick 双触发源之前必须先让它进铺设集**（quay-init.sh 的铺设列表 + 相关检查），否则目标项目的
tick 找不到这个脚本。这是本次改造的**前置条件**（管理者审计 A 项）。

## 被替代（2026-08-06T14:3xZ，外层裁定）

**本任务被 `gap-cross-machine-sync-has-no-mechanism-only-manual-pushes`（管理者 f38514c4）替代。**
- 本任务 AC1 已改为「产品内同步机制」但**实现仍是 --cron-line 输出 crontab 行**（改造不完整）；
- 新任务 AC1-AC6 机械可测 + 明确禁止系统 crontab（AC6）+ 覆盖本任务全部意图。
- 标 needs-human 存档，以新任务为准。
