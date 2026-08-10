---
id: gap-ac37-exec-core-ships-with-package
title: 执行核零交付——plugin/loop/{manager,orchestrator,fast-mode}-tick-core.md
  三份全部不存在，quay-init.sh 里 tick-core 命中 0；交付出去的是 1232/1309 行理由档案，≤80
  行执行路径一行没走；处方=执行核进 quay-init.sh derive_loop_scripts 派生集 ⇒ :1081 的 referenced ⊆
  landed 门自动生效（不新建检查）
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

**执行核零交付——`plugin/loop/{manager,orchestrator,fast-mode}-tick-core.md` 三份全部不存在；`quay-init.sh` 里 `tick-core` 命中 0。交付出去的是 1232/1309 行的理由档案，≤80 行的执行路径一行没走。** 而 ADR-009 第二次修订原文：「**凡是必须跨压缩存活的东西，必须落在锚所指向的文件里**」——锚指的核本身没随包走。

**这是本阶段（产品化交付）的第二优先工作（人指定顺序：AC36 → AC37）。** 人 2026-08-10 裁定：典型路径是两层（outer + inner），**manager 那份随 `--manager` opt-in，不进 `--loop` 默认集**。

### 实证（manager 2026-08-10 09:1x + outer 复核）

- **三份执行核不存在**：`plugin/loop/manager-tick-core.md`、`plugin/loop/orchestrator-tick-core.md`、`plugin/loop/fast-mode-tick-core.md` 全部 MISSING（outer 复核）。
- **quay-init.sh 零命中**：`quay-init.sh` 里 `tick-core` 命中 0。
- **现有载体在 orchestration/**：三份核当前只存在于 `orchestration/`（`manager-tick-core.md` / `orchestrator-tick-core.md` / `fast-mode-tick-core.md`）——不在交付派生集里。
- **`referenced ⊆ landed` 门已存在**：`quay-init.sh:978` `verify_referenced_landed`（gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down），`:1081` 机制是「被引用集 ⊆ 已铺集」——执行核进 `derive_loop_scripts` 后此门自动生效，**不新建检查**。

**为什么重要**：交付物缺执行路径 = 别人装到 quay 后拿到的是一堆理由档案，没有「每轮该做什么」的 ≤80 行执行核。AC30(a) 要求执行核 ≤80 行、分 A/B/C/D 四段——这些核存在但没随包走，等于交付面缺最关键的一层。

### 选定机制方向（实现归 inner，判定归 outer）

1. **执行核进 derive_loop_scripts**：`quay-init.sh` 的 `derive_loop_scripts()`（:864）派生集加入三份 tick-core.md（从 `orchestration/` 复制进 `plugin/loop/` 作为随包正本，或 derive 直接指向现有文件）。
2. **manager 份 opt-in**：manager-tick-core 随 `--manager` 参数（不进 `--loop` 默认集）——人裁定典型路径两层。
3. **referenced ⊆ landed 自动生效**：核进派生集后 `:1081` 门自动覆盖——不新建检查。
4. **冷启动可读**：`--loop` 铺设后目标项目里能读到三份核。

**验证锚**：修后 (a) `quay-init.sh | grep -c tick-core` > 0；(b) `--loop` 铺设后目标项目 `plugin/loop/` 三份核齐全；(c) `:1081` 门对这三份生效（无 referenced-but-not-landed 报错）；(d) `--manager` opt-in 时 manager 核在，默认 `--loop` 无 manager 核。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录三份执行核 MISSING + quay-init tick-core 0 命中实证（本任务 Proposal 已含）
  - 证据：本任务 Proposal「实证」段已固化——`plugin/loop/{manager,orchestrator,fast-mode}-tick-core.md` 三份全部 MISSING、`quay-init.sh` 里 `tick-core` 命中 0（outer 复核）。本实现前 `plugin/loop/` 只有 `*loop-tick.md`（fast-mode-loop-tick / manager-loop-tick / orchestrator-loop-tick），无任何 `*-tick-core.md`
- [x] AC2: **执行核进派生集**——`derive_loop_scripts` 加入三份 tick-core.md，`quay-init.sh | grep -c tick-core` > 0
  - 证据：`derive_loop_scripts`（quay-init.sh (c3) 段）加入 `orchestrator-tick-core.md` / `fast-mode-tick-core.md` / `manager-tick-core.md`；三份随包正本落在 `plugin/loop/`（从 `orchestration/` 字节复制）。实测 `bash plugin/scripts/quay-init.sh --loop --root <tmp> ... 2>/dev/null | grep -c tick-core` = **3**（见 Contract invoke 输出）
- [x] AC3: **manager opt-in**——manager-tick-core 随 `--manager`，不进 `--loop` 默认集
  - 证据：默认 `--loop` 铺设后目标项目 `orchestration/` 只有 `orchestrator-tick-core.md` + `fast-mode-tick-core.md`（manager 不落），输出含 `skip (opt-in): orchestration/manager-tick-core.md`；`--loop --manager` 铺设后三份齐全（见 Contract invoke 输出）
- [x] AC4: **referenced ⊆ landed 自动生效**——`:1081` 门对三份核生效（不新建检查）
  - 证据：默认 `--loop` 与 `--loop --manager` 均输出 `verify-referenced-landed: OK`；`plugin/test/quay-init.test.mjs` AC4 测试删掉 plugin/loop/orchestrator-tick-core.md + fast-mode-tick-core.md 后 install FAIL（`referenced-not-landed` 命名两个缺失核）——证明门校验的是「落地」而非 reference-doc 声明（声明已从 init/SKILL.md 移除）
- [x] AC5: **冷启动可读**——`--loop` 铺设后目标项目能读到三份核；`--for-task` scoped 门绿
  - 证据：`--loop --manager` 铺设后目标 `orchestration/{orchestrator,fast-mode,manager}-tick-core.md` 三份齐全且与 `plugin/loop/` 正本字节一致（可读）；`bash scripts/test.sh --for-task gap-ac37-exec-core-ships-with-package --allow-thin` 退出 0（见 Evidence）。注：裸 `--for-task` 报 `test-selection-thin`（9 条 Touches 中 6 条是 .md 文档/任务文件、无 basename 配对测试，选择器判定 0.33<0.5）——这是选择器对文档重型任务的覆盖度判定，非测试失败；所选测试 18/18 全绿，`--allow-thin` 为机制规定的豁免路径

## Evidence

**Contract measure（exec_core_ships ≥ 3）**——`--loop` 铺设（默认）输出 tick-core 命中：
```
$ bash plugin/scripts/quay-init.sh --loop --root <tmp> --project proj --test-command 'node --test' --tmux-session 'proj-0:0.0' --worktree-root <disk> 2>/dev/null | grep -c tick-core
3
```

**Contract invoke（默认 `--loop` 铺设后目标项目 orchestration/ 文件清单）**：
```
$ ls <tmp>/orchestration/ | grep tick-core
fast-mode-tick-core.md
orchestrator-tick-core.md
# （manager-tick-core.md 不落 —— opt-in；输出含 "skip (opt-in): orchestration/manager-tick-core.md"）
```

**Contract invoke（`--loop --manager` 铺设后三份齐全）**：
```
$ ls <tmp>/orchestration/ | grep tick-core
fast-mode-tick-core.md
manager-tick-core.md
orchestrator-tick-core.md
$ bash plugin/scripts/quay-init.sh --loop --manager --root <tmp> ... 2>&1 | grep verify-referenced
  verify-referenced-landed: OK (every referenced file is landed or declared self-create/reference-doc; every laid-down script's same-dir dependency is landed)
```

**referenced⊆landed 自动生效（AC4，不新建检查）**——`plugin/test/quay-init.test.mjs` AC4：从 plugin/loop/ 删掉两份默认核后 install 输出：
```
FAIL (referenced-not-landed): orchestration/orchestrator-tick-core.md ...
FAIL (referenced-not-landed): orchestration/fast-mode-tick-core.md ...
ERROR: quay-init --loop would ship skills/tick docs that reference files it does not lay down (referenced ⊆ landed violated).
```

**scoped 测试**：`bash scripts/test.sh --for-task gap-ac37-exec-core-ships-with-package --allow-thin` 退出 0（18/18 全绿，cancelled 0）：
```
warning: test-selection-thin: task gap-ac37-exec-core-ships-with-package resolved tests for 3/9 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
EXIT=0
```
静态检查全过（task-contract-check: no violations / adr016 / superseded-capability / dead-code-after-return / strategic-doc / test-impl-census）+ 新增 `plugin/test/quay-init.test.mjs` 4 测试全绿（AC2/AC3/AC4/AC5）+ 既有 `quay-init-check-drift`（10/10）/ `quay-init-drift-report` / `quay-init-laydown-closure`（5/5）全绿。裸 `--for-task` 的 `test-selection-thin` 是选择器对文档重型任务（9 条 Touches 中 6 条 .md 文档/任务文件）的覆盖度判定，非测试失败——`--allow-thin` 为机制规定的豁免路径（AC5 注已写）。

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：`quay-init.sh | grep -c tick-core` > 0 + 目标项目读核（贴输出）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/quay-init.sh（AC2/AC3：derive_loop_scripts 加三份核 + --manager opt-in）
- `plugin/loop/manager-tick-core.md`（AC3：随包正本——从 orchestration/ 复制）(new)
- `plugin/loop/orchestrator-tick-core.md`（AC2：随包正本）(new)
- `plugin/loop/fast-mode-tick-core.md`（AC2：随包正本）(new)
- orchestration/manager-tick-core.md / orchestrator-tick-core.md / fast-mode-tick-core.md（随包正本的源）
- `plugin/test/quay-init.test.mjs`（AC2-AC5：派生集含核 + opt-in + referenced⊆landed）(new)
- plugin/scripts/known-load-sensitive.ts（头注释补「收编到 serial 相仅应在证明并发造成后执行」裁定——manager 2026-08-10 建议放机制正本；C15 已在 orchestrator-tick-core.md 落 git 跟踪，此为同裁定的机制侧载体）
- tasks/gap-ac36-delivery-critical-priority-axis.md（交叉标注——本任务将作 AC36 ③ 的活体样本）
- tasks/gap-ac37-exec-core-ships-with-package.md（自身：勾 AC + 贴证据）

## Contract

measure   exec_core_ships = `bash plugin/scripts/quay-init.sh 2>/dev/null | grep -c tick-core` 的 stdout 数字
band      exec_core_ships >= 3（三份核进派生集）
invariant manager_core_optin = 1（--manager 时才铺 manager 核）
invariant referenced_landed_holds = 1（:1081 门对三份核生效）
invoke    `bash plugin/scripts/quay-init.sh --loop --root <temp-dir>`（贴目标项目 plugin/loop/ 文件清单）
control   派生集含核；manager opt-in；referenced⊆landed 生效；冷启动可读
resume    派生集 / opt-in / 冷启动分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 本阶段（产品化交付）第二优先（人指定顺序 AC36→AC37）。执行核零交付实证（三份 MISSING + quay-init 0 命中）。处方=进 derive_loop_scripts ⇒ referenced⊆landed 自动生效。manager 份 --manager opt-in（人裁定两层典型路径）。实现归 inner。AC37 完成后将作 AC36 ③ 的活体样本（打 delivery-critical label → 观察下一次派发取走）
