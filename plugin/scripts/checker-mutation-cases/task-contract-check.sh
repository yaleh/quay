#!/usr/bin/env bash
# Mutation case for task-contract-check (## Contract consumer check + shrink-only ratchet).
# Fixture: a temp workspace with a shrink-only baseline (ceiling 0) and a clean task.
# Inject: a task whose ## Contract declares a measure with NO backtick command — a NEW
# violation not in the baseline → the checker MUST exit 1 (RED, ratchet growth).
# Restore: remove the violating task → the checker MUST exit 0 (GREEN).
set -u
name="task-contract-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/tasks" "${workdir}/docs/analysis"
printf '# baseline-count: 0\n' > "${workdir}/docs/analysis/contract-violations.md"
cat > "${workdir}/tasks/ok.md" <<'EOF'
---
id: ok
title: "ok"
status: todo
---

## Proposal

A clean task with no ## Contract section (contract-absent is info, not a violation).
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/task-contract-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: clean task, no violations → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean task (checker always-red?)" >&2
  exit 4
fi

# INJECT: a contract with a measure lacking a backtick command → NEW violation → ratchet growth.
cat > "${workdir}/tasks/bad.md" <<'EOF'
---
id: bad
title: "bad"
status: todo
---

## Proposal

## Contract

measure x = not a command
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected contract violation did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the violating task → back to green.
rm -f "${workdir}/tasks/bad.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored task still reddens the checker" >&2
  exit 4
fi

exit 0
