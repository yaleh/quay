---
id: gap-release-freshness-no-recut-mechanism
title: release 新鲜度无维护机制——develop 领先 release 已 2216 提交（08-07 时 568），无重切/自动化任务；交付缺口：产物长期陈旧则交付面不可信，release 与 develop 漂移无闸
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**release 新鲜度无维护机制（manager 2026-08-11 13:4x 核实，task list --search 逐条查）**：develop 领先 release（v0.4.0）已 **2216 提交**（08-07 时 568，增速约 4×）；无重切/自动化任务。交付物长期陈旧 ⇒ 交付面不可信——用 release 装的产物与 develop 行为偏离，AC16③ 的「用 release 装出来跑通」验证的是旧产物。

**这是交付缺口**：DIR-061/exp5-M-PRODUCTIZED-DELIVERY 覆盖「构建」不覆盖「保持 release 当前」。需要机制：重切触发（develop 领先超阈值 ⇒ 提示/自动重切）+ release 与 develop 漂移闸（可机械报出）。

### 实证（manager 13:4x + outer 复核）

- develop 领先 release 2216 提交（08-07 时 568，增速 4×）
- 无任务提及「release 重切 / recut / freshness / 重新发布」
- DIR-061 等产品化 epic 覆盖构建不覆盖新鲜度维护

### 选定机制方向（实现归 inner，判定归 outer）

1. **重切触发**：release 领先差（develop vs 最新 release tag）超阈值 ⇒ 报 WARN/提示重切（机械量：`git rev-list --count <release-tag>..develop`）
2. **漂移闸**：release 产物与 develop 的机制集漂移可机械报出（复用 delivery-inventory 思路对 release 面）

### 验证锚

修后 (a) 重切触发量（develop vs release 领先差）可机械读；(b) 漂移闸接入（release 陈旧报 WARN）；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 release 陈旧度（develop 领先 2216，08-07 568）+ 无任务覆盖（本任务 Proposal 已含）
- [ ] AC2: **重切触发**——develop vs release 领先差超阈值机械报 WARN（可核数字）
- [ ] AC3: **漂移闸**——release 产物与 develop 机制集漂移可机械报出
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：领先差读数 + 漂移闸触发样例贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/release-freshness-check.sh（新：领先差 + 漂移闸）
- plugin/scripts/develop-deliver-tgz.sh（DIR-123 交叉标注——「每次 merge 后自动 build」已由该脚本覆盖，本任务剩余缺口 = recut 触发 + 漂移闸）
- plugin/test/release-freshness-check.test.mjs（新：重切触发 + 漂移闸测试）
- docs/proposals/quay-product-outline.md（release 面交叉标注）
- tasks/gap-release-freshness-no-recut-mechanism.md（自身：勾 AC + 贴证据）

## Contract

measure   release_ahead = `git rev-list --count v0.4.0..develop` 的 stdout 数字
band      release_ahead 重切后 < 阈值（当前 2216；阈值待定——measure-first 定）
invariant release_drift_gate = 1（release 与 develop 机制集漂移可机械报出）
invoke    `bash plugin/scripts/release-freshness-check.sh`（贴领先差 + 漂移读数）
control   release 新鲜度可维护；漂移可查；既有不回归
resume    重切触发 / 漂移闸 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 13:4x——交付缺口①：release 新鲜度无维护机制（develop 领先 2216 vs 08-07 568），无重切/自动化任务。立案 + label delivery-critical。实现归 inner
