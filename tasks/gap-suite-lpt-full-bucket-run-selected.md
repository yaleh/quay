---
id: gap-suite-lpt-full-bucket-run-selected
title: suite full bucket（run_selected 老路径）不享受 LPT——full 轮占 58% 墙钟零优化
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`gap-m-bucket-long-tail-lpt-scheduling`（done）的 LPT 重排 + `suite-lpt-runner.mjs`（保序 `run({files})`）**只挂在 `scripts/test.sh --buckets` 分支、且只在 bucket 选择器解析出具体子集时跑到**。一旦 `bucket_full=1`（hub 文件触碰，或 Touches 判不出分类 fail-closed），代码在 LPT 段之前经 `run_selected` 直接退出——走旧三阶段 `serial→lowconc→main`（`node --test "${files[@]}"`，CLI 把位置参数按字母序重排）。

**量化（8h 34 轮）**：full 轮 11 轮均 1097s（占轮次数 32%、占总墙钟 **58%**），零 LPT。实证 round #557（buckets=full，819s）前 10 个文件耗时 39.9/3.8/0.9/7.7/44.3/2.5/31.5/68.7/0.8/1.5s，最长的 `full-suite-runner.test.mjs`（242.6s）不在前 10 个。

**量化结论（manager 8h 模拟）**：full 的慢约一半是真实额外工作量（S-only 文件占 22% 文件数、贡献 45-46% 工作量、单文件均长 3 倍），一半是 serial/lowconc 分相税（对整个 full 生效，把本可 16 并发的 M/P 文件一起拖慢到 1.74-1.80x 理想）。model honesty：拆文件对 full 无效（floor-bound 0/12）；主频缩放对 M/P 队首偏乐观（子进程/IO 墙钟不随主频）。⇒ 本任务（让 full 也 LPT）必要但不充分——更大杠杆是分相移除（见 `gap-suite-serial-lowconc-classification-recheck`）。

## Plan

`run_selected` 老路径（`--buckets` 的 `bucket_full=1` 分支 + 默认无 `--buckets` 全量入口共用的那条）也换成 `run({files})` + LPT 排序。⚠️ `run_selected` 内部有 serial/lowconc/main 三阶段分离，LPT 需与分阶段结构相容。

## Acceptance Criteria

- [x] AC1（能取假，full 轮 LPT 生效）：`bucket_full=1` 或无 `--buckets` 全量时，最长文件进入开始序列前段（LPT 重排，非字母序）；（⛔ 最长文件仍被字母序排到后面 ⇒ 假）。实测：`lpt-order: file list reordered (501 files; first=full-suite-runner.test.mjs)`——最长文件（242.6s）进入序列首位，非字母序。
- [x] AC2（能取假，分阶段相容）：LPT 重排与 serial/lowconc/main 三阶段结构相容（分阶段边界正确，不同并发度的文件组不被 LPT 跨组混排）；（⛔ 不同阶段文件被混排 ⇒ 假）。结构 pin：`lpt_reorder_files files` 只作用于 main 组（`lpt_reorder_files serial_files`/`lowconc_files` 均不存在），serial/lowconc 仍 `node --test --test-concurrency="$SERIAL_CONCURRENCY"`/`$LOWCONC_CONCURRENCY` 各自独立相位。
- [x] AC3（能取假，makespan 改善）：full 轮 makespan 较旧三阶段字母序下降（同 N 前后对照）；（⛔ 无改善 ⇒ 假）。同 N=501 前后对照：`main_phase_ms` 505853→366932（**−138.9s，−27.5%**）、总墙钟 832s→655s（**−177s，−21.3%**）；`QUAY_TEST_LPT_ORDER=0` 对照轮 2 个 session-liveness 族 flaky 失败（与本改动无关，LPT=1 轮 0 失败绿）。

## Definition of Done

`run_selected` 老路径接入 LPT + 保序 `run({files})`；AC1-3 全勾；full 轮不再走字母序。

## Touches

- scripts/test.sh（run_selected 全量主阶段接入 lpt_reorder_files + suite-lpt-runner.mjs；--buckets full 分支共用 helper）
- plugin/test/suite-lpt-order.test.mjs（LPT 接线 pin 改写 + full 路径 AC1/AC2 结构 pin）
- plugin/test/test-phases-order.test.mjs（主阶段 marker node --test → suite-lpt-runner.mjs）
- tasks/gap-suite-lpt-full-bucket-run-selected.md（自身）