---
id: AC-933
title: spawn-verify/selfcheck ship 决策成文 + shipped 产物与决策一致
status: achieved
kind: criterion
goal: GOAL-913
criterion: 'if ! grep -q "codex-stage1"
  plugin/scripts/shipped-shell-reachability.ts; then echo "FAIL:
  shipped-shell-reachability.ts has no codex-stage1 ship decision entry" >&2;
  exit 1; fi'
expect: 正向：shipped-shell-reachability.ts 记录了 codex-stage1 的 ship 决策（ship 则标记
  reachable，dev-tree-only 则成文标注）；反向：删掉该决策条目 exit 非 0。产物一致性（build 后校验）由任务测试承担
origin: 人 2026-10-30 裁定：spawn-verify 是否 ship 写进 goal，落地为成文决策 + 一致性判据
activatedAt: 2026-10-30T05:34:54.174Z
statusLog:
  - at: 2026-10-30T05:34:54.174Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-10-30 裁定激活；criterion 是 reading（源文件声明），完整行为由任务测试承担
  - at: 2026-10-30T06:50:14.283Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-30T05:34:54.174Z
phase: pre-merge
---
