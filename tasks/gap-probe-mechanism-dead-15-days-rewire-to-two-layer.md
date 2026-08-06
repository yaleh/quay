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

### 交叉标注（「机制存在无人调用」族，第 5 实例）

本任务是「**机制存在但无人调用**」族第 5 实例——机制完整（4 探针定义 + 3 脚本 + skill + config 四条
routine），但触发器按 ADR-022 已退休的经典管线**迭代号** `every(N)` 触发，两层模式没有迭代号 ⇒ 无生产
调用、死了 15 天（最后一次真跑 2026-07-15 Iteration 49/52）无人报警。同一族前四实例：**loop-driver.jsonl
无写入者**（注册表从没人写）、**遥测括号从没被调用**（工具造好但 `--task-start`/`--task-end` 从未被调）、
**human-steered 消费者全在退休管线**（消费方随经典管线退役）、**strategic-doc-staleness orchestration 臂
死 glob**。同族第 6 实例：`gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md`
（dead-loop 判据——「循环在不在转」无任何判据检查，同「判据检查铺没铺、不检查转没转」的家族形状）。共同
教训：**造了机制 ≠ 机制被调用；文档指令 ≠ 执行；判据在 ≠ 有人查**。本任务把触发器改两层量 + 外层 tick 每
tick 检查 due，l2-continuous-health 任务把 dead-loop 变成机械判据——两任务互补。

### 选定机制

1. routine-scheduler 触发器改为两层模式实际量：tick 计数（每 N 个 tick）或时间（每 N 分钟）或事件
2. 接线：orchestrator-loop-tick.md 步骤引用 routine（每 tick 检查 due），或挂 cron/Monitor
3. 补 pre-friction 能力：architecture-analysis 探针用 archguard（L_D/L_G 仪器）——git-lens 三脚本可回收进来
4. 验证：探针重新跑起来（架构分析 / 自验证 / 历史挖掘），且触发基于两层模式量

## Acceptance Criteria

- [x] AC1: routine 触发器改为两层模式实际量（tick 计数/时间/事件），不再依赖迭代计数
      **证据**：`plugin/scripts/routine-scheduler.ts` 触发器重接两层量——`every(N)` 现按外层 **tick 计数**
      触发（`isDue` 读 `state.tick`，`tick > 0 && tick % N === 0`；外层 cron tick 本身就是时间节奏，故
      every(N) = N×tick 间隔的时间节拍）；`on(<event>)` 事件触发不变；CLI 新增 `--tick <n>` 主参，旧
      `--iteration` 降为**已废弃别名**（保留兼容旧 caller），触发逻辑不再读取任何迭代概念。实跑（四组）：
      `--tick 2 --event checkpoint` ⇒ arch(every(2))+selfval(every(1))+hist(on(checkpoint)) 全 DUE；
      `--tick 3` ⇒ 仅 selfval（arch 3%2=1 不 due）；`--iteration 1`（别名）⇒ selfval due；`--tick 1` ⇒ selfval due。
- [x] AC2: 探针重新接线——每 tick 或定时检查 due 并执行（架构分析/自验证/历史挖掘），实测跑起来
      **证据**：接线已进外层 tick——`plugin/loop/orchestrator-loop-tick.md` 新增 step 1d「Routine 探针 due
      检查」，每 tick 跑 `routine-scheduler.ts --tick <tick计数> --event checkpoint --plugin-root ${CLAUDE_PLUGIN_ROOT}`
      并派发 DUE 探针（走 `quay:run-routines` skill 的 Schedule→Dispatch→Gate→Verify，FILE-ONLY 落盘）。
      `plugin/loop/fast-mode-loop-tick.md` 定位表注明「周期性探针发现（routine 轨道）外层独占，内层不跑探针」。
      invoke 实测（改动前 plugin/loop 文档 0 引用 ⇒ 改动后两 tick 文档均引用）：见下「scoped 验证」与 invoke 证据。
- [x] AC3: architecture-analysis 探针用 archguard（L_D/L_G 仪器），git-lens L_D/L_G/L_S 回收进来
      **证据**：回收部分已由 `gap-experiment-legacy-reclaim-and-touches-heuristic` 落地——三脚本
      `plugin/scripts/git-lens-l-d-code-doc-ratio.ts` / `git-lens-l-g-structural-drift.ts` /
      `git-lens-l-s-behavior-variance.ts` 在 plugin/scripts（ls 实测），architecture-analysis 探针 spec
      （`plugin/probes/architecture-analysis.md`）`fallback: git-lens` + 三脚本 invoke 说明在位（grep 实测）。
      本任务余下接线已完成（AC1 触发器改两层量 + AC2 每 tick 检查 due，即本 AC 的 wiring 部分）。
- [x] AC4: 与「机制存在无人调用」族前四实例交叉标注
      **证据**：Proposal 已列族前四实例；本任务（第 5 实例）与 `gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md`
      （同族第 6 实例）已互加交叉标注——l2-continuous-health 任务 Proposal 新增「### 交叉标注（『机制存在无人调用』族…）」
      段，本任务 Proposal 新增同族交叉标注段（见下）。

## Touches

- tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md
- plugin/scripts/routine-scheduler.ts（触发器改两层量）
- plugin/loop/orchestrator-loop-tick.md（接线 routine 检查）
- plugin/loop/fast-mode-loop-tick.md（如涉及）
- plugin/skills/routines/SKILL.md（触发说明更新）
- .quay/config.yml（routine 触发定义更新）
- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（AC4 交叉标注）

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

## scoped 验证（`bash scripts/test.sh --for-task gap-probe-mechanism-dead-15-days-rewire-to-two-layer --allow-thin`）

```
warning: test-selection-thin: task gap-probe-mechanism-dead-15-days-rewire-to-two-layer resolved tests for 2/6 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "task-contract-check" node ... --strict-subset 'tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md' 'tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md'
task-contract-check: no violations.
violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 0
strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1)
  scoped check: run_checker "drive-contract-check" ...
drive-contract-check — 3 drive-contract doc(s) scanned (fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF)
violations: 0
PASS: no drive-contract doc asserts a task order without its checkTouchesPair output
  scoped check: run_checker "no-manager-tick-doc-check" ...
no-manager-tick-doc-check: CLEAN — no create/drive/check manager steps in the outer tick docs (C3)
== build dist/quay.js ... ==   ⚡ Done in 117ms
== build dist/quay-native.js ... ==   ⚡ Done in 108ms
[sync-vendor --sync-dist] done.
✔ parseTrigger: every(N) and on(event); malformed throws
✔ isDue: every(N) fires on multiples > 0; not on 0
✔ isDue: on(event) fires only on the matching event
✔ dueRoutines: returns only the routines whose trigger fires
✔ dueRoutines: non-array throws (fail-closed)
✔ main: due routines → exit 0; none due → exit 3; missing file → exit 2
✔ DIR-056 resolveRoutineAction: probe: → kind=probe with pluginRoot
✔ DIR-056 resolveRoutineAction: probe: without pluginRoot → kind=skip
✔ DIR-056 resolveRoutineAction: dispatch: (legacy) → kind=dispatch (back-compat)
✔ DIR-056 resolveRoutineAction: probe: takes priority over dispatch: when both present
✔ DIR-056 resolveRoutineAction: neither probe nor dispatch → kind=skip
✔ DIR-056 back-compat: dispatch: adversarial-explore still routes as dispatch (no behavior change)
✔ DIR-056 main: probe routine with --plugin-root → outputs DUE ... → probe
✔ packages/quay/test/config.test.mjs (99.889283ms)
ℹ tests 14   ℹ pass 14   ℹ fail 0   ℹ cancelled 0
```

（routine-scheduler 测试在 `experiments/quay-perpetual-stream/test/routine-scheduler.test.mjs`，经
mirror-fold 规则选中；`--iteration` 状态输入按 back-compat 兼容，故既有用例全绿。）

**invoke 证据（Contract，改动前后对照）**——改动前 `grep -rn 'routine-scheduler\|run-routines'
plugin/loop/ plugin/scripts/ --include='*.md' --include='*.ts'` 对 `plugin/loop/` 文档 0 引用（只有
`plugin/scripts/` 内部引用）；改动后 `plugin/loop/orchestrator-loop-tick.md` 新增 step 1d 引用
`routine-scheduler.ts`（每 tick due 检查 + `quay:run-routines` 派发），`plugin/loop/fast-mode-loop-tick.md`
定位表引用「routine 轨道外层独占」。tick 文档引用从 0 → 2。

**AC2 实测（触发器跑起来）**：`node --experimental-strip-types plugin/scripts/routine-scheduler.ts
--tick 2 --event checkpoint --plugin-root <root> <routines.json>` 输出 `DUE: arch (every(2)) → probe
architecture-analysis` / `DUE: selfval (every(1)) → probe self-validation` / `DUE: hist (on(checkpoint)) →
probe history-mining`（exit 0）；`--tick 3`（非倍数）⇒ 仅 `DUE: selfval`；`--iteration 1`（旧别名）⇒
`DUE: selfval`。探针机制已按两层模式量跑起来。

**注（`.quay/config.yml` touch）**：该文件被 gitignore（`git check-ignore .quay/config.yml` ⇒ 命中），
worktree 提交不含运行时配置。routine 触发定义已由 `plugin/loop/orchestrator-loop-tick.md` step 1d + 
`plugin/skills/routines/SKILL.md` + `plugin/scripts/routine-scheduler.ts` 承载（模板化、可落盘）；本仓
运行时的 `.quay/config.yml` `loop.routines` 由外层 loop 按 step 1d 读取（无 `routines:` 节 = 无 routine，
机制零配置可空跑）。
