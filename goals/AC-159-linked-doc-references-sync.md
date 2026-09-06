---
id: AC-159
title: 三个连带文档提及同步清理
status: draft
kind: criterion
goal: GOAL-003
criterion: |
  node --experimental-strip-types plugin/scripts/l1-delivery-surface-check.ts --surface
expect: "exit 0（surface-categories-covered 全覆盖；散文写「仍报 6/6」，本仓当前 SPEC 实为 5/5——散文漂移物证）"
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役」。正本 SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
  §12e 表格逐行点名的落点。
---

**判据（能取假）**：`l1-delivery-surface-check.ts --surface` 仍报 **6/6**（六类交付物全部有交付物 +
owning task）。

**取假**：漏改 `SPEC-complete-delivery-surface:240` 的机读行 ⇒ 第 6 类交付物缺失 ⇒ 5/6。

**⊢ 散文漂移物证**：散文写「仍报 6/6」，而本仓当前 SPEC 实为 5 类（实测输出 `surface-categories-covered: 5/5`）
——本条判据的可跑命令退出 0 = 全部类别覆盖，与「6/6」的意图一致，但数字随 SPEC 类别数而变，
**这正是「散文不能继续当权威」的同一类物证**。
