---
id: AC-307
title: 产品层不再反向依赖上层：packages/** → plugin/** 或 experiments/** 的真实 import 边 = 0（由
  import-graph-check 按语句位置读出）
status: active
kind: criterion
goal: GOAL-025
criterion: |
  f=plugin/scripts/import-graph-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.evaluated===true&&Array.isArray(j.reverseEdges)&&j.reverseEdges.length===0?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=reverse-edges-nonzero-or-not-evaluated — packages/** 仍 import plugin/** 或 experiments/**（reverseEdges 非空），或检查器未评估" >&2; exit 1; }
expect: exit 0（import-graph-check --json 的 evaluated===true 且 reverseEdges
  为空数组）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与 exit 1 写在同一行。检查器不存在/未评估时同样
  exit 1（不是 0）。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §1.2 T1 / §2 P1
  / §5 Phase 2。实测（2026-09-19，grep 按 import/export 语句位置）：5 条边、4
  个符号——serve.ts:36/38/42、server-state.ts:38 →
  plugin/scripts/{driver-shared,write-json-atomic,worktree-process-reaper}.ts；quay-native/src/store.ts:42
  → shape-sections.ts。会回升的量（新 import 随时可再引入），故 long-term:true（goal-mechanism
  §12b 三岔第二行）。
activatedAt: 2026-09-19T05:29:20.918Z
long-term: true
---
**范围（供立案/实现对齐，⛔ 不需读 SPEC 也能执行）**：把 `packages/quay/src/serve.ts`、`server-state.ts` 与 `packages/quay-native/src/store.ts` 对 `plugin/scripts/{write-json-atomic,shape-sections,worktree-process-reaper}.ts` 的 import 改为从 **`packages/quay/src/kernel/`** 导入（落点由人 2026-09-19 裁定为 kernel/）。`serveControlPlane`（`plugin/scripts/driver-shared.ts:283`）属 driver 运行时，由实现者按实测在「下沉 kernel」与「由 serve 注入」间选（推荐注入，只改 serve.ts 一处调用点）。plugin 侧旧路径保留 re-export 一个发布周期，避免下游 worktree 中途断链。

**前置**：`gap-arch-import-graph-check` 落地（否则本量不存在读数）。

**不做**：不改 Provider ABI 与公开 CLI/MCP 表面；不改 `packages/**` 之外的语义。

**关联**：与 AC-309（kernel/ 建立且被消费）通常是同一批改动。