---
id: AC-196
title: 四态返回：输出词表含 not-in-git 与 unchanged，旧 boolean 提交函数 = 0
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  # >>> four-state-vocabulary


  # This block is run VERBATIM by
  packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs.


  #


  # THE PROPERTY: the store-commit primitive's return vocabulary has FOUR states

  # (committed | unchanged | not-in-git | failed), so "not in a git work tree",
  "content unchanged so the

  # commit was skipped", and "the commit really failed" are three DISTINCT
  readings instead of one

  # boolean (hard rule 3b: a verdict whose word-list has no "not evaluated"
  state cannot tell "checked

  # and clean" from "never checked"). The predicate is STRUCTURAL:


  #   ① the canonical implementation packages/quay/src/core/store-commit.ts
  exists;


  #   ② the four state names are read OUT OF the `CommitOutcome` DECLARATION
  BLOCK (quotes stripped,

  #      tokenised) — ⛔ a mention inside a comment is not a member of the
  vocabulary;


  #   ③ the retired boolean helpers `commitGoalFileAfterWrite` /
  `commitMetaFileAfterWrite` are gone

  #      from packages/quay/src (count == 0).


  #


  # ⛔ WHY THE IMPORT-SURFACE DIMENSION IS GONE. The previous text asserted that
  the src-ROOT

  # packages/quay/src/store-commit.ts still existed and forwarded to
  ./core/store-commit.ts. That

  # intermediate state is RETIRED: GOAL-907 declared it transitional and AC-911
  (2026-10-21) deleted

  # the src-root forwarding surface outright, so the canonical module is now the
  ONLY path. The

  # guarantee never weakened — it is one implementation, reached by exactly one
  path — and this

  # predicate reads that implementation directly (declaration block +
  retired-helper count), ⛔ not a

  # forwarding file that no longer exists. ⛔ Do NOT "fix" a future red by
  pasting the state names

  # into a new shim, by restoring an implementation at the src root, or by
  re-adding a boolean helper.


  prim="packages/quay/src/core/store-commit.ts"


  test -f "$prim" || { echo "CAUSE=canonical-implementation-missing — $prim 不存在"
  >&2; exit 1; }


  decl="$(awk '/^export type CommitOutcome *=/{f=1} f{print} f&&/;/{exit}'
  "$prim")"


  test -n "$decl" || { echo "CAUSE=outcome-declaration-missing — $prim 里找不到
  export type CommitOutcome 的声明块" >&2; exit 1; }


  tokens="$(printf '%s\n' "$decl" | tr -d '"' | tr '|;=' '\n\n\n' | tr -s
  '[:space:]' '\n' | grep -v '^$')"


  for state in committed unchanged not-in-git failed; do
    printf '%s\n' "$tokens" | grep -qx "$state" || { echo "CAUSE=state-missing:${state} — CommitOutcome 声明块缺 ${state}" >&2; exit 1; }
  done


  n="$(grep -rl 'function commitGoalFileAfterWrite\|function
  commitMetaFileAfterWrite' packages/quay/src | wc -l)"


  test "$n" -eq 0 || { echo "CAUSE=legacy-boolean-commit-functions —
  packages/quay/src 下仍有 ${n} 个文件含旧 boolean 提交函数" >&2; exit 1; }


  echo "OK — CommitOutcome 四态齐备（committed | unchanged | not-in-git |
  failed）；实现唯一（$prim）；旧 boolean 提交函数 = 0"


  # <<< four-state-vocabulary


  exit 0
expect: 重锚后立即读：canonical 实现 packages/quay/src/core/store-commit.ts 的 `export
  type CommitOutcome` 声明块含四态 committed / unchanged / not-in-git / failed（去引号后逐
  token 判，⛔ 注释里提到不算）；packages/quay/src 下旧 boolean 提交函数计数 = 0 ⇒ exit 0。失败时 exit 1
  且 stderr 携带具名 `CAUSE=`（canonical-implementation-missing /
  outcome-declaration-missing / state-missing:<state> /
  legacy-boolean-commit-functions）——⛔ `echo … >&2` 与 `exit 1`
  必须写在【同一行】：plugin/scripts/criterion-failure-attribution-check.ts
  逐行判定，拆两行会被判裸退出并打红棘轮（GOAL-009 AC-241 纪律）。⛔ 本条不再断言 src 根转发面存在——该中间态已由 GOAL-907
  退役、AC-911 删除（2026-10-21），实现唯一在 core/，由此处结构断言；也不再把两个状态名 grep 在重构前的 src-root
  载体上（35dc5da93 之前的形态，gap-ac196-criterion-four-state-vocabulary-carrier-stale
  复盘）。
origin: >-
  SPEC §3 不可协商第 3 条 / 硬规则 3b。goal-store.ts:264 与 meta-store.ts:77 现在把「不在 git
  工作树」「内容没变所以跳过」「commit 真失败」三件事全部返回 false ——
  一个判定的输出词表若没有「未评估」这一态，它就无法区分「查过且合格」与「没查成」。


  ⛔ 2026-10-20
  重锚（gap-ac196-criterion-four-state-vocabulary-carrier-stale）：原谓词逐字把
  `not-in-git` 与 `unchanged` grep 在 `packages/quay/src/store-commit.ts` 上 ——
  那个路径当时是四态实现的家。35dc5da93（refactor(core): sink the gate substrate into src/core
  to break the "<empty>"<->gate directory SCC，2026-10-18T12:29:59Z，已是 develop
  祖先）把实现**下沉**到 `packages/quay/src/core/store-commit.ts`，src-root
  路径保留为纯转发再导出（其头注释明写「⛔ Do not re-add implementation here」——回填实现会把 src root
  重新拉进它刚拆掉的 gate 环路）。保证从未丢失、今天还更强（一处实现 + 一个转发面），失效的只是判据的载体：台账上同一 criterionHash
  `0d68374d922ba1ef` 在 2026-10-20T01:38:44Z 还是 pass（tree bbcbd7bf，提交
  293bba31e），到 2026-10-20T05:19:29Z 变成 fail（tree 79faf890，提交
  2304d9c8a）——判据文本一字未改，翻转纯属树变了（硬规则 4c 撰写侧失败）。修法是**重锚到结构**（import 面转发 / canonical
  实现存在 / 声明块内四态 / 旧 boolean 函数 = 0），⛔ 不是把状态名复制回 shim、⛔ 不是在 src root 重新加实现、⛔
  不是把谓词放宽成「文件里出现某词」。先例：gap-ac197-criterion-commitstorewrite-identifier-pin-stale
  已用同一修法处理同族判据（AC-198 的同类失效由 driver 独立立案，不在本任务范围）。
---
