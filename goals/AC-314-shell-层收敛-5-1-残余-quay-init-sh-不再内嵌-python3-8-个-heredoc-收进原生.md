---
id: AC-314
title: shell 层收敛 5.1 残余：quay-init.sh 不再内嵌 python3（8 个 heredoc 收进原生
  init.ts；自举不可替代者须如实标注；由 sh-census-check 读出）
status: active
kind: criterion
goal: GOAL-026
criterion: |-
  f=plugin/scripts/sh-census-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.evaluated!==true||!Array.isArray(j.files)){console.error("CAUSE=not-evaluated — census 未给出 evaluated:true 与 files 数组");process.exit(1)}const bad=["quay-init"].map(n=>j.files.find(x=>x.path==="plugin/scripts/"+n+".sh")).filter(x=>x&&x.embedded.includes("python3")).map(x=>x.path+" 仍含内嵌 python3（"+x.codeLines+" 有效行）");if(bad.length){console.error("CAUSE=still-embeds-python3 — "+bad.join(", "));process.exit(1)}process.exit(0)}catch(e){console.error("CAUSE=unparseable-census-output");process.exit(1)}})' || { echo "CAUSE=quay-init-python-not-extracted-or-not-evaluated — quay-init.sh 仍内嵌 python3，或 census 未评估" >&2; exit 1; }
expect: exit 0（sh-census-check --json 的 evaluated===true，且 quay-init.sh 的
  embedded 不含 python3，或该文件已不存在）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与
  exit 1 写在同一行。检查器不存在/未评估时同样 exit 1（不是 0）。
origin: gap-quay-init-native-reconcile（done）的 DoD 明写「载体迁移暂缓」。实测（2026-09-20）：1332
  有效行、embedded=[node,python3]、8 个 python3 heredoc；承载 task =
  gap-arch-quay-init-sh-python-heredocs-to-native。
activatedAt: 2026-10-01T18:02:37.069Z
statusLog:
  - at: 2026-10-01T18:02:37.069Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:02:37.069Z
---
