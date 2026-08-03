#!/usr/bin/env bash
# Mutation case for task-ac-carryover-check (AC-carryover gate: done task may not leave
# an unchecked AC without a named carrier). Fixture: a temp workspace with a shrink-only
# baseline (ceiling 0) and a done task whose ACs are all checked.
# Inject: a done task with an unchecked AC and NO `## Carries` successor → a NEW unowned AC
# not in the baseline → the checker MUST exit 1 (RED, ratchet growth).
# Restore: remove the violating task → the checker MUST exit 0 (GREEN).
set -u
name="task-ac-carryover-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/tasks" "${workdir}/docs/analysis"
printf '# task-ac-carryover baseline\n# baseline-count: 0\n' > "${workdir}/docs/analysis/task-ac-carryover-baseline.md"
cat > "${workdir}/tasks/ok.md" <<'EOF'
---
id: ok
title: "ok"
status: done
---

## Acceptance Criteria

- [x] AC1: done
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/task-ac-carryover-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: done task with all ACs checked → no unowned AC → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean store (checker always-red?)" >&2
  exit 4
fi

# INJECT: a done task with an unchecked AC and no carrier → NEW unowned AC → ratchet growth.
cat > "${workdir}/tasks/bad.md" <<'EOF'
---
id: bad
title: "bad"
status: done
---

## Acceptance Criteria

- [ ] AC1: not done
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected unowned AC did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the violating task → back to green.
rm -f "${workdir}/tasks/bad.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored store still reddens the checker" >&2
  exit 4
fi

exit 0
