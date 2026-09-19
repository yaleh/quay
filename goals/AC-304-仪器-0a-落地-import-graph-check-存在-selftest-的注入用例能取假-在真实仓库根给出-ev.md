---
id: AC-304
title: 仪器 0a 落地：import-graph-check 存在、--selftest 的注入用例能取假、在真实仓库根给出
  evaluated:true 且 edges>0 的有效读数
status: active
kind: criterion
goal: GOAL-025
criterion: |
  f=plugin/scripts/import-graph-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在（Phase 0a 仪器未落地）" >&2; exit 1; }
  node --experimental-strip-types "$f" --selftest >/dev/null 2>&1 || { echo "CAUSE=selftest-failed — $f --selftest 非零（注入用例不能取假）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.evaluated===true&&Number.isInteger(j.edges)&&j.edges>0&&Array.isArray(j.reverseEdges)?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=not-evaluated-on-real-tree — $f --json 在真实仓库根未给出 evaluated:true 且 edges>0（读不懂输入不得伪装成合格）" >&2; exit 1; }
expect: exit 0（检查器存在 ∧ --selftest 通过 ∧ 真实仓库根 --json 给出
  evaluated:true、edges>0、reverseEdges 为数组）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo
  … >&2 与 exit 1 写在同一行。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §5 Phase
  0a。实测缘由：archguard 对 plugin/scripts 的 detect_cycles 返回 []，而自写 import 图在同一批文件里算出
  3 个文件级 SCC——该工具输出词表里没有「未评估」一态（硬规则 3b）。本条只判「仪器建成且能取假」（建成即不撤销，故不带
  long-term）；它读的量（环数/反向边数）由 AC-307/308 判。
activatedAt: 2026-09-19T05:29:16.003Z
---
**对应任务**：`gap-arch-import-graph-check`（已立案）。

**判据形态**：读真检查器在真实仓库根的输出，不读 fixture；`--selftest` 通过证明注入用例（值环 / 类型环 / 反向边 / 注释内伪 import / 空输入）各自给出预期判定。

**不判**：具体环数与边数——它们会随 Phase 2/3 下降，由 AC-307/AC-308 判。