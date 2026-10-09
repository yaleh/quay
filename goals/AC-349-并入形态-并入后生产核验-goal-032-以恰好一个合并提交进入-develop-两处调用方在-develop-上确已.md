---
id: AC-349
title: 并入形态 + 并入后生产核验：GOAL-032 以恰好一个合并提交进入 develop，两处调用方在 develop 上确已委托给 kernel
status: active
kind: criterion
goal: GOAL-032
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  pair=$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-032"&&e.payload&&e.payload.outcome==="landed")r=e.payload.landedSha+" "+e.payload.tipSha}catch{}};process.stdout.write(r)})()')
  [ -n "$pair" ] || { echo "NOT-EVALUATED: GOAL-032 has no landed goal-merge-result yet (post-merge AC)" >&2; exit 3; }
  landed=${pair%% *}; tip=${pair##* }
  fpf=$(mktemp /tmp/goal032-fp.XXXXXX); trap 'rm -f "$fpf"' EXIT
  git rev-list --first-parent develop > "$fpf"
  grep -qx "$landed" "$fpf" || { echo "CAUSE=merge-not-on-first-parent — $landed is not on develop's first-parent chain" >&2; exit 1; }
  [ "$(git rev-list --parents -n1 "$landed" | wc -w)" -eq 3 ] || { echo "CAUSE=not-a-merge-commit — $landed does not have exactly two parents" >&2; exit 1; }
  [ "$(git rev-parse "$landed^2")" = "$(git rev-parse "$tip")" ] || { echo "CAUSE=wrong-second-parent — $landed^2 is not the goal tip $tip" >&2; exit 1; }
  leak=$(git rev-list "$landed^1..$tip" | grep -xF -f "$fpf" | head -1)
  [ -z "$leak" ] || { echo "CAUSE=branch-commit-on-first-parent — goal-branch commit $leak appears on develop's first-parent chain" >&2; exit 1; }
  grep -q "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts || { echo "CAUSE=production-not-delegated-fidelity — develop's criterion-fidelity.ts does not delegate" >&2; exit 1; }
  grep -q "parseBinaryVerdict" plugin/scripts/goal-driver.ts || { echo "CAUSE=production-not-delegated-sufficiency — develop's goal-driver.ts does not delegate" >&2; exit 1; }
  echo "PASS: GOAL-032 landed as exactly one merge commit (second parent = goal tip); develop's two call sites both delegate to the kernel parser"
expect: exit 0 = 合并形态正确且生产两处均已委托；exit 1 = CAUSE= 指明哪一项；exit 3 = 尚未并入
origin: GOAL-032 并入验收，同构 AC-342/AC-345
activatedAt: 2026-10-09T01:55:10.012Z
statusLog:
  - at: 2026-10-09T01:55:10.012Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T01:55:10.011Z
---
