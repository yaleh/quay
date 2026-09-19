---
id: AC-309
title: kernel/ 建立且被消费：packages/quay/src/kernel/ 下 tracked .ts ≥ 3 个，且 ≥ 3 个文件按
  import 语句位置从 kernel/ 导入
status: active
kind: criterion
goal: GOAL-025
criterion: >
  d=packages/quay/src/kernel

  n=$(git ls-files "$d" | grep -c '\.ts$'); [ "$n" -ge 3 ] || { echo
  "CAUSE=kernel-missing — $d 下 tracked .ts 数 n=$n < 3（3 个叶子原语未迁入）" >&2; exit 1;
  }

  c=$(git grep -lE "^\s*(import|export|\})[^'\"]*from ['\"][^'\"]*/kernel/" --
  'packages/*.ts' 'plugin/scripts/*.ts' ":!$d" | grep -vc '\.test\.'); [ "$c"
  -ge 3 ] || { echo "CAUSE=kernel-not-consumed — 仅 $c 个文件（<3）从 kernel/
  导入，原语迁入但无人消费" >&2; exit 1; }
expect: exit 0（git ls-files 下 kernel 目录 .ts 数 ≥3 ∧ 从 kernel/ 导入的非测试文件数 ≥3）。失败时
  exit 1 且 stderr 携带 CAUSE=…（kernel-missing / kernel-not-consumed）；⛔ echo … >&2
  与 exit 1 写在同一行。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §3 / §8-①，人
  2026-09-19 裁定：「在 packages/quay 内新建 kernel/ 目录」。「迁入但无人消费」与「没迁」同形（硬规则 4
  推论三），故判据含消费者一半。目录可被误删/回退，故 long-term:true。
activatedAt: 2026-09-19T05:29:24.230Z
long-term: true
---
**范围**：新建 `packages/quay/src/kernel/`，迁入 3 个纯叶子原语：`write-json-atomic`（35 行）、`shape-sections`（71 行）、`worktree-process-reaper`（662 行——体量已非「叶子」，迁前先审它的依赖）。边界规则：kernel/ 不得 import 自身之外的任何模块，也不得 import `plugin/`、`experiments/`（由 import-graph-check 的 kernel 规则守）。

**与 AC-307 关系**：通常同一批改动；本条判「目录建成且有消费者」，AC-307 判「反向边清零」。

**⛔ 注意**：`packages/quay/src/primitives/` 是带 PROVENANCE.md 的外来 vendored 文件，性质不同，不要混放。