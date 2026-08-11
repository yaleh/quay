---
id: gap-release-freshness-no-recut-mechanism
title: release 新鲜度无维护机制——develop 领先 release 已 2216 提交（08-07 时
  568），无重切/自动化任务；交付缺口：产物长期陈旧则交付面不可信，release 与 develop 漂移无闸
status: ready
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

- [x] AC1: **复现固化**——任务体记录 release 陈旧度（develop 领先 2216，08-07 568）+ 无任务覆盖（本任务 Proposal 已含）
- [x] AC2: **重切触发**——develop vs release 领先差超阈值机械报 WARN（可核数字）
- [x] AC3: **漂移闸**——release 产物与 develop 机制集漂移可机械报出
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：领先差读数 + 漂移闸触发样例贴出
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
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

## Inner 实跑证据（2026-08-11，worktree /home/yale/work/quay-worktrees/gap-release-freshness-no-recut-mechanism）

分步提交（3 commits，均已提交）：

- `1ee02f6e` 重切触发——release-freshness-check.sh 领先差读数 + 阈值 WARN + 契约输出（outline §6 交叉标注 + DELIVERY-INVENTORY 快照 205→206）
- `0855af19` 漂移闸——release tag 树 vs develop 机制集逐目录计数对比（drift_dirs/surface_delta + --list-drift 文件级 A/D/M）
- `55315d3c` 测试——release-freshness-check.test.mjs（14 例：重切触发 / 漂移闸 / --list-drift / JSON / exit-2 / 单一事实源 selfcheck）

### 领先差读数（AC2，worktree 实跑）

```
$ bash plugin/scripts/release-freshness-check.sh
release-freshness-check (root=/home/yale/work/quay-worktrees/gap-release-freshness-no-recut-mechanism)
  release_tag=v0.4.0 develop=develop
  release_ahead=2252 recut_threshold=500 recut_warn=1
  drift_dirs=3 surface_delta=208
  drift: plugin/scripts:126->205
  drift: plugin/probes:4->5
  drift: plugin/loop:2->6
  WARN: release is stale — develop is 2252 commits ahead of v0.4.0 (threshold 500); trigger a recut (DIR-123 / delivery)
  WARN: release v0.4.0 产物与 develop 机制集漂移 — 3 dir(s) count differ; run --list-drift for file-level A/D/M
  verdict=STALE
$ echo $?
1
```

阈值可核：`--threshold 99999` 时 `recut_warn=0`（`release_ahead=2252 <= 99999`）→ `verdict=FRESH` / exit 0（反证阈值触发成立）。JSON 模式：`--json` 输出 `{"release_tag":"v0.4.0","develop":"develop","release_ahead":2252,"recut_threshold":500,"recut_warn":1,"drift_dirs":3,"surface_delta":208,"drift":["plugin/scripts:126->205","plugin/probes:4->5","plugin/loop:2->6"],"verdict":"STALE"}`（python3 -m json.tool 校验合法）。

### 漂移闸触发样例（AC3，worktree 实跑）

`--list-drift` 文件级 A/D/M（v0.4.0..develop，delivery surface 前几行）：

```
$ bash plugin/scripts/release-freshness-check.sh --list-drift
  file-level A/D/M between v0.4.0 and develop (delivery surface):
    M	plugin/loop/fast-mode-loop-tick.md
    A	plugin/loop/fast-mode-tick-core.md
    A	plugin/loop/manager-loop-tick.md
    A	plugin/loop/manager-tick-core.md
    M	plugin/loop/orchestrator-loop-tick.md
    A	plugin/loop/orchestrator-tick-core.md
    M	plugin/probes/architecture-analysis.md
    A	plugin/probes/external-dogfooding.md
    A	plugin/scripts/a15-ruling5-counter.ts
    ...
```

漂移闸独立于重切触发（测试用例「a develop-only delivery-dir addition ⇒ drift_dirs=1, exit 1 even with recut_warn=0」证实：无 ahead WARN 时漂移单独使 verdict=STALE）。

### scoped 门（AC4）

`bash scripts/test.sh --for-task gap-release-freshness-no-recut-mechanism --allow-thin`（worktree 内跑）→ exit 0，14/14 测试 pass（fail 0 / cancelled 0）。全部 change-relevant scoped 静态检查 PASS：test-framework-policy / test-isolation / test-impl-census / adr016-screen-use / superseded-capability / dead-code-after-return / strategic-doc-staleness / tick-core-static / **delivery-inventory-drift-gate**（plugin/scripts A/D + outline 同 change 更新确认）。

### 新增测试（AC2/AC3/AC4 独立用例）

`plugin/test/release-freshness-check.test.mjs` — 14 例全绿：重切触发（ahead>threshold ⇒ exit 1 + recut_warn=1 + STALE；threshold 高 ⇒ recut_warn=0）、漂移闸（drift_dirs=1 独立触发；--list-drift 命名文件）、recut+drift 同时、FRESH（tag at develop HEAD ⇒ ahead=0/drift=0/exit 0）、JSON 合法、exit-2（缺 ref / 非 git repo / 非法 threshold）、**单一事实源 selfcheck**（脚本 DELIVERY_DIRS == verify-delivery-surface.ts DELIVERY_INVENTORY dir 集）。

### 发现（交叉标注偏差）

任务体 Touches 列的 `plugin/scripts/develop-deliver-tgz.sh` **在仓库中不存在**（`find . -name 'develop-deliver*'` 零结果）——DIR-123 的「每次 merge 后自动 build」覆盖脚本实际是 `plugin/scripts/arm64-build-on-ad-arm1.sh`（DIR-123-aarch64… Touches 所列，status: todo 未落地）。本任务实现的是 recut 触发 + 漂移闸（任务体 Contract 的 invoke 面），与 DIR-123 的 arm64 build 触发互补；develop-deliver-tgz.sh 的交叉标注线建议 outer 在 DIR-123 落地时更正为 arm64-build-on-ad-arm1.sh。