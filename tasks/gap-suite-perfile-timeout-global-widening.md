---
id: gap-suite-perfile-timeout-global-widening
title: 并发 16 核下 perfile-timeout 60s 系统性偏紧——统一放宽 + slow-test 异常守卫（防掩盖真回归）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

flaky 集群 10 组中超时类（runner-grouping 78s、session-liveness 260s）根是**同一个**：并发 16 核下测试超 60s perfile-timeout 阈值。逐条加超时/拆分/白名单是治标（whack-a-mole，已 10 组）。

**⛔ 关键约束（硬规则 4）**：统一放宽不是「放弃慢测试信号」——perfile-timeout 是一个【测量】（慢测试 = 真回归信号，如 O(n²) bug）。放宽到容纳任何负载 = 恒真 = 不是测量。正确形态是**双层阈值**：
- 下层（放宽）：perfile-timeout 从 60s → 容纳已知慢测试的量级（如 300s），消并发噪声；
- 上层（异常守卫）：新增一个更高阈值（如 >10min 或相对基线 N 倍），慢到异常量级仍报红（真回归仍被抓）。

**另评估**：是否系统性降并发度（16 → 更小），从根上减并发对时序/资源假设的破坏（与放宽阈值是互补两向）。

## Plan

1. 测各超时 flaky 文件的真实 duration 分布（runner-grouping 78s / session-liveness 260s 等），定下层放宽阈值下限。
2. 放宽 perfile-timeout 下层阈值（60s → 已知慢测试量级）。
3. 加上层 slow-test 异常守卫（更高阈值/相对基线 N 倍），真慢回归仍报红。
4. 评估并发度（可选）：降并发 vs 放宽阈值的取舍，实测墙钟与稳定性。

## Acceptance Criteria

- [ ] AC1（能取假，下层放宽）：并发 load 下已知慢测试（runner-grouping / session-liveness）不再 perfile-timeout 判 failed；（⛔ 仍 failed ⇒ 假）。
- [ ] AC2（能取假，上层守卫）：构造一个「慢到异常量级」的测试（如注入 10min 睡眠），上层守卫仍报红——放宽不掩盖真回归；（⛔ 真慢回归被放过 ⇒ 假，硬规则 4）。

## Definition of Done

perfile-timeout 双层阈值（下层放宽 + 上层守卫）落地；AC1/AC2 勾；已知慢测试并发下绿、真慢回归仍红；全量 suite 绿；并发度评估有结论。

## Touches

- plugin/scripts/full-suite-runner.ts（perfile-timeout 双层阈值）
- tasks/gap-suite-perfile-timeout-global-widening.md（自身）
