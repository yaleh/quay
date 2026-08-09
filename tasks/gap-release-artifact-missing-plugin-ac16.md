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

- [x] AC1: **复现固化**——任务体记录 archguard 报告 #13 实证（tarball 无 plugin + strings 搜 6 机制名未中 + init 停 config 冲突 + 3 天未处理）（本任务 Proposal 已含；内层补：构建 v0.4.0 产物复现——见 Evidence）
- [x] AC2: **release 产物含 plugin**——下一个 release tarball 解包有 plugin/ 或二进制内嵌机制文件（候选 A；sidecar 已由 `gap-release-sea-bundle-excludes-plugin-tree` 落地，本任务实跑验证——见 Evidence）
- [x] AC3: **产物层验证**——release 产物 CI 验证「含 plugin + strings 搜机制名命中」（候选 B；新增 `verify-sea-artifact.sh` + 接线 release.yml + 测试）
- [x] AC4: **升级通道通**——消费方下载新产物 → init --loop 拿到机制（候选 C e2e；新增 `sea-artifact-consumer-e2e.test.mjs`）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含打包/release 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构建 release 产物 ⇒ 含 plugin + strings 命中；消费方 init --loop 拿机制（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/scripts/（候选 A：sea 打包步骤——plugin 进产物）
- .github/workflows/release.yml（候选 B：release 产物验证——tarball 含 plugin + strings 命中）
- .github/workflows/ci.yml（候选 B：产物层验证接线）
- plugin/test/（候选 C：consumer 侧 e2e）
- packages/quay/test/（候选 C：consumer 侧 e2e）
- tasks/gap-release-artifact-missing-plugin-ac16.md（自身：勾 AC + 贴证据）

## Test-Files

- packages/quay/test/verify-sea-artifact.test.mjs（AC3 产物层验证脚本的正/负测试）
- packages/quay/test/sea-artifact-consumer-e2e.test.mjs（AC4 消费方升级通道 e2e——真 artifact 插件 init --loop）
- packages/quay/test/sea-bundle-plugin-sidecar.test.mjs（既有：AC2 sidecar 打包含 6 机制名）

## Contract

measure   release_tarball_has_plugin = 解包 release tarball 后 `ls plugin/` 是否非空（或二进制 strings 搜机制名命中数）
band      release_tarball_has_plugin = 非空 / 命中 ≥6（6 机制名全在产物）
invariant ac16_artifact_level_met = 1（产物层 AC16 达成——消费方拿到机制）
invariant upgrade_channel_open = 1（消费方 init --loop 拿机制）
invoke    `bash packages/quay/scripts/build-sea.sh`（构建产物贴回）或等价打包入口
control   产物含 plugin；strings 命中；消费方升级通道通
resume    sea 打包 + 产物验证 + consumer e2e 分步提交，任一步完成即写盘

## Evidence（内层实现 2026-08-09）

### 根因（复现固化，AC1）

`quay-sea-0.4.0-linux-x64.tar.gz`（69MB）只有 `quay`/`quay-native` 二进制 + `tasks/` + config 模板，**无 `plugin/`**。SEA 单文件二进制结构上不可能含目录树；`package.json` 的 `files` 字段只管 `npm pack`（npm tarball 路径），**管不到 SEA release 归档**——两条发布路径在 v0.4.0 脱节。内层在本 worktree 实跑复现：

- 完整 `bash packages/quay/scripts/build-sea.sh` 成功 → `dist-sea/quay`（SEA 二进制）。
- 对**仅二进制**做 `strings` 搜 6 机制名（`dead-loop-check`/`verify-delivery-surface`/`slot-refill`/`claim-task`/`self-report-vocab`/`laydown-set-check`）：**6 个全 0 命中**（AC1 复现：与 archguard 报告 #13 完全一致——SEA 二进制本身不承载机制）。

### 修复（AC2）

sidecar 方案（架构决策 `gap-release-sea-bundle-excludes-plugin-tree`，已在 develop 落地）：SEA 归档内以**目录 sidecar**携带 plugin/。内层实跑验证：

- `build-sea.sh --stage-plugin-only` → `dist-sea/plugin`（295 文件，含 vendor runtime）。
- 按 release.yml 的 assemble 步骤组装 bundle（plugin/ + quay + .quay/config.yml）→ `tar -czf` 后 `tar -tzf` 列出 **338 个 plugin 条目**；6 机制名 grep 全部命中（5~11 文件/名）。
- 修复后 bundle 上 `verify-sea-artifact.sh` PASS。

### 新增产物层验证（AC3）

- **`packages/quay/scripts/verify-sea-artifact.sh`**（新）：机械 artifact 级检查——`plugin/` 存在且非空 **且** 6 机制名在产物内可反搜（`grep -rlF` 全 bundle，含二进制）；fail-closed。`--list-mechanisms` 打印 6 名。
- **接线 release.yml**：`sea-release` 在归档后提取刚建的归档跑该脚本（上传前 fail-closed）；`sea-verify-node-free` 在下载真产物解包后跑内联等价检查（消费方拿到手的产物层证明；该 job 是 debian 容器无 checkout，故内联镜像脚本检查，6 名清单与脚本交叉引用）。
- **`packages/quay/test/verify-sea-artifact.test.mjs`**（新）：正/负测试——带 plugin 的 bundle PASS；无 plugin/ 空 plugin/ 各 FAIL closed；`--list-mechanisms` 恰 6 名。CI（ci.yml 默认 glob 含 `packages/quay/test/*.mjs`）随每次 push 跑。

### 升级通道（AC4）

- **`packages/quay/test/sea-artifact-consumer-e2e.test.mjs`**（新，`@test-group serial` + `@load-sensitive heavy`）：按 release.yml 步骤 stage sidecar → 组装 bundle → **从 bundle 的 plugin（真 artifact 的插件）对 fresh consumer git 工作区跑 `quay-init.sh --loop`** → 断言 exit 0 + 可观测机制（dead-loop-check/slot-refill/claim-task/self-report-vocab/laydown-set-check 5 个 loop 机制）落盘 + 外/内 tick 文档落盘 + `verify-sea-artifact.sh` 先 PASS。手动实跑同路径：exit 0、`quay-init complete`、auto-commit 84 文件。`verify-delivery-surface` 是 plugin-side（repo 级 delivery-surface checker）不入消费方 laydown 集，其产物内存在由 AC3 检查覆盖。

### 验证输出

- 新增两个测试文件：`verify-sea-artifact.test.mjs` 5/5 pass；`sea-artifact-consumer-e2e.test.mjs` 2/2 pass。
- 既有 `sea-bundle-plugin-sidecar.test.mjs` 3/3 pass（AC2 回归）。
- `scripts/test.sh --for-task gap-release-artifact-missing-plugin-ac16 --allow-thin` → **fail 0 / cancelled 0 / FULL-SUITE-EXIT=0**（见本任务验收）。
- DoD「全量套件绿」留待外层 verification-round 验证（本行不勾）。

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（archguard 报告 #13 3 天未处理：quay-sea v0.4.0 release 产物缺 plugin——source 配置改了但打包没打进，AC16 产物层未达成，升级通道不通根因。manager 核实。实现归内层）
