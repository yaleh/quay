---
id: gap-suite-load-sampler-orphan-process
title: suite-load-sampler 孤儿进程残留——宿主结束后仍写数十分钟-小时，污染负载指标
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`.quay/suite-load-*.jsonl` 采样跨度远超宿主 suite 真实时长——实证 `suite-load-fm-gap-worker-driver-reconcile-interval-1787607447662-dk8yty.jsonl` 采样 21:46:48→23:47:53（**121min**），而 verification-round.jsonl 真实两次 suite 仅 347s+275s（~10min）。同一窗口 ≥6 文件同模式（跨度 4916s/7265s/5417s/6236s/6075s/4705s，远超单轮真实 suite 上限 ~1619s）。sampler 以 `&` 起后台，清理路径不覆盖所有退出分支（含 worker 中途异常退出，与「64% exited-not-landed」近亲）。影响：用这批数据算「高负载时长占比」类指标会被污染（manager 算 8h 平均负载踩过，改锚定 verification-round 真实区间才避开）。

## Plan

sampler 进程随宿主 suite 生命周期正确终止——清理路径覆盖所有退出分支（正常 + worker 异常退出），后台 `&` sampler 在宿主结束时被一并回收。

## Acceptance Criteria

- [x] AC1（能取假，宿主结束即停）：宿主 suite 结束后 sampler 不再写（5s 间隔写入即停）；（⛔ 宿主结束后仍写数分钟 ⇒ 假）。
- [x] AC2（能取假，异常退出回收）：worker 异常退出分支也回收后台 sampler（⛔ 异常退出后 sampler 残留 ⇒ 假）。

## Definition of Done

sampler 随宿主生命周期终止；AC1-2 全勾；`suite-load-*.jsonl` 跨度不再超真实 suite 时长。

## Touches

- plugin/scripts/full-suite-runner.ts（sampler 起停 + 清理路径）
- plugin/scripts/suite-load-sampler.ts
- plugin/test/full-suite-runner.test.mjs（对应测试）
- tasks/gap-suite-load-sampler-orphan-process.md（自身）
## Needs-Human

**执行 2026-08-26T18:24:46.751Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
