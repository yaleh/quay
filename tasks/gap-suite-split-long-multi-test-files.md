---
id: gap-suite-split-long-multi-test-files
title: 拆分含多个独立 test() 的长耗时文件——压缩 M-bucket LPT 队列头（makespan 下限）
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

round #560 负载曲线前 3 段（长文件跑那段）均值 load1=26.02、峰值 47.02、比值 0.55——机器有真实闲置容量。两个排最前的长文件：`plugin/test/session-liveness.test.mjs`（250.7s，9 个独立 `test()`、8 次子进程 spawn）、`plugin/test/quay-init-loop-vendor.test.mjs`（307.3s，7 个独立 `test()`、含 npm 子进程调用）——都是多场景顺序执行 + 子进程/IO 重、非 CPU 密集，结构上可拆。拆成多个文件让 Node 的文件级并发并行化这些场景，压缩 M-bucket LPT 队列头部（决定 makespan 下限的部分）。

## Plan

先抽查 M-bucket 排前的长文件确认可拆（多独立 `test()` + 拆后不共享状态），可拆的拆成多个文件 + suite 仍绿 + makespan 改善。候选清单在 round #560 perFile 数据里取（不止这两个已验证的）。

## Acceptance Criteria

- [ ] AC1（能取假，独立性抽查）：抽查 M-bucket 排前长文件，确认多独立 `test()` 且拆后互不依赖共享状态；（⛔ 未抽查 ⇒ 假）。
- [ ] AC2（能取假，拆分不破坏）：可拆长文件拆成多个文件，suite 仍绿（行为不变）；（⛔ 拆分后 suite 红 ⇒ 假）。
- [ ] AC3（能取假，makespan 改善）：拆分后 M-bucket makespan 下降（文件级并发并行化场景）；（⛔ 无改善 ⇒ 假）。

## Definition of Done

可拆长文件拆分为多个独立文件并落地提交；AC1-3 全勾（独立性抽查、拆分不破坏、makespan 改善）；M-bucket LPT 队列头压缩、makespan 下降。

## Touches

- plugin/test/session-liveness.test.mjs（拆）
- plugin/test/quay-init-loop-vendor.test.mjs（拆）
- 其它可拆长文件（抽查后定，round #560 perFile 清单）
- tasks/gap-suite-split-long-multi-test-files.md（自身）