---
id: gap-full-suite-belongs-to-outer-background-above-3-min
title: "full suite (5-8 min magnitude) belongs to the OUTER as background async,
  not blocking inner tasks — measured inner runs it 10x vs outer 3x,
  foreground-blocking (scripts/test.sh > log), the second half of the batch
  boundary (first half = closure bookkeeping); threshold: suite >= 3 min =>
  outer-centralized background; if it drops < 3 min => delegate to inner
  per-task and eliminate 'batch' entirely; red-window ruling: outer's suite RED
  => immediate stop-dispatch signal, inner stops new dispatch + holds fan-in
  until re-green"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人的设计裁定（量化门槛，**不是建议**）：

1. **当前 5-8 分钟量级的全量套件**，应当**集中到 outer、用后台 subagent 跑**，不要堵着 inner 里各个任务；
2. **如果哪天能降到 3 分钟以内**，就可以**下放给 inner 各任务自己跑**——那时「批次」这个概念可以彻底消除。

**实测现状**：全量套件主要是 inner 在跑（**inner 10 次 vs outer 3 次**），而且是**前台阻塞**
（`scripts/test.sh > log` 直接等）——这是**批次边界的另一半来源**（前一半是收尾记账）。耗时实测：
8 lane 下 11-12 分钟；源码注释记载 8 lane 原本 460-570 秒（~8 分钟），并发降到推导值 1 时暴涨到
55 分钟、当天已紧急改回 8。

**⇒ 按人的门槛，现在这个量级明确属于 outer 集中跑。**

**完整形态（三块合起来才消除批次）**：
- **a) 全量套件移到外层后台异步跑**（本条）；
- **b) 收尾记账移到外层异步做**（`gap-closure-sync-is-the-true-batch-boundary-...`，已立案在飞）；
- **c) 任务代理自己勾 AC + 贴 invoke 证据**（`tasks/<id>.md` 加进 Touches，
  `gap-closure-could-not-run-in-task-...`，已立案）。

做完这三块，inner 侧只剩「执行 → 合并」，没有任何批次同步点。

### 选定机制（含外层对红窗风险的裁定）

1. **全量套件移外层后台异步**：外层跑全量套件用后台 subagent / `run_in_background:true`（不阻塞外层
   tick、不堵 inner）；结果写**众所周知的位置**（`.quay/full-suite-state.json` 或 gate-events）：
   `{state: running|green|red, startedAt, finishedAt, durationMs, laneCount}`。**runner 一检测到失败就
   立即标 RED**（不是等全套跑完才标）——缩小「变红到发现」的窗口。
2. **inner 不再自己跑全量套件**：inner 的「上一步全量 suite 非绿」停止条件**改读外层的 suite-state**
   （running/green → 照常；red → 停止），不自己跑。
3. **红窗风险裁定（外层裁定）**：套件从 inner 前台移到外层后台后，master 变红到外层发现之间有窗口，
   期间 inner 可能继续合并。处置：
   - **GREEN 或 RUNNING** → inner **乐观合并/派发**（不等待套件——这正是消除同步点的关键）；
   - **RED** → 外层**立即写 stop-dispatch 信号**；inner **停止新派发 + 暂缓已完成 agent 的 fan-in**
     （不并进红树），直到外层重新 green；
   - **外层独占分诊**：定位红窗内的肇事合并（二分）、回滚/修复、重启套件、重新 green、撤信号。
   - 只停派发不停在飞合并会让红树继续累积，故 RED 时 fan-in 一并暂缓（仅 RED 异常态，非正常批门控）。
4. **阈值决策规则（门槛机械化）**：测全量套件耗时 `suite_duration`：
   - `suite_duration ≥ 3 分钟` ⇒ **outer 集中后台跑**（当前形态）；
   - `suite_duration < 3 分钟` ⇒ **下放 inner 各任务自己跑**（此时批概念彻底消除）。
   规则写进 loop 文档 + 一个测量 hook（跑一次套件即得 durationMs）。

**与 closure-async 的关系**：closure-async 是收尾（b）块，其「全量 suite 为外层收尾 gate」由本条细化
为「外层后台跑 + inner 读状态」；本条是套件（a）块。三块（a+b+c）合起来才消除批次。

## Acceptance Criteria

- [ ] AC1: 外层跑全量套件为**后台异步**（subagent / run_in_background，不阻塞 tick、不堵 inner）；
      结果写 `.quay/full-suite-state.json`（或 gate-events）：`{state: running|green|red, runner:
      outer|inner, startedAt, finishedAt, durationMs, laneCount}`
- [ ] AC2: **runner 一检测到失败即标 RED**（非等全套跑完）——缩小「变红到发现」窗口
- [ ] AC3: inner 不再自己跑全量套件；「上一步全量 suite 非绿」停止条件**改读外层 suite-state**
      （running/green → 照常；red → 停止）
- [ ] AC4: **红窗裁定实现**——GREEN/RUNNING ⇒ inner 乐观合并/派发；RED ⇒ 外层立即写 stop-dispatch
      信号、inner 停止新派发 + 暂缓已完成 agent fan-in；外层独占分诊（二分肇事合并 + 回滚/修复 +
      重启套件 + 重新 green + 撤信号）
- [ ] AC5: **阈值决策规则**——`suite_duration ≥ 3 分钟` ⇒ outer 集中后台；`< 3 分钟` ⇒ 下放 inner
      各任务自跑（批概念彻底消除）；规则 + 测量 hook 在 loop 文档
- [ ] AC6: **真实使用**——(i) 至少一次外层后台套件运行期间 inner 持续派发/合并（不阻塞，证据）；(ii)
      至少一次 RED 路径：外层信号 → inner 停止 + fan-in 暂缓（证据）
- [ ] AC7: 三块消除批次（a+b+c）在 loop 文档交叉标注；本条是 (a) 套件块
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC8 全部勾上；AC6 实跑证据贴任务体
- [ ] **inner 零全量套件运行**（grep 证明 inner 侧无 scripts/test.sh 全量调用；只读 suite-state）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——由外层后台跑出的绿

## Touches

- plugin/loop/orchestrator-loop-tick.md（外层后台套件 + suite-state + RED 信号 + 分诊）
- plugin/loop/fast-mode-loop-tick.md（inner 删全量套件自跑；停止条件改读 suite-state；阈值规则）
- plugin/scripts/full-suite-runner.ts（new：后台跑 + state 写入 + 早期 RED 信号）或等价
- plugin/test/（AC4/AC5 fixture 单测）
- tasks/gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async.md（交叉标注：
  本条是 (a) 套件块，closure-async 是 (b) 收尾块）

## Contract

measure   last_suite_runner = `cat .quay/full-suite-state.json` stdout 的 runner 字段
band      last_suite_runner = outer（≥3 分钟量级；<3 分钟才可下放 inner）
invariant inner_full_suite_runs = 0（grep：inner 侧无全量套件自跑，只读 suite-state）
invoke    `grep -rn 'scripts/test.sh' plugin/loop/fast-mode-loop-tick.md`（应只见「读外层结果」引用）
control   红 merge fixture ⇒ runner 标 RED ⇒ inner 停止 + fan-in 暂缓；修复后 re-green ⇒ inner 恢复
resume    外层 runner 与 inner 读状态分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T02:4xZ
changed: 外层受人量化门槛裁定立案。四处收紧：
(1) **门槛机械化**——≥3 分钟 outer 集中后台，<3 分钟下放 inner 各任务自跑（批彻底消除）；当前实测
    11-12 分钟明确属 outer；
(2) **红窗裁定（人问的风险）**——GREEN/RUNNING 乐观合并不等待（消除同步点）；RED 立即停派发 +
    fan-in 暂缓 + 外层独占分诊；runner 一检测失败即标 RED 缩小窗口；
(3) **三块消除批次**——本条 (a) 套件块，closure-async (b) 收尾块，closure-decomposition (c) AC/证据
    块，三块在 loop 文档交叉标注；
(4) **inner 零全量套件**——只读 suite-state，grep 证明（DoD）。
status: todo——三块之一；与 closure-async/closure-decomposition 同链（都触 loop 文档，串行）。
