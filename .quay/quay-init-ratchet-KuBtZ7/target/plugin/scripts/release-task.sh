#!/usr/bin/env bash
# release-task.sh — RELEASE a claimed task: delete the `task/<id>` claim branch on the shared bare
# repo (gap-two-machine-collaboration-git-branch-claiming, AC1).
#
# Protocol: merge + delete = release. After the task's work is merged into `integration` (the
# pending-verification merge point), the claiming machine deletes the claim marker on the shared repo
# so the next machine can claim the task. The marker is a PURE existence signal — deleting it never
# touches the merged work (which lives on `integration`), so a release is always safe. Deleting an
# already-gone claim branch is reported but NOT an error (idempotent release).
#
# Usage:
#   release-task.sh <task-id> [--root <repo>] [--remote <remote>] [--dry-run]
#   --root / --remote are the same as claim-task.sh (default remote: $QUAY_CLAIM_REMOTE).
#
# Exit codes:
#   0  released (claim branch deleted), or was already gone
#   1  remote delete failed
#   2  usage / no claim remote / invalid id
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$SCRIPT_DIR/../.." && pwd)"
remote="${QUAY_CLAIM_REMOTE:-}"
dry_run=0
id=""

validate_id() {
  local v="$1"
  case "$v" in
    ''|*' '*) echo "release-task: invalid task id: '$v'" >&2; exit 2 ;;
    */*) echo "release-task: task id must be a single path segment (no '/'): '$v'" >&2; exit 2 ;;
  esac
  if ! printf '%s' "$v" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    echo "release-task: invalid task id (must match ^[A-Za-z0-9][A-Za-z0-9._-]*$): '$v'" >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --remote) remote="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --help|-h) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "release-task: unknown option: $1" >&2; exit 2 ;;
    *) id="$1"; shift ;;
  esac
done

if [ -z "$id" ]; then
  echo "release-task: missing task id" >&2
  sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi
validate_id "$id"
[ -n "$remote" ] || { echo "release-task: no claim remote — set QUAY_CLAIM_REMOTE or pass --remote" >&2; exit 2; }

# One ls-remote call, FAIL-CLOSED on an unreachable shared repo (exit 2) — never a silent "nothing
# to release" on a down remote.
heads="$(git -C "$repo_root" ls-remote --heads "$remote" 'refs/heads/task/*' 2>&1)" || {
  echo "release-task: shared claim remote unreachable: $remote" >&2
  printf '%s\n' "$heads" >&2
  exit 2
}
if ! printf '%s\n' "$heads" | awk -v ref="refs/heads/task/$id" '$2 == ref {found=1} END {exit !found}'; then
  echo "release: task/$id not claimed on $remote (nothing to release)"
  exit 0
fi

if [ "$dry_run" -eq 1 ]; then
  echo "would-release: task/$id from $remote (dry-run; no branch deleted)"
  exit 0
fi

if git -C "$repo_root" push -q "$remote" --delete "refs/heads/task/$id" 2>/dev/null; then
  echo "released: task/$id (claim branch deleted on $remote)"
  exit 0
else
  echo "release-failed: task/$id delete rejected on $remote" >&2
  exit 1
fi
