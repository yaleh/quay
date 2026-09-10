---
id: AC-198
title: root 取自 git rev-parse --show-toplevel，不再把 path.dirname(<kind>Dir) 当 git 根
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  test "$(grep -rn 'const root = path.dirname(goalDir)' packages/quay/src | wc
  -l)" -eq 0 || { echo "goal-store 仍用 path.dirname 当 root"; exit 1; }

  test "$(grep -rn 'const root = path.dirname(metaDir)' packages/quay/src | wc
  -l)" -eq 0 || { echo "meta-store 仍用 path.dirname 当 root"; exit 1; }

  grep -q 'rev-parse' packages/quay/src/store-commit.ts
expect: 今天读数 2 处（goal-store.ts:265 / meta-store.ts:78）⇒ 红。落地后 0 且原语用 rev-parse。
origin: SPEC §3 不可协商第 1 条 / 硬规则 4 推论二。path.dirname(goalDir) 假设 goals/
  直接躺在仓库根下——今天恰好成立，换布局或在 worktree 里就静默指向错误的根。quay-native/src/store.ts
  已经是对的写法（git rev-parse --show-toplevel），本 AC 把它推广到全部 kind。
---
