---
id: AC-912
title: GOAL-907 退出条件② 需要自己的可跑判据：10 个具名内部 shim 必须真的从 packages/quay/src 根消失（AC-911
  只数头注释，数不到「删除」）
status: active
kind: criterion
goal: GOAL-907
criterion: 'still=""; for m in adr-store branch-model contract-validator
  criterion-fidelity document-store frontmatter-store-base goal-store
  plugin-root store-commit worktree-namespace; do [ -e "packages/quay/src/$m.ts"
  ] && still="$still $m"; done; if [ -n "$still" ]; then echo "internal shims
  still present:$still" >&2; exit 1; fi; echo "OK: 10 internal shims deleted"'
expect: 红→绿：今天 10 个文件全在 ⇒ exit 1 并逐名写出残留；删掉这 10 个后 exit
  0。它测的是文件在不在，不是头注释有没有被抹掉——一棵只删注释、文件仍在原处继续转发的树在这条判据下仍红，在 AC-911 下却已绿。
origin: "readings 里 AC-911 的 criterion 只做 `grep -rln 'FORWARDING re-export'
  packages/quay/src/*.ts | wc -l`（本轮 verdict=fail，reason='src-root shim count is
  12'），而同一 AC 的 expect 与 GOAL-907 标题要求的是「删 10 个内部
  shim」；tasks/gap-goal907-add-exit-conditions.md 已逐字记录该缺口（「一棵把 10 个 shim
  的头注释删掉、文件仍留在原处继续转发的树，同一判据读数仍为 2 ⇒ 绿」），并把它写成 GOAL body 的 ##
  退出条件②，但没有落成可跑判据；今日按本条 criterion 干跑 exit 1，逐名列出 10 个残留文件。AC-911
  本身保留不动（是否退役它仍是人的决定）。"
activatedAt: 2026-10-21T05:31:27.467Z
statusLog:
  - at: 2026-10-21T05:31:27.467Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-21T05:31:27.467Z
---
