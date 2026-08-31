---
id: gap-suite-load-sampler-early-red-truncates-load-curve
title: suite-load-sampler 把 early-red 当套件结束——红轮 /tests 负载曲线截断在首败时刻（isSuiteRunning 判据未对齐 finishedAt 语义）
status: ready
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

红轮的 `/tests` 负载曲线被截断在首败时刻：round #777（`mfi-gap-retrystate-needshuman-no-reconcile-with-disk-ready-1788155364010`）声明 `durationMs=470000`（套件实跑 470s：3681 tests×127.7ms），但负载曲线只有 90s——`.quay/suite-load-<runId>.jsonl` 19 条样本，末样本 06:08:03.964Z 距 `redAt`（06:08:05.986Z）仅 2.0s = 采样器下一轮 poll 读到 `state=red` 即停。

**根因**：`full-suite-runner.ts` 的 early-red（人 2026-08-12 裁定 kill-on-red 默认 OFF）首条失败行就写 `state=red` + `finishedAt: null`（:2793），但套件继续跑到自然结束；只有终止写才设 `finishedAt`（:3150/:3172）。而 `suite-load-sampler.ts:78` `isSuiteRunning` 只判 `state !== "running"` 即停——把临时 early-red 当成套件结束。feature 任务 AC 写「suite 结束即停采样」，实现没对齐 early-red 语义。

**系统性**：台账×289 负载文件，绿轮 median 覆盖=1.00（230 轮仅 3 轮<0.7）；红轮 5/20 <0.7，最近三红轮全截断（756:70/516s、758:65/471s、777:90/470s）。绿轮不受影响因终止绿写在套件结束时才发生。

**归因**：`gap-test-detail-load-timeseries`（commit 94660192f，08-23）引入——采样器落笔时 early-red 已存在 11 天，判据写错；`gap-suite-load-sampler-orphan-process`（0d155295c）保留同一判据，继承而非引入。

## Plan

1. 采样器侧改（⛔ 不改 runner——early-red 的 `state=red` 是 AC2 stop-dispatch 信号）：`isSuiteRunning` 改按 `finishedAt` 区分——`finishedAt==null`（running 或临时 red/aborted）继续采样；`finishedAt` 已设 / 文件缺失才停；宿主死亡（ppid）兜底保留。
2. 保持「结束即停 / 不常驻空跑」不变式（termination 写 finishedAt 后才停）；绿轮行为不变。

## Acceptance Criteria

- [x] AC1（能取假，机制级）：`isSuiteRunning` 按 `finishedAt` 判定——grep 判据含 `finishedAt`（非仅 `state !== "running"`）；（⛔ 仍只判 state ⇒ 假）。
- [x] AC2（能取假，红轮覆盖）：实现落地后时间窗内，红轮的负载曲线覆盖 = 套件实跑窗口（非截断在首败）——造一次 early-red 轮验证采样持续到 finishedAt 写；（⛔ 曲线仍截断 ⇒ 假）。
- [x] AC3（能取假，无回归）：绿轮行为不变（覆盖=1.00 不回退）、「结束即停/不常驻空跑」不变式仍成立（采样器在 finishedAt 后退出，不空跑）。

## Definition of Done

采样器按 finishedAt 判定；AC1-AC3 全勾；一次 early-red 轮验证曲线覆盖完整；全量 suite 绿。

## Touches

- plugin/scripts/suite-load-sampler.ts（isSuiteRunning 按 finishedAt 判定）
- plugin/test/full-suite-runner.test.mjs（AC2/AC3 单测：early-red 续采 + finishedAt 停）
- tasks/gap-suite-load-sampler-early-red-truncates-load-curve.md（自身）
