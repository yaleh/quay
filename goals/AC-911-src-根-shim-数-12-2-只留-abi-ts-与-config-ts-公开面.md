---
id: AC-911
title: src 根 shim 数 12→2（只留 abi.ts 与 config.ts 公开面）
status: active
kind: criterion
goal: GOAL-907
criterion: "n=$(grep -rln 'FORWARDING re-export' packages/quay/src/*.ts | wc
  -l); if [ \"$n\" -ne 2 ]; then echo \"src-root shim count is $n (want 2:
  abi.ts + config.ts)\" >&2; exit 1; fi; echo \"OK: src-root shim count = 2\""
expect: 正向：packages/quay/src 根下带「FORWARDING re-export」头注释的 shim 恰剩 2 个（abi.ts 与
  config.ts，公开 ABI 面），其余 10
  个（adr-store/branch-model/contract-validator/criterion-fidelity/document-store/frontmatter-store-base/goal-store/plugin-root/store-commit/worktree-namespace）已删且消费方改指
  core/。反向（能取假）：保留第 3 个 shim ⇒ 判据红（计数 3，stderr 写 cause）；删至 2 ⇒ 绿。criterion cwd =
  git 根，`grep -rln` 只统计含该头注释的文件，非关键词误匹配。
origin: 架构分析 G-2（12 个 FORWARDING re-export shim 实测，留 abi.ts+config.ts 作公开面）
activatedAt: 2026-10-21T02:13:59.072Z
statusLog:
  - at: 2026-10-21T02:13:59.072Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-21T02:13:59.071Z
---
