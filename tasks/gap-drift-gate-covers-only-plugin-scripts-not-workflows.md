---
id: gap-drift-gate-covers-only-plugin-scripts-not-workflows
title: "delivery-inventory drift 闸只盯 plugin/scripts/，不覆盖 .claude/workflows/ —— 新建 workflow 不镜像 plugin/workflows/ 红 3 条（M143/AC9/C6）；同类缺口还敞一个口子"
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

**`delivery-inventory-drift-gate.sh` 只盯 `plugin/scripts/`（`--diff-filter=AD` 命中该目录 ⇒ 要求同提交更新 outline §6 快照），不覆盖 `.claude/workflows/` ⇒ 新建 workflow 没镜像进 `plugin/workflows/`，r265 红 3 条（M143/AC9/C6）。**

### 实证（manager 2026-08-11 01:4x + outer 复核）

- **r265 真实验证轮**：`tests=3176 fail=5 failures=16`，两条失败文件（workflow-metadata-conformance / plugin-packaging）。
- **三条同源失败**：`✖ M143: git-tracked workflows in plugin/workflows/ byte-identical to .claude/workflows/`、`✖ AC9: mirror byte-identity on surviving workflows`、`✖ C6: script default invocation resolves the 5 surviving workflow files`。
- **实测两目录**：`.claude/workflows/` = **6**（drain-directives / execute-suite-fix / manager-tick-core / pool-quality-judge / run-routines / select-preflight）；`plugin/workflows/` = **2**（drain-directives / run-routines）。缺 4 个；且同名 `run-routines.js` 两边**内容不一致**（drain-directives.js 一致）。
- **C6 期望 5 而现在 6、M143/AC9 要求逐字节一致而 run-routines 不一致**。时间线：execute-suite-fix.js 是今晚 15:47 建的（人裁定 workflow 化），pool-quality-judge.js 亦新增。
- **这是今晚第三次同一形态**：①outline §6 快照（红 6 轮 128.4min，已由 drift 闸解决）；②capability-catalog 声明；③本条（workflow 镜像）。**共同点：往带钉死不变量（计数/镜像/快照）的集合加文件，没更新被钉的那侧。**
- **缺口**：drift 闸只盯 `plugin/scripts/`，不覆盖 `.claude/workflows/` ⇒ 同一族缺口还敞着一个口子。

### 选定机制方向（实现归 inner，判定归 outer）

**把 drift 闸触发目录从 `plugin/scripts/` 扩到「所有带钉死计数/镜像的集合」**——至少加 `.claude/workflows/`；判据形态与现有一致（`--diff-filter=AD` 命中该目录 ⇒ 要求同提交更新 `plugin/workflows/` 镜像 + C6 计数）。

**验证锚**：修后 (a) 新增 `.claude/workflows/foo.js` 但 plugin/workflows 未镜像 ⇒ 静态检查 FAIL；(b) 只改已有 workflow 内容（无 A/D）⇒ 不触发；(c) 同步镜像 ⇒ PASS；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录两目录计数（6 vs 2）+ run-routines 漂移 + 三条失败（M143/AC9/C6）+ 时间线（本任务 Proposal 已含）
- [ ] AC2: **闸覆盖 workflows**——drift 闸触发目录扩到 `.claude/workflows/`（A/D ⇒ 要求同提交更新 plugin/workflows 镜像 + C6 计数），FAIL-closed
- [ ] AC3: **既有不回归**——`--for-task` scoped 门绿；drift 闸既有 plugin/scripts 判据不破坏
- [ ] AC4: **类级缺口闭合**——同一族「往钉死集合加文件」的其它集合（capability-catalog 声明等）评估是否同法覆盖

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：新增 .claude/workflows/foo.js 未镜像 ⇒ 静态红；镜像 ⇒ 绿（贴 diff-filter 输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/delivery-inventory-drift-gate.sh（触发目录扩到 .claude/workflows/ + 被钉侧要求）
- plugin/scripts/checker-mutation-cases/delivery-inventory-drift-gate.sh（mutation case 更新）
- plugin/test/delivery-inventory-drift-gate.test.mjs（新增 workflows A/D 用例）
- tasks/gap-drift-gate-covers-only-plugin-scripts-not-workflows.md（自身：勾 AC + 贴证据）

## Contract

measure   drift_gate_covers_workflows = `grep -cE "workflows" plugin/scripts/delivery-inventory-drift-gate.sh` 的 stdout 数字
band      drift_gate_covers_workflows >= 1（闸已覆盖 .claude/workflows/）
invariant new_workflow_requires_mirror = 1（新增 .claude/workflows 文件 ⇒ 同提交 plugin/workflows 镜像）
invariant content_only_change_skipped = 1（只改 workflow 内容不触发）
invoke    `git diff --name-only --diff-filter=AD <base>..HEAD | grep -E '^\.claude/workflows/'`（贴输出，证明能被闸捕获）
control   闸覆盖 workflows；新增 ⇒ 镜像；内容改动不误报
resume    闸扩展 / scoped 门 / 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 01:4x——r265 红 3 条同源（M143/AC9/C6），根因=新建 workflow 没镜像 plugin/workflows/（.claude 6 vs plugin 2 + run-routines 漂移）。今晚第三次「往钉死集合加文件没更新被钉侧」（①outline 快照 ②catalog 声明 ③workflow 镜像）。处方：drift 闸触发目录扩到 .claude/workflows/。实现归 inner，判定归 outer
