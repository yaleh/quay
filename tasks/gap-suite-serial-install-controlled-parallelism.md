---
id: gap-suite-serial-install-controlled-parallelism
title: 串行 install 家族受控并行——serial_concurrency 1→2-4 作对照实验（预期 2-4× 墙降）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

最慢单文件 = quay-init-loop-runtime 208s（16 test / 20 次真运行·拷贝）/ quay-init-loop 143s（8 test / 7 runInit）/ quay-init-loop-driver 130s（17 test / 4 runInit）/ npm-pack-e2e 115s / install-config-e2e-upgrade 107s。install 家族 ~700s 串行是墙的主要构成。`serial_concurrency` 旋钮已存在（suite-params.ts:42，QUAY_SERIAL_CONCURRENCY，schema int≥1，默认 1）；install 家族已收编 concurrency-1 serial 相（known-load-sensitive.ts:52）。方案 = config 里 serial_concurrency 从 1 提到 2-4 作受控实验（同 QUERY_MAIN_TAIL_OVERLAP 模式：对照轮 + 墙读 + flake 门），预期 2-4× 墙降（~700s→~175-350s）。

**风险**：serial_concurrency 全局影响 A/B-class（nested-suite-spawn）→ 并行资源爆炸风险。缓解：flake 门拦截；若 A/B-class 真 flake 则第二阶段收窄作用域（A2：install 家族 per-file 并发上限）。

## Plan

1. config 里 serial_concurrency 提到 2（起步值，人确认 A1 全局先试），作对照轮 + 墙读 + flake 门。

## Acceptance Criteria

- [ ] AC1（能取假）：serial_phase_ms 在 QUAY_SERIAL_CONCURRENCY=2 下 vs 基线(1) 有可测墙降（目标 2-4×）；（⛔ 无墙降 ⇒ 假）。
- [ ] AC2（能取假，无 flake）：并行后无新增 flake——全量 suite 绿 + @load-sensitive 家族 ≥3 轮对照零退出（或 flake 率≤基线）；（⛔ 新增 flake ⇒ 假）。
- [ ] AC3（能取假）：完整 suite 绿（落地后真实一轮）。
- [ ] AC4（能取假，回滚）：unset QUAY_SERIAL_CONCURRENCY → 回 1（one-key rollback）。

## Definition of Done

选定值落 config；对照墙降 + flake 门读数；真实一轮全量 suite 绿。

## Touches

- .quay/config.yml（serial_concurrency 提升）
- plugin/scripts/suite-params.ts（如需 A2 收窄）
- plugin/scripts/known-load-sensitive.ts（如需收窄作用域）
- tasks/gap-suite-serial-install-controlled-parallelism.md（自身）
