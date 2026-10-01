---
id: AC-313
title: shell 层收敛 5.3：develop-deliver-tgz.sh 不再内嵌 python3（10 个 heredoc 抽成
  .ts，编排保留 bash；由 sh-census-check 读出）
status: achieved
kind: criterion
goal: GOAL-026
criterion: |-
  f=plugin/scripts/sh-census-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.evaluated!==true||!Array.isArray(j.files)){console.error("CAUSE=not-evaluated — census 未给出 evaluated:true 与 files 数组");process.exit(1)}const bad=["develop-deliver-tgz"].map(n=>j.files.find(x=>x.path==="plugin/scripts/"+n+".sh")).filter(x=>x&&x.embedded.includes("python3")).map(x=>x.path+" 仍含内嵌 python3（"+x.codeLines+" 有效行）");if(bad.length){console.error("CAUSE=still-embeds-python3 — "+bad.join(", "));process.exit(1)}process.exit(0)}catch(e){console.error("CAUSE=unparseable-census-output");process.exit(1)}})' || { echo "CAUSE=develop-deliver-tgz-python-not-extracted-or-not-evaluated — develop-deliver-tgz.sh 仍内嵌 python3，或 census 未评估" >&2; exit 1; }
expect: exit 0（sh-census-check --json 的 evaluated===true，且
  develop-deliver-tgz.sh 的 embedded 不含 python3，或该文件已不存在）。失败时 exit 1 且 stderr 携带
  CAUSE=…；⛔ echo … >&2 与 exit 1 写在同一行。检查器不存在/未评估时同样 exit 1（不是 0）。
origin: SPEC-architecture-consolidation §5 Phase 5.3 第一阶段。实测（2026-09-20）：2354
  有效行、embedded=[python3]、10 个 python3 heredoc；承载 task =
  gap-arch-tsify-develop-deliver-tgz-python-heredocs。
activatedAt: 2026-10-01T18:01:36.566Z
statusLog:
  - at: 2026-10-01T18:01:36.566Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-01T18:08:42.649Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:01:36.566Z
---
