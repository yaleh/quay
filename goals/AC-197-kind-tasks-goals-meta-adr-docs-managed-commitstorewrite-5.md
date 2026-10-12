---
id: AC-197
title: 五 kind 齐备：tasks/goals/meta/adr/docs-managed 全部接线 commitStoreWrite = 5
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  # >>> five-kind-wiring

  # This block is run VERBATIM by
  packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs.

  #

  # THE PROPERTY: all five store kinds (tasks / goals / meta / adr /
  docs-managed) are wired to the ONE

  # shared store-commit primitive. The predicate is STRUCTURAL — ① the primitive
  module exports both the

  # four-state primitive `commitStoreWrite` AND the single per-kind wrapper
  `commitKindFile`, which

  # DELEGATES to it (no second parallel primitive); ② each of the five store
  files depends on that module

  # and carries a CALL SITE on it.

  #

  # ⛔ WHY IT IS NOT KEYED ON THE IDENTIFIER ANY MORE. The previous text counted
  files containing the

  # literal `commitStoreWrite` (a `grep -l` for that one name over the five
  store files, piped to `wc -l`, == 5). That measured "does this

  # function name appear in these five files", not "are the five kinds wired" —
  and 943ef47f6

  # (store-commit: one commitKindFile wrapper replaces four per-kind copies)
  folded the four byte-identical

  # per-kind copies into the single shared wrapper, deleting the literal from
  four of the five files. The

  # five-kind guarantee was never lost (it is stronger now: one primitive + one
  wrapper); only the

  # identifier disappeared. So the pin must be STRUCTURAL, and it must survive
  the next dedup of the same

  # family: ⛔ do NOT re-pin it to the literal `commitStoreWrite`, and ⛔ do NOT
  restore a per-kind copy to

  # make an identifier reappear (store-commit.ts:203 forbids a per-kind prefix
  there).

  #

  # ⚠️ KNOWN OVER-INCLUSION, stated rather than hidden: `grep -q
  'store-commit\.ts'` also matches a line

  # that merely MENTIONS the module inside a comment. This is the predicate's
  acknowledged

  # over-approximation of the import surface — it is ⛔ NOT a precise import
  parser, and the margin is NOT

  # to be widened further (the call-site half of the conjunction is what keeps
  it non-vacuous).

  prim="packages/quay/src/store-commit.ts"

  grep -q 'export function commitStoreWrite' "$prim" || { echo
  "CAUSE=primitive-missing — $prim 未导出四态原语 commitStoreWrite" >&2; exit 1; }

  grep -q 'export function commitKindFile' "$prim" || { echo
  "CAUSE=wrapper-missing — $prim 未导出每 kind 包装 commitKindFile" >&2; exit 1; }

  awk '/export function commitKindFile/{f=1} f{print} f&&/^}/{exit}' "$prim" |
  grep -q 'commitStoreWrite(' || { echo "CAUSE=second-primitive — commitKindFile
  未委托 commitStoreWrite（出现第二套并行原语）" >&2; exit 1; }

  n=0

  for f in packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts
  packages/quay/src/adr-store.ts packages/quay/src/document-store.ts
  packages/quay-native/src/store.ts; do
    grep -q 'store-commit\.ts' "$f" && grep -qE 'commit(StoreWrite|KindFile|StoreBatch)\(' "$f" && n=$((n+1))
  done

  test "$n" -eq 5 || { echo "CAUSE=store-commit-call-site-missing-in-all-5 —
  依赖并调用共享原语的 store 文件数 n=$n ≠ 5（五种 kind：tasks/goals/meta/adr/docs-managed）" >&2;
  exit 1; }

  echo "OK — one shared store-commit primitive (commitStoreWrite + delegating
  commitKindFile) and 5/5 store kinds wired to it (module dependency + call site
  each)"

  # <<< five-kind-wiring

  exit 0
expect: 重锚后立即读：共享原语模块 packages/quay/src/store-commit.ts 同时导出四态原语
  commitStoreWrite 与委托它的每 kind 包装 commitKindFile，且五个 store 文件逐一「依赖
  store-commit.ts ∧ 出现一次调用」⇒ exit 0。失败时 exit 1 且 stderr 携带具名
  `CAUSE=`（primitive-missing / wrapper-missing / second-primitive /
  store-commit-call-site-missing-in-all-5）——⛔ `echo … >&2` 与 `exit 1`
  必须写在【同一行】：plugin/scripts/criterion-failure-attribution-check.ts
  逐行判定，拆两行会被判裸退出并打红棘轮（GOAL-009 AC-241 纪律；2026-09-12
  gap-criterion-attribution-blind-to-silent-terminal-command）。⛔ 本条不再要求五个 store
  文件出现字面量 commitStoreWrite —— 那是旧文本的 identifier 键化，已被 943ef47f6
  的去重结构性作废（gap-ac197-criterion-commitstorewrite-identifier-pin-stale，2026-10-13
  复盘）。
origin: >-
  SPEC §4 声明表 + 人 2026-09-08 裁定「adr / docs-managed 也要有 commit-after-write」。今天
  adr-store.ts 与 document-store.ts 完全没有提交路径（grep commit = 0），是五个 kind 里唯二写盘不提交的。


  ⛔ 2026-10-13
  重锚（gap-ac197-criterion-commitstorewrite-identifier-pin-stale）：原谓词逐字是
  `n="$(grep -l commitStoreWrite <五个 store 文件> | wc -l)"; test "$n" -eq 5` ——
  它键在一个标识符上，测的从来不是「五 kind 是否经统一原语提交」。943ef47f6（store-commit: one commitKindFile
  wrapper replaces four per-kind copies，2026-10-12T16:34:36Z，已是 develop
  祖先）把四份字节相同的 per-kind 拷贝折叠成单一共享包装 commitKindFile，四份拷贝里的字面量随之消失 ⇒ 实测 n=1（唯一命中
  packages/quay-native/src/store.ts），判据在真实树上结构性失效。五 kind 的保证从未丢失、今天还更强（一个原语 +
  一个共享包装），故修法是重锚到结构（共享原语模块依赖 + 调用面），⛔ 不是把字面量塞回四个 store 文件（store-commit.ts:203 明禁
  per-kind prefix
  回退）。同族教训：extraction-ratchet-must-key-on-structure-not-identifiers。
---
