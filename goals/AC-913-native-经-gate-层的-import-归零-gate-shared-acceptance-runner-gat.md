---
id: AC-913
title: native 经 gate/ 层的 import 归零（gate/shared/acceptance-runner +
  gate/gate-event-store 改指 core 真身或 exports）
status: draft
kind: criterion
goal: GOAL-908
criterion: "n=$(grep -rnE 'quay/src/gate/' packages/quay-native/src/ 2>/dev/null
  | wc -l); if [ \"$n\" -ne 0 ]; then echo \"native imports $n gate-layer
  path(s) (want 0)\" >&2; exit 1; fi; echo \"OK: native imports 0 gate-layer
  paths\""
expect: 正向：packages/quay-native/src 下不再有 `quay/src/gate/` 的 import（grep 计数
  0）；gate/shared/acceptance-runner 与 gate/gate-event-store 两条改指 core
  真身（core/acceptance-runner.ts / core/gate-event-store.ts）或经 package.json
  exports。反向（能取假）：故意保留一条 gate/ 层 import ⇒ 判据红（计数 1，stderr 写 cause）；移除 ⇒ 绿。只断
  gate/ 层归零，不断 kernel/*（合法共享叶）与 abi.ts（公开 ABI 面）。
origin: 架构分析 G-3（native 经 gate 层 2 条转发 shim import，绕过 provider 只依赖 ABI 表面）
---
