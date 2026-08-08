---
id: gap-blocked-signal-timeout-auto-escalation
title: "blocked signal must AUTO-ESCALATE on timeout — a signal nobody consumes
  should not let inner wait indefinitely (tonight: 92 min consumed by fake
  blocks); auto-escalate to human-needed / timeout-archive, no infinite freeze;
  independent mechanism in inner-blocked-signal.ts (consumption timeout /
  auto-upgrade); scoped out of gap-telemetry-brackets AC9 (distinct mechanism,
  noted for outer 2026-08-06)"
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

**阻塞信号超时自动升级——没人消费的信号不应让 inner 无限期等（今晚 92 分钟假阻塞形态）。**

**【背景】**:今晚多次被假阻塞信号冻住（fake OVER90 / 红窗遗留括号等），inner 等信号被消费 = 无限期冻结
（累计至少 92 分钟）。从 telemetry-brackets 任务 AC9 拆出（独立机制）。

**【范围】**：`inner-blocked-signal.ts` 的**消费超时/自动升级**——一条信号写后 N 分钟内没人消费 ⇒
自动升级为「需要人工介入」或「超时归档」，不无限冻结 inner。

### 选定机制

1. 阻塞信号带消费超时：写后 N 分钟无人读 ⇒ 自动升级/归档
2. inner 不等无限期——超时后继续（或升级需人）
3. 与 reconcile/telemetry 括号闭合协同

## Acceptance Criteria

- [ ] AC1: 阻塞信号写后 N 分钟无人消费 ⇒ 自动升级/归档（inner 不再无限冻结，实测）
- [ ] AC2: 今晚 92 分钟假阻塞形态消除（同类场景不再冻 inner）
- [ ] AC3: 与 gap-telemetry-brackets（AC9 carry）交叉标注——括号闭合后假信号源消除

## Definition of Done

- [ ] AC1-AC3 全勾（阻塞信号 N 分钟无人消费自动升级/归档；92 分钟假阻塞形态消除；与 telemetry-brackets AC9 交叉标注）
- [ ] 超时自动升级实测；假阻塞形态不再冻 inner
- [ ] scoped 门 `scripts/test.sh --for-task gap-blocked-signal-timeout-auto-escalation` 绿

## Touches
- tasks/gap-blocked-signal-timeout-auto-escalation.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/inner-blocked-signal.ts（消费超时/自动升级）
- plugin/test/（AC1/AC2 fixture）

## Contract

measure   auto_upgrade = `bash <blocked-signal-check.sh> --timeout 2>&1 | grep -c '升级\|归档\|escalate'` stdout 数字段
band      auto_upgrade >= 1（超时自动升级生效）
invoke    `grep -n 'timeout\|升级\|escalate\|归档' plugin/scripts/inner-blocked-signal.ts`
control   信号被消费 ⇒ 不升级（负控制）；无人消费 ⇒ 升级
resume    超时与归档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T01:4xZ
changed: telemetry-brackets AC9 scoped out（独立机制，inner 注给外层）——外层另立本任务（消费超时自动升级，
今晚 92 分钟假阻塞形态）。

## Carries

from: gap-telemetry-brackets-vs-subagents-no-slot-visibility
acs: AC9（阻塞信号超时自动升级）
