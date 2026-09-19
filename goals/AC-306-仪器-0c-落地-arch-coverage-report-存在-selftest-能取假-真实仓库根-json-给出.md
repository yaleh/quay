---
id: AC-306
title: 仪器 0c 落地：arch-coverage-report 存在、--selftest 能取假、真实仓库根 --json 给出 ts/sh/mjs
  三行的 analyzed|NOT-EVALUATED 状态
status: active
kind: criterion
goal: GOAL-025
criterion: |
  f=plugin/scripts/arch-coverage-report.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在（Phase 0c 仪器未落地）" >&2; exit 1; }
  node --experimental-strip-types "$f" --selftest >/dev/null 2>&1 || { echo "CAUSE=selftest-failed — $f --selftest 非零（注入用例不能取假）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const ok=r=>r.status==="analyzed"||r.status==="NOT-EVALUATED";process.exit(j.evaluated===true&&Array.isArray(j.languages)&&["ts","sh","mjs"].every(l=>j.languages.some(r=>r.language===l&&ok(r)))?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=not-evaluated-on-real-tree — $f --json 未给出 evaluated:true 及 ts/sh/mjs 三行的 analyzed|NOT-EVALUATED 状态" >&2; exit 1; }
expect: exit 0（报告存在 ∧ --selftest 通过 ∧ 真实仓库根 --json 给出 evaluated:true 且 ts、sh、mjs
  三行各带 analyzed|NOT-EVALUATED 状态）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与
  exit 1 写在同一行。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §5 Phase
  0c。实测缘由：archguard 默认 global scope 只指向 packages/quay/src，plugin/scripts 是独立
  scope 且被当成单个 (root) 包；约 300 个手写 .mjs/.js 与 144 个 .sh 完全不被解析——「0 环」只能读作「未评估」。
activatedAt: 2026-09-19T05:29:19.270Z
---
**对应任务**：`gap-arch-coverage-self-report`（已立案）。

**只判**：报告的存在与输出契约形状。⛔ 不判「sh/mjs 必须是 NOT-EVALUATED」——将来若接入 shell 分析器该值会合法改变，那不是回归。