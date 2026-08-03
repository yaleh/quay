---
id: gap-tasksperhour-counts-halted-time-as-slow-work
title: tasksPerHour puts halted wall-clock in its denominator, so a pause reads as
  degraded throughput — and rewards picking light tasks
status: done
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

- [x] AC1: 停机区间的数据源已选定并写明理由，含漏记时的退化方向（必须偏保守）
- [x] AC2: 报告同时暴露 `windowHours`（已扣）与 `haltedHours`，扣减量可被独立核对
- [x] AC3: **负控制一——零停机不变性**：一段没有任何停机记录的窗口，
      修改前后 `tasksPerHour` **逐位相等**（实跑输出贴任务体）
- [x] AC4: **负控制二——人造停机**：注入一段已知长度的停机记录 ⇒ 读数升高，
      且升幅等于 `count/(elapsed-halted)` 的手算值（两个数都贴出来）
- [x] AC5: 用**今晚这段真实停机**（2026-08-03 09:33Z→10:32Z）回算一次：
      给出扣除前后的 `tasksPerHour`，以及扣除后 AC18 的到期时刻如何变化
- [x] AC6: 分子未被改动——加一条测试断言「两个耗时相差 10 倍的任务对读数的贡献相同」
- [x] AC7: AC18 的口径补进 `orchestration/exp6-phase1-sustained-unattended-operation.md`
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC3 与 AC4 的实跑输出贴进任务体——**一个改分母的修改如果没有零停机不变性证明，
      就无法与「把数字调好看」区分开**
- [~] 完整套件连跑 2 次全绿——**如实标注：仅 1 次全量绿**（协调方 batch3-fanin2，2085 tests / 2065 pass /
      0 fail / 0 cancelled，`/tmp/batch3-fanin-fullsuite2.log`，2026-08-03 13:25Z，已含本任务合并代码）。
      **非连跑 2 次**：本任务 worktree 内按纪律未自启全量；第二次全量待外层 session-liveness 改名落定后
      补跑（工作树当前处改名半成品态，补跑会测到断裂引用）
- [x] 任务体记录一句：本任务由**管理者在读到停机导致的衰减后主动要求**建立，
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

reviewer: inner
at: 2026-08-03T12:00:00Z
changed: 闸口结果——task-contract-check **0 新增**（violations 5 / ceiling 5 / new since baseline 0）；
checkTouchesPair（规范化 expand）与 gap-tmp-leak-*、gap-nothing-checks-monitor **两两 DISJOINT**，
可同批派发。

## 执行记录（2026-08-03，外层 fast-mode）

本任务由**管理者在读到停机导致的衰减后主动要求**建立，不是为了让读数好看——这是它将来被质疑时唯一的答复。

### 数据源判定（AC1）

实测 `.halt` 的 git 历史**不是权威数据源**：

| 时刻 | git 历史 | 事实 | 偏差 |
|---|---|---|---|
| 落 `.halt` | 提交 `46d662f6` @ 09:55:08Z | 文件内容自述 `外层 2026-08-03T09:33:12Z` | **+21 分 56 秒** |
| 解除 | 提交 `b505d3aa` @ 10:34:42Z | 任务体记录 10:32Z 解除 | +2 分 42 秒；**测量时尚未提交** |

⇒ 按 git 历史取停机区间会**系统性偏短**（这次约 25 分钟），且解除时刻可能完全缺失。

**选定数据源**：只追加停机日志 `<root>/.workflow-events/halt-events.jsonl`，由落/解除 `.halt` 的同一 actor
在落/解除时刻调 `fast-mode-telemetry --halt-start` / `--halt-end` 写入（`--atMs` 支持精确回填）。
**漏记退化方向（必须偏保守）**：只扣「start 后有 end」的**闭区间**；开区间（停机仍持续或 end 行丢失）与
孤儿 end **不扣任何时间** ⇒ 退化成旧行为（停机照算，读数偏低），**绝不高估**。测试 `AC1 — 开区间/孤儿 end
subtract NOTHING` 固定此语义。

### AC3 实跑——零停机不变性（负控制一）

`fast-mode-telemetry --report --json`（无任何停机记录）：

```json
"tasksPerHour": 1054.172767203514,
"windowHours": 0.0018972222222222222,
"haltedHours": 0,
"halted": []
```

`haltedHours = 0` ⇒ `windowHours = elapsed`，与改动前逐位一致。测试 `AC3 — 零停机窗口 byte-identical`
（`haltEvents: []` / `null` / 缺省三者 `assert.equal` 严格相等）固定此不变性。

### AC4 实跑——人造停机（负控制二）

向同一窗口注入一段 1 小时停机（`--since` 钉窗口起点，`--halt-start/--halt-end --atMs` 精确落点）：

| | windowHours | haltedHours | tasksPerHour |
|---|---|---|---|
| 无停机 | 3.0021 | 0 | **0.6662**（2/3.0021） |
| 注入 1h 停机 | 2.0032（3.0021 − 1） | **1** | **0.9984**（2/2.0032） |

升幅 = `count/(elapsed−halted) − count/elapsed` = 0.9984 − 0.6662 = **0.3322**，正好等于 2/2.0032 − 2/3.0021 的手算值。
测试 `AC4 — 人造 1h 停机 raises tasksPerHour by exactly count/(elapsed−halted)` 固定此数值（2/2=2.0 vs 2/1=1.0）。

### AC5 回算——今晚真实停机（2026-08-03 09:33:12Z→10:32:00Z，0.98h）

同一批 **37 个收尾任务**，窗口起点 = 最早 startedAtMs（复现外层实测的 24.0402h 窗口）：

| | windowHours | tasksPerHour |
|---|---|---|
| 扣除前 | 24.0402 | **1.539089**（外层实测 1.5391） |
| 扣除后 | 23.0602（24.0402 − 0.98） | **1.604496** |

**AC18 的 ≥1.5 到期时刻**：`37/1.5 = 24.667h` 窗口。
- 不扣停机：24.0402h 时还剩 37.59 分钟 ⇒ **11:09:45Z 到期**（≈37 分钟，与任务体推算吻合）。
- 扣除停机：阈值推迟为 `24.667 + 0.98 = 25.647h` 墙钟，10:32:10Z 时还剩 96.39 分钟 ⇒ **12:08:33Z 到期**。
- 差异正好等于停机时长 **0.98h**——停机不再算作「干得慢」。

### AC6 分子未动

测试 `AC6 — 10x duration difference contributes equally`：同一窗口 [0,10h] 下，{1h,10h} 与 {10h,1h}
两组任务的 `tasksPerHour` 严格相等（2/10=0.2），仅 `minutes` 字段体现大小差异。分子恒为收尾任务数。

### AC8 测试分组

- `plugin/test/fast-mode-telemetry-halt.test.mjs` — `// @test-group governance`，`node:test`，12 个测试全绿；
  默认套件（product,engine）下经 in-file 自跳报 `skipped`（ADR-019 先例），`--group governance` 或显式调用时全跑。
- 既有 `plugin/test/fast-mode-telemetry.test.mjs`（`@test-group engine`）补了报告形状断言（`haltedHours`/`halted`
  存在且零停机为 0/[]），30 个测试仍全绿。

**未做**：完整套件连跑 2 次（按纪律留给协调方 fan-in 承担）；`--halt-start/--halt-end` 尚未接入落/解除 `.halt`
的现有流程（本次只建好数据源与口径，接线的调用方由后续任务补——漏写即退化为偏保守，安全）。
