---
id: gap-tasksperhour-measures-mean-duration-not-throughput
title: "tasksPerHour is 60/mean — it measures per-task speed, not throughput,
  and it penalizes concurrency"
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

`plugin/scripts/fast-mode-telemetry.ts:338`：

```js
const tasksPerHour = totalMinutes > 0 ? (count * 60) / totalMinutes : 0;
```

`totalMinutes` 是**各任务耗时之和**，不是窗口经过的墙钟。所以

```
tasksPerHour ≡ 60 / 均耗时
```

实测验证：均耗时 45.1 分钟，报出 1.33 = 60/45.1，完全吻合。

**它衡量的是单任务速度，不是吞吐。** 而这个名字、以及所有引用它的地方（exp6 阶段 1 的 AC18、
每日报告、外层每个 tick），要的都是「每墙钟小时完成几个任务」。

### 三个后果

**一、它惩罚并发。** 并发让单任务墙钟变长（CPU 争抢），`totalMinutes` 上升 ⇒ 报出的数**下降**，
而真实吞吐**上升**。exp6 的 AC13（要求并发）与 AC18（用这个数判定）因此互相打架——
2026-08-03 00:22Z 才发现，此前窗口内一直串行所以没暴露。

**二、它和自己的基线不可比。** AC18 的基线「2.1 任务/小时」原文是「6 个任务 / 2.8 小时」，
即 `任务数 / 经过时间`——**真实吞吐**。拿 `60/均耗时` 去比它是两个量。

**三、它不提供新信息。** `meanMinutes` 已经在同一份输出里。`60/meanMinutes` 是它的确定性变换，
占着一个承诺了别的含义的名字。

### 实测差距（2026-08-03 00:25Z）

| 口径 | 全期 | 无人值守窗口 |
|---|---|---|
| **真实吞吐**（任务数/墙钟小时） | 13 / 11.40h = **1.14** | 6 / 6.69h = **0.90** |
| 当前代码 | 1.33 | 1.33 |

窗口内真实值是基线 2.1 的 **43%**，而当前代码报 1.33（63%）——**当前算法系统性高估**。

逐小时收尾分布 `2 1 0 1 0 1 1` 显示第 3、5 小时为零；这种空洞被「均耗时倒数」完全抹平，
因为它根本不看时间轴。

## Chosen mechanism

**把 `tasksPerHour` 改成它名字承诺的量，并保留原量但正名。**

1. `tasksPerHour = count / windowHours`，其中 `windowHours` 是**墙钟**：
   - 有 `--since` → 从它算起
   - 无 `--since` → 从数据中最早的 `startedAtMs` 算起
   - 终点取 `max(最晚 endedAtMs, now)`——活报告用 now，历史窗口用最晚 end
2. **原量正名保留**：`60/均耗时` 若仍有用，命名为 `serialEquivalentPerHour` 并在字段说明里写明
   「若任务串行背靠背执行的等效速率；与并发无关」。若判定它冗余（`meanMinutes` 已在输出里），
   直接删掉，不要留一个含义不明的数。
3. **窗口口径写进输出**：报告里带上 `windowStart` / `windowEnd` / `windowHours`，
   使任何引用这个数的人能看出它是对哪段时间算的。当前输出没有窗口信息，
   这正是这个缺陷能存活到今天的原因。

**不做**：不改任何任务的实际执行方式。这是纯计量修正。

## Acceptance Criteria

- [ ] AC1: `tasksPerHour = count / windowHours`（墙钟），不再等于 `60/均耗时`
- [ ] AC2: `--since` 给定时以它为窗口起点；未给定时以最早 `startedAtMs` 为起点
- [ ] AC3: 输出包含 `windowStart` / `windowEnd` / `windowHours`
- [ ] AC4: 用今日真实数据回归：无人值守窗口（`--since 2026-08-02T17:43:24Z`）应报 **≈0.90**，
      全期应报 **≈1.14**（当前均报 1.33）
- [ ] AC5: 原量或删除、或更名为 `serialEquivalentPerHour` 并注明与并发无关；不得保留歧义命名
- [ ] AC6: 并发场景回归测试：两个各耗时 60 分钟、在同一小时内并行完成的任务，
      `tasksPerHour` 必须约等于 **2**（当前算法会报 1）
- [ ] AC7: 引用该字段的地方同步——`orchestration/exp6-phase1-sustained-unattended-operation.md` 的
      AC18、`docs/analysis/fast-mode-loop-tick.md` 的「每个 tick 必报」、
      `orchestration/orchestrator-loop-tick.md`
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC4 的回归数字与 AC6 的并发用例输出贴进任务体
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：**一个名字承诺 A、实际算 B 的指标，会让所有基于它的判定悄悄失效**——
      本次代价是 exp6 的 AC13 与 AC18 互相打架，且整天的吞吐报告系统性高估

## Touches

- plugin/scripts/fast-mode-telemetry.ts
- experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- orchestration/exp6-phase1-sustained-unattended-operation.md
