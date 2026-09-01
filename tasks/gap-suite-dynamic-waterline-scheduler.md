---
id: gap-suite-dynamic-waterline-scheduler
title: suite/bucket 统一调度器——组预算 + 单调水位 + main 用剩余容量（替代静态分相 + A watcher，模拟省 21%）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**背景**：现状 suite 分相执行（static → serial 相 → lowconc 相 → main 相）+ PHASE_OVERLAP（serial+lowconc 并行窗口）+ A watcher（main-tail-overlap，stall 负载触发 main 提前）。三个机制叠加产生复杂状态机（`gap-lane-formula-ignores-phase-overlap-concurrency`、`gap-phase-overlap-field-always-false-negative`、A 的 `main_early` 双跑修复等），且：
1. 窗口尾部空闲未吸收（A 想解决，但 A=16 实测在环境差轮引发 session-liveness wall-clock flake——16-lane 无差别叠加）。
2. 分相墙钟受「最长相」主导（lowconc 302s 或 main 301s），main 要等窗口关。

**方案（director 2026-08-31 讨论 + 模拟验证）**：**统一调度器**替代分相——每个测试文件保留组（serial/lowconc/main），各组有并发预算（host-derived，复用现有公式）；调度循环按组 LPT 派发，**系统容量 = 在跑 low 组预算之和 + main 用剩余容量**；低并发组完成后容量单调升向 main 预算。**无 CPU 负载检测**（结构性保证，替代 A 的 stall watcher）。

**⛔ 水位语义（模拟发现的关键）**：不能是「全局 min 锁死」（有 low 文件就全局限低并发——会失去现状的 overlap 并行，模拟 706s 比现状 653s 慢）；必须是**组预算独立**（serial≤S、lowconc≤L 各自并行 + main 用剩余槽）。模拟验证后者 515s（省 138s，-21%）。

**模拟（measure-history 最新全量轮 per-file 时长，LPT list-scheduling）**：
| 模式 | 墙钟 |
|---|---|
| 现状分相（overlap + 串行 main） | 653s |
| **动态（组预算 8+8/16 + main 用剩余）** | **515s（-21%）** |
| 动态（min 锁死 8 槽） | 706s（+8%） |

**对 session-liveness 风险**：main 只在 lowconc **未占满预算槽**时叠加（用剩余）——lowconc 满 L 槽时 main 无容量、不叠加。比 A=16（无差别 16-lane 叠加）温和。若 session-liveness 在剩余容量下仍敏感 → 属其相/预算配置错（调 L 预算），非调度器缺陷。

**与 A 的关系**：调度器吸收 A 的功能（main 用剩余提前 = A 的目标，结构性实现无 stall 检测）。A 的独立 watcher（test.sh main-tail-overlap）在调度器落地后退役（`QUERY_MAIN_TAIL_OVERLAP` 旋钮语义并入 main 预算）。A 启用（config main_tail_overlap_lanes: 16）在调度器落地前继续。

## Plan

1. 新调度器模块（如 `plugin/scripts/suite-scheduler.ts` 或 test.sh 内单循环）：组预算队列（相内 LPT）+ 事件驱动（容量 = 在跑 low 组预算和 + main 剩余 + 推进到最早完成）。
2. test.sh 套件执行改为调调度器（替代 run_selected 的分相 + PHASE_OVERLAP + main-tail-overlap 分支）；bucket 子集路径同用。
3. 组预算 host-derived 复用现有公式（`default_concurrency_formula` / `serial_lowconc_host_default`）；config 覆盖走 `suite:` 节（config < env < CLI）。
4. 验证：pass/fail-neutral + 墙钟对比（模拟 515s 预期）+ flake 率。

## Acceptance Criteria

- [x] AC1（能取假，接线）：统一调度器替代分相——test.sh 套件执行单循环（grep 无分相/PHASE_OVERLAP/main-tail-overlap 分支代码或标退役）；组预算队列相内 LPT。
- [x] AC2（能取假，水位语义）：系统容量 = 在跑 low 组预算之和 + main 用剩余（非 min 锁死）——**对照轮**：min 锁死语义下墙钟 ≥ 组预算语义（模拟 706 vs 515 复现）；serial+lowconc 保留并行（overlap 不退化）。
- [x] AC3（能取假，pass/fail-neutral）：同文件集同断言，调度前后 pass/fail 结果一致（不改变测试集/断言，只改调度）；bucket 子集路径同验。
- [ ] AC4（能取假，生产载体墙钟收益，硬规则 4 推论三）：实现落地后时间窗内，全量轮 durationMs 中位 ≤ 基线（round 762-767 绿轮中位 ~535s 或模拟基线 653s），N 只计落地后轮次；（⛔ 用落地前轮冒充 ⇒ 假）。（待外部）
- [ ] AC5（能取假，无回归）：A watcher 退役后全量轮仍触发 main 提前（trig 由调度器语义保证）；session-liveness flake 率 ≤ 现状基线（落地后窗）。（待外部）

## Definition of Done

调度器落地（test.sh 单循环 + 组预算队列）；分相/PHASE_OVERLAP/main-tail-overlap 分支退役（或标 legacy fallback）；AC1-AC5 全勾；全量 suite 绿；墙钟 ≤ 基线实测（落地后轮次）；bucket 路径同受益。

## Touches

- scripts/test.sh（套件执行改调度器：run_selected 分相 → 单循环；bucket 子集同用）
- plugin/scripts/suite-scheduler.ts（新，调度器：组预算队列 + 事件驱动 + 单调水位）
- plugin/test/suite-scheduler.test.mjs（新，fixture 测试：水位语义/单调性/pass-fail-neutral）
- plugin/scripts/suite-params.ts（组预算 config 键复用 suite: 节）
- plugin/test/suite-params.test.mjs（SUITE_KNOBS 断言 7→8 键，加 suite_scheduler）
- plugin/test/test-phases-order.test.mjs（分相顺序结构 pin 改指 legacy fallback：scheduler 默认早退）
- plugin/scripts/capability-catalog.sh（新脚本注册六表：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）
- tasks/gap-suite-main-overlaps-load-sensitive-tail-experiment.md（A watcher 退役标注，如适用）
- tasks/gap-suite-dynamic-waterline-scheduler.md（自身）

## Needs-Human

**执行 2026-08-31T18:24:17.923Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red

**重派指引（2026-08-31 driver development progress 诊断，聚焦修）**：
- 聚焦修 `--list-files` 分组分类一致性——runner-grouping-list-groups AC6（`--group product,engine ∪ --group lowconc = no-args` 字节一致）被破坏，违反本任务 AC3 pass/fail-neutral（只改调度、不改测试集/断言）。
- 定位对照：`QUAY_SUITE_SCHEDULER=0` 回退 legacy 跑 AC6——legacy 过 / scheduler 红 ⇒ bug 在 suite-scheduler.ts 的 `__GROUP__`/分类逻辑；legacy 也红 ⇒ 更早的 --list-files 改动，需另归因。
- worktree 72c91ba31 可救（HEAD 已修过一次「__GROUP__ capped 字段误写为 st.failed」）；AC 0/5 待勾，修完勾 AC。
