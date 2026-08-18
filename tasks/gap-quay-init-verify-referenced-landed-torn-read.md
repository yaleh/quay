---
id: gap-quay-init-verify-referenced-landed-torn-read
title: quay-init.sh verify_referenced_landed() 完整性哨兵 torn read——只钉 2 条 always-present 行，丢后面声明 ⇒ declared ref 被 false-positive 成 not-declared ⇒ worktree-root-fs-check AC4 30s 超时（directory-lock fan-in 实证）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（inner 实测 + outer 复核，2026-08-18 01:3xZ）**：`gap-directory-level-tasks-touch-global-lock` fan-in 的 suite **AC4 RED**（「a real disk worktree root proceeds」30s 超时），根因不在 slot-refill（directory-lock 自身无回归），而在 **`quay-init.sh` 的 `verify_referenced_landed()` 完整性哨兵**。

**根因（读代码核实）**：`verify_referenced_landed()` 只钉 **2 条 always-present 行**（tick-log.md + manager-tick-log.md）做完整性哨兵——**torn read 可保住这 2 行却丢后面的声明**（实测 SPEC-methodology-as-a-deliverable.md @line173）⇒ declared ref 被 false-positive 成 not-declared ⇒ worktree-root-fs-check AC4 超时。这是**真 pre-existing bug**（torn-read 完整性检测设计缺陷），非 directory-lock 回归。

**与 directory-lock 的关系**：suite-fix agent 已修（哨兵换 stability check：SKILL.md 两次独立读声明集必须一致，torn read 必异故重试）——**这是跨域修复，quay-init.sh 不在 directory-lock Touches** ⇒ directory-lock land 时 anti-drift（eaa428f1，刚落地）会 HARD FAIL。**裁定：提取为独立任务**——directory-lock 任务本身是「Touches 诚实性」的修复者，背一个跨域修复恰是其反题；quay-init 修复自己有 Touches + AC。

**能取假（⊢ 对照）**：修复后，quay-init.sh 的 `verify_referenced_landed()` 对 torn read（部分读到的声明集）判定为「未一致」而非「已 landed」——stability check 两次独立读声明集一致才通过；worktree-root-fs-check AC4 不再 30s 超时（无需 suite-fix 干预）。

## Plan

1. 读 `quay-init.sh` 的 `verify_referenced_landed()`（现状：只钉 2 条 always-present 行）。
2. 实现 stability check：SKILL.md（或扫描目标文件集）**两次独立读**声明集必须一致，torn read 必异故重试（suite-fix agent 已写的形态，验证后采纳/落盘）。
3. 确认 worktree-root-fs-check AC4 恢复（30s 内完成，不再超时）。
4. **land 顺序**：本任务先 land（own Touches + AC）→ directory-lock re-merge develop（拿到 quay-init 修复）→ suite（AC4 绿）→ land。directory-lock 的 branch 不带 quay-init.sh 改动（避免 anti-drift HARD FAIL）。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: `verify_referenced_landed()` 换 stability check（两次独立读声明集一致才通过），torn read 不再 false-positive declared→not-declared。
- [x] AC2: worktree-root-fs-check AC4 恢复（30s 内完成），directory-lock fan-in 不再被它 RED。
- [x] AC3: directory-lock 的 land 不带 quay-init.sh（跨域修复隔离），anti-drift 不再 HARD FAIL。
- [x] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] quay-init.sh 哨兵换 stability check（torn-read 免疫），AC4 恢复，directory-lock 跨域隔离 land，scoped + 全量绿。

## Land 顺序（跨域修复隔离）

本任务先 land（quay-init.sh stability check 修复，own Touches + AC）→ directory-lock（gap-directory-level-tasks-touch-global-lock）再 re-merge develop 拿到本修复 → 其 suite（worktree-root-fs-check AC4）应绿 → 再 land。directory-lock 的 branch **不带** quay-init.sh 改动（跨域修复隔离，AC3），否则其 land 的 anti-drift（eaa428f1）会对未声明的 quay-init.sh 改动 HARD FAIL。注记放本任务体而非 directory-lock 任务文件：后者在另一 worktree 在飞（AC 已勾 + Evidence），同文件同区域追加会与其 fan-in 合并冲突。

## Touches

- plugin/scripts/quay-init.sh（verify_referenced_landed() 哨兵换 stability check）
- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（torn-read 回归测试：stability 重试 + pass-through 控制 + 真实缺失 ref 负控制）
- tasks/gap-quay-init-verify-referenced-landed-torn-read.md（自身）
