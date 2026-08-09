---
id: gap-release-artifact-missing-plugin-ac16
title: "quay-sea v0.4.0 release 产物缺 plugin——tarball 只有二进制无 plugin/，strings 搜 6
  机制名全未中，AC16 产物层未达成，升级通道不通根因（archguard 报告 #13，躺 3 天）"
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

**quay-sea v0.4.0 release 产物（quay-sea-0.4.0-linux-x64.tar.gz，69MB）不含 plugin 包——消费方无论怎样装都拿不到机制，AC16 在产物层面未达成。这是 archguard 报告 #13（2026-08-06 10:15Z，已躺 3 天无人处理）发现并实证的：tarball 只有 quay + quay-native 二进制 + tasks/ + config 模板，无 plugin/ 目录；对二进制 strings 搜 6 个新机制名（dead-loop-check/verify-delivery-surface/slot-refill/claim-task/self-report-vocab/laydown-set-check）全未找到。这解释了升级通道为什么一直不通——不只是 config 冲突，是发布产物本身缺 plugin。**

### 实证（archguard 报告 #13，2026-08-06 + manager 2026-08-09 核实）

- **release 产物不含 plugin**：`quay-sea-0.4.0-linux-x64.tar.gz`（69MB）只有 quay/quay-native 二进制 + tasks/ + config 模板。无 plugin/ 目录、无独立机制文件。
- **二进制 strings 搜 6 机制名全未找到**：SEA 未内嵌 plugin。
- **config-preserving 修复不在 v0.4.0**：`quay init --loop` 仍停在 `.quay/config.yml already exists`（同 0.3.13）。
- **结论**：package.json files 字段含 plugin（source 层面）≠ release 产物含 plugin（消费方下载的）。AC16 在产物层面未达成。
- **3 天未处理**：报告 2026-08-06 进 `.quay/manager-inbox/`，最新 2026-08-06 13:26；task_list 搜 sea/release/plugin 产物无未立案任务（DIR-042/047/058/060 等是已 done 旧任务）。
- **升级通道不通的根因**：不只 config 冲突，是发布产物本身缺 plugin——消费方装 v0.4.0 仍拿不到机制。

**为什么重要**：这是「机制随包走」主线的直接阻塞。source 配置改了（package.json files 含 plugin），但 release 打包没把 plugin 打进去——「亲代确认 source、消费方下载产物发现缺口」。升级通道不通 = 自举演进断链。

**修的方向（实现归内层）**：
- 候选 A：**sea 打包含 plugin**——修 sea 打包步骤，把 plugin/ 打进 release 产物（内嵌或独立目录）。
- 候选 B：**产物层 AC16 验证**——release 产物 CI 验证「tarball 含 plugin + 二进制 strings 搜机制名命中」，防止 source 配置与产物脱节。
- 候选 C：**consumer 侧测试**——新增「下载真产物 → 验证含 plugin → init --loop 拿机制」e2e（DIR-110 族）。

**验证锚**：修后，(a) 下一个 release 产物含 plugin（tarball 解包有 plugin/ 或二进制内嵌）；(b) 二进制 strings 搜机制名命中；(c) 消费方 init --loop 拿到机制（升级通道通）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 archguard 报告 #13 实证（tarball 无 plugin + strings 搜 6 机制名未中 + init 停 config 冲突 + 3 天未处理）（本任务 Proposal 已含；内层补：下载/构建 v0.4.0 产物复现）
- [ ] AC2: **release 产物含 plugin**——下一个 release tarball 解包有 plugin/ 或二进制内嵌机制文件（候选 A）
- [ ] AC3: **产物层验证**——release 产物 CI 验证「含 plugin + strings 搜机制名命中」（候选 B）
- [ ] AC4: **升级通道通**——消费方下载新产物 → init --loop 拿到机制（候选 C e2e）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含打包/release 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构建 release 产物 ⇒ 含 plugin + strings 命中；消费方 init --loop 拿机制（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/scripts/（候选 A：sea 打包步骤——plugin 进产物）
- .github/workflows/release.yml（候选 B：release 产物验证——tarball 含 plugin + strings 命中）
- .github/workflows/ci.yml（候选 B：产物层验证接线）
- plugin/test/（候选 C：consumer 侧 e2e）
- packages/quay/test/（候选 C：consumer 侧 e2e）
- tasks/gap-release-artifact-missing-plugin-ac16.md（自身：勾 AC + 贴证据）

## Contract

measure   release_tarball_has_plugin = 解包 release tarball 后 `ls plugin/` 是否非空（或二进制 strings 搜机制名命中数）
band      release_tarball_has_plugin = 非空 / 命中 ≥6（6 机制名全在产物）
invariant ac16_artifact_level_met = 1（产物层 AC16 达成——消费方拿到机制）
invariant upgrade_channel_open = 1（消费方 init --loop 拿机制）
invoke    `bash packages/quay/scripts/build-sea.sh`（构建产物贴回）或等价打包入口
control   产物含 plugin；strings 命中；消费方升级通道通
resume    sea 打包 + 产物验证 + consumer e2e 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（archguard 报告 #13 3 天未处理：quay-sea v0.4.0 release 产物缺 plugin——source 配置改了但打包没打进，AC16 产物层未达成，升级通道不通根因。manager 核实。实现归内层）
