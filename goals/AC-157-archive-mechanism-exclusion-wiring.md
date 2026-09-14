---
id: AC-157
title: archive 机制落地 + 五个排除面接线（AC158 的前置）
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  [ "$(head -1 archive/INDEX.tsv | awk -F'\t' '{print NF}')" = 7 ] || { echo
  "AC-157 fail: archive/INDEX.tsv header does not have exactly 7 tab-separated
  fields" >&2; exit 1; }

  for f in plugin/scripts/capability-catalog.sh
  plugin/scripts/runtime-usage-inventory.ts scripts/test.sh
  plugin/scripts/laydown-set-check.sh scripts/version-consistency-check.ts; do
    [ -e "$f" ] || { echo "AC-157 fail: exclusion surface $f does not exist" >&2; exit 1; }
    grep -vE '^[[:space:]]*(#|//|\*)' "$f" | grep -q 'archive/' || { echo "AC-157 fail: $f has no non-comment line referencing archive/" >&2; exit 1; }
  done

  exit 0
expect: exit 0（archive/INDEX.tsv 表头恰 7 个 tab 字段 ∧ 五个排除面各自在【非注释行】引用 archive/；任一缺失即假）
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12a。
---

**判据（能取假）**：archive 机制落地——`archive/<日期>-<slug>/<保持原始相对路径>` + `archive/INDEX.tsv`
（SPEC §12a 的七字段）+ **五个排除面接线**（`capability-catalog.sh` / `runtime-usage-inventory.ts` /
`scripts/test.sh` 测试 glob / laydown 交付面闭包 / `version-consistency-check.ts`）。

**取假**：随便 archive 一个文件后跑全量 suite——**不接线必红**；接线后应绿。


