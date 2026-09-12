---
id: AC-156
title: 注册表/清单裸文件名扫描（AC158 的前置）
status: achieved
kind: criterion
goal: GOAL-003
criterion: |-
  f=orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
  if ! grep -qE '^- 扫描前死集: [0-9]+$' "$f"; then
    echo "CAUSE=missing-before-deadset-line — $f 缺「- 扫描前死集: N」机读行（只有散文叙述不算）" >&2; exit 1
  fi
  if ! grep -qE '^- 扫描后死集: [0-9]+$' "$f"; then
    echo "CAUSE=missing-after-deadset-line — $f 缺「- 扫描后死集: M」机读行（只有散文叙述不算）" >&2; exit 1
  fi
  exit 0
expect: "exit 0（SPEC §12e 同时含机读行 `- 扫描前死集: N` 与 `- 扫描后死集: M`；只有散文叙述不算——两个数字缺一即假）。失败时 exit 1 且 stderr 携带 `CAUSE=…` 成因——⛔ `echo … >&2` 与 `exit 1` 必须写在【同一行】：`plugin/scripts/criterion-failure-attribution-check.ts` 逐行判定，拆两行会被判裸退出并打红棘轮（GOAL-009 AC-241 纪律；2026-09-12 gap-criterion-attribution-blind-to-silent-terminal-command）。"
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12f。
---

**判据（能取假）**：按 SPEC §12f 对 97 个死集跑一趟**注册表/清单裸文件名扫描**（对象：`quay-deliver.ts`
这类以数组/映射登记脚本的地方、`*.json` 清单；⛔ `capability-catalog.sh` 不算引用——它是对种群的描述
不是使用）。命中的逐个判、从死集摘出，**扫描后死集数写回 SPEC §12e**。

**取假**：SPEC 里没有 before/after 两个数字 ⇒ 未做。


