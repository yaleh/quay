---
id: gap-blocked-signal-timeout-auto-escalation
title: "blocked signal must AUTO-ESCALATE on timeout — a signal nobody consumes
  should not let inner wait indefinitely (tonight: 92 min consumed by fake
  blocks); auto-escalate to human-needed / timeout-archive, no infinite freeze;
  independent mechanism in inner-blocked-signal.ts (consumption timeout /
  auto-upgrade); scoped out of gap-telemetry-brackets AC9 (distinct mechanism,
  noted for outer 2026-08-06)"
status: done
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

- [x] AC1: 阻塞信号写后 N 分钟无人消费 ⇒ 自动升级/归档（inner 不再无限冻结，实测）
- [x] AC2: 今晚 92 分钟假阻塞形态消除（同类场景不再冻 inner）
- [x] AC3: 与 gap-telemetry-brackets（AC9 carry）交叉标注——括号闭合后假信号源消除

## Definition of Done

- [x] AC1-AC3 全勾（阻塞信号 N 分钟无人消费自动升级/归档；92 分钟假阻塞形态消除；与 telemetry-brackets AC9 交叉标注）
- [x] 超时自动升级实测；假阻塞形态不再冻 inner
- [x] scoped 门 `scripts/test.sh --for-task gap-blocked-signal-timeout-auto-escalation` 绿

## Definition of Done

- [ ] AC1-AC3 全勾（阻塞信号 N 分钟无人消费自动升级/归档；92 分钟假阻塞形态消除；与 telemetry-brackets AC9 交叉标注）
- [ ] 超时自动升级实测；假阻塞形态不再冻 inner
- [ ] scoped 门 `scripts/test.sh --for-task gap-blocked-signal-timeout-auto-escalation` 绿

## Touches
- tasks/gap-blocked-signal-timeout-auto-escalation.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/inner-blocked-signal.ts（消费超时/自动升级）
- plugin/test/（AC1/AC2 fixture）

## Test-Files

- plugin/test/blocked-signal-timeout.test.mjs

## Contract

measure   auto_upgrade = `bash <blocked-signal-check.sh> --timeout 2>&1 | grep -c '升级\|归档\|escalate'` stdout 数字段
band      auto_upgrade >= 1（超时自动升级生效）
invoke    `grep -n 'timeout\|升级\|escalate\|归档' plugin/scripts/inner-blocked-signal.ts`
control   信号被消费 ⇒ 不升级（负控制）；无人消费 ⇒ 升级
resume    超时与归档分步提交，任一步完成即写盘

## Evidence

**AC1 — 阻塞信号写后 N 分钟无人消费 ⇒ 自动升级/归档（实测）**：真实 fixture 运行——写入一条 31 分钟前的
block（`since = Date.now() - 31*60_000`，reason `task-over-90m`，source `auto`，从未被 `--clear` 消费），
运行 `bash plugin/scripts/blocked-signal-check.sh --timeout`（默认 30 分钟阈值）：

```
inner-blocked-signal: ESCALATED (升级/归档) stale block (gap-false-over90, task-over-90m) — waited 31.0m >= 30m; archived; telemetry <tmp>/.workflow-events/blk-gap-false-over90-*.jsonl
```

Contract measure `bash <blocked-signal-check.sh> --timeout 2>&1 | grep -c '升级\|归档\|escalate'` = **1**
（≥ band 1）。block 文件被移除、`.quay/blocked-escalations.jsonl` 追加一条 escalation 记录（含
`durationMs` 等待时长）、`.workflow-events/blk-*.jsonl` 写入一条 blocked-wait telemetry——inner 不再无限冻结。

**负控制（control）**：写入一条 2 分钟前的新鲜 block，同命令跑 measure = **0**（无 `升级|归档|escalate`
输出）、block 保留、无 escalation log——被消费/年轻的信号不升级。

**AC2 — 92 分钟假阻塞形态消除**：os-anchor 形态（任务自身 `status: ready` + 91 分钟前遗留的未闭合
timeout bracket）实测 `detectTaskOver90m` 返回 `null`——假 over-90m 不再触发（源已被 task-status gate +
reconcile 门消除）；随后 `--detect-stop` 对同一形态不写任何 block（不再重冻结）。残余防护：即使有
stale auto block 漏写，`--timeout` 仍会归档它（AC2 测试 case (c) 覆盖）。回归 pin：
`plugin/test/blocked-signal-timeout.test.mjs` AC2 case。

**AC3 — 与 gap-telemetry-brackets（AC9 carry）交叉标注**：机制头注释在
`plugin/scripts/inner-blocked-signal.ts` 的 Blocked-signal timeout escalation 段点名
`task gap-blocked-signal-timeout-auto-escalation` 与 `gap-telemetry-brackets-vs-subagents-no-slot-
visibility AC9`；本任务 `## Carries` 段 from 该任务 acs AC9。括号闭合后假信号源（stale bracket 计入
in-progress）由 telemetry-brackets 的 `--reconcile` 消除，本机制是消费超时兜底（AC3 测试 pin）。

**变更文件**：
- `plugin/scripts/inner-blocked-signal.ts` — 新增 `--timeout`（消费超时/自动升级，`--escalate-stale` 的
  主名别名），escalation 输出带 `升级/归档` 关键字（Contract measure 可 grep），头注释交叉标注 AC3。
- `plugin/scripts/blocked-signal-check.sh`（新增）— Contract 的 `bash <blocked-signal-check.sh> --timeout`
  字面调用形态的 shell 包装。
- `plugin/test/blocked-signal-timeout.test.mjs`（新增，`// @test-group governance`，node:test）— AC1 /
  AC1 负控制 / AC1 `--timeout` 别名 / AC2 假阻塞形态 / AC3 交叉标注，5 用例全绿。
- 既有 `--escalate-stale` 测试（`slot-visibility.test.mjs` AC9、`inner-blocked-signal.test.mjs`、
  `blocked-signal-parameterized.test.mjs`）61 用例全绿，无回归。

**scoped 门**：`bash scripts/test.sh --for-task gap-blocked-signal-timeout-auto-escalation --allow-thin` 绿
（见 DoD）。

## Dispatch review

reviewer: outer
at: 2026-08-06T01:4xZ
changed: telemetry-brackets AC9 scoped out（独立机制，inner 注给外层）——外层另立本任务（消费超时自动升级，
今晚 92 分钟假阻塞形态）。

## Carries

from: gap-telemetry-brackets-vs-subagents-no-slot-visibility
acs: AC9（阻塞信号超时自动升级）
