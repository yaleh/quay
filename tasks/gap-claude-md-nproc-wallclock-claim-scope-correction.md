---
id: gap-claude-md-nproc-wallclock-claim-scope-correction
title: CLAUDE.md「nproc 是墙钟甜点/8 是 4.25× 超订」判据是 08-08 成本实验的 cancelled
  数非墙钟；同日墙钟数据(lane=8 783s vs lane=4
  1302s,−22%~−40%)指向相反——改适用范围(cancelled+墙钟两维度拆分,非删结论),衔接 lane 4 vs 8 对照实验
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**CLAUDE.md 里「nproc 是墙钟甜点 / 8 是 4.25× 超订」那条，判据是 2026-08-08 成本侧实验的 cancelled 数，不是墙钟；同日（08-08）墙钟数据指向相反方向（lane=8 中位 783s vs lane=4 1302s，−22%~−40%）——该改的是那条文档结论的适用范围，不是把结论删掉。**

### 实证（manager 2026-08-10 核实 + outer 复核）

- **CLAUDE.md 现行表述**：并发从硬编码 8 改为按 nproc 推导（8 workers 在 4 核 = 4.25× 超订 / 17 进程；08-08 成本实验实测并发 4 和 8 的 cancelled 均 0，「避免 cancel 需更高并发」被推翻）。
- **判据核实**：那条的判据是 **cancelled 数**（成本侧实验），不是墙钟。08-08 成本侧实验（`gap-dod-two-green-runs-and-over90-budget` AC1/AC3）测的是「避免 cancel 需要更高并发」被推翻——并发 4 和 8 的 cancelled 都是 0。
- **同日墙钟数据指向相反方向**：lane=8 同日（08-08）中位 **783s**（n=17）vs lane=4 **1302s**（n=2），全期 789 vs 1012，方向一致 **−22%~−40%**——墙钟上 lane=8 更快。
- **注意（勿当精确值）**：tests 字段在 213/141/3092/3152 间跳、套件内容在变（load-flake 标注、serial 相扩容都在改套件构成），所以 −22%~−40% 是方向性证据不是精确收益。
- **结论**：CLAUDE.md 那条把「cancelled 判据」写成了「墙钟甜点」——适用范围该改：cancelled 判据支持的是「避免 cancel 不需要更高并发」，墙钟判据（同日 08-08）指向 lane=8 更快。两者不冲突，是两个不同维度的结论。

**为什么重要**：文档结论的适用范围错了会导致后续决策用错判据——「nproc=4 是墙钟甜点」被当墙钟证据引用（本会话早前的并发证据讨论就因此反复），实际墙钟数据指向 lane=8。改适用范围后，决策者知道：cancelled 维度支持低并发，墙钟维度支持高并发，需要对照实验定取舍（gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2 已含 lane 4 vs 8 对照）。

### 选定机制方向（实现归内层，接法留执行时）

1. **改 CLAUDE.md 适用范围**：那条并发结论拆两个维度——cancelled 维度（08-08 成本实验：并发 4/8 cancelled 均 0，「避免 cancel 需更高并发」被推翻）与墙钟维度（同日 lane=8 中位 783s vs lane=4 1302s，−22%~−40%，方向性证据）。不再写「nproc 是墙钟甜点」。
2. **交叉标注**：与 gap-load-sensitive-serial-phase-unbounded-growth-measure-first（AC2 lane 4 vs 8 对照实验）衔接。

**验证锚**：修后 (a) CLAUDE.md 不再把 cancelled 判据写成墙钟甜点；(b) 两个维度分开表述；(c) 指向对照实验。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 CLAUDE.md 现行表述 + 判据核实（cancelled 非墙钟）+ 同日墙钟反方向数据（本任务 Proposal 已含）
- [x] AC2: **CLAUDE.md 适用范围修正**——并发结论拆 cancelled 维度 + 墙钟维度，不再写「nproc 是墙钟甜点」
- [x] AC3: **交叉标注**——衔接 gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2（lane 4 vs 8 对照）
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：CLAUDE.md 两维度表述贴任务体；cancelled/墙钟分离
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- CLAUDE.md（并发结论：cancelled 维度 + 墙钟维度拆分，去掉「nproc 是墙钟甜点」）
- tasks/gap-load-sensitive-serial-phase-unbounded-growth-measure-first.md（交叉标注——AC2 lane 4 vs 8 对照实验）
- tasks/gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible.md（交叉标注——成本侧实验源）
- tasks/gap-suite-concurrency-4-vs-8-measurement.md（交叉标注——并发测量族）
- tasks/gap-claude-md-nproc-wallclock-claim-scope-correction.md（自身：勾 AC + 贴证据）

## Contract

measure   nproc_wallclock_claim_removed = `grep -c "nproc 是墙钟甜点\|nproc.*墙钟" CLAUDE.md` 的 stdout 数字
band      nproc_wallclock_claim_removed = 0（不再把 cancelled 判据写成墙钟甜点）
invariant cancelled_and_wallclock_separated = 1（两维度分开表述）
invariant points_to_controlled_experiment = 1（衔接 AC2 lane 4 vs 8 对照）
invoke    `grep -n "cancelled\|墙钟\|nproc\|并发" CLAUDE.md | head -10`（贴修后表述）
control   cancelled/墙钟分离；不再写墙钟甜点；指向对照实验
resume    CLAUDE.md 适用范围修正分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 裁定——CLAUDE.md「nproc 是墙钟甜点/8 是 4.25× 超订」判据是 08-08 成本实验的 cancelled 数非墙钟；同日墙钟数据（lane=8 783s vs lane=4 1302s）指向相反。该改适用范围（cancelled 维度 + 墙钟维度拆分）非删结论。立案。实现归内层

## Evidence（内层实现 2026-08-10）

**AC2 适用范围修正**：claim 现位于 `scripts/test.sh` 头注释（CLAUDE.md 已 trim 为指向 test.sh 正本的指针结构）——两处「concurrency = nproc is the wall-clock sweet spot」改为**双维度拆分**：
- **CANCELLED 维度**：08-08 成本实验并发 1/4/8 cancelled 全 0，推翻「避免 cancel 需更高并发」——这是推导（默认=nproc）的判据。
- **墙钟维度（独立轴）**：selected set c4 最快（24s vs c1 57.5s / c8 27.3s），但外层全量 laneCount-8 轮墙钟更快（中位 ~783s vs lane-4 ~1302s，−22%~−40%，方向性——套件构成在变）；两处均明确「不以 nproc=墙钟甜点作为推导判据」，指向 `gap-load-sensitive-serial-phase-unbounded-growth-measure-first` AC2 的 lane 4 vs 8 对照。

**AC3 交叉标注**：两处注释均注明衔接 measure-first AC2 对照实验。

**AC4 scoped 门绿**：`bash scripts/test.sh --for-task gap-claude-md-nproc-wallclock-claim-scope-correction --allow-thin` → exit 0。
