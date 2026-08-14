---
id: gap-fan-in-suite-data-not-accounted
title: fan-in 的 suite 数据不入账——fan-in 不在 verification-round 记账路径（0 命中），per-task 载体覆盖率 1/24；人 14:5xZ 令「先保障数据入账」
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（fan-in 的 suite 数据不入账——人 2026-08-14 14:5xZ 逐字令：「那最近的 fan-in-execute 是如何跑 suite 测试的？先保障这些测试的数据入账」；manager 诊断完成）**。

**三个缺口（manager 全部按位置查证）**：

**① fan-in 的 suite【结构上】不在 verification-round 记账路径上**：
```
verification-round.jsonl 唯一写入者 = full-suite-runner.ts（经 suite-state-trigger.ts:1235 派生）
scripts/test.sh 里 2 处 verification-round 命中全是注释、零写入
fan-in-execute.js 里 suite-state-trigger/full-suite-runner 命中 = 0/0
fan-in 的三处 suite 调用全是裸 bash scripts/test.sh
⇒ 不是载体坏了，是 fan-in 从来就不在那条路上
载体日期分布实测：08-12 87 轮 · 08-13 77 轮 · 08-14【0 轮】
```

**② ac63 落地的新载体（per-task-suite-records.jsonl）覆盖率 1/24**：
```
per-task-suite-records.jsonl = 1 行（gap-ac63，laneCount=1，1805ms）
今天 inner 的 fan-in workflow run 数 = 24
今天翻 done 的任务 = 42
```

**③ 那唯一 1 行正好解释「为什么 fan-in 时 CPU 负载都很低」**：
```
taskId=gap-ac63  laneCount=1  durationMs=1805  state=green  docChecked=True
对照 08-13 全量 suite：wall 346-444 秒 ⇒ 1.8 秒 = 只跑了 doc 检查
印证 fan-in-execute.js:70-71 判定规则：code_delta 为空 ⇒ 跳过全量 suite（只跑 doc 检查）
⇒ CPU 低不是缺陷，是设计按判定跳过了全量——但此前没有任何读数能证明
```

**判据1（先做，人令优先）**：**每次 fan-in 都要写一条 per-task-suite-record**——今天 24 次写了 1 条。⊢ 判据（能取假）：**今日 fan-in run 数 == per-task-suite-records 当日行数**（现真值 24 vs 1 ⇒ 假）。**⛔ 不得只在「跑了全量」时写——跳过全量【也要写】**，否则「为什么 CPU 低」永远只能靠推断（正是今天处境）。
**判据2（区分度，几乎零成本）**：记录能分辨【跑了全量】与【只跑 doc】——现靠 laneCount=1/durationMs=1805 反推。⊢ 加 `fullSuiteRan: true|false` + `skipReason`（step 2 的 code_delta 判定结果）——**让「跳过」成为被记录的决定**，不是靠时长反推的事实。
**判据3（字段深度，人 08-13 15:57 排第 1 的「相边界差分」在 per-task 载体上没落）**：补 cpu_time_s / 分相 ms / load——`cpu_usec + PSI` trap 写入。**没有它分不开「main 欠并行」与「serial 尾巴长」**（08-13 推算：σ_其余 0.37-0.51 低于 1 物理不可能 ⇒ 口径问题，需分相 cpu_usec）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**优先级**：① > ② > ③。没有 ③ 还能上界推算；**没有 ① 连原料都没有**。② 立刻消除「CPU 低是跳过还是跑慢」误判。

**⚠️ 必须与 AC83 一起完成（manager 14:5xZ 报）**：`gap-phase-boundary-differential-accounting`（相边界差分 cpu_usec+PSI）status=done 但**真实数据 0**——5 AC 被 scoped 测试满足（注入假 cgroup 数据，`QUAY_TEST_CGROUP_SCRIPT` 于 full-suite-runner.ts:795），**证明的是「能产出」不是「已产出」**。且仪器在 full-suite-runner.ts 而 fan-in 走裸 bash scripts/test.sh（0 命中）⇒ **即使 runner 再跑 fan-in 仍拿不到**。**⊢ 本任务与 AC83 必须一起完成——单独完成任一条，人要的「拿到真实数据」都不满足。**

**判据5（交叉，AC83 判据3）**：与 `gap-phase-boundary-differential-accounting` 一起完成——fan-in 的 suite 数据入账 + 相边界差分生产数据落地，两者互为前置。

**一般形态（manager 建议吃进核，与 C29 同族更精确）**：
```
C29  执行了、报了、但没留痕        ⇒ 与【没执行】同形
本条 实现了、测试绿了、但生产没跑过 ⇒ 与【没实现】同形
共同修法：把判据挪到产物上——前者 REFUSE 也写载体行；后者 AC 读生产载体的行数
```
**⊢ 前向生效**（manager 建议不立刻回查 42 条 done，成本高且多数非仪器类）：**只对【以产出读数为目标】的任务加「载体中满足 X 的记录数 ≥ N，N 在实现落地后时间窗计」的 AC**；⛔ 不设回查范围/阈值（成本结构未知，归人裁）。

**不覆盖**：不改 fan-in 的 suite 判定逻辑（跳过全量是设计，:70-71）；不新建第三个载体（沿用 per-task-suite-records）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js 的三处 suite 调用 + per-task-suite-record.ts 写点 + verification-round 派生链。
2. 判据1：每次 fan-in 写一条（含跳过）——⊢ 今日 run 数==当日行数。
3. 判据2：加 fullSuiteRan + skipReason 字段。
4. 判据3：补 cpu_time_s/分相 ms/load（相边界差分）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：每次 fan-in 写一条 per-task-suite-record（含跳过全量）——今日 run 数==当日行数。
- [ ] AC2 判据2：fullSuiteRan + skipReason 字段（跳过=被记录的决定）。
- [ ] AC3 判据3：cpu_time_s/分相 ms/load 字段（相边界差分）。
- [ ] AC4 判据4：与 AC83 交叉——fan-in 入账 + 相边界差分生产数据一起完成。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in 每次 suite（含跳过）入账 per-task-suite-records（run 数==行数）+ fullSuiteRan/skipReason + 分相字段 + 与 AC83 一起完成（真实数据落地非仅测试绿）。

## Touches

- .claude/workflows/fan-in-execute.js（每次 suite 调用后写 per-task-suite-record，含跳过）
- plugin/scripts/per-task-suite-record.ts（补 fullSuiteRan/skipReason/cpu_time_s/分相字段）
- plugin/test/per-task-suite-record-check.test.mjs（补测）
- tasks/gap-fan-in-suite-data-not-accounted.md（自身）

## Evidence

（落地后回填）
