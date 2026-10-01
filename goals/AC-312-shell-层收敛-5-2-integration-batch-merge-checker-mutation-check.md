---
id: AC-312
title: shell 层收敛 5.2：integration-batch-merge / checker-mutation-check /
  cross-machine-verify 三个 .sh 收成 ≤25 有效行的薄入口或已删除（由 sh-census-check 读出）
status: achieved
kind: criterion
goal: GOAL-026
criterion: |-
  f=plugin/scripts/sh-census-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.evaluated!==true||!Array.isArray(j.files)){console.error("CAUSE=not-evaluated — census 未给出 evaluated:true 与 files 数组");process.exit(1)}const bad=["integration-batch-merge","checker-mutation-check","cross-machine-verify"].map(n=>j.files.find(x=>x.path==="plugin/scripts/"+n+".sh")).filter(x=>x&&x.codeLines>25).map(x=>x.path+"="+x.codeLines);if(bad.length){console.error("CAUSE=not-thin — 仍 >25 有效行："+bad.join(", "));process.exit(1)}process.exit(0)}catch(e){console.error("CAUSE=unparseable-census-output");process.exit(1)}})' || { echo "CAUSE=phase-5.2-scripts-not-converted-or-not-evaluated — 5.2 三个脚本未收成 ≤25 行薄入口/已删除，或 census 未评估" >&2; exit 1; }
expect: exit 0（sh-census-check --json 的 evaluated===true，且三个脚本各自 codeLines≤25
  或不再存在）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与 exit 1
  写在同一行。检查器不存在/未评估时同样 exit 1（不是 0）。
origin: SPEC-architecture-consolidation §5 Phase 5.2。实测（2026-09-20）：697/490/489
  有效行；承载 task =
  gap-arch-tsify-{integration-batch-merge,checker-mutation-check,cross-machine-verify}-sh。
activatedAt: 2026-10-01T18:00:58.937Z
statusLog:
  - at: 2026-10-01T18:00:58.937Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-01T18:08:16.985Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:00:58.936Z
---
