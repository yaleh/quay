---
id: gap-worker-driver-governance-self-skip-missing
title: 5 个重 governance 文件改标 lowconc（gap-retire-governance-group-merge-into-bucket 的 AC2 子集）——主池不再裸跑 ~1080s lane-time；不加守卫、不建机械检查
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

**原版（给 5 个文件加自跳守卫 + 机械强制「governance 文件必带守卫」）已退役方向**：与人 2026-08-25 逐字裁定「不要在 bucket 和相机制以外再搞一套」、及 `gap-retire-governance-group-merge-into-bucket`（AC1 删 39 段守卫、AC2 改标真实相）**方向相反**——「governance 自跳」正是那第三套选择机制，且永久机械检查会把要退役的机制铸成常设件。本任务**收窄为 A 的 AC2 子集**：5 个重文件改标 `@test-group lowconc`（负载敏感 → 低并发相），**不加守卫、不建检查**；A 落地时其 142 文件重分类覆盖本 5 文件，二者不冲突、B 被吸收。

实测（verification-round.jsonl 最近 8 轮聚合）：5 个重 governance 文件全部无 `QUAY_TEST_GROUPS` 守卫（逐一 grep 核实，QUAY_TEST_GROUPS=0）⇒ 每轮默认套件在 main 池满并发裸跑——

| 文件 | avg/轮 | 角色 |
|---|---|---|
| plugin/test/full-suite-runner.test.mjs | **396s（全套件 #1）** | 嵌套真实 runner + fake-suite |
| plugin/test/worker-driver.test.mjs | 208s | driver spawn + wall-clock seam |
| plugin/test/test-file-snapshot.test.mjs | 195s | 文件快照 |
| plugin/test/verify-deliver-coldstart.test.mjs | 145s | 冷启动验证 |
| plugin/test/slot-refill.test.mjs | 138s | slot 派发 |

合计 ~1080s lane-time/轮全挤在 main 相（lanes 16）；full-suite-runner.test.mjs 396s 是每轮 main 相关键路径主项。今天两 flake 根（worker-driver / full-suite-runner）即「本该隔离却在主池裸跑」。改标 lowconc ⇒ 移出默认集（product,engine+governance）与 main 池，进 lowconc 相（并发 3）——**flake 根消、main 相卸重，方向与 A AC2 一致**。⛔ 口径：这不省总墙钟（文件仍每轮跑，只是换相）；省的是 main 相关键路径与负载隔离。「省时间」属 A 的 900s 预算触发「测试优化」的载荷（install-cache / LPT / metadata-spawn 等），不是本任务。

## Plan

1. 5 文件头部 `// @test-group governance` → `// @test-group lowconc`（负载敏感 → 低并发相；child-spawn 族优先 lowconc 而非 serial——同 A「关系与前置」的测量结论）。
2. ⛔ **不加** `QUAY_TEST_GROUPS` 自跳守卫、**不建**「governance 必带守卫」机械检查（与 A 退役方向冲突，人裁「不在 bucket 和相机制以外再搞一套」）。
3. 已知负载敏感登记保留：文件既已 `@load-sensitive` / KNOWN-LOAD-SENSITIVE 的标记不撤（known-load-sensitive 闸只对 serial 族要求 entry，lowconc 族不 gate entry）。
4. 负控制：默认 {product,engine} 轮 5 文件不再出现于 main 池；`--group lowconc` 或显式文件列表仍全跑。
5. 关系标注：本任务 = `gap-retire-governance-group-merge-into-bucket` 的 AC2 子集先行；A 实现前须在本任务落地后重取计数/相分布（A 的 AC4 已含此前置）。

## Acceptance Criteria

- [x] AC1（能取假）：5 文件 `@test-group` 从 governance 改为 lowconc（逐文件 grep 核 5 文件）；（⛔ 仍标 governance ⇒ 假）。
- [x] AC2（能取假，负控制）：`--group lowconc` 或显式文件列表调用时 5 文件仍全跑（改标不挡显式请求）。
- [x] AC3（能取假，无守卫/无机械检查）：5 文件**不新增** QUAY_TEST_GROUPS 自跳守卫；无新增「governance 必带守卫」机械检查（grep runner-grouping.ts / checker 无 governance 守卫强制）；（⛔ 仍有守卫或新检查 ⇒ 假）。
- [ ] AC4（测量，AC2 纪律）：同 selected set 前后对照——修后 main_phase_ms 下降（396s 文件离开 main 关键路径）、lowconc_phase_ms 相应上升、0-cancelled。（待外部）

## Definition of Done

5 个重文件改标 lowconc、移出 main 池裸跑；无守卫、无 governance 守卫机械检查；显式运行不受影响；方向与 `gap-retire-governance-group-merge-into-bucket`（AC2 子集）一致，A 落地时被吸收、无冲突。

## Touches

- plugin/test/full-suite-runner.test.mjs（@test-group → lowconc）
- plugin/test/worker-driver.test.mjs（@test-group → lowconc）
- plugin/test/test-file-snapshot.test.mjs（@test-group → lowconc）
- plugin/test/verify-deliver-coldstart.test.mjs（@test-group → lowconc）
- plugin/test/slot-refill.test.mjs（@test-group → lowconc）
- tasks/gap-worker-driver-governance-self-skip-missing.md（自身）
