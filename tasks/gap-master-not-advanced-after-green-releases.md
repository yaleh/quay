---
id: gap-master-not-advanced-after-green-releases
title: master 停在 v0.8.0——v0.9~v0.24 release.yml 全绿但 master 未推进
status: done
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

## Resolution

机制缺口定位（AC1）：**release.yml 的 `advance-master` job 已接线且在工作**——既非缺 step、非断线、也非从未接线。逐条证据（2026-10-30 实测）：

- `git ls-remote origin master` = `e92805ff3` = `v0.25.0^{}`（v0.25.0 是最近一次全绿发布）；GitHub 侧 master 已推进到位。
- v0.24.0 run 40470861346 三个 job（verify-plugin-channel / create-github-release / advance-master）全 `success`（2026-10-27）；v0.25.0 run 40993134132 同（2026-10-30）——`advance-master` 的 `git push origin <peeled-tag>:master` 确实在跑。
- v0.8.0~v0.25.0 每个 tag 的 release.yml 都带 `advance-master` job（`git show <tag>:.github/workflows/release.yml | grep -c advance-master` = 7~11）。

「master 停在 v0.8.0」读数来自**本地 `master` 分支**：它 `tracks origin/master` 但落后 10499 提交——没有任何机制 `fetch origin` + ff 本地这个镜像。而本该变红的 meter（`release-model-check.ts`）只断言「master 停在某个 version tag」（v0.8.0 也算），不断言「停在最近一次全绿 tag」⇒ 无一条线变红（硬规则 3b/4b 形态）。

修复（AC2）：给 `release-model-check.ts` 加第四条不变量 `line-not-stale`——`advance: ci` 时本地 line 落后 `origin/<line>` 即 fail，detail 携带修复命令（`git fetch origin <line> && git branch -f <line> origin/<line>`）；无 `origin/<line>` 时 `not-evaluated`（⛔ 不并入 pass，硬规则 3b）。并当场修复本地 master：`git fetch origin master && git branch -f master origin/master` ⇒ master = `e92805ff3` = v0.25.0（最近一次全绿发布）。推进机制本身（release.yml advance-master）原已可重复；本地镜像的失守现在有 meter 变红兜底，且修复命令由 fail detail 自证可重复。

## Acceptance Criteria

- [x] 定位 master 停在 v0.8.0 的机制原因（读 release.yml 与 SPEC §6，指明推进机制是缺 step、断线、还是从未接线）。
- [x] 修复后，master 能 ff 到最近一次全绿发布的 tag（至少 v0.24.0；若 v0.25.0 已绿则到 v0.25.0）。

## Definition of Done

master 推进机制已定位并修复，master ff 到最近全绿 tag，且该推进是可重复执行的机制而非一次手动作业。

该轴仍暗,理由:分支模型/release 机制缺陷，无组件代码改动，未跑 archguard/码文档比测量

## Touches

- tasks/gap-master-not-advanced-after-green-releases.md
- plugin/scripts/release-model-check.ts
- plugin/scripts/checker-mutation-cases/release-model-check.sh
- plugin/test/release-model-check.test.mjs
- plugin/scripts/runner-static-gate.ts
