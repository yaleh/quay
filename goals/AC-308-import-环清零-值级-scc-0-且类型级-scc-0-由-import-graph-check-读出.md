---
id: AC-308
title: import 环清零：值级 SCC = 0 且类型级 SCC = 0（由 import-graph-check 读出）
status: achieved
kind: criterion
goal: GOAL-025
criterion: |
  f=plugin/scripts/import-graph-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.evaluated===true&&Array.isArray(j.valueSccs)&&Array.isArray(j.typeSccs)&&j.valueSccs.length===0&&j.typeSccs.length===0?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=cycles-nonzero-or-not-evaluated — 仍存在值级或类型级 import 环，或检查器未评估" >&2; exit 1; }
expect: exit 0（import-graph-check --json 的 evaluated===true 且 valueSccs 与
  typeSccs 均为空数组）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与 exit 1
  写在同一行。检查器不存在/未评估时同样 exit 1（不是 0）。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §1.2 T2/T3 / §5
  Phase 3。实测（2026-09-19）：1 个真值级环（ready-pool-check.ts:238 ↔
  strategic-doc-staleness-check.ts:55）；2 个类型级环（gate/registry.ts ↔ 11 个
  gate/factories/*；full-suite-runner.ts ↔
  runner-state-write.ts/runner-red-parse.ts 等 5 个）。archguard 对这三个 SCC 报
  0——不能作为证据。会回升的量，故 long-term:true。
activatedAt: 2026-09-19T05:29:22.523Z
statusLog:
  - at: 2026-09-19T11:36:59.120Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
**范围**：①值环：`stripCodeSpans` 下沉到独立小模块，`ready-pool-check.ts` 与 `strategic-doc-staleness-check.ts` 都从它导入；②类型环：`GateFn` 等抽到 `gate/types.ts`；`SuiteState`/`SuiteRoundRecord`/`SuiteFailure` 等抽到 `full-suite-runner-types.ts`。

**前置**：`gap-arch-import-graph-check` 落地。

**注意（派发）**：`ready-pool-check.ts`（3719 行）与 `full-suite-runner.ts`（4153 行）是热文件——本条的任务必须与任何碰这两个文件的在飞任务串行。

**不做**：不借机拆这些巨型文件本身（Phase 6，另行处理）。