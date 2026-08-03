---
id: gap-tasksperhour-counts-halted-time-as-slow-work
title: tasksPerHour puts halted wall-clock in its denominator, so a pause reads as
  degraded throughput — and rewards picking light tasks
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`tasksPerHour` 现在的定义是 **收尾任务数 / 墙钟窗口小时**
（`plugin/scripts/fast-mode-telemetry.ts:394-410`：`windowStart` = `--since` 或最早 `startedAtMs`，
`windowEnd` = `max(最晚 endedAtMs, now)`）。这个口径是 2026-08-03 00:22Z 修对的——
旧的 `60/均耗时` 测的是单任务速度，并发会**压低**它，方向与 AC13 相反。**那次修正是对的，本任务不推翻它。**

**但它把停机时间算进了分母。** 停机期间分子冻结（没有任务收尾）、分母随墙钟增长，
于是**一个刻意的暂停在读数上与「干得慢」不可区分**。

### 实测（外层 2026-08-03，同一批 37 个收尾任务，期间零工作发生）

| 时刻 | windowHours | tasksPerHour |
|---|---|---|
| 10:10:54Z | 23.6856 | **1.5621** |
| 10:32:10Z | 24.0402 | **1.5391** |

**21 分 16 秒的纯停机，读数掉了 0.0230**，而这段时间里没有一个任务开工、没有一个任务收尾——
`inProgress: []`、`orphaned: []`、工作树干净。

**并且它有一个可以算出来的到期时刻**：分子固定 37，`37 / 1.5 = 24.667h`
⇒ 窗口一旦跨过 24.667 小时，AC18 的 `≥1.5` 就不再成立，**原因与工作质量无关**。
按 10:32:10Z 的 24.040h 推算，那是**约 37 分钟后**。
今晚的停机（2026-08-03T09:33Z 落 `.halt` → 10:32Z 解除，约 1 小时）已经吃掉了其中一大半。

### 这不只是「数字不好看」——它制造了一个反向激励

AC18 是外层每个 tick 必报的项。**一个会因为停机而下跌的吞吐数，会诱导两件坏事**：

1. **不敢停机**——而停机正是本仓用来做跨项目资源仲裁的唯一开关（tick 文档 §0d）
2. **挑轻任务把数拉回来**——分子是「收尾任务数」，不区分大小；
   管理者 2026-08-03 明确点名了这一条：**修的是仪器，不是去挑任务**

**这与那次修正是同一个错误的另一半**：上次是「仪器惩罚了 AC13 要求的并发」，
这次是「仪器惩罚了 §0d 要求的暂停」。两次都是**仪器给出的激励与机制要求的行为相反**。

### 停机区间是可机械恢复的——但只在提交纪律成立时

`.halt` **是被 git 跟踪的文件**（`git ls-files .halt` 有输出），所以它的落下与解除会进 git 历史：

```
git log --format='%h %ad %s' --date=iso-strict -- .halt
  46d662f6 2026-08-03T09:55:08Z cold-start: halt quay, launch archguard's two layers...
```

**但这条路有一个实测到的精度问题**：这次 `.halt` 的**文件内容自述落于 09:33:12Z**，
而**提交时刻是 09:55:08Z**，差 **22 分钟**；解除（删除）在 10:32Z 发生时**尚未提交**。
⇒ 按 git 历史取停机区间会系统性偏短，且解除时刻可能完全缺失。
**先判这个数据源够不够，不够就换一个**（例如落 `.halt` 与解除时各追加一条到只追加日志）——
不要默认 git 历史就是权威。

## Contract

```
measure tph_raw = `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json` 输出的 tasksPerHour 字段
measure halted_hours = `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json` 输出中新增的 haltedHours 字段
band halted_hours >= 0
invariant 零停机窗口下新旧口径必须逐位相等；分子始终是收尾任务数，不按任务大小加权
invoke `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json`
control 无停机记录的窗口 ⇒ 读数不变；人造一段停机 ⇒ 读数升高且升幅等于扣掉的小时数所对应的值
resume 先落停机区间的数据源，再改口径；两步各自可独立验证
```

## Chosen mechanism

**从分母里扣掉停机区间**，分子一个字不改。

1. **先确定停机区间的权威数据源**，并写明为什么选它。候选两个：
   `.halt` 的 git 历史（**已实测有 22 分钟偏差且解除时刻可能未提交**），
   或落 `.halt`/解除时各追加一行到只追加日志。**选后者要说明谁来写这一行、漏写时怎么表现**
   （漏写 ⇒ 退化成现在的行为，即偏保守，不得反向变成高估）。
2. **`computeReport` 增加 `haltedHours`，`windowHours` 改为 `elapsed - haltedHours`**，
   两个数都出现在报告里——**不要只暴露修正后的值**，否则下次没人能核对扣了多少。
3. **`orchestration/exp6-phase1-sustained-unattended-operation.md` 的 AC18 补一句口径**：
   `tasksPerHour` 的窗口不含停机时间，并写明这次的证据。

**不做**：不改分子；不按任务大小加权（那正是要防的挑轻任务）；不引入新的吞吐指标
（本仓已经有一次「同一个名字两种含义」的教训，`serialEquivalentPerHour` 就是那次留下的）；
不自动检测「机器闲着」当停机——**只认显式的停机记录**，否则「内层在等 subagent」也会被扣掉，
那是真实的工作时间。

## Acceptance Criteria

- [ ] AC1: 停机区间的数据源已选定并写明理由，含漏记时的退化方向（必须偏保守）
- [ ] AC2: 报告同时暴露 `windowHours`（已扣）与 `haltedHours`，扣减量可被独立核对
- [ ] AC3: **负控制一——零停机不变性**：一段没有任何停机记录的窗口，
      修改前后 `tasksPerHour` **逐位相等**（实跑输出贴任务体）
- [ ] AC4: **负控制二——人造停机**：注入一段已知长度的停机记录 ⇒ 读数升高，
      且升幅等于 `count/(elapsed-halted)` 的手算值（两个数都贴出来）
- [ ] AC5: 用**今晚这段真实停机**（2026-08-03 09:33Z→10:32Z）回算一次：
      给出扣除前后的 `tasksPerHour`，以及扣除后 AC18 的到期时刻如何变化
- [ ] AC6: 分子未被改动——加一条测试断言「两个耗时相差 10 倍的任务对读数的贡献相同」
- [ ] AC7: AC18 的口径补进 `orchestration/exp6-phase1-sustained-unattended-operation.md`
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC3 与 AC4 的实跑输出贴进任务体——**一个改分母的修改如果没有零停机不变性证明，
      就无法与「把数字调好看」区分开**
- [ ] 完整套件连跑 2 次全绿
- [ ] 任务体记录一句：本任务由**管理者在读到停机导致的衰减后主动要求**建立，
      而不是为了让读数好看——这句话是它将来被质疑时唯一的答复

## Touches

- plugin/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- orchestration/exp6-phase1-sustained-unattended-operation.md

## Dispatch review

reviewer: outer
at: 2026-08-03T10:36:00Z
changed: 按管理者 2026-08-03 的交代建立，证据用外层本次实测（同一批 37 个收尾任务在 21 分 16 秒
纯停机中读数从 1.5621 掉到 1.5391；分子固定 37 ⇒ 37/1.5 把窗口上限锁在 24.67h）。
**建任务时就把「挑轻任务」这条路堵死**：AC6 断言分子不按任务大小加权——管理者点名担心的正是这个，
而一个改吞吐口径的任务最容易顺手把它一起改了。**并预先记下一个实测到的数据源缺陷**：
`.halt` 虽被 git 跟踪，但这次文件自述 09:33:12Z 而提交 09:55:08Z（差 22 分钟）、
解除时尚未提交 ⇒ 按 git 历史取区间会偏短且可能缺解除时刻，因此 AC1 要求先判数据源再改口径。
优先级：**排在 `gap-loop-mechanism-lives-outside-the-package-and-cannot-ship` 之后**（人已定产品化优先）。
