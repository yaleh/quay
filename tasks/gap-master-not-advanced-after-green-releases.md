---
id: gap-master-not-advanced-after-green-releases
title: master 停在 v0.8.0——v0.9~v0.24 release.yml 全绿但 master 未推进
status: ready
labels:
  - gap
  - release
  - branch-model
parent: null
children: []
extra:
  schema: execution
---
## Finding

<!-- dedup-ref -->
相关但机制不同：`gap-release-branch-model-hardcoded-not-configurable`（done）把发布分支模型做成可配置 + 可运行 meter（不变量含「停在最近一次全绿发布」）；本任务管的是另一机制——release.yml 全绿后 master 实际未 ff 到对应 tag。

SPEC-release-and-hotfix-branching-2026-09-15 §6 定义 master =「最近一次全绿发布」（release.yml 该 tag 的 run 全绿之后 ff 到该 tag）。实测（2026-10-30）：

- `git log -1 master` = `ae28758aa`（2026-09-16，「Merge release/v0.8.0 into develop」）——master 停在 v0.8.0。
- 而 `gh run list --workflow=release.yml` 显示 v0.9.0 起连续多次 release 均 `completed success`：v0.24.0（run 40470861346，28m29s，2026-10-27）、v0.23.0（run 40267612018，15m1s，2026-10-26）。
- ⇒ 至少 v0.23.0、v0.24.0 两个全绿发布之后，master 都没有被 ff 到对应 tag。master-advancement 机制（release.yml 绿 → ff master）要么未接线、要么断了，且没有任何一条线因此变红（「半截发布」与「一切正常」同形，硬规则 3b 形态，SPEC §2.3 后果 3 的同族）。

这是独立于 v0.25.0 本次切分的既有失守（v0.25.0 的 release.yml 尚在排队）。

## Requested action

定位 master 未推进的机制缺口（release.yml 是否有 ff master 的 step？还是靠外部流程？SPEC §6 的推进机制现在落在哪个载体？），并修复/补齐，使「最近一次全绿发布的 tag」成为 master 的实际状态。

## Acceptance Criteria

- [ ] 定位 master 停在 v0.8.0 的机制原因（读 release.yml 与 SPEC §6，指明推进机制是缺 step、断线、还是从未接线）。
- [ ] 修复后，master 能 ff 到最近一次全绿发布的 tag（至少 v0.24.0；若 v0.25.0 已绿则到 v0.25.0）。

## Definition of Done

master 推进机制已定位并修复，master ff 到最近全绿 tag，且该推进是可重复执行的机制而非一次手动作业。

该轴仍暗,理由:分支模型/release 机制缺陷，无组件代码改动，未跑 archguard/码文档比测量

## Touches

- tasks/gap-master-not-advanced-after-green-releases.md
- .github/workflows/release.yml
