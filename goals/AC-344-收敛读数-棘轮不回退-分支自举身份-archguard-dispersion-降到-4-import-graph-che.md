---
id: AC-344
title: 收敛读数 + 棘轮不回退 + 分支自举身份：ArchGuard dispersion 降到 4、import-graph-check
  四量不回退、身份证据指向 goal worktree
status: achieved
kind: criterion
goal: GOAL-031
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  ev=".quay/goal-031-evidence/archguard-dispersion.json"
  [ -f "$ev" ] || { echo "NOT-EVALUATED: $ev not written yet" >&2; exit 3; }
  node -e '(()=>{const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!d.after){console.error("CAUSE=missing-after-field");process.exit(1)}if(d.after.dispersion!==4){console.error("CAUSE=dispersion-not-4 — after.dispersion="+d.after.dispersion+", want 4");process.exit(1)}if((d.after.files||[]).includes("plugin/scripts/goal-driver.ts")){console.error("CAUSE=goal-driver-still-listed — after.files still includes goal-driver.ts");process.exit(1)}})()' "$ev" || exit 1
  idev=".quay/goal-031-evidence/selfhost-identity.json"
  [ -f "$idev" ] || { echo "NOT-EVALUATED: $idev not written yet" >&2; exit 3; }
  node -e '(()=>{const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(d.match!==true){console.error("CAUSE=selfhost-identity-mismatch — match="+d.match+", loadedFrom="+d.loadedFrom);process.exit(1)}if(typeof d.loadedFrom!=="string"||!d.loadedFrom.includes("goal-GOAL-031")){console.error("CAUSE=loaded-from-missing-worktree-marker — loadedFrom="+d.loadedFrom);process.exit(1)}})()' "$idev" || exit 1
  out=$(node --experimental-strip-types plugin/scripts/import-graph-check.ts --json 2>/dev/null) || { echo "CAUSE=import-graph-check-failed-to-run" >&2; exit 1; }
  node -e '(()=>{const d=JSON.parse(process.argv[1]);const v=d.verdict||{};if(v.ok!==true){console.error("CAUSE=import-graph-ratchet-regressed — verdict="+JSON.stringify(v));process.exit(1)}})()' "$out" || exit 1
  echo "PASS: ArchGuard dispersion after=4 with goal-driver.ts cleared, self-host identity proven inside the goal worktree, import-graph-check ratchet unregressed"
expect: exit 0 =
  三份证据(archguard-dispersion.json/selfhost-identity.json/import-graph-check)全部达标；exit
  1 = CAUSE= 指明哪一项；exit 3 = 证据文件尚未落盘
origin: GOAL-031 收敛与身份验收，见 goal body「验证步骤」4-6
activatedAt: 2026-10-08T14:08:31.299Z
statusLog:
  - at: 2026-10-08T14:08:31.299Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-08T15:55:24.791Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-08T14:08:31.299Z
---
