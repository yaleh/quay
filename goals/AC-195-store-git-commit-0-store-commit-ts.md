---
id: AC-195
title: 单一提交原语：五个 store 文件中自己实现 git commit 的 = 0（全部委托 store-commit.ts）
status: achieved
kind: criterion
goal: GOAL-008
criterion: |
  n="$(grep -l '"commit",' packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts packages/quay-native/src/store.ts 2>/dev/null | wc -l)"
  test "$n" -eq 0 || { echo "CAUSE=store-writes-raw-commit — 绕过 commitStoreWrite 直接写 commit 字段的 store 文件数 n=$n ≠ 0" >&2; exit 1; }
  exit 0
expect: 今天读数 3（goal-store / meta-store / quay-native store 各一份独立实现）⇒ 红。落地后 0。失败时 exit 1 且 stderr 携带 `CAUSE=…` 成因——⛔ `echo … >&2` 与 `exit 1` 必须写在【同一行】：`plugin/scripts/criterion-failure-attribution-check.ts` 逐行判定，拆两行会被判裸退出并打红棘轮（GOAL-009 AC-241 纪律；2026-09-12 gap-criterion-attribution-blind-to-silent-terminal-command）。
origin: SPEC-store-commit-unification-2026-09-08 §3。今天 store 层有 3 份互不相同的 git
  add/commit 实现（另有 fan-in/ff-merge.ts:185 属收敛路径，不在本 AC 范围）。按位置判定：grep 模式用
  `"commit",`（代码位置标记）而非 `--no-verify`（后者在 store.ts 里有一处注释命中 ⇒ 假阳性，硬规则 2）。
---
