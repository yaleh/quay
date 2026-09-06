---
id: gap-mechanical-fan-in-loses-per-phase-accounting
title: 机械 fan-in 的 --buckets 轮只记一条 lanes=1 的 static 相，main/serial/lowconc 分相记账与 PSI 全失
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测，2026-09-06）**：`.quay/verification-round.jsonl` 今天 **37 轮，全部单相**——
每轮只有一条 `{phase: "static", lanes: 1, wall_ms ≈ 47000, reconstructed: true,
psi_cpu_total: null, psi_io_total: null}`，**没有任何一轮含 `main` / `serial` / `lowconc` 相**。
而这些轮的真实 suite 是 16 泳道全量（`full-suite-state.json` 的 `laneCount: 16`、
`durationMs` 数分钟级），**记录里那 47 秒的单相与实际跑的东西不是一回事**。

**分相记账的断点**：历史上多相轮共 **129** 条，**最后一条是 2026-08-31**；
之后全部退化为单相。时间点与机械 fan-in（`runMechanicalFanIn`）成为 happy-path primary 吻合。
今天 37 轮的 `runId` 全是 `mfi-*`、`runner: inner`、`scope: worktree`。

**⛔ 先排除两个"其实正常"的解释（都已排除，不要重走）**：
1. **不是 writer 走错**：`worker-driver.ts:2596-2599` 与 `:3135` 明写机械路径经
   `full-suite-runner.ts --buckets`（verification-round 的**唯一 writer**），
   `gap-fan-in-red-bucket-run-not-recorded`（done）已把这条修对——记录**确实进来了**。
2. **不是 PSI 仪器坏了**：`suite-accounting.ts:325-335` `backfillFinalCpu` 的注释明写
   「PSI has no journal counterpart — it stays null (**honest; not fabricatable**)」，
   且 `reconstructed: true` 只作用于**末相**。单相轮的末相 = 唯一相 ⇒ **PSI 为 null 是设计中的诚实行为**。
   ⇒ **真正缺的是分相本身，PSI 缺失只是它的下游后果。**

**为什么要紧（代价已发生）**：分相记账是判断"某一相压力多大"的唯一生产读数。
历史读数显示 **`main` 相的 CPU 停滞占比中位 39.4%、最高 49.3%**（`psi_cpu_total / wall_ms`，
121 条 main 相样本，lanes ∈ {8,16}）。**2026-08-31 之后这个量再也拿不到**，
直接后果是 2026-09-06 两次时序敏感断言翻转（`gap-measure-suite-heavy-wait-ratio-load-sensitive-flaky`、
`gap-writestate-torn-read-assertion-load-sensitive-flaky`）**只能靠 `load average` 与隔离对照归因，
没有任何 PSI 证据可查**——而这正是分相记账当初要解决的问题。

**同族先例**：硬规则 4 推论三记的 `gap-phase-boundary-differential-accounting`
（status=done、AC 5/5 全勾、scoped 绿，而生产载体 167 轮含 `cpu_usec` 的 = 0）。
**本条是同一个量在【另一条执行路径】上再次失去载体**——那次是"落地后一轮没跑过"，
这次是"跑了，但换了路径后不再分相"。

## Acceptance Criteria

- [ ] 机械 fan-in 跑一轮全量后，该轮的 `verification-round.jsonl` 记录含 **≥3 个不同 `phase` 值**（至少 static + main + end），立案时取假（今天 37/37 单相）
- [ ] 其中 `main` 相的 `lanes` 与该轮 `full-suite-state.json` 的 `laneCount` 一致（不是 1）——立案时取假
- [ ] `main` 相的 `psi_cpu_total` 非 null（PSI 随分相自动恢复；⛔ 不得用推导值填充，缺就留 null 并报 `read_error`）
- [ ] 负控制：cgroup 不可读时该相仍写 `read_error` 且 PSI 保持 null，**不得静默产出结构完整的空记录**（硬规则 3b）
- [ ] 单相退化不再无声：若某轮只产出单相，记录里必须有可区分的字段说明原因，而不是与正常多相轮同形
- [ ] `bash scripts/test.sh --for-task gap-mechanical-fan-in-loses-per-phase-accounting` 退出 0

## Definition of Done

**验收对象是【生产载体里重新出现多相记录且 main 相带真实 PSI】，不是【代码里能产出分相】。**
在真实的机械 fan-in 轮之后读 `.quay/verification-round.jsonl`：
存在 ≥1 条**实现落地之后**写入的轮次，含 `main` 相、`lanes` 等于该轮真实泳道数、`psi_cpu_total` 非 null。
**反例判据**：把 fixture / `QUAY_TEST_CGROUP_SCRIPT` 注入缝关掉后本条仍成立，它才是测量。
仅单测绿而载体里仍是清一色单相 static ⇒ 不算完成。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/suite-accounting.ts
- plugin/scripts/worker-driver.ts
- plugin/test/suite-accounting.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-mechanical-fan-in-loses-per-phase-accounting.md
