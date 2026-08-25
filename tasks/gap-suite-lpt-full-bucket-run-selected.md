---
id: gap-suite-lpt-full-bucket-run-selected
title: suite full bucket（run_selected 老路径）不享受 LPT——full 轮占 58% 墙钟零优化
status: todo
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`gap-m-bucket-long-tail-lpt-scheduling`（done）的 LPT 重排 + `suite-lpt-runner.mjs`（保序 `run({files})`）**只挂在 `scripts/test.sh --buckets` 分支、且只在 bucket 选择器解析出具体子集（M/P/P+M/S/G…）时跑到**。一旦 `bucket_full=1`（hub 文件触碰，或 Touches 判不出分类 fail-closed），代码在 LPT 段之前经 `run_selected` 直接退出——走旧三阶段 `serial→lowconc→main`（`node --test "${files[@]}"`，CLI 把位置参数按字母序重排，正是该任务自己证伪的旧行为）。

**量化（8h 34 轮，manager 直读 perFile）**：full 轮 11 轮均 1097s（占轮次数 32%、占总墙钟 **58%**），M 轮 14 轮均 414s、P 轮 7 轮均 328s、P+M 2 轮均 311s。**full 轮是最重的 58%，零 LPT 优化**。实证 round#557（buckets=full，819s）：前 10 个实际开始的文件耗时 39.9/3.8/0.9/7.7/44.3/2.5/31.5/68.7/0.8/1.5s，最长的 `full-suite-runner.test.mjs`（242.6s）不在前 10 个——无任何重排。

## Plan

`run_selected` 老路径（`--buckets` 的 `bucket_full=1` 分支 + 默认无 `--buckets` 全量入口共用的那条）也换成 `run({files})` + LPT 排序。⚠️ `run_selected` 内部有 serial/lowconc/main 三阶段分离（不同并发度跑不同文件组），LPT 需与分阶段结构相容——不是简单复用 `suite-lpt-runner.mjs` 现成调用。

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