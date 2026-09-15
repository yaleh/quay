#!/usr/bin/env bash
# release-branch-finish.sh — FINISH a release branch: the "合回后删除" half of the release
# protocol. SPEC: orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §4.1 — a
# `release/vX.Y.Z` is cut from develop → version bump → merged back to develop → tagged at the
# merge point → **the branch is DELETED**. This script is that last step, as a command (the
# SPEC wrote the protocol as prose; ADR-004: prose gets paraphrased away, so the rule ships
# with its execution face).
#
# It is NOT a general "delete a branch" tool. Three properties are load-bearing, and each is a
# distinct, non-silent failure:
#
#   1. ONLY release branch names. `<branch>` must match `release-*` or `release/*`; anything
#      else is refused (a generic deleter would get misused).
#   2. UNMERGED ⇒ REFUSED. `git rev-list --count <base>..<branch>` != 0 means the branch still
#      holds commits develop never saw — force-deleting it would lose work. Refused, with its
#      own exit code and its own CAUSE= on stderr.
#   3. A FAILED REMOTE DELETE IS NEVER SWALLOWED. After the local delete, if the same ref
#      exists on the remote (origin, or --remote), it is deleted too; a failure there leaves a
#      trace (its own CAUSE=) and exits non-zero. A remote that cannot be READ is also a
#      failure — "could not look" must not be reported as "nothing there" (hard rule 3b).
#
# Usage:
#   release-branch-finish.sh <branch> [--root <repo>] [--remote <name>] [--no-remote]
#                            [--base <ref>] [--dry-run]
#   <branch>     a release branch name matching release-* / release/*
#   --root       repo to operate on (default: the repo this script lives in)
#   --remote     remote to also delete the ref from (default: origin)
#   --no-remote  explicitly skip remote handling (local-only finish)
#   --base       the ref the branch must be merged into (default: develop, else origin/develop)
#   --dry-run    print what WOULD happen, exit 0, mutate nothing
#
# Exit codes:
#   0  finished — the branch is gone locally (and remotely, when a remote was consulted);
#      also 0 when it was already gone (idempotent finish)
#   1  a delete actually failed, or the remote could not be read — CAUSE= names which
#   2  usage error / the name is not a release branch / the merge check could not be performed
#   3  the branch is NOT merged into <base> — refused, nothing deleted
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$SCRIPT_DIR/../.." && pwd)"
remote="origin"
use_remote=1
base=""
dry_run=0
branch=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --remote) remote="$2"; shift 2 ;;
    --no-remote) use_remote=0; shift ;;
    --base) base="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -*) echo "release-branch-finish: unknown option: $1" >&2; exit 2 ;;
    *) branch="$1"; shift ;;
  esac
done

if [ -z "$branch" ]; then
  echo "release-branch-finish: missing branch name" >&2
  echo "用法: bash $(basename "$0") <release-branch> [--root <repo>] [--remote <name>] [--no-remote] [--base <ref>] [--dry-run]" >&2
  exit 2
fi

# ── property 1: release names only ────────────────────────────────────────────────────────────
# Refuse anything that is not `release-<x>` / `release/<x>`. This is what keeps the command from
# being a generic branch deleter: `develop`, `master`, `task/<id>` are all refused by NAME, before
# any ref is looked at. A name with whitespace or a leading dash is a usage error, not a branch.
case "$branch" in
  release-?*|release/*) : ;;
  *) echo "CAUSE=not-a-release-branch — refusing to finish '$branch': only release-* or release/* branch names are accepted (this is not a general branch deleter)" >&2; exit 2 ;;
esac
case "$branch" in
  *' '*|*$'\t'*|*..*) echo "CAUSE=invalid-branch-name — '$branch' contains whitespace or '..'" >&2; exit 2 ;;
esac

# ── resolve the merge base (fail-closed: 'cannot check' is not 'merged') ──────────────────────
if [ -z "$base" ]; then
  if git -C "$repo_root" rev-parse --verify --quiet refs/heads/develop >/dev/null; then
    base="develop"
  elif git -C "$repo_root" rev-parse --verify --quiet refs/remotes/origin/develop >/dev/null; then
    base="origin/develop"
  else
    echo "CAUSE=release-branch-base-unresolvable — neither 'develop' nor 'origin/develop' resolves in $repo_root, so 'is it merged back?' cannot be answered; refusing to delete anything" >&2
    exit 2
  fi
fi
if ! git -C "$repo_root" rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "CAUSE=release-branch-base-unresolvable — --base '$base' does not resolve to a commit in $repo_root" >&2
  exit 2
fi

local_ref="refs/heads/$branch"
local_exists=0
if git -C "$repo_root" rev-parse --verify --quiet "$local_ref" >/dev/null; then
  local_exists=1
fi

# ── property 2: unmerged ⇒ refused ────────────────────────────────────────────────────────────
if [ "$local_exists" -eq 1 ]; then
  ahead="$(git -C "$repo_root" rev-list --count "$base..$branch" 2>/dev/null)"
  if [ -z "$ahead" ]; then
    echo "CAUSE=release-branch-merge-check-failed — could not count $base..$branch in $repo_root; refusing to delete (an unanswerable check must not read as 'merged')" >&2
    exit 2
  fi
  if [ "$ahead" -ne 0 ]; then
    echo "CAUSE=release-branch-not-merged — '$branch' carries $ahead commit(s) not in $base; deleting it would lose work. Merge it back first, or park its tip on a tag (AC-271 accepts either)" >&2
    exit 3
  fi
fi

# ── property 3: the remote is consulted and never fails silently ──────────────────────────────
remote_has=0
if [ "$use_remote" -eq 1 ]; then
  # Read the exit status on its own line. Writing the "cmd OR rc=status" shorthand inline would be
  # read by instrument-failure-check's FAMILY-3 detector as a status-read that follows a pipe
  # character (it does not distinguish the OR operator from a pipe), which is a shrink-only
  # baseline violation and blocks the commit. There is no `set -e` here, so a failing assignment
  # simply falls through to the status read on the following line.
  remote_out="$(git -C "$repo_root" ls-remote --heads "$remote" "$local_ref" 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "CAUSE=release-branch-remote-unreadable — could not read remote '$remote' in $repo_root (ls-remote exited $rc): $remote_out => 'could not look' is not 'nothing there'; refusing to report a finish" >&2
    exit 1
  fi
  if printf '%s\n' "$remote_out" | awk -v ref="$local_ref" '$2 == ref {found=1} END {exit !found}'; then
    remote_has=1
  fi
fi

if [ "$dry_run" -eq 1 ]; then
  if [ "$local_exists" -eq 1 ]; then
    echo "would-delete-local: $branch (merged into $base)"
  else
    echo "local-already-gone: $branch"
  fi
  if [ "$use_remote" -eq 1 ]; then
    if [ "$remote_has" -eq 1 ]; then
      echo "would-delete-remote: $remote/$branch"
    else
      echo "remote-already-clean: $remote/$branch"
    fi
  else
    echo "remote-skipped: --no-remote"
  fi
  echo "dry-run: no ref was touched"
  exit 0
fi

# ── local delete ──────────────────────────────────────────────────────────────────────────────
if [ "$local_exists" -eq 1 ]; then
  # -D (not -d): the merge test above is against $base, not against HEAD, so `git branch -d`
  # would refuse a legitimately-finished release branch whose tip is not an ancestor of HEAD.
  if ! git -C "$repo_root" branch -D "$branch" >/dev/null 2>&1; then
    echo "CAUSE=release-branch-local-delete-failed — git branch -D '$branch' failed in $repo_root" >&2
    exit 1
  fi
  echo "deleted-local: $branch (merged into $base)"
else
  echo "local-already-gone: $branch"
fi

# ── remote delete ─────────────────────────────────────────────────────────────────────────────
if [ "$use_remote" -eq 1 ]; then
  if [ "$remote_has" -eq 1 ]; then
    if ! git -C "$repo_root" push -q "$remote" --delete "$local_ref" 2>/dev/null; then
      echo "CAUSE=release-branch-remote-delete-failed — the local branch is gone but '$remote/$branch' was NOT deleted (the push --delete was rejected); re-run to retry the remote half" >&2
      exit 1
    fi
    echo "deleted-remote: $remote/$branch"
  else
    echo "remote-already-clean: $remote/$branch"
  fi
else
  echo "remote-skipped: --no-remote"
fi

echo "finished: $branch"
exit 0
