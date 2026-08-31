---
id: gap-suite-main-overlaps-load-sensitive-tail-experiment
title: main 相提前启动吸收 serial+lowconc 尾部空转——受控实验（重叠并发档位 × 固定 QUAY_PHASE_OVERLAP × flake 率判据）
status: ready
labels: [gap]
type: execution
---

## Proposal

**现象（director 2026-08-30 负载曲线实测）**：全量轮顺序 `static → serial+lowconc(重叠窗口) → main → end`，serial+lowconc 窗口有 **~130s 近空转尾部**。round 748 实测：窗口 48 采样中 23 个 stall<3%、loadavg 掉回 ~4（窗口地板由 full-suite-runner.test.mjs 211s + quay-init 安装族卡住，是 latency-bound 等待非 CPU 活）；整轮 613s 中 ~150s（24%）stall≈0。此时机器全空而 main 的 CPU 活在排队等窗口关。

**假设**：让 main 在窗口尾部提前启动（限流并发，使总负载 ≤ 目标档位），能吸收空转、缩短绿轮墙钟，且不 reintroduce serial/lowconc 相 flake。

**风险边界（必须先实验、不得直接上生产）**：round 160-162 轮转 flake 实证——serial/lowconc 被移出 main 正因它在 full-suite 负载下 flake（gap-full-suite-runner-test-poll-timeout-load-flake：full-suite-runner.test.mjs 在 load 11.81 / 16 lanes 下轮询超时）。重叠把 main 负载叠加上去有 reintroduce flake 的真实风险。

**实验设计**：
- **独立变量**：main 与窗口尾部重叠时的并发档位（新旋钮 `QUERY_MAIN_TAIL_OVERLAP=<lanes>`，0=现状顺序=基线）。档位 0/4/8/12。每档观测**总系统负载**（负载曲线 loadavg/cpu_stall）。
- **控制变量**：`QUAY_PHASE_OVERLAP` 固定 =1（生产默认）并每轮记录；concurrentSuiteSlots 固定 =1（生产现状）；同任务同 worktree 同文件集。
- **响应变量**：(a) serial+lowconc 相 flake 率 = 该相 fail+cancelled 文件数/轮（从 verification-round.jsonl + measure-history.jsonl 数）；(b) 整轮 wall-clock（verification-round durationMs）；(c) 空转段长度（负载曲线 stall<3% 采样数，应随重叠缩短）。
- **判据**：某档若 flake 率相对 0 档基线增量为 0 且 wall-clock 中位下降 ≥15% → 可行；任一档出现可归因于重叠负载的 fail/cancelled → 该档否决；全部否决 → 结论「不可行 + 理由」落档收尾。
- **启动时机机制二选一（实现定，AC1 只要求存在且可复现）**：(i) 固定延迟启动；(ii) 负载触发（窗口 stall 掉到阈值下持续 N 秒后启动 main）。

**与既有任务区分**：gap-suite-longtail-single-file-floor（done）= 相内单文件地板，不同杠杆；gap-phase-overlap-two-phase-parallel-exploration（done）= serial+lowconc 两相重叠，本任务是它的延伸（main×尾部）；gap-resource-gate-no-single-flight-lock-two-suite-overlap = 两套件重叠，不同。

## Plan

1. scripts/test.sh 加 env-gated 旋钮 `QUERY_MAIN_TAIL_OVERLAP`（默认 0=现状；>0 时 main 相在窗口 CPU 活结束后以该并发提前启动，与剩余 latency-bound 测试重叠）。档位→总负载换算复用 `serial_lowconc_host_default` 式宿主推导，避免字面量（硬规则 4 推论二）。
2. full-suite-runner.ts：verification-round 记录 `main_tail_overlap_lanes` + 观测总负载，保证每档可审计。
3. 跑对照轮：档位 0/4/8/12 × QUAY_PHASE_OVERLAP=1 固定，每档 ≥2 轮（同任务同 worktree）。**代价估算：每轮 ~10min，4 档 ×2 轮 ≈ 8 轮 ≈ 90min 套件时间（且受 fan-in 单飞锁串行）——实现前先确认时间窗。**
4. 数 AC3 读数、落 AC4 结论。

> **实现状态（worker 落地 2026-08-31，对照实验未跑）**：`QUERY_MAIN_TAIL_OVERLAP` 旋钮已实现——scripts/test.sh 负载触发（cpu_stall ≤3% 持续 5s 即提前启动 main，档位=该并发；0/unset=现状基线；窗口关闭或 300s 上限自动回落正常 main）；full-suite-runner.ts 读 test.sh 的 `main-tail-overlap: lanes=N load=X` 流标记，落 `main_tail_overlap_lanes`/`main_tail_overlap_load` 进 verification-round。hermetic 已验：`bash -n`、`suite-lpt-order.test.mjs` AC1 pin 19/19、wait 函数 seam（fire/fallthrough 双向）、tail-overlap 记录测试 + 基线负控制、overlap 回归 6/6 绿。
> **待跑对照（AC1 实测一档 + AC2/AC3/AC4）**：`QUERY_MAIN_TAIL_OVERLAP=<0|4|8|12> QUAY_PHASE_OVERLAP=1 bash scripts/test.sh`，每档 ≥2 轮；从 verification-round.jsonl + measure-history.jsonl 数 flake 率与 wall-clock 中位数；结论写回 AC4。AC 均未勾、逐项标注「（待外部）」——旋钮默认 0=inert（落地即现状），对照实验是落地后的外层验证。

## Acceptance Criteria

- [ ] AC1（能取假，接线）：`QUERY_MAIN_TAIL_OVERLAP` 旋钮存在且生效——设 >0 时 main 在窗口关闭前以指定并发提前启动（grep scripts/test.sh 可见实现；实测一档证明 main 与 serial+lowconc 时间窗重叠）；设 0 时行为与现状一致。 （待外部）
- [ ] AC2（能取假，控制变量）：对照轮固定 `QUAY_PHASE_OVERLAP`=1——verification-round 的 phase_overlap 字段全部实验轮同一值；concurrentSuiteSlots 全程 =1。 （待外部）
- [ ] AC3（能取假，生产载体 flake 率判据，硬规则 4 推论三）：实现落地后时间窗内，每档 serial+lowconc 相 flake 率（fail+cancelled 文件数/轮）与 wall-clock 中位数从 verification-round.jsonl + measure-history.jsonl 数出，N 只计落地后轮次；任务体给「档位 → 总负载 → flake 率 → wall-clock」对照表。 （待外部）
- [ ] AC4（能取假，结论落档）：结论写回任务体——「档位 X 可行：节省 Ys (Z%) + flake 增量 W」或「全部否决 + 归因理由」；引用 AC3 实际读数（非空口）。 （待外部）

## Definition of Done

旋钮实现 + 4 档 ×≥2 轮对照跑完；AC1-AC4 全勾；结论落档（附档位→负载→flake→墙钟表）；若某档可行，给出推荐生产档位与 rollout 建议。

## Touches

- scripts/test.sh（`QUERY_MAIN_TAIL_OVERLAP` 旋钮 + main 提前启动/限流）
- plugin/scripts/full-suite-runner.ts（verification-round 记录重叠档位/负载字段）
- plugin/test/full-suite-runner.test.mjs（main_tail_overlap_lanes/load 记录路径 + 基线负控制）
- tasks/gap-suite-main-overlaps-load-sensitive-tail-experiment.md（自身）
