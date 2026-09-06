#!/usr/bin/env bash
# Mutation case for task-file-bypass-check (gap-adr013-gate-blind-spots-and-task-bypass-ratchet,
# AC4 negative control). Fixture: a temp workspace with plugin/scripts/fixture.ts carrying NO
# task-path file op → GREEN. Inject: a `tasks/` fs read in a NON-allowlisted file → the checker MUST
# go RED. Restore: back to a clean file → GREEN. The count-warnings over a fixture-only tree are
# benign (WARN, exit unchanged) and are discarded by `>/dev/null 2>&1` — only the exit code is judged.
set -u
name="task-file-bypass-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/task-file-bypass-check.ts" --gate --root "$1" >/dev/null 2>&1
}

# GREEN baseline: a clean script (no task-path file op) → exit 0.
cat > plugin/scripts/fixture.ts <<'EOF'
export const clean = 1;
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: a task-path fs read in a NON-allowlisted file → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
import fs from "node:fs";
export function readTask() { return fs.readFileSync(`tasks/scratch-bypass.md`, "utf8"); }
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a tasks/ fs read in a non-allowlisted file did not redden the checker" >&2
  exit 3
fi

# RESTORE: back to a clean file → GREEN.
cat > plugin/scripts/fixture.ts <<'EOF'
export const clean = 1;
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean repo still reddens the checker" >&2
  exit 4
fi

exit 0
