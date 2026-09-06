---
id: AC-158
title: 执行批次一 —— 扫描后死集 git mv + INDEX 同一提交
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12。
---

**判据（能取假）**：扫描后死集全部 `git mv` 进 archive，**自带测试同批移动**，`git mv` 与 INDEX 行
**同一提交**（硬规则 7）。

**取假**：`plugin/scripts` 计数未下降 / INDEX 行数 ≠ 移动文件数 / suite 红。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
