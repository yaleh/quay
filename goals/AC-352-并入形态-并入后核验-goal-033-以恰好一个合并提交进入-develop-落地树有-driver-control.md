---
id: AC-352
title: 并入形态 + 并入后核验：GOAL-033 以恰好一个合并提交进入 develop，落地树有 driver-control.ts、无
  cli/driver-vocab.ts、core-root 零 cli/ import
status: active
kind: criterion
goal: GOAL-033
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  pair=$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-033"&&e.payload&&e.payload.outcome==="landed")r=e.payload.landedSha+" "+e.payload.tipSha}catch{}};process.stdout.write(r)})()')
  [ -n "$pair" ] || { echo "NOT-EVALUATED: GOAL-033 has no landed goal-merge-result yet (post-merge AC)" >&2; exit 3; }
  landed=${pair%% *}; tip=${pair##* }
  fpf=$(mktemp /tmp/goal033-fp.XXXXXX); trap 'rm -f "$fpf"' EXIT
  git rev-list --first-parent develop > "$fpf"
  grep -qx "$landed" "$fpf" || { echo "CAUSE=merge-not-on-first-parent — $landed is not on develop's first-parent chain" >&2; exit 1; }
  [ "$(git rev-list --parents -n1 "$landed" | wc -w)" -eq 3 ] || { echo "CAUSE=not-a-merge-commit — $landed does not have exactly two parents" >&2; exit 1; }
  [ "$(git rev-parse "$landed^2")" = "$(git rev-parse "$tip")" ] || { echo "CAUSE=wrong-second-parent — $landed^2 is not the goal tip $tip" >&2; exit 1; }
  leak=$(git rev-list "$landed^1..$tip" | grep -xF -f "$fpf" | head -1)
  [ -z "$leak" ] || { echo "CAUSE=branch-commit-on-first-parent — goal-branch commit $leak appears on develop's first-parent chain" >&2; exit 1; }
  git cat-file -e "$landed:packages/quay/src/driver-control.ts" 2>/dev/null || { echo "CAUSE=landed-tree-missing-driver-control — $landed has no packages/quay/src/driver-control.ts" >&2; exit 1; }
  ! git cat-file -e "$landed:packages/quay/src/cli/driver-vocab.ts" 2>/dev/null || { echo "CAUSE=landed-tree-kept-old-vocab — $landed still carries packages/quay/src/cli/driver-vocab.ts" >&2; exit 1; }
  ctl=$(git grep -cE "from\s*[\"']\.\./config\.ts[\"']" "$landed" -- ':(glob)packages/quay/src/cli/*.ts' | wc -l)
  [ "$ctl" -ge 1 ] || { echo "CAUSE=predicate-blind — the control import scan matched nothing in $landed cli/*.ts, so a zero below would mean nothing" >&2; exit 1; }
  bad=$(git grep -nE "^\s*(import|export)\b.*from\s*[\"']\./cli/|^\s*\}\s*from\s*[\"']\./cli/|import\(\s*[\"']\./cli/" "$landed" -- ':(glob)packages/quay/src/*.ts' | head -3)
  [ -z "$bad" ] || { echo "CAUSE=landed-core-root-imports-cli — $bad" >&2; exit 1; }
  echo "PASS: GOAL-033 landed as exactly one merge commit (second parent = goal tip); the landed tree has driver-control.ts, no cli/driver-vocab.ts, and no core-root import of cli/"
expect: exit 0 = 恰好一个合并提交、第二父=goal tip、无分支提交泄漏、落地树 core-root 零 cli/ import；exit
  1 = CAUSE=；exit 3 = 尚未并入
origin: 人 2026-10-09 裁定：调查并推进 core-root<->core-cli 最小依赖环切片
activatedAt: 2026-10-09T05:46:04.942Z
statusLog:
  - at: 2026-10-09T05:46:04.942Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T05:46:04.941Z
phase: post-merge
---
