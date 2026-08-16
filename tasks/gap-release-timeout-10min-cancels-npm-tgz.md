---
id: gap-release-timeout-10min-cancels-npm-tgz
title: "release.yml release job timeout-minutes:10 撞测试时长被 cancel——npm .tgz 不自动附（v0.5.0 实测）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：v0.5.0 release 工作流（run 31958447040）实测，2026-08-16 16:2xZ。

**现象**：release job 的 "Run tests" 步超过 `timeout-minutes: 10` ⇒ job 被 cancel ⇒ "Build release artifact
(npm pack)" 与 "Upload artifact to GitHub Release" 全 skipped ⇒ v0.5.0 发布时**没有自动附 npm .tgz**
（只有 3 个 SEA 资产）。本次由 outer 用本地 `package.sh` 重造 + `gh release upload` 手动补齐。

**manager 裁定（2026-08-16 16:4xZ）**：⛔ 不并进 AC97（AC97 定义=三条零成本 WebUI 缺口，release 超时是
发布链缺陷不是 WebUI 缺口；判据与名字对不上=「勾了但没做那件事」的入口）。**独立任务，属"发布期缺陷"族**，
同 `gap-sea-verify-node-free-fails-050`。

**影响**：不改则下次发版（0.6.0+）npm .tgz 仍不自动附——发布通道依赖手动补救，不是机制。

## Acceptance Criteria

- [ ] AC1: release job `timeout-minutes` 放宽到足够跑完整确定性测试（或拆分测试/产物步），下次发版 npm .tgz
      自动 attach。
- [ ] AC2: 改动可 `git log` 追溯（.github/workflows/release.yml），⛔ 不要求全量套件（CI 配置改动，
      验证 = 下次发版自动附 .tgz）。

## Definition of Done

- [ ] release.yml 超时缺陷修复，npm .tgz 在后续发版自动 attach（AC1+AC2）。

## Touches

- .github/workflows/release.yml（timeout-minutes）
- tasks/gap-release-timeout-10min-cancels-npm-tgz.md（自身）
