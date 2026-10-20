---
id: AC-198
title: root 取自 git rev-parse --show-toplevel，不再把 path.dirname(<kind>Dir) 当 git 根
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  # >>> rev-parse-root

  # This block is run VERBATIM by
  packages/quay/test/ac198-criterion-rev-parse-root.test.mjs.

  #

  # THE PROPERTY: every store write resolves the git root through `git rev-parse
  --show-toplevel`

  # instead of assuming a `<kind>Dir` sits directly under the repository root,
  and the shared

  # store-commit primitive derives its DEFAULT root from that resolver.

  #

  # ⛔ WHY IT IS SYMBOL-ANCHORED, NOT PATH-ANCHORED. The previous text pinned the
  `rev-parse`

  # reading to the pre-refactor src-root carrier path of the store-commit
  primitive. 35dc5da93

  # (refactor(core): sink the gate substrate into src/core, 2026-10-18) moved
  the implementation

  # DOWN into src/core/ and left the historical src-root path as a pure
  forwarding re-export whose

  # own header forbids re-adding implementation ("a body kept here would put the
  src root back in

  # the gate cycle the move removed"). The guarantee was never lost — it got
  strictly better (one

  # implementation + one forwarding surface) — only the path-keyed criterion
  rotted. So this block

  # locates the carrier BY SYMBOL (`export function commitStoreWrite`) and
  measures STRUCTURE, so

  # the next move of that module cannot silently break it again:

  #   ① zero occurrences of the two banned `path.dirname(<kind>Dir)` root
  literals in packages/quay/src;

  #   ② EXACTLY ONE module under packages/quay/src DEFINES commitStoreWrite (no
  second parallel

  #      primitive) — this count is also what SELECTS the carrier module
  measured by ③ and ④;

  #   ③ the resolveGitRoot FUNCTION BODY (⛔ not the whole file — a mention in a
  comment is not a

  #      measurement) carries both `rev-parse` and `--show-toplevel`;

  #   ④ the commitStoreWrite FUNCTION BODY wires its default root to
  `resolveGitRoot(`.

  #

  # ⛔ Do NOT satisfy this by pasting the implementation (or a stray `rev-parse`
  comment) back into

  # the forwarding shim, and do NOT widen any arm from "function body" to "file
  contains".


  n="$(grep -rn 'const root = path.dirname(goalDir)' packages/quay/src | wc -l)"

  test "$n" -eq 0 || { echo "CAUSE=dirname-goaldir-root — packages/quay/src
  still has $n goal-store line(s) using path.dirname(goalDir) as the git root"
  >&2; exit 1; }


  n="$(grep -rn 'const root = path.dirname(metaDir)' packages/quay/src | wc -l)"

  test "$n" -eq 0 || { echo "CAUSE=dirname-metadir-root — packages/quay/src
  still has $n meta-store line(s) using path.dirname(metaDir) as the git root"
  >&2; exit 1; }


  mod="$(grep -rl 'export function commitStoreWrite' packages/quay/src
  --include='*.ts')"

  n="$(printf '%s\n' "$mod" | sed '/^$/d' | wc -l)"

  test "$n" -eq 1 || { echo "CAUSE=primitive-definition-count-not-1 — modules
  under packages/quay/src defining export function commitStoreWrite: n=$n (want
  exactly 1); got: $mod" >&2; exit 1; }


  awk '/export function resolveGitRoot\(/{f=1} f{print} f&&/^}/{exit}' "$mod" |
  grep -q 'rev-parse' || { echo "CAUSE=resolvegitroot-not-rev-parse — the
  resolveGitRoot function body in $mod does not call git rev-parse" >&2; exit 1;
  }


  awk '/export function resolveGitRoot\(/{f=1} f{print} f&&/^}/{exit}' "$mod" |
  grep -q -- '--show-toplevel' || { echo "CAUSE=resolvegitroot-no-show-toplevel
  — the resolveGitRoot function body in $mod does not pass --show-toplevel" >&2;
  exit 1; }


  awk '/export function commitStoreWrite\(/{f=1} f{print} f&&/^}/{exit}' "$mod"
  | grep -q 'resolveGitRoot(' || { echo
  "CAUSE=primitive-root-not-from-resolvegitroot — the commitStoreWrite function
  body in $mod does not derive its default root from resolveGitRoot(" >&2; exit
  1; }


  echo "OK — git root from rev-parse --show-toplevel: 0 banned
  path.dirname(<kind>Dir) roots; exactly 1 module defines commitStoreWrite
  ($mod); its resolveGitRoot body carries rev-parse + --show-toplevel; its
  commitStoreWrite body wires the default root to resolveGitRoot("


  # <<< rev-parse-root


  exit 0
expect: 重锚后立即读（cwd = 仓库根）：packages/quay/src 下两个被禁字面量计数 = 0；`export function
  commitStoreWrite` 的定义模块数 = 1（今天 = packages/quay/src/core/store-commit.ts）；该模块
  resolveGitRoot 函数体内同时出现 rev-parse 与 --show-toplevel；该模块 commitStoreWrite
  函数体内出现 resolveGitRoot( ⇒ exit 0。失败时 exit 1 且 stderr 携带具名
  `CAUSE=`（dirname-goaldir-root / dirname-metadir-root /
  primitive-definition-count-not-1 / resolvegitroot-not-rev-parse /
  resolvegitroot-no-show-toplevel / primitive-root-not-from-resolvegitroot）——⛔
  `echo … >&2` 与 `exit 1`
  必须写在【同一行】：plugin/scripts/criterion-failure-attribution-check.ts
  逐行判定，拆两行会被判裸退出并打红棘轮（GOAL-009 AC-241 纪律）。⛔ 本条不再把 rev-parse 钉在重构前的 src-root
  载体路径上——载体按符号（export function commitStoreWrite）解析，实现模块再搬家仍能取到量（硬规则
  4c）；旧文本的逐字归档在 origin 字段。
origin: |-
  SPEC §3 不可协商第 1 条 / 硬规则 4 推论二。path.dirname(goalDir) 假设 goals/ 直接躺在仓库根下——今天恰好成立，换布局或在 worktree 里就静默指向错误的根。quay-native/src/store.ts 已经是对的写法（git rev-parse --show-toplevel），本 AC 把它推广到全部 kind。

  ⛔ 2026-10-20 重锚（gap-ac198-criterion-rev-parse-root-carrier-stale）。被退役的旧谓词逐字归档于此（它曾断言三件事：root 取自 rev-parse、不拿 path.dirname(<kind>Dir) 当 git 根、原语用 rev-parse）：

  test "$(grep -rn 'const root = path.dirname(goalDir)' packages/quay/src | wc -l)" -eq 0 || { echo "AC-198 fail - packages/quay/src goal-store 仍用 path.dirname(goalDir) 当 root" >&2; exit 1; }
  test "$(grep -rn 'const root = path.dirname(metaDir)' packages/quay/src | wc -l)" -eq 0 || { echo "AC-198 fail - packages/quay/src meta-store 仍用 path.dirname(metaDir) 当 root" >&2; exit 1; }
  grep -q 'rev-parse' packages/quay/src/store-commit.ts || { echo "AC-198 fail: packages/quay/src/store-commit.ts does not use rev-parse to resolve the root" >&2; exit 1; }

  为什么改：前两条今天仍为真（计数 0），第三条在真实树上结构性失效——它把 rev-parse 的读数钉在重构前的 src-root 载体路径上。35dc5da93（refactor(core): sink the gate substrate into src/core to break the ""<->gate directory SCC，2026-10-18，已是 develop 祖先）把 gate 底座下沉到 packages/quay/src/core/，该 src-root 路径只留纯转发再导出（其头注释明写「⛔ Do not re-add implementation here」——回填实现会把 src root 重新拉进刚拆掉的 gate 目录环）。保证本身没有丢：实现唯一（core/store-commit.ts 的 resolveGitRoot 调 git rev-parse --show-toplevel），今天还更强。丢失的是判据的载体 —— 硬规则 4c 撰写侧失败：判据点名的量在「产生处 → 读取处」之间的那次重构里被搬走了。

  修法：按符号定位实现模块（export function commitStoreWrite 的定义模块数必须恰为 1），再用 awk 截取 resolveGitRoot / commitStoreWrite 的函数体分别断言 rev-parse + --show-toplevel 与 resolveGitRoot( —— ⛔ 整文件 grep 会被注释满足（硬规则 2），⛔ 也不把谓词放宽成「packages/quay/src 任意位置出现 rev-parse」。同族教训：reanchored-criterion-rationale-must-not-quote-the-retired-pin（旧字面量归档在 origin，不在 criterion）。
---
