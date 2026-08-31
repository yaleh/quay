---
id: gap-suite-main-tail-overlap-bucket-subset
title: main-tail-overlap 接到 bucket 子集路径（--buckets P/M 分支）——lowconc 相尾部提前启动 main
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

**现象**：`QUERY_MAIN_TAIL_OVERLAP`（gap-suite-main-overlaps-load-sensitive-tail-experiment，A）只在全量路径（test.sh `run_selected` 的 overlap 分支 :1128-1202）实现；**bucket 子集路径**（--buckets 的 P/M 分支，test.sh:1690-1713）是顺序相（serial → lowconc → main），无 overlap 窗口，**未接 main-tail-overlap**。director 2026-08-31 实测 round 774（bucket 子集 tests 3679）：lowconc 相 106s（session-liveness-scd-* 等 wall-clock 等待）负载低、stall 低，main 本可在此段提前启动吸收空转，但 A 未生效（`main_tail_overlap_lanes=None`）。

**接法（复用现有机制，零新机制）**：bucket 子集路径在 `bucket_lowconc` 启动后（记录 pid）→ `bucket_main` 启动前（test.sh:1708），复用 `main_tail_overlap_wait`（监视 lowconc pid 存活 + stall≤3% 持续 5s → main 提前以 `QUERY_MAIN_TAIL_OVERLAP` lanes 启动；lowconc 退出 / 300s 超时回落正常）。触发从全量的「serial+lowconc 重叠窗口尾部」**简化为「lowconc 相尾部」**（bucket 子集无 overlap 窗口）。bucket_main 已 LPT，提前启动复用同一 LPT 序。

**收益**：round 774 量级（lowconc 106s + main 170s @ cpu 2269s）：lowconc 尾部提前 ~40-60s 启动 main，扣 12-lane 限流损失 ~19s ≈ **净省 ~20-30s/轮**。`bucket_full=1`（hub/no-bucket）走 `run_selected`（已有 A），不受影响。

**与全量路径关系**：同一旋钮 `QUERY_MAIN_TAIL_OVERLAP`、同一 watcher 函数，只加 bucket 子集调用点。pass/fail-neutral（只改 main 启动时机，不改测试集/断言）。

## Plan

1. test.sh bucket 子集分支：`bucket_lowconc` 启动后记 lowconc_pid；`bucket_main` 启动处加 main-tail-overlap watcher（复用 `main_tail_overlap_wait` + `main_early_code_file` 模式，同全量路径 :1195-1221）。
2. 触发时 main 以 `QUERY_MAIN_TAIL_OVERLAP` lanes 提前启动（suite-lpt-runner 保序）；fallthrough 走正常 bucket_main。
3. 验证：--buckets 子集轮触发（verification-round `main_tail_overlap_lanes`）+ 全量轮不回归。

## Acceptance Criteria

- [ ] AC1（能取假，接线）：`QUERY_MAIN_TAIL_OVERLAP`>0 时，bucket 子集路径（--buckets P/M 非 full）的 main 相在 lowconc 相尾部（stall≤3% 持续 5s）提前启动（grep test.sh bucket_main 处可见实现；实测一档 --buckets 子集轮证明 main 与 lowconc 尾部时间窗重叠）；0/unset 行为与现状一致。
- [ ] AC2（能取假，触发记录）：bucket 子集轮触发后 verification-round 出现 `main_tail_overlap_lanes`/`main_tail_overlap_load`（流标记 `main-tail-overlap` 落字段）。
- [ ] AC3（能取假，pass/fail-neutral）：接 A 前后 bucket 子集轮的 pass/fail 结果一致（不改变测试集/断言，只改 main 启动时机）。
- [ ] AC4（能取假，无回归）：全量路径（run_selected）的 main-tail-overlap 行为不变（`QUERY_MAIN_TAIL_OVERLAP` 同值下全量轮仍触发；bucket_full=1 走 run_selected 不受影响）。

## Definition of Done

bucket 子集路径接 main-tail-overlap；AC1-AC4 全勾；--buckets 子集轮实测触发（`main_tail_overlap_lanes`）+ 全量轮不回归；pass/fail-neutral 验证。

## Touches

- scripts/test.sh（bucket 子集分支：bucket_lowconc pid + bucket_main 处 watcher）
- tasks/gap-suite-main-tail-overlap-bucket-subset.md（自身）

## Needs-Human

**执行 2026-08-31T09:02:11.389Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
