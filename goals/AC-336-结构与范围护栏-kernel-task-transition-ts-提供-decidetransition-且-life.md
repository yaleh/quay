---
id: AC-336
title: 结构与范围护栏：kernel/task-transition.ts 提供 decideTransition 且 LIFECYCLE_EDGES
  只在 kernel 定义一次；ready-pool-check 不再直接调用 patchStatusField 并 import 该模块；fan-in 与
  needs-human 写入计数不变（4/2）；import-graph-check 绿且无 kernel 越界
status: draft
kind: criterion
goal: GOAL-030
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  nc() { grep -vE '^[[:space:]]*(//|\*|/\*)' "$1" | grep -cE "$2"; }
  k=packages/quay/src/kernel/task-transition.ts; rpc=plugin/scripts/ready-pool-check.ts
  [ -f "$k" ] || { echo "CAUSE=kernel-module-absent — $k does not exist in $root" >&2; exit 1; }
  [ "$(nc "$k" '^export (async )?function decideTransition\b')" -ge 1 ] || { echo "CAUSE=no-decideTransition — $k does not export function decideTransition" >&2; exit 1; }
  defs=$(grep -rlE '^export const LIFECYCLE_EDGES\b' packages/quay/src plugin/scripts --include='*.ts' 2>/dev/null | grep -v '\.test\.' | tr '\n' ' ')
  case "$defs" in "packages/quay/src/kernel/"*" ") [ "$(echo $defs | wc -w)" -eq 1 ] || { echo "CAUSE=edge-table-not-single — LIFECYCLE_EDGES defined in: $defs" >&2; exit 1; } ;; *) echo "CAUSE=edge-table-not-in-kernel — LIFECYCLE_EDGES defined in: ${defs:-nowhere} (must be exactly one definition under packages/quay/src/kernel/, gate/lifecycle.ts re-exports it)" >&2; exit 1 ;; esac
  r=$(nc "$rpc" 'patchStatusField\('); [ "$r" -eq 0 ] || { echo "CAUSE=direct-status-write-remains — $rpc still has $r non-comment patchStatusField( call(s)" >&2; exit 1; }
  [ "$(grep -cE '^import [^;]*from "[^"]*kernel/task-transition\.ts"' "$rpc")" -ge 1 ] || { echo "CAUSE=not-wired — $rpc has no line-start import of kernel/task-transition.ts" >&2; exit 1; }
  df=$(nc plugin/scripts/driver-filters.ts 'patchStatusField\('); wf=$(nc plugin/scripts/worker-fan-in.ts 'patchStatusField\(')
  [ "$df" -eq 2 ] && [ "$wf" -eq 4 ] || { echo "CAUSE=scope-breach — needs-human/branch-sync (driver-filters.ts) or fan-in (worker-fan-in.ts) status writes changed: $df (expect 2), $wf (expect 4); this goal must not touch them" >&2; exit 1; }
  igc=$(node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts --json 2>/dev/null); rc=$?
  [ "$rc" -eq 0 ] || { echo "CAUSE=import-graph-check-red — exit $rc (1 = over baseline / kernel boundary crossed, 2 = graph unreadable, fail-closed by that checker's contract)" >&2; exit 1; }
  printf '%s' "$igc" | node -e '(()=>{let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.kernelChecked!==true||(j.kernelViolations||[]).length>0){console.error("CAUSE=kernel-boundary — kernelChecked="+j.kernelChecked+" violations="+JSON.stringify(j.kernelViolations));process.exit(1)}console.log("PASS: kernel decideTransition present; LIFECYCLE_EDGES single definition in kernel; ready-pool-check has 0 direct writes and imports the kernel module; fan-in/needs-human untouched (2/4); import-graph-check green, kernelViolations []")})})()'
expect: exit 0 = 结构到位且范围护栏与 import-graph-check 全绿；exit 1 = 任一条不满足（CAUSE=
  点名哪一条）；exit 3 = 不在 git 仓库内。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
phase: pre-merge
---
