---
id: AC-348
title: ArchGuard before/after：duplicate group 消失、canonical definition count 收敛到
  1、consumer convergence 证据
status: achieved
kind: criterion
goal: GOAL-032
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  ev=".quay/goal-032-evidence/archguard-before-after.json"

  [ -f "$ev" ] || { echo "NOT-EVALUATED: $ev not written yet" >&2; exit 3; }

  node -e '(()=>{const fs=require("fs");const
  d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(!d.before||!d.after){console.error("CAUSE=missing-before-after-fields");process.exit(1)}
    if(d.after.duplicateGroupPresent!==false){console.error("CAUSE=duplicate-group-still-present — after.duplicateGroupPresent="+d.after.duplicateGroupPresent);process.exit(1)}
    if(d.before.duplicateGroupPresent!==true){console.error("CAUSE=before-baseline-wrong — before.duplicateGroupPresent should be true (reproduces the known duplicate)");process.exit(1)}
    if(d.after.canonicalDefinitionCount!==1){console.error("CAUSE=canonical-count-not-1 — after.canonicalDefinitionCount="+d.after.canonicalDefinitionCount);process.exit(1)}
    if(!Array.isArray(d.consumerConvergenceEvidence)||d.consumerConvergenceEvidence.length<2){console.error("CAUSE=consumer-convergence-evidence-missing — need >=2 entries (criterion-fidelity + goal-driver call sites)");process.exit(1)}
  })()' "$ev" || { echo "CAUSE=evidence-file-unreadable-or-script-failed — $ev
  did not parse or the check script itself errored" >&2; exit 1; }

  echo "PASS: ArchGuard before/after shows duplicate group present->absent,
  canonical definition count converged to 1, and consumer-convergence evidence
  recorded"
expect: exit 0 = 证据文件齐全且三项读数达标；exit 1 = CAUSE= 指明哪一项；exit 3 = 证据文件尚未落盘
origin: GOAL-032 机械证据，见 goal body「验证步骤」5
activatedAt: 2026-10-09T01:55:08.002Z
statusLog:
  - at: 2026-10-09T01:55:08.002Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-09T02:57:12.434Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T01:55:08.001Z
---
