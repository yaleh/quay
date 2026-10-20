---
id: gap-full-suite-runner-ac4-wallclock-noise-envelope
title: full-suite-runner AC4：on/off 墙钟差在 fan-in 负载下 1.86% > 1% ⇒
  采样与噪声容限按实测收紧（instrument 腿仍守 1%）
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

`plugin/test/full-suite-runner-cgroup.test.mjs:586-649` 的 AC4 有两条腿：

- instrument 腿：`samplerCostMs / minOn <= 1%` —— 采样器自身成本的权威读数；
- 墙钟 A/B 腿：`(minOn - minOff) / minOff <= 1%` —— 受调度噪声支配。

2026-10-19 fan-in 读数为墙钟腿 **1.86%**（54.1 s），instrument 腿远低于 1%：

```
✖ AC4 — the sampler's own cost stays under 1% of the suite wall ... (54139.011045ms)
  AssertionError: the on/off wall-clock delta is within the 1% budget (measured 1.86%)
```

同一文件在 Ready 任务 `gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host` 的干净 Round 3 里 `fail 0`，证明这是负载敏感 flake，不是固定回归。AC-237 已把每臂样本从 2 提到 3，仍不够。

修复方向（实现时二选一，用实测分布定参）：

- 每臂 5 个交替样本 + 取 min；或
- instrument 腿保持 1% 硬上限；墙钟腿引入具名噪声容限（例如 `deltaPct <= max(1%, 2 × 实测空载噪声)`），并把实测分布写进 Evidence。

⛔ 不是无证据地把 1% 抬大了事；必须保留一条「可控地让 instrument 读数 >1% ⇒ 测试仍红」的负控制，证明修法没有把判据变空。

本任务只处理 fan-in/服务 cgroup 下的墙钟腿。8 GiB 会话 cgroup 下另外 5 条宿主形状用例（AC1/AC2/AC3/AC3-DoD/REAL control）是环境前提问题，不是 fan-in 的阻断签名，另案处理，不计入本条。

## Plan

1. 在 fan-in/服务 cgroup（无 8 GiB 会话上限）下复测 AC4，记录 3 次墙钟腿读数与 instrument 读数。
2. 按实测选择 5 样本或具名噪声容限；改动只落在 AC4 的采样/断言，不动其它用例。
3. 加负控制：用可控 fixture 让 `samplerCostMs` 超过预算 ⇒ instrument 腿必须红。
4. 在 fan-in 环境重复跑 3 次，确认墙钟腿不再红。

## Acceptance Criteria

- [ ] AC1 — fan-in 环境（服务 cgroup）下 `node --test plugin/test/full-suite-runner-cgroup.test.mjs` 的 AC4 通过；附 3 次墙钟腿与 instrument 腿读数。
- [ ] AC2 — instrument 腿仍为 1% 硬上限：`costPct <= 1` 的断言保留，且实测值随输出打印。
- [ ] AC3 — 负控制：可控地让 instrument 读数 >1% ⇒ 测试 exit 非 0，附失败断言原文；恢复后复绿。
- [ ] AC4 — 墙钟腿的容限来自实测：Evidence 里给出空载/负载两组分布与所选参数；不是任意常数。
- [ ] AC5 — 同文件其余用例零回归（fan-in 环境下 70/70；8 GiB 会话下那 5 条宿主形状用例另案处理，不计入本条）。

## Definition of Done

fan-in 负载下 AC4 不再是确定性阻断：连续 3 次运行墙钟腿不红，instrument 腿仍能对真实超预算取假；该文件从 fan-in 的 added-red 集合里消失，两条 needs-human 可被 retreat 重试。

## Touches

- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-full-suite-runner-ac4-wallclock-noise-envelope.md
