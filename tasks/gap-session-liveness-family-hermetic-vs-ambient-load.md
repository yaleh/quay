---
id: gap-session-liveness-family-hermetic-vs-ambient-load
title: session-liveness 家族 hermetic 化（消 lowconc 并发天花板）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
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

- [ ] AC1: session-liveness 家族在 conc 8/10/12 全过（lowconc 天花板消失）
- [ ] AC2: 测试断言不变（无弱化——原断言全保留）
- [ ] AC3: 全量套件绿 + 总耗时下降（verification-round 对比）
- [ ] AC4: 新测试/现有测试覆盖；`--for-task` scoped 门绿
- [ ] AC5: 与 ac36-sortkey 的 hermetic 手法一致（同族可复用）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] hermetic 化后 conc 8/10/12 实跑结果贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证
