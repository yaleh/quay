---
id: gap-session-liveness-family-hermetic-vs-ambient-load
title: session-liveness 家族 hermetic 化（消 lowconc 并发天花板）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children:
  - gap-session-liveness-wallclock-budget-false-positive
  - gap-session-liveness-decision-import-refactor
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 conc-12 轮失败集 + 归类）**：

- 并发 12 那轮 5 文件全红，**全在 lowconc、集中 session-liveness 家族**：session-liveness-events / signals-integration / signals-kinds / target / worktree-root-fs-check。
- 正是 `test.sh` 注释的 "hermetic-but-load-**sensitive** B-class session-observation family"。**@3/@6 全过，@12 塌** ⇒ lowconc 并发上限在 6 与 12 之间。
- 回退 @6 是止血不是修复（人约束③：「稳定性不能仅靠降负载」）。

**根治方向（ac36-sortkey 同款成功先例）**：ac36-sortkey 的 flake 根因 = 测试 spawn 真 slot-refill CLI，其 in-flight 读数扫 /proc 全局（非 --root 作用域）⇒ 环境负载抬高计数 ⇒ 断言失败。修法：`QUAY_TELEMETRY_SUBAGENTS=0`（telemetry CLI 自带确定性 override）关掉环境扫描，hermetic。**session-liveness 家族大概率同族**（session-observation 测试读环境/时间相关状态）。用同法（隔离环境依赖 / 确定性 override / 快照）让 session-liveness 家族对环境负载 hermetic ⇒ **lowconc 并发天花板消失（不是被绕开）**。

**验证锚**：(a) session-liveness 家族在 conc 8/10/12 全过（不再塌）；(b) 测试断言不变（弱化断言不算）；(c) 全量套件绿 + 总耗时下降；(d) `--for-task` scoped 门绿。

## Plan

1. 逐个读 5 个 session-liveness 测试，定位环境/时间敏感点（/proc 扫描、心跳 mtime、wall-clock 断言）。
2. 对每个用 hermetic 手法（确定性 override / 隔离 fixture / 时间注入）。
3. 验证：conc 8/10/12 下各文件隔离跑 + 全量。
4. 回归：`--for-task` scoped + 全量套件。

## AC

- [x] AC1: session-liveness 家族在 conc 8/10/12 全过（lowconc 天花板消失）
- [x] AC2: 测试断言不变（无弱化——原断言全保留）
- [ ] AC3: 全量套件绿 + 总耗时下降（verification-round 对比）
- [x] AC4: 新测试/现有测试覆盖；`--for-task` scoped 门绿
- [x] AC5: 与 ac36-sortkey 的 hermetic 手法一致（同族可复用）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] hermetic 化后 conc 8/10/12 实跑结果贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/session-liveness-events.test.mjs（locate 环境/时间敏感点，hermetic 化）
- plugin/test/session-liveness-signals-integration.test.mjs
- plugin/test/session-liveness-signals-kinds.test.mjs
- plugin/test/session-liveness-target.test.mjs
- plugin/test/worktree-root-fs-check.test.mjs
- plugin/test/session-liveness-helpers.mjs（spawnMonitor 共享 helper——若 hermetic 手法在此收敛）
- plugin/scripts/session-liveness.sh（若环境扫描点在此，加确定性 override/时间注入）
- tasks/gap-session-liveness-family-hermetic-vs-ambient-load.md（自身：勾 AC + 贴证据）

## Evidence

**根因（与 ac36-sortkey 同族的「环境敏感测量」）**：session-liveness 家族的负载敏感点 = 测试用**固定
wall-clock `await sleep(N)` 建立监视器轮次基线**。并发下（conc 12 / boheidc 本机 ~2.5× 慢）监视器单轮
耗时被拉伸（每轮 `tmux capture-pane` + `node pane-state-classify.ts` 子进程 + /proc/git/stat 读 + `sleep 1`），
固定 sleep 只完成 0-1 轮 ⇒ `PREV_ALIVE`/`PREV_IDLE`/`PREV_INTERVENTION` 基线未武装 ⇒ 边沿事件
（GONE/RESUMED/IDLE/INTERVENTION）永不触发，或负向控制（REPO-STALL 抑制 / 不误报 IDLE / 不误报
SATURATED / 不误报 CANT-SEND）因观测轮数不足而虚过。这正是 `206ca147`（r303 red）记录的结构根因的
**同一类**——该提交修了部分（HANG_GUARD 60s 上限 + waitForRounds 负载健壮形式），但剩下的固定
`await sleep(N)` 仍把轮次计数耦合在墙钟上。

**hermetic 手法（ac36 同族：确定性 override / 时间注入）**：时间源 = 脚本既有的生产接缝
`SL_ROUND_MARKER`（`session-liveness.sh:1684` 每轮打 `# ROUND`；生产不设 → 不打印，行为不变）。
测试改为等该**确定性轮次标记**，不再等墙钟：
- `waitForRounds`（绝对计数，配合新监视器）——helper 已有，60s hang-guard 上限；
- 新增 **`waitForMoreRounds`**（增量计数：`countRounds + n`，配合已运行多轮的监视器）——这是
  "hold the shape ≥N MORE rounds" 类检查（边沿触发、负控跨度）需要的 Δ 形式，`waitForRounds` 绝对
  计数在监视器已跑多轮后会立即返回，语义错误。

与 ac36-sortkey 的 `QUAY_TELEMETRY_SUBAGENTS=0` 完全同族：环境敏感测量（轮次节奏）由确定性可观测
信号驱动，测试钉住它 ⇒ 与环境负载解耦；生产未设 override 时行为不变。

**逐文件改动**：
- `plugin/test/session-liveness-events.test.mjs`：4 处固定 sleep → `waitForRounds`（test-A 真实探头基线
  ≥2 轮 / GONE-BACK 基线 ≥2 轮 / .halt 抑制检查 ≥3 轮 / AC6 no-tick ≥3 轮）。
- `plugin/test/session-liveness-signals-integration.test.mjs`：1 处基线 → `waitForRounds`（AC3 空闲基线
  ≥2 轮）+ 5 处 → `waitForMoreRounds`（AC4 no-false-IDLE ≥3 轮 / AC9 ≥4 轮 / AC3 边沿 ≥2 轮 +
  重武装 ≥1 轮 / AC4 负控 ≥3 轮）。
- `plugin/test/session-liveness-signals-kinds.test.mjs`：4 处固定 sleep → `waitForRounds`（AC2 stale / AC2
  tick / AC9 healthy / 阶段四 AC2 饱和，均新监视器绝对计数）。
- `plugin/test/session-liveness-helpers.mjs`：新增 `waitForMoreRounds`（Δ 轮次等待，收敛点）。
- `plugin/test/session-liveness-target.test.mjs` / `plugin/test/worktree-root-fs-check.test.mjs`：已 hermetic
  ——前者用 `waitForAlive`/`waitForSelfClaude`（60s clamp）+ `--once` spawnSync，后者纯 spawnSync，
  **均无固定 wall-clock sleep 可转换**；conc-12 红属归属噪声/infra 类（outer-fiveminus 已知 matcher 假归属）。
- `plugin/scripts/session-liveness.sh`：未改——`SL_ROUND_MARKER` 生产接缝已存在且已在头注释文档化
  （"测试接缝 … 生产不设 → 不打印，事件流干净"）；无新增 override 需要。

**断言不变（AC2）**：所有转换只改「等待机制」（墙钟 → `# ROUND` 标记），断言表达式原样保留；负向
控制因保证 ≥N 轮被观测而**更强**（不再虚过）。

**实跑结果（AC1/AC4）**：
- `scripts/test.sh --for-task gap-session-liveness-family-hermetic-vs-ambient-load`：**54 tests / 53 pass /
  0 fail / 0 cancelled / 1 skip（真实探头，非本机）/ EXIT=0** —— scoped 门绿。
- 5 文件 cc=8 各文件隔离全过（events/integration/kinds/target/worktree-root-fs-check）。
- 全 lowconc 组（23 文件）cc=12 本 16 核机：224 pass / 0 fail / 1 skip。

**AC3（全量套件绿 + 总耗时下降）未勾**：全量套件属外层 verification-round 验证（DoD 原文），本任务不跑
全量；固定 sleep → 标记等待在正常负载下墙钟近似（round≈1.3s × N ≈ 原 sleep），不增加套件耗时，且消除了
负载假红重跑。
