---
id: gap-sync-vendor-proposal-convergence-mirror-drift
title: sync-vendor 镜像漂移：a551dd5f 只改 experiments/ 的 proposal-convergence.ts 未镜像
  plugin/ ——M136 --check 报 DRIFT，round-166 红（solo 也红=真实回归），阻塞批量合
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**round-166（e8098df0，2026-08-09 11:04-11:13）全量套件红，唯一失败 = `plugin/test/plugin-packaging.test.mjs` 的 `M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning verifies all managed files with no hardcoded lists`——`sync-vendor.sh --check` 报 `DRIFT: scripts/proposal-convergence.ts differs between source and destination`。根因：**a551dd5f（inner 的 epoch-lock PID-liveness 修复）只改了 `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`，没镜像到 `plugin/scripts/proposal-convergence.ts`**——sync-vendor.sh 管理这一对镜像文件，`--check` 抓到漂移。**

### 实证（outer 2026-08-09 11:13 红窗分诊）

- **失败子测试**：`✖ M136 (DIR-070-A): sync-vendor.sh --check ... (1113ms)`——断言 `--check` exit 0 且输出含 `CLEAN`。实际 `bash plugin/scripts/sync-vendor.sh --check` 输出 `FAIL: drift detected`（但 exit 0，断言 CLEAN 失败）。
- **DRIFT 行**：`DRIFT: scripts/proposal-convergence.ts differs between source and destination`；src=`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`，dst=`plugin/scripts/proposal-convergence.ts`。
- **根因确认**：`git show a551dd5f --stat` = 只改 `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`（+19/-4）；`diff` 证实 plugin/ 侧停在旧版。a551dd5f 是 pending surface 里 26 提交之一。
- **solo 也失败**：`node --test plugin/test/plugin-packaging.test.mjs --test-name-pattern=M136` 单独跑仍 red——真实回归，非 flake。
- **同类先例**：sync-vendor.sh 镜像漂移是既有缺陷类（gap-drift-check-only-looks-at-the-harmless-direction 等）；a551dd5f 犯的是「改实验侧源文件没镜像 plugin 侧」——与 ffe7dd21 的 inventory 重生成同族「改了源没同步镜像/清单」。

**为什么重要**：这是「改了双份源中的一份」的镜像漂移回归。batch-merge freshness gate 读 `state=red ⇒ suiteGreen=false ⇒ 不 merge`——26 提交全卡住。修复极快（镜像一个文件），但必须修才绿。

**修的方向（实现归内层）**：
- 候选 A（正道）：把 a551dd5f 的变更镜像到 `plugin/scripts/proposal-convergence.ts`（`sync-vendor.sh` 的镜像语义——同 stage-receipt.ts 的 mirror parity 机制）；`sync-vendor.sh --check` 恢复 CLEAN。
- 候选 B：跑 `sync-vendor.sh` 的镜像（不带 --check）让它自己同步——但需确认不会顺带改别的。
- **交叉标注**：同一族「改源没镜像」缺陷——如果内层有「改实验/产品双份源文件」的提交，提交前必须 `sync-vendor.sh --check`。

**验证锚**：修后，(a) `bash plugin/scripts/sync-vendor.sh --check` 输出 CLEAN；(b) M136 单独跑绿；(c) 全量套件绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-166 实证（M136 红 + sync-vendor --check 报 DRIFT proposal-convergence.ts + a551dd5f 只改实验侧未镜像 plugin 侧 + solo 也红）（本任务 Proposal 已含；内层补：`sync-vendor.sh --check` 直接跑复现）
- [x] AC2: **镜像修复**——`plugin/scripts/proposal-convergence.ts` 与 `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` 字节一致（含 a551dd5f 的 PID-liveness 变更）
- [x] AC3: **--check 恢复 CLEAN**——`bash plugin/scripts/sync-vendor.sh --check` 输出 CLEAN 且 exit 0
- [x] AC4: **M136 solo 绿**——`node --test plugin/test/plugin-packaging.test.mjs --test-name-pattern=M136` 单独跑绿
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 sync-vendor / plugin-packaging 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：`sync-vendor.sh --check` CLEAN；M136 solo 绿（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/proposal-convergence.ts（镜像 a551dd5f 的变更——从 experiments/ 侧同步）
- plugin/scripts/sync-vendor.sh（--check 核实；不须改，除非镜像机制本身有缺陷）
- tasks/gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak.md（交叉标注——a551dd5f 是 leak 修复的来源提交，本任务是它的镜像漂移副作用）
- tasks/gap-proposal-convergence-load-flake-20-child-concurrency.md（交叉标注——同源）
- tasks/gap-runner-perfile-pattern-unnchored-self-match-phantom-red.md（交叉标注——同轮红窗三连）
- tasks/gap-sync-vendor-proposal-convergence-mirror-drift.md（自身：勾 AC + 贴证据）

## Contract

measure   sync_vendor_check_after_fix = `bash plugin/scripts/sync-vendor.sh --check` 的 stdout
band      sync_vendor_check_after_fix = 含 CLEAN 且 exit 0
invariant plugin_experiment_byte_identical = 1（plugin/ 与 experiments/ 的 proposal-convergence.ts 字节一致）
invariant M136_solo_green = 1（`--test-name-pattern=M136` 单独跑绿）
invoke    `bash plugin/scripts/sync-vendor.sh --check` + `node --no-warnings --experimental-strip-types --test plugin/test/plugin-packaging.test.mjs --test-name-pattern=M136`（贴回）
control   --check CLEAN；M136 solo 绿；全量绿
resume    镜像文件 + --check 验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-166 红窗分诊：M136 sync-vendor --check 报 DRIFT proposal-convergence.ts——a551dd5f 只改实验侧未镜像 plugin 侧；solo 也红=真实回归。实现归内层）
