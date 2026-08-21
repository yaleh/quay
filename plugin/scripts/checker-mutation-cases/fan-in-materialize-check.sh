#!/usr/bin/env bash
# Mutation case for fan-in-materialize-check (gap-workflow-scriptpath-materialize-falls-back-main):
# the defect is a bootstrap-HIT fan-in whose `scriptPath` points into a task worktree but whose
# MATERIALIZED script is the MAIN checkout version (the SDK silently falls back — M176 family).
# The checker reads the production carrier (SDK-written wf_*.json carrying BOTH the passed
# scriptPath AND the materialized script content) and compares byte-exact against the worktree file
# when it is alive on disk (DECISIVE). Fixture: a project-dir with ONE wf_*.json whose scriptPath is
# a worktree path, plus a LIVE worktree fan-in-execute.js. Baseline GREEN (materialized == worktree
# file); INJECT the fallback (materialized script != worktree file → RED the checker MUST catch);
# RESTORE → GREEN. A checker that never reads the worktree file (or that conflates NOT-EVALUATED
# with green) stays green under the injection and fails the case.
set -u
name="fan-in-materialize-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -- Hermetic fixture: --root is a fake "main checkout" root; the worktree scriptPath lives OUTSIDE
# it (under workdir/worktrees/...), mirroring the real main-checkout vs quay-worktrees layout. The
# checker is pointed at --project-dir <fixture>/projects so it NEVER touches the real ~/.claude. --
main_root="${workdir}/main-root"
project_dir="${workdir}/projects"
worktree_root="${workdir}/worktrees/gap-foo"
worktree_wf="${worktree_root}/.claude/workflows/fan-in-execute.js"
workflow_events="${workdir}/no-events"
mkdir -p "${main_root}" "${workflow_events}" "$(dirname "${worktree_wf}")"

# The worktree's fan-in-execute.js — the "latest block" the bootstrap-HIT task added.
WORKTREE_CONTENT="export const meta = { name: 'fan-in-execute' };\n// BOOTSTRAP-MARKER: gap-foo\n"
printf '%b' "$WORKTREE_CONTENT" > "${worktree_wf}"

# A fallback-materialized script — the MAIN version WITHOUT the bootstrap marker (the defect).
FALLBACK_CONTENT="export const meta = { name: 'fan-in-execute' };\n// (main version — no bootstrap marker)\n"

write_wf() {
  local content="$1"
  mkdir -p "${project_dir}/session-1/workflows"
  printf '{"runId":"wf_mut-01","timestamp":"2026-08-21T00:00:00.000Z","scriptPath":"%s","script":"%s","args":{"task":"gap-foo","runId":"fm-gap-foo-1"}}\n' \
    "${worktree_wf}" "${content}" > "${project_dir}/session-1/workflows/wf_mut-01.json"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/fan-in-materialize-check.ts" \
    --root "${main_root}" \
    --project-dir "${project_dir}" \
    --workflow-events-dir "${workflow_events}" \
    --json >/dev/null 2>&1
}

# GREEN baseline: materialized script == worktree file (worktree version materialized) → exit 0.
write_wf "$WORKTREE_CONTENT"
if checker_cmd; then :; else
  echo "baseline RED on a worktree-version materialization (checker always-red?)" >&2
  exit 4
fi

# INJECT the fallback: materialized script != worktree file → the checker MUST go RED (exit 1).
write_wf "$FALLBACK_CONTENT"
if checker_cmd; then
  echo "STAYED-GREEN — a main-version materialization did not redden the checker (fallback slips through)" >&2
  exit 3
fi

# RESTORE: materialized script back to the worktree version → back to GREEN.
write_wf "$WORKTREE_CONTENT"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored worktree-version materialization still reddens the checker" >&2
  exit 4
fi

exit 0
