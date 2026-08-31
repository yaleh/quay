---
id: gap-suite-split-full-suite-runner-lowconc-floor
title: lowconc 相单文件地板 211s（full-suite-runner.test.mjs）——拆 3 文件打破地板（每轮省 ~60-90s）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象**：全量轮重叠窗口（round 745/746/748 的 overlap_sub_ms 实测）瓶颈是 **lowconc（239-349s），serial 只占 111-123s**。按先例公式「每相墙钟 = max(sum÷并发, 最长单文件)」（gap-suite-floor-two-longest-files-bound），lowconc 地板 = **full-suite-runner.test.mjs 211s 封顶**（sum≈1202s，sum÷8=150s < 211s ⇒ 单文件封顶）。

**先例（同方向已执行成功）**：gap-suite-floor-two-longest-files-bound 已验证「拆最长文件打破单文件地板」杠杆（runner-grouping 204→51s，nested-spawn 族——安装夹具救不了，只能拆）；gap-suite-split-long-multi-test-files AC1 判定「可拆」类 = node:test 多独立 test、各 test 独立 tmp tag、无跨 test 可变状态。**full-suite-runner.test.mjs 176 test 全属可拆类**：每 test 自有 mkdtemp root + fake-suite bash，唯一 after() 只清 _runnerLockDirs，无 sharedFixture/install（director 2026-08-30 已逐一核实，与 serial 安装族 quay-init-loop-* 的共享环境不同）。

**收益修正（floor 公式，诚实下调）**：拆 full-suite-runner 3 份（各 ~70s）→ 最长变 worker-driver 132s < 150s ⇒ lowconc 地板 211 → **~150s（sum 封顶接管），省 ~60-90s/轮（10-15%）**。再拆 worker-driver 无额外收益（sum 封顶已接管）。与 main 相「拆文件只值 2.8%」（split-long-multi-test-files ④）不矛盾：main 是 16 lane sum 封顶，lowconc 是单文件封顶。

**边界**：full-suite-runner.test.mjs 是 KNOWN-LOAD-SENSITIVE child-spawn（nested-suite-spawn，spawn 真实 full-suite-runner.ts + fake-suite）。拆后各文件仍 spawn runner 子进程 ⇒ **保持 @test-group lowconc + @load-sensitive 标注逐文件保留**（同 runner-grouping 先例）；3 文件低并发并行会略增并发 spawn 数，flake 率须在 AC3 验证（fail=0）。

## Plan

1. 抽 harness（fakeSuite / runRunner / waitExit / poll / readState / GREEN_SUITE / PHASE_SUITE / _runnerLockDirs 清理）到 `plugin/test/helpers/full-suite-runner-harness.mjs`（先例：helpers/ 已有多模块，单一来源防 drift）。
2. 按区段拆 3 文件：`full-suite-runner.test.mjs`（~60 test）+ `full-suite-runner-phases.test.mjs` + `full-suite-runner-cgroup.test.mjs`，各标 `@test-group lowconc` + `@load-sensitive`，test 体逐字保真。
3. 每文件独立跑绿 + scoped 直跑 176 tests 全绿 + 全量 suite 绿（pass/fail-neutral 验证，同先例 AC3）。

## Acceptance Criteria

- [ ] AC1（能取假，接线/可拆类判定）：harness 抽到共享 helper 模块（定义唯一处，grep 各拆分文件只有 import 引用）；3 个拆分文件各标 `@test-group lowconc` + `@load-sensitive`；原 full-suite-runner.test.mjs 删除。
- [ ] AC2（能取假，pass/fail-neutral）：拆分后 test 体逐字保真（diff 或断言计数相等）——3 文件合计 test 数 = 拆前 176；scoped 直跑 pass 全绿、fail 0。
- [ ] AC3（能取假，生产载体地板下降 + 无 flake，硬规则 4 推论三）：实现落地后时间窗内，全量轮 lowconc 相地板（verification-round overlap_sub_ms 的 lowconc_ms / measure-history 最长文件）从生产载体数出，N 只计落地后轮次；lowconc_ms ≤ 160s 且对应轮 fail=0 / cancelled=0。
- [ ] AC4（能取假，防 drift）：helper 抽取后全仓无第二份副本（grep full-suite-runner-harness 定义仅一处）；known-load-sensitive / 相关引用路径更新无 stale。

## Definition of Done

拆 3 文件 + harness 抽取落地；AC1-AC4 全勾；全量 suite 绿（fail 0 / cancelled 0）；lowconc 地板 211→~150s 的实测读数（落地后轮次）落档。

## Touches

- plugin/test/full-suite-runner.test.mjs（删，拆 3）
- plugin/test/helpers/full-suite-runner-harness.mjs（新，harness 单一来源）
- plugin/test/full-suite-runner-phases.test.mjs（新，@test-group lowconc）
- plugin/test/full-suite-runner-cgroup.test.mjs（新，@test-group lowconc）
- plugin/test/known-load-sensitive.test.mjs（如引用旧路径则更新）
- tasks/gap-suite-split-full-suite-runner-lowconc-floor.md（自身）
