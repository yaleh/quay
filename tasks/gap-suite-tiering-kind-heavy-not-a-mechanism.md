---
id: gap-suite-tiering-kind-heavy-not-a-mechanism
title: "泳道分级破口——known-load-sensitive kind=heavy 是兜底桶非机制陈述（serial 24 成员 16 个 kind=heavy，lowconc→serial 9 文件 8 heavy+1 child-spawn，无一命中 serial 的机制判据 nested-spawn/wall-clock）；--check-exit 只验填没填不验理由是否命中本泳道 kind 集（格式闸非分级闸）⇒ 给 heavy 真机制定义（真安装/真 npm pack、进程与 IO 放大 N×）+ 不满足回 lowconc + --check-exit 升级为分级闸"
status: todo
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**泳道分级原则是【按机制，不按症状】——serial 的不变式是【脱离主池/不放大进程】（REAL-INSTALL install/quay-init 族 + nested-suite-spawn + real-wall-clock-wait），不是【互斥】；lowconc = hermetic-but-load-sensitive session-observation 族。破口：`known-load-sensitive` 的 kind 有四个取值，`nested-spawn/child-spawn/wall-clock` 都是机制陈述，而 `heavy` 不是——它是「慢/曾 flake」的兜底桶。serial 24 个成员里 16 个 kind=heavy（三分之二），lowconc 降进 serial 的那 9 个文件 8 heavy+1 child-spawn，没有一个命中 serial 最初的机制判据。**

### 实证（manager 2026-08-11 03:2x/03:4x 交叉表 + outer 复核）

- **kind 四取值**：`nested-spawn` / `child-spawn` / `wall-clock` 是机制陈述；`heavy` 是「慢/曾 flake」兜底桶——不满足「按机制」原则。
- **serial 24 成员**：16 个 kind=heavy（三分之二），nested-spawn 仅 2、wall-clock 仅 1。
- **lowconc→serial 降级 9 文件**：8 heavy + 1 child-spawn，**没有一个是 nested-spawn 或 wall-clock，即没有一个符合 serial 最初的机制判据**。
- **3 个 serial 成员 + 10 个 lowconc 成员根本没有 kind 声明**：带组标注但不在族里，进入理由不可核。
- **单向棘轮成因**：`--check-exit` 校验的是【有没有填进入原因】而不是【这个理由是否命中本泳道的 kind 集合】——它是**格式闸不是分级闸**：降级成本=加一个标注、上行成本=整轮套件重跑 ⇒ 只进不出。
- **为什么重要（对硬件决策）**：**不做杠杆 3，加机器收益封顶**——serial 相在 conc=2 下与核数无关恒 620s ⇒ K=8 全套仅 -19%、K=16 仅 -29%，serial 占比升到 57%。做完三条杠杆后 K=8 ≈590s、K=16 ≈310s。**分级修复是解锁硬件的前提，不是可选项。**

### 选定机制方向（实现归 inner，判定归 outer）

1. **给 heavy 真正的机制定义**：如【真安装/真 npm pack】或【进程与 IO 放大 N×】——用机制陈述替代「慢/曾 flake」兜底。命中机制判据才留在 serial；不满足的**回 lowconc/main**。
2. **补缺省 kind**：无 kind 声明的 serial/lowconc 成员（3+10）要么标机制 kind、要么按机制判据重分泳道——进入理由可核。
3. **--check-exit 升级为分级闸**：从【填没填理由】升级为【理由是否命中本泳道的 kind 集合】——降级不再只靠加一个标注，必须命中机制判据；不命中 ⇒ FAIL-closed 拒收。

**验证锚**：修后 (a) serial 成员全部命中机制 kind（nested-spawn/wall-clock/REAL-INSTALL/放大 N×），无 kind=heavy 兜底；(b) lowconc→serial 降级的 9 文件按机制判据重分（8 heavy 多数应回 lowconc）；(c) `--check-exit` 对不命中 kind 集合的降级 FAIL；(d) `--for-task` scoped 门绿；(e) serial 相 sum 下降（重分后）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 kind 四取值 + serial 24 成员 16 heavy + lowconc→serial 9 文件无一命中机制判据 + 3/10 无 kind 声明 + --check-exit 格式闸非分级闸（本任务 Proposal 已含）
- [ ] AC2: **heavy 给机制定义**——kind=heavy 改为机制陈述（真安装/真 npm pack/放大 N×），serial 成员全部命中机制判据
- [ ] AC3: **不满足回 lowconc**——lowconc→serial 降级 9 文件按机制判据重分（8 heavy 多数回 lowconc），serial 相 sum 下降
- [ ] AC4: **--check-exit 升级分级闸**——校验理由命中本泳道 kind 集合；不命中 FAIL-closed 拒收
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；全量套件绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：serial 成员 kind 分布贴出（heavy 清零或全为机制 kind）；--check-exit 对不命中判据的降级 FAIL
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/known-load-sensitive.ts（kind=heavy 机制定义 + 缺省 kind 补齐）
- plugin/scripts/known-load-sensitive.test.mjs（新增 kind 判据测试）
- plugin/scripts/ 或 scripts/test.sh（--check-exit 从格式闸升级为分级闸）
- plugin/test/ 各泳道成员（重分 kind 标注）
- tasks/gap-suite-tiering-kind-heavy-not-a-mechanism.md（自身：勾 AC + 贴证据）

## Contract

measure   serial_kind_heavy_count = `grep -rE '@load-sensitive heavy' plugin/test/ experiments/quay-perpetual-stream/test/ 2>/dev/null | wc -l` 的 stdout 数字
band      serial_kind_heavy_count = 0（serial 成员无 kind=heavy 兜底，全部机制 kind）
invariant check_exit_validates_kind_set = 1（--check-exit 校验理由命中本泳道 kind 集合，FAIL-closed）
invariant downgraded_reevaluated = 1（lowconc→serial 降级文件按机制判据重分）
invoke    `grep -rE '@load-sensitive (heavy|nested-spawn|child-spawn|wall-clock)' plugin/test/ experiments/quay-perpetual-stream/test/ 2>/dev/null | sort | head -40`（贴 kind 分布）
control   heavy 清零或全机制；--check-exit 分级闸；降级重分；既有不回归
resume    kind 定义 / 重分 / --check-exit 升级 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人指示应用三条杠杆；manager 03:2x（分级原则正本 + 破口）+ 03:4x（硬件决策：不做分级修复加机器收益封顶）。杠杆 3 = kind=heavy 真机制定义 + --check-exit 升级分级闸。实现归 inner，判定归 outer
