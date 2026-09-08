#!/usr/bin/env bash
# Mutation case for fan-in-materialize-check (gap-workflow-scriptpath-materialize-falls-back-main +
# gap-fan-in-materialize-check-bootstrap-hit-post-dispatch-sync): the defect is a bootstrap-HIT fan-in
# whose `scriptPath` points into a task worktree but whose MATERIALIZED script is the MAIN / PRE-task
# version (the SDK silently falls back — M176 family). The checker reads the production carrier
# (SDK-written wf_*.json carrying BOTH the passed scriptPath AND the materialized script content) and
# verifies it against (a) the live worktree file when on disk, and (b) the git-reconstructed worktree
# states (base / dispatch-HEAD / fanIn) when the on-disk file mismatches (post-dispatch merge-develop
# sync) or is gone.
#
# Fixture: a REAL git repo as --root (so reconstructWorktree can resolve base/dispatch-HEAD/fanIn) +
# a .workflow-events jsonl (start.baseCommit + end.fanInCommitSha) + a LIVE worktree fan-in-execute.js
# outside the root. Phases:
#   baseline        materialized == worktree file                 → GREEN (exit 0)
#   post-sync (neg) materialized == dispatch-HEAD, on-disk newer  → GREEN (exit 0 — the false positive
#                     this task fixes: post-dispatch sync must NOT redden the checker)
#   inject fallback materialized == base (PRE-task) + task touched → RED (exit 1, the true fallback)
#   restore         materialized == worktree file                 → GREEN (exit 0)
# A checker that never reads the reconstruction (or conflates NOT-EVALUATED with green) stays green
# under the fallback injection and fails the case; a checker that REDs on the legitimate post-dispatch
# sync evolution fails the case too.
set -u
name="fan-in-materialize-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -- Hermetic fixture: --root is a REAL git repo (for the reconstruction); the worktree scriptPath
# lives OUTSIDE it (under workdir/worktrees/...), mirroring the real main-checkout vs quay-worktrees
# layout. The checker is pointed at --project-dir <fixture>/projects so it NEVER touches ~/.claude. --
main_root="${workdir}/main-root"
project_dir="${workdir}/projects"
worktree_root="${workdir}/worktrees/gap-foo"
worktree_wf="${worktree_root}/plugin/workflows/fan-in-execute.js"
workflow_events="${workdir}/events"
mkdir -p "${main_root}" "${workflow_events}" "$(dirname "${worktree_wf}")"

# -- Build a REAL git repo at main_root: base (workflow file = BASE) → develop-advance (other file);
#    a task branch forked from base changes the workflow file (= TASK); a fan-in merge (first parent =
#    task HEAD) produces fanIn. Reconstructed states: base=BASE, dispatch-HEAD=TASK, fanIn=TASK,
#    taskTouchedWorkflow=true. --
git -C "${main_root}" init -q 2>/dev/null
git -C "${main_root}" config user.email "mutation@test.invalid"
git -C "${main_root}" config user.name "mutation"
mkdir -p "${main_root}/plugin/workflows"
printf 'BASE' > "${main_root}/plugin/workflows/fan-in-execute.js"
git -C "${main_root}" add .
git -C "${main_root}" commit -q -m base
BASE_SHA=$(git -C "${main_root}" rev-parse HEAD)
printf 'x' > "${main_root}/other.txt"
git -C "${main_root}" add .
git -C "${main_root}" commit -q -m develop-advance
DEVELOP_SHA=$(git -C "${main_root}" rev-parse HEAD)
git -C "${main_root}" checkout -q -b task "${BASE_SHA}"
printf 'TASK' > "${main_root}/plugin/workflows/fan-in-execute.js"
git -C "${main_root}" add .
git -C "${main_root}" commit -q -m task-change
git -C "${main_root}" merge -q -m "fan-in merge" "${DEVELOP_SHA}"
FANIN_SHA=$(git -C "${main_root}" rev-parse HEAD)
if [ -z "${BASE_SHA}" ] || [ -z "${FANIN_SHA}" ]; then
  echo "git fixture setup failed (no base/fanIn SHA)" >&2
  exit 2
fi

# -- A16 telemetry: start.baseCommit + end.fanInCommitSha for runId fm-gap-foo-1 (args.runId). --
printf '{"eventKind":"start","baseCommit":"%s"}\n' "${BASE_SHA}" > "${workflow_events}/fm-gap-foo-1.jsonl"
printf '{"eventKind":"end","fanInCommitSha":"%s"}\n' "${FANIN_SHA}" >> "${workflow_events}/fm-gap-foo-1.jsonl"

BASE_CONTENT="BASE"
TASK_CONTENT="TASK"
POST_SYNC_CONTENT="POST_SYNC"

write_wf() {
  local content="$1"
  mkdir -p "${project_dir}/session-1/workflows"
  printf '{"runId":"wf_mut-01","timestamp":"2026-08-25T00:00:00.000Z","scriptPath":"%s","script":"%s","args":{"task":"gap-foo","runId":"fm-gap-foo-1"}}\n' \
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
printf '%s' "${TASK_CONTENT}" > "${worktree_wf}"
write_wf "${TASK_CONTENT}"
if checker_cmd; then :; else
  echo "baseline RED on a worktree-version materialization (checker always-red?)" >&2
  exit 4
fi

# post-dispatch-sync NEGATIVE CONTROL: materialized == dispatch-HEAD (TASK) while the on-disk worktree
# file is a newer post-merge-develop version (POST_SYNC) → the checker MUST stay GREEN (exit 0).
# RED here = the false positive gap-fan-in-materialize-check-bootstrap-hit-post-dispatch-sync fixes.
printf '%s' "${POST_SYNC_CONTENT}" > "${worktree_wf}"
write_wf "${TASK_CONTENT}"
if checker_cmd; then :; else
  echo "post-dispatch-sync RED — a legitimate merge-develop sync false-positived the checker" >&2
  exit 4
fi

# INJECT the fallback: materialized == base (PRE-task) while the task's own commit touched the file
# → the checker MUST go RED (exit 1).
write_wf "${BASE_CONTENT}"
if checker_cmd; then
  echo "STAYED-GREEN — a PRE-task base materialization did not redden the checker (fallback slips through)" >&2
  exit 3
fi

# RESTORE: materialized script back to the worktree version → back to GREEN.
printf '%s' "${TASK_CONTENT}" > "${worktree_wf}"
write_wf "${TASK_CONTENT}"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored worktree-version materialization still reddens the checker" >&2
  exit 4
fi

exit 0
