---
id: AC-315
title: shell 层棘轮不回升：内嵌解释器行数/重复副本数不高于基线、基线未被调高、例外清单 exceptionLines 不高于 7500（由
  sh-census-check 读出）
status: draft
kind: criterion
goal: GOAL-026
criterion: |-
  f=plugin/scripts/sh-census-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.evaluated!==true||!j.verdict||!j.totals){console.error("CAUSE=not-evaluated — census 未给出 evaluated:true / verdict / totals");process.exit(1)}if(j.verdict.ok!==true){console.error("CAUSE=ratchet-red — 内嵌解释器行数/重复副本数回升或基线被调高："+JSON.stringify({over:j.verdict.over,baselineRaised:j.verdict.baselineRaised}));process.exit(1)}if(j.totals.exceptionLines>7500){console.error("CAUSE=exception-list-grew — exceptionLines="+j.totals.exceptionLines+" >7500（例外清单被拿来逃棘轮）");process.exit(1)}process.exit(0)}catch(e){console.error("CAUSE=unparseable-census-output");process.exit(1)}})' || { echo "CAUSE=sh-ratchet-violated-or-not-evaluated — shell 层棘轮回升/例外清单增长，或 census 未评估" >&2; exit 1; }
expect: exit 0（sh-census-check --json 的 evaluated===true，verdict.ok===true，且
  totals.exceptionLines≤7500）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与 exit
  1 写在同一行。检查器不存在/未评估时同样 exit 1（不是 0）。
origin: SPEC-architecture-consolidation §10.3：会回退的量必须 long-term。7500 =
  2026-09-20 例外清单 7 个文件的 exceptionLines
  实测（6293+207+194+146+192+297+171），用来堵「把文件加进例外清单以逃棘轮」。会回升，故 long-term:true。
long-term: true
---
