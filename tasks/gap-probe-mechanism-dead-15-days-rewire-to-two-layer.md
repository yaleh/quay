---
id: gap-probe-mechanism-dead-15-days-rewire-to-two-layer
title: probe mechanism dead 15 days — routine-scheduler exists but no production
  caller (0 tick-doc refs, every(N) uses retired iteration concept, last run
  07-15 Iteration 49/52); 5th 'mechanism exists nobody calls' instance; rewire
  trigger to two-layer quantities (tick-count/time/event) + archguard L_D/L_G
  instrumentation
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
  needs_human_reason: "fan-in conflict: cherry-pick bf6b42b2 onto integration → 1
    conflict on plugin/loop/fast-mode-loop-tick.md step 4b. Integration already
    has a step 4b (cross-machine-verify heartbeat from
    gap-no-post-merge-cross-machine-verification-detection-latency-is-luck,
    landed 5674e0ea); probe-mechanism adds its own step 4b (routine check). Both
    are live heartbeat steps claiming the same doc position — a genuine
    same-position two-task conflict, same class as ac8/shipped-ts. Per doc:
    conflict → needs-human, never --skip/-X ours. Work fully implemented +
    verified (58/0 tests, all ACs ticked). Worktree/branch
    task/gap-probe-mechanism-dead-15-days-rewire-to-two-layer preserved at
    bf6b42b2+9e4ffd45. Needs human to merge/renumber the two step-4b sections
    (e.g. cross-machine as 4b + routine as 4c, or merge). NOTE: the cherry-pick
    abort initially reset integration backward past the ac8 merge +
    readme-source fan-in; I restored integration to 578afc7c (all fan-ins
    verified present) — integration is safe."
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
- [x] AC2: 探针重新接线——每 tick 或定时检查 due 并执行（架构分析/自验证/历史挖掘），实测跑起来
- [x] AC3: architecture-analysis 探针用 archguard（L_D/L_G 仪器），git-lens L_D/L_G/L_S 回收进来
  - 回收部分已由 `gap-experiment-legacy-reclaim-and-touches-heuristic` 落地（2026-08-06）：git-lens L_D/L_G/L_S 三脚本已回收进 `plugin/scripts/`，architecture-analysis 探针 spec（`plugin/probes/architecture-analysis.md`）已加 fallback: git-lens 说明。本任务余下为探针机制重新接线（触发器改两层量 + 每 tick 检查 due）。
- [x] AC4: 与「机制存在无人调用」族前四实例交叉标注

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：rewire ask satisfied by landed work: routines in .quay/config.yml, fast-mode-loop-tick.md step 3.7 dispatches routine-scheduler per-tick, done tasks DIR-056 / exp5-M-OUTERLOOP-ROUTINE-WIRING / exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED confirm wiring.）**
全文见 git 历史（`git log -p -- tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md`）。

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
