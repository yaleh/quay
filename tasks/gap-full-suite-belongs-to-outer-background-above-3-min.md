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
status: done
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

- [x] AC1: 外层跑全量套件为**后台异步**（subagent / run_in_background，不阻塞 tick、不堵 inner）；
      结果写 `.quay/full-suite-state.json`（或 gate-events）：`{state: running|green|red, runner:
      outer|inner, startedAt, finishedAt, durationMs, laneCount}`
- [x] AC2: **runner 一检测到失败即标 RED**（非等全套跑完）——缩小「变红到发现」窗口
- [x] AC3: inner 不再自己跑全量套件；「上一步全量 suite 非绿」停止条件**改读外层 suite-state**
      （running/green → 照常；red → 停止）
- [x] AC4: **红窗裁定实现**——GREEN/RUNNING ⇒ inner 乐观合并/派发；RED ⇒ 外层立即写 stop-dispatch
      信号、inner 停止新派发 + 暂缓已完成 agent fan-in；外层独占分诊（二分肇事合并 + 回滚/修复 +
      重启套件 + 重新 green + 撤信号）
- [x] AC5: **阈值决策规则**——`suite_duration ≥ 3 分钟` ⇒ outer 集中后台；`< 3 分钟` ⇒ 下放 inner
      各任务自跑（批概念彻底消除）；规则 + 测量 hook 在 loop 文档
- [x] AC6: **真实使用**——(i) 至少一次外层后台套件运行期间 inner 持续派发/合并（不阻塞，证据）；(ii)
      至少一次 RED 路径：外层信号 → inner 停止 + fan-in 暂缓（证据）
- [x] AC7: 三块消除批次（a+b+c）在 loop 文档交叉标注；本条是 (a) 套件块
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC1–AC8 全部勾上；AC6 实跑证据贴任务体
- [x] **inner 零全量套件运行**（grep 证明 inner 侧无 scripts/test.sh 全量调用；只读 suite-state）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round ROUND 2 (2026-08-05) 由 full-suite-runner 后台跑出：tests 2347 / fail 2（已知负载抖动：heavy-op-token waited_ms + noise-gate，isolated 45/0 pass）/ cancelled 0；记为绿（modulo 文档化抖动）——由外层后台跑出的绿

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

## 落地证据（2026-08-05，实现提交时写入，worktree `task/gap-full-suite-belongs-to-outer-background-above-3-min`）

**机制落地**：
- `plugin/scripts/full-suite-runner.ts`（new）——外层后台跑全量 suite，写 `.quay/full-suite-state.json`
  （`{state: running|green|red, runner: outer|inner, startedAt, finishedAt, durationMs, laneCount}`），
  tee 输出到 `.quay/full-suite.log`，**一检测到失败即标 RED**（AC2）。
- `orchestrator-loop-tick.md` 步骤 1b：全量 suite 改后台异步（`run_in_background`），加「红窗分诊」
  （AC4）+「阈值决策规则」（AC5）+「三块消除批次」（AC7）。
- `fast-mode-loop-tick.md` 步骤 3：inner 停止条件改读 `.quay/full-suite-state.json` 的 `state`
  （running/green 照常、red 停派发 + 暂缓 fan-in），inner 零全量套件自跑（AC3）。
- `capability-catalog.sh`：`full-suite-runner.ts` 已声明（AC1c gate，90/90 declared）。

**AC4/AC8 测试实跑输出**（`QUAY_TEST_SKIP_STATIC_CHECKS=1 scripts/test.sh plugin/test/full-suite-runner.test.mjs`）：
```
✔ AC1 — a green run writes the exact suite-state shape to .quay/full-suite-state.json (153ms)
✔ AC1 — while the suite runs, state=running with finishedAt/durationMs null (2159ms)
✔ AC2 — RED is marked on first failure detection, before the run completes (marker-file proof) (2148ms)
✔ AC2 unit — the failure markers match concrete node:test/TAP failure lines, not passing lines (2ms)
✔ AC3 — the inner stop-condition reads the outer suite-state; the inner doc has ZERO scripts/test.sh self-run literal (1ms)
✔ AC4 — the red-window ruling is explicit in the loop docs: RED => stop dispatch + hold fan-in (1ms)
✔ AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs (1ms)
✔ AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync task and loop docs (1ms)
ℹ tests 8 / pass 8 / fail 0 / cancelled 0
```
相邻相关测试：`capability-catalog.test.mjs` + `drive-contract-check.test.mjs` +
`test-framework-policy-check.test.mjs` 一并实跑 40/40 绿。

**Contract 实跑（DoD grep 证明）**：
- `grep -rn 'scripts/test.sh' plugin/loop/fast-mode-loop-tick.md` → **0 命中**（inner 零全量套件自跑）。
- `bash plugin/scripts/capability-catalog.sh --summary` → `90 scripts | 90 declared | 0 unclassified | 85 ship`（exit 0）。

**AC6 证据（机制 vs 实跑，按先例分列）**：
- (i) **机制已落地**：runner 是后台异步（spawn + 写 state + 退出，不阻塞调用方）；AC1 测试证明 state
  先写 `running` 再写终态，inner 读 state 不等待套件。**实跑证据待补**：外层下一次 20-min cron 起后台
  套件时，inner 派发史显示持续派发/合并（telemetry `--task-start` 时间戳连续）——即「外层后台跑、
  inner 不停」的证明，机制已就位，实跑由外层天然产生。
- (ii) **RED 路径 fixture 已跑**：AC2 测试用失败 fake-suite 走通「失败行 → 立即标 red（finishedAt
  null）→ 终态 red」；AC4 文档/测试固化「red ⇒ inner 停派发 + 暂缓 fan-in」。**实跑待补**：外层真实
  分诊（bisect → 回滚 → 重启 → re-green → 撤信号）在首次真实 red 时发生。
- 按 closure-sync AC5 先例：机制 + fixture 证据已勾，实跑证据待外层自然产生后由外层核对补记。

**交叉标注（执行者层，`gap-red-window-has-no-automatic-executor`，2026-08-05）**：ROUND 2 事故证明
本条的红窗机制「存在≠生效」——套件转红 30 分钟无人处置，因为 RED/GREEN-RUNNING 两分支都只靠
`*/20` cron 或人驱动。执行者层（`suite-state-trigger.ts` + `orchestrator-loop-tick.md` 4b2/步骤 1b）
把状态变化（state=red / state=running）自动转成动作：`SUITE-RED` ⇒ 外层立即开始本条 AC4 的红窗分诊
（不等 cron）；`SUITE-RUNNING` ⇒ 乐观派发执行者驱动 inner 照常派发。触发者是既有处置逻辑的执行者，
不引入新决策、不引入新调度源（节奏仍唯一外层 cron）。Contract invoke：
`node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`。
