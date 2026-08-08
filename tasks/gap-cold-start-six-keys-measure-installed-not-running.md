---
id: gap-cold-start-six-keys-measure-installed-not-running
title: "cold-start six keys measure 'installed' not 'running' — 'queue-empty /
  waiting-for-direction / never-started' all pass the six keys (criteria answer
  without evidence, the recurring pattern); can't express 'started before but
  stopped now, please continue'; dead-loop-check.sh (L2 criterion, just landed)
  tests EXACTLY the running state (transcript no new user-msg + git no recent
  commit) but cold-start does NOT call it; fix: cold-start adds an 'installed
  but stopped' branch calling dead-loop-check to distinguish + give an
  EXECUTABLE next step (restart / human-needed / backlog-empty) instead of
  reporting 'complete'; measured 2026-08-06: /quay:cold-start on archguard
  reported 'completed (11:40 cold-start → 8.5h autonomous → #102 stopped at
  completion point), six keys five-true-one-false' then sat idle waiting —
  archguard's real stop was backlog-bottom (needs human direction: capability
  direction/TASK-49 creds/TASK-31-35 release), genuinely human-needed, NOT a
  defect; archguard NOT suitable for AC12b second timing line (no work)"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**cold-start 六键测「装没装好」不是「在不在转」——判据在无依据时仍给答案（今晚反复的形态）。**

**【实测（管理者，AC12b 协议，2026-08-06）】**：对 archguard 输 `/quay:cold-start`（唯一允许动作、零附加
文本、已核实送达）。执行后回报「冷启动已完成（11:40 冷启动→8.5h 自主运转→#102 停止于完成点），六键五真
一假」，然后继续停在原地等人。

**【缺陷】**：六键测的是「装没装好」，不是「**现在在不在转**」。**「队列空 / 等人给方向 / 从未启动」三种
状态在六键下全部为真**——它无法表达「我知道你启动过，但你现在停了，请继续」。这正是今晚反复抓的形态：
**判据在没有依据时仍然给出答案**。

**【修复方向】**：今晚刚落地的 `dead-loop-check.sh`（L2 判据：transcript 无新 user 消息 + git 无最近提交）
测的**恰恰是后者**，但 cold-start **没有调用它**。建议：cold-start 增加「**已装好但已停转**」分支，调用
dead-loop-check 区分并给出**可执行的下一步**（重启 / 需要人 / backlog 空），而不是报「已完成」。

**【archguard 实情（非缺陷）】**：archguard 停转的真实原因是 **backlog 见底**（它明说在等新能力方向 /
TASK-49 凭据 / TASK-31-35 发布）——真需要人。archguard 目前**不适合做 AC12b 第二条计时线**（不是机制
问题，是没活可干）。

### 选定机制

1. cold-start 增加「已装好但已停转」分支：调用 dead-loop-check 判断 running 态
2. 停转时给可执行下一步（区分：重启 / 需要人 / backlog 空），不报「已完成」

## Acceptance Criteria

- [ ] AC1: cold-start 区分「已装好+在转」vs「已装好+已停」（调用 dead-loop-check，实测）
- [ ] AC2: 停转时给可执行下一步（restart / human-needed / backlog-empty），非「已完成」
- [ ] AC3: 「队列空 / 等人 / 从未启动」三态不再全部报「完成」（区分可执行）
- [ ] AC4: 与 gap-l2-continuous-health-dead-loop-criterion 交叉标注（复用 L2 判据）

## Definition of Done

- [ ] AC1-AC4 全勾（cold-start 区分「已装好+在转」vs「已装好+已停」调用 dead-loop-check；停转给可执行下一步；三态不再全报「完成」；与 gap-l2-continuous-health-dead-loop-criterion 交叉标注）
- [ ] 三态区分实测（队列空/等人/从未启动分别给出不同判定）
- [ ] scoped 门 `scripts/test.sh --for-task gap-cold-start-six-keys-measure-installed-not-running` 绿

## Touches

- plugin/skills/cold-start/SKILL.md（加「已停转」分支）
- plugin/scripts/dead-loop-check.sh（cold-start 调用）
- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（AC4 交叉标注）

## Contract

measure   stopped_detected = `bash <cold-start> --check-running 2>&1 | grep -c 'stopped\|dead-loop\|已停'` stdout 数字段
band      stopped_detected >= 1（已停转被识别，非「已完成」）
invoke    `grep -n 'dead-loop\|stopped\|已停' plugin/skills/cold-start/SKILL.md`
control   三态（队列空/等人/从未启动）可区分（AC3）
resume    分支与复用分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T00:5xZ
changed: 管理者 cold-start 语义缺陷立案——六键测装没装好非在不在转；复用 L2 dead-loop 判据加「已停转」
分支 + 可执行下一步。archguard AC12b 第二条线不适合（backlog 见底需人，非缺陷）。
