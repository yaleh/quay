#!/usr/bin/env bash
# Mutation case for touches-one-entry-one-path-check (gap-touches-connector-delimiter-uncaught).
# The defect the checker exists to catch: a ## Touches bullet that declares ≥2 REAL paths joined by
# a path-separating delimiter — " / ", " + " (space-plus-space, the AC93/ac86/AC91 anti-drift HARD
# FAIL case), "、" / "，" / "," — which the ONE parser (parseTouchEntriesWithTags) reads as ONE
# composite entry (matches no file on disk, hides each real path from checkTouchesPair's overlap
# judgment). The mutation injects a " + "-connected bullet and asserts the checker goes RED; a
# masking fix (or a checker that never reads Touches) stays green forever and fails.
# Fixture: a temp workspace with an EMPTY shrink-only baseline (ceiling 0) and a clean single-path
# task. Inject: a ` + `-connected multi-path bullet → exit 1 (RED). Restore: remove it → exit 0.
set -u
name="touches-one-entry-one-path-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/tasks" "${workdir}/docs/analysis"
printf '# touches-one-entry-one-path-baseline.md — shrink-only grandfather list\n# baseline-count: 0\n' > "${workdir}/docs/analysis/touches-one-entry-one-path-baseline.md"
cat > "${workdir}/tasks/ok.md" <<'EOF'
---
id: ok
title: "ok"
status: todo
---

## Proposal

A clean task with single-path Touches bullets.

## Touches

- plugin/scripts/a.ts
- plugin/scripts/b.ts（说明）
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/touches-one-entry-one-path-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: clean single-path task → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean single-path task (checker always-red?)" >&2
  exit 4
fi

# INJECT: a ` + `-connected multi-path bullet — the AC93/ac86/AC91 fan-in case shape.
cat > "${workdir}/tasks/bad.md" <<'EOF'
---
id: bad
title: "bad"
status: todo
---

## Proposal

A task whose Touches bullet joins two paths with " + " — the ONE parser reads the whole line as ONE
composite entry.

## Touches

- plugin/scripts/it0-split-or-commit-check.ts + experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected \" + \"-connected multi-path bullet did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the violating task → back to green.
rm -f "${workdir}/tasks/bad.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean task still reddens the checker" >&2
  exit 4
fi

exit 0
