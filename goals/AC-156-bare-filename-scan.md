---
id: AC-156
title: 注册表/清单裸文件名扫描（AC158 的前置）
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12f。
---

**判据（能取假）**：按 SPEC §12f 对 97 个死集跑一趟**注册表/清单裸文件名扫描**（对象：`quay-deliver.ts`
这类以数组/映射登记脚本的地方、`*.json` 清单；⛔ `capability-catalog.sh` 不算引用——它是对种群的描述
不是使用）。命中的逐个判、从死集摘出，**扫描后死集数写回 SPEC §12e**。

**取假**：SPEC 里没有 before/after 两个数字 ⇒ 未做。


