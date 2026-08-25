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

- [ ] AC1（能取假，full 轮 LPT 生效）：`bucket_full=1` 或无 `--buckets` 全量时，最长文件进入开始序列前段（LPT 重排，非字母序）；（⛔ 最长文件仍被字母序排到后面 ⇒ 假）。
- [ ] AC2（能取假，分阶段相容）：LPT 重排与 serial/lowconc/main 三阶段结构相容（分阶段边界正确，不同并发度的文件组不被 LPT 跨组混排）；（⛔ 不同阶段文件被混排 ⇒ 假）。
- [ ] AC3（能取假，makespan 改善）：full 轮 makespan 较旧三阶段字母序下降（同 N 前后对照）；（⛔ 无改善 ⇒ 假）。

## Definition of Done

`run_selected` 老路径接入 LPT + 保序 `run({files})`；AC1-3 全勾；full 轮不再走字母序。

## Touches

- scripts/test.sh（run_selected + --buckets full 分支）
- plugin/scripts/suite-lpt-runner.mjs（如需分阶段相容改造）
- scripts/test.sh 对应测试
- tasks/gap-suite-lpt-full-bucket-run-selected.md（自身）