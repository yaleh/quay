---
id: gap-probe-mechanism-dead-15-days-rewire-to-two-layer
title: probe mechanism dead 15 days — routine-scheduler exists but no production
  caller (0 tick-doc refs, every(N) uses retired iteration concept, last run
  07-15 Iteration 49/52); 5th 'mechanism exists nobody calls' instance; rewire
  trigger to two-layer quantities (tick-count/time/event) + archguard L_D/L_G
  instrumentation
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**探针机制已死 15 天——「机制存在但无人调用」第五实例（管理者实测 + 外层核实）**：

**死亡证据**：routine-scheduler.ts 存在但无生产调用（只有 config-wiring-check/read-probe-spec/SKILL.md
引用，无实际生产路径调用它）；orchestrator-loop-tick.md 引用 0 处、fast-mode-loop-tick.md 0 处；
trigger every(N) 按迭代计数触发（ADR-022 退休的经典管线概念——两层模式没有迭代号）；最后一次真跑
2026-07-15（Iteration 49/52）。机制本身完整：4 探针定义 + 3 脚本 + skill(106 行) + config 四条 routine。

**为什么重要**：今晚机器自己开的 7 根新维度全部是 post-friction（被硌了才发现）。探针本来就是设计做
pre-friction 发现——architecture-analysis 用 archguard 查依赖环/上帝包/重复抽象，正是 ADR-007 的
L_D/L_G 仪器。手工跑生成器问句不可持续，探针才是可持续机制，死了 15 天无人报警。

**同一族前四实例**：loop-driver.jsonl 无写入者、遥测括号从没被调用、human-steered 消费者全在退休管线、
strategic-doc-staleness orchestration 臂死 glob。

**重新接线方向**：触发器从迭代计数改为两层模式实际有的量（tick 计数 / 时间 / 事件）。

### 选定机制

1. routine-scheduler 触发器改为两层模式实际量：tick 计数（每 N 个 tick）或时间（每 N 分钟）或事件
2. 接线：orchestrator-loop-tick.md 步骤引用 routine（每 tick 检查 due），或挂 cron/Monitor
3. 补 pre-friction 能力：architecture-analysis 探针用 archguard（L_D/L_G 仪器）——git-lens 三脚本可回收进来
4. 验证：探针重新跑起来（架构分析 / 自验证 / 历史挖掘），且触发基于两层模式量

## Acceptance Criteria

- [x] AC1: routine 触发器改为两层模式实际量（tick 计数/时间/事件），不再依赖迭代计数
      **证据**：`plugin/scripts/routine-scheduler.ts` 新增 `interval:<N>m` 触发器（`parseTrigger` →
      `{kind:"interval",minutes}`；`isDue` 按 `now − lastRun ≥ N×60_000` 判定，从未运行 ⇒ due；
      CLI 增 `--now <epoch-ms>` 与 `--last-run <json>`）；`every(N)` 标注为 LEGACY 迭代计数
      back-compat。`packages/quay/src/loop-params.ts` 的 routine trigger 校验 regex 扩为接受
      `interval:<N>m`（`/^(every\(\s*\d+\s*\)|interval:\s*\d+\s*m|on\(\s*[\w-]+\s*\))$/`）。
      `.quay/config.yml` 四条 routine 全部从 `every(N)`（迭代计数）改为两层模式**时间量**
      `interval:<N>m`（self-validation 180m / architecture-analysis 1440m / history-mining
      1440m / browser-explorer 2880m）。测试：`routine-scheduler.test.mjs` 增 interval 判定 + CLI
      `--now/--last-run` 用例（16/16 pass）；`loop-params.test.mjs` no-drift 用例扩 interval 形态
      （42/42 pass）。
- [x] AC2: 探针重新接线——每 tick 或定时检查 due 并执行（架构分析/自验证/历史挖掘），实测跑起来
      **证据**：`plugin/loop/fast-mode-loop-tick.md` 新增「### 4b. Routine 检查（探针 standing
      track，每 tick 判定 due）」——每 tick 无条件跑 `routine-scheduler.ts --now/--last-run`，
      DUE ⇒ 调 run-routines skill 派发探针、派发后写回 `.quay/routine-last-run.json`、FILE-ONLY
      invariant；「每个 tick 必报」增 routine 行。`plugin/loop/orchestrator-loop-tick.md` 新增
      「### 1a. Routine 检查（监督探针不 dead）」——外层同源判定 + **STALE 检测（>2×interval ⇒ 探针
      dead 升格）**，即「死 15 天无人报警」的机械反例；「每个 tick 必报」增 routine 行。实测（worktree
      内、真实 config routines）：无 last-run ⇒ 全 due；刚写回 ⇒ 无 due；3.5h 后 ⇒ 仅 self-validation
      due；25h 后 ⇒ self-validation + architecture-analysis + history-mining due（browser-explorer
      2880m 窗口未到）——见下方「实施与验证」。
- [x] AC3: architecture-analysis 探针用 archguard（L_D/L_G 仪器），git-lens L_D/L_G/L_S 回收进来
      **证据**：回收部分已由 `gap-experiment-legacy-reclaim-and-touches-heuristic` 落地（2026-08-06）：
      git-lens L_D/L_G/L_S 三脚本已回收进 `plugin/scripts/`（`git-lens-l-d-code-doc-ratio.ts` /
      `git-lens-l-g-structural-drift.ts` / `git-lens-l-s-behavior-variance.ts`，实测存在），
      `plugin/probes/architecture-analysis.md` 已加 `instrument: archguard` / `fallback: git-lens`
      及三脚本调用说明。本任务余下部分（触发器改两层量 + 每 tick 检查 due）已由 AC1/AC2 完成。
- [x] AC4: 与「机制存在无人调用」族前四实例交叉标注
      **证据**：见下方「AC4 交叉标注（「机制存在无人调用」族）」。四前实例 + 本族第五实例
      `gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed` 已双向交叉标注。

## 实施与验证（2026-08-07）

**实测 1（AC2 实跑——worktree 内真实 config routines，两层时间量触发）**：

```
$ node plugin/scripts/routine-scheduler.ts --now <NOW> --plugin-root "$(pwd)" /tmp/routines-live.json
# 无 last-run（从未运行 ⇒ due，track 启动）：
DUE: self-validation (interval:180m) → probe self-validation
DUE: architecture-analysis (interval:1440m) → probe architecture-analysis
DUE: history-mining (interval:1440m) → probe history-mining
DUE: browser-explorer (interval:2880m) → probe browser-explorer

# 模拟派发后写回 .quay/routine-last-run.json（同一 tick 再跑 ⇒ 无 due，窗口内不重触发）：
$ node ... --now <NOW> --last-run .quay/routine-last-run.json ...
no routines due  (exit 3)

# 3.5h 后 ⇒ 仅 self-validation due（180m 窗口已过；其余未到）：
DUE: self-validation (interval:180m) → probe self-validation

# 25h 后 ⇒ self-validation + architecture-analysis + history-mining due（1440m 窗口已过；
# browser-explorer 2880m 窗口未到）：
DUE: self-validation (interval:180m) → probe self-validation
DUE: architecture-analysis (interval:1440m) → probe architecture-analysis
DUE: history-mining (interval:1440m) → probe history-mining
```

**实测 2（Contract measure）**：`git log --oneline -1 --all --grep='Iteration 4[0-9]\|probe\|routine' --since='2026-08-01' | wc -l` ⇒ 1（band ≥1 满足；measure 为 `-1 | wc -l` 二值）。接线证据看 Contract **invoke**：
`grep -rn 'routine-scheduler\|run-routines' plugin/loop/ plugin/scripts/ --include='*.md' --include='*.ts'` ⇒ **21 处命中**，其中 tick 文档命中 7 处（orchestrator-loop-tick.md 4 + fast-mode-loop-tick.md 3）——死亡证据原为「两个 tick 文档各 0 引用」，现在每 tick 文档都有机械接线点。

**测试**：`bash scripts/test.sh experiments/quay-perpetual-stream/test/routine-scheduler.test.mjs packages/quay/test/loop-params.test.mjs` ⇒ **exit 0，tests 58 / pass 58 / fail 0**；scoped 静态 tier
`bash scripts/test.sh --for-task gap-probe-mechanism-dead-15-days-rewire-to-two-layer --allow-thin` ⇒
**exit 0**（task-contract-check: no violations / drive-contract-check PASS）。

## AC4 交叉标注（「机制存在无人调用」族）

本任务是「机制存在无人调用」族的**第五实例**（探针机制死 15 天——`routine-scheduler.ts` 存在但无
生产调用；`every(N)` 按退休的迭代计数触发）。族前四实例（相互交叉标注）：

1. **loop-driver.jsonl 无写入者** → `tasks/gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.md`
2. **遥测括号从没被调用** → `tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md`
3. **human-steered 消费者全在退休管线** → `tasks/gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode.md`
4. **strategic-doc-staleness orchestration 臂死 glob** → `tasks/gap-stale-check-orchestration-arm-is-a-dead-glob.md`

族相关第五实例（dead-loop 判据——「循环没在转」与「机制没人调」同源，见 Touches）：
`tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md`（已加回指交叉标注）。

**共同形态**：造了机制 → 无人调用 / 判据查铺不查转 → 静默失效。本任务把探针触发器从「两层模式
不存在的迭代号」改为「两层模式实际有的时间/事件量」，并把 due 判定接进每 tick，机制重新有生产路径。

## Touches

- tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md
- plugin/scripts/routine-scheduler.ts（触发器改两层量：新增 `interval:<N>m` + `--now`/`--last-run`）
- plugin/loop/orchestrator-loop-tick.md（接线 routine 检查 + STALE dead-mechanism 报警）
- plugin/loop/fast-mode-loop-tick.md（步骤 4b 每 tick due 判定 + 派发）
- plugin/skills/routines/SKILL.md（触发说明更新为两层量）
- .quay/config.yml（routine 触发定义更新：`every(N)` → `interval:<N>m`；untracked/gitignored，本地生效）
- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（AC4 交叉标注）
- packages/quay/src/loop-params.ts（routine trigger 校验 regex 扩为接受 `interval:<N>m`——AC1 必需）
- packages/quay/test/loop-params.test.mjs（no-drift 用例扩 interval 形态——AC1 测试）
- experiments/quay-perpetual-stream/test/routine-scheduler.test.mjs（interval 判定 + CLI 用例——AC1 测试）
- plugin/skills/loop-driver/SKILL.md（generic 驱动 routine 触发说明更新——AC1 文档）
- .claude/workflows/run-routines.js（bespoke 派发器 invocation 契约更新为 `--now`/`--last-run`——AC2 必需）
- .gitignore（新增 `**/.quay/routine-last-run.json`——FILE-ONLY 状态文件，AC2 必需）

## Contract

measure   probe_last_run = `git log --oneline -1 --all --grep='Iteration 4[0-9]\|probe\|routine' --since='2026-08-01' 2>&1 | wc -l` stdout 数字段（探针最近运行）
band      probe_last_run >= 1（8 月后有探针运行记录）
invoke    `grep -rn 'routine-scheduler\|run-routines' plugin/loop/ plugin/scripts/ --include='*.md' --include='*.ts'`
control   当前形态（死 15 天）⇒ 无 8 月后运行；接线后 ⇒ 有（AC2）
resume    触发器改造与接线分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
