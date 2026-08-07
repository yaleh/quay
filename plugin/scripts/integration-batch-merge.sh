#!/usr/bin/env bash
# integration-batch-merge.sh — the integration→develop batch-merge helper of the two-line branch
# model (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point, AC3; real-merge
# mode per gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling).
#
# Under the two-line model the outer verification-round batch-merges `integration` → `develop`.
# The ORIGINAL design assumed this is ALWAYS a fast-forward (integration is always a descendant of
# develop, SPEC §4). That assumption was EMPIRICALLY NEGATED on 2026-08-06 23:48 (a 60-second
# disproof: develop advances via direct inner/outer/manager commits within a minute of an alignment
# merge), and the direction ruling (2026-08-06 23:4x) changed integration→develop from FF-only to
# real-merge on divergence.
#
# Modes:
#   default (no --merge) — fast-forward when integration is a descendant of develop; on TRUE
#     divergence (develop has commits integration lacks) report the divergence surface
#     (develop-only / integration-only counts + would-conflict file list) and FAIL CLOSED (needs a
#     human, nothing moved) — never a blind --ours/--theirs.
#   --merge — on TRUE divergence, perform a REAL merge of `integration` into `develop` (a merge
#     commit, built in a throwaway temp git worktree; the primary checkout is never touched).
#     Conflicts on KNOWN SHARED files (defaults: *tick-log.md, tasks/*.md, *queue-state* — files
#     written directly to develop by the inner/outer/manager, whose authoritative version lives on
#     develop) are auto-resolved develop-authoritative; any REAL code conflict FAILS CLOSED (needs a
#     human, nothing moved, conflict file list reported) — never blind --ours/--theirs on code.
#     Fast-forward when possible (no gratuitous merge commits).
#
# Contract (task body):
#   measure   integration_ff_merges = `git merge-base --is-ancestor <integration> <develop>` exit code
#             (0 = integration's tip is reachable from develop = its commits are absorbed)
#   band      integration_ff_merges = 0 (POST-state: after a successful batch merge integration is an
#             ancestor of develop; the PRE-state ff-ability check is `--is-ancestor <develop> <integration>`)
#   invoke    `git log --oneline develop..integration` (only pending-verification task merges, never empty
#             during a red window)
#   control   a task merged into integration during a red window does NOT block; a touch-declaration
#             imprecision shows up as a task→integration merge conflict, never a silent overwrite.
#
# The helper performs a REF-LEVEL fast-forward (`git update-ref` with a CAS on the old develop tip)
# or a REF-LEVEL real merge (temp worktree → merge → CAS update-ref), so it never touches the primary
# working tree and never needs `integration`/`develop` checked out. It exits non-zero — WITHOUT
# moving any ref — when integration is NOT a descendant of develop AND (no --merge, or a real code
# conflict).
#
# Usage:
#   integration-batch-merge.sh [--root <repo>] [--develop <ref>] [--integration <ref>]
#                              [--dry-run] [--merge] [--shared-file <glob>] [--sync]
#   --root        repo root (default: auto-derived from this script's location)
#   --develop     develop ref (default: develop)
#   --integration integration ref (default: integration)
#   --dry-run     check ff-ability + report the measure WITHOUT moving any ref; on divergence, also
#                 report the divergence surface (develop-only / integration-only counts + would-
#                 conflict file list)
#   --merge       on TRUE divergence, perform a REAL merge (a merge commit) instead of failing
#                 closed: conflicts on known shared files (defaults: *tick-log.md, tasks/*.md,
#                 *queue-state*) auto-resolve develop-authoritative; real code conflicts FAIL CLOSED
#                 (never blind --ours/--theirs). Fast-forward when possible.
#   --shared-file <glob>  add a path glob treated as a KNOWN SHARED file (develop-authoritative on
#                 conflict). Repeatable; defaults: *tick-log.md, tasks/*.md, *queue-state*.
#   --sync        (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes) after a successful
#                 merge (ff or real), IMMEDIATELY push the advanced <develop> ref to origin via
#                 sync-lag-check.sh (the event-driven trigger of the cross-machine sync mechanism —
#                 the push happens in the SAME round as the land closure, not at the next tick).
#                 The merge is the primary outcome; a push failure (non-fast-forward = a real
#                 cross-machine divergence) is REPORTED and does not roll the ref back — the
#                 every-tick heartbeat retries it.
#
# Exit codes:
#   0  merge performed (ff or real) OR nothing pending (integration already absorbed into develop);
#      with --dry-run, the ff-ability / divergence surface was reported without moving any ref
#   1  NOT a fast-forward and no --merge (needs a human), OR a real code conflict in --merge mode
#      (fail-closed, nothing moved)
#   2  usage / missing ref
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
develop_ref="develop"
integration_ref="integration"
dry_run=0
sync=0
merge_mode=0
# Global for the real-merge temp worktree path (must outlive real_merge() so the EXIT trap can
# clean it up even under `set -u`).
tmp_wt=""
# Known-shared files: written directly to develop by the inner/outer/manager; integration's copies
# are stale — on conflict, develop is authoritative. Matched against conflicted paths via bash case.
shared_patterns=('*tick-log.md' 'tasks/*.md' '*queue-state*')

usage() {
  sed -n '2,70p' "${BASH_SOURCE[0]}" | sed -n 's/^# \{0,1\}//p' >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --develop) develop_ref="$2"; shift 2 ;;
    --integration) integration_ref="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --merge) merge_mode=1; shift ;;
    --shared-file) shared_patterns+=("$2"); shift 2 ;;
    --sync) sync=1; shift ;;
    *) usage ;;
  esac
done

[ -d "${repo_root}/.git" ] || [ -f "${repo_root}/.git" ] || { echo "integration-batch-merge: not a git repo: ${repo_root}" >&2; exit 2; }

if ! git -C "${repo_root}" rev-parse --verify --quiet "refs/heads/${develop_ref}" >/dev/null; then
  echo "integration-batch-merge: develop ref not found: ${develop_ref}" >&2
  exit 2
fi
if ! git -C "${repo_root}" rev-parse --verify --quiet "refs/heads/${integration_ref}" >/dev/null; then
  echo "integration-batch-merge: integration ref not found: ${integration_ref}" >&2
  exit 2
fi

develop_tip="$(git -C "${repo_root}" rev-parse "refs/heads/${develop_ref}")"
integration_tip="$(git -C "${repo_root}" rev-parse "refs/heads/${integration_ref}")"

# ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

# Is a conflicted path a KNOWN SHARED file (develop-authoritative on conflict)?
is_shared_file() {
  local path="$1" p
  for p in "${shared_patterns[@]}"; do
    case "${path}" in
      ${p}) return 0 ;;
    esac
  done
  return 1
}

# Resolve one conflicted path to the develop side ("ours" — we merge integration INTO develop).
# Covers modify/modify, add/add, theirs-deleted (checkout --ours) and ours-deleted (git rm).
resolve_as_ours() {
  local wt="$1" path="$2"
  if git -C "${wt}" checkout --ours -- "${path}" >/dev/null 2>&1; then
    git -C "${wt}" add -- "${path}" >/dev/null 2>&1 || true
  else
    # ours (develop) DELETED the path — develop-authoritative = keep it deleted.
    git -C "${wt}" rm -q -- "${path}" >/dev/null 2>&1 || true
  fi
}

# Report the divergence surface (AC1): develop-only / integration-only counts + would-conflict files.
# Used by BOTH the dry-run report and the pre-merge report of the real path. Populates the global
# would_conflicts=() array with the would-conflict file list (empty = none / disjoint).
report_divergence() {
  local dev_only int_only mt_out mt_rc
  would_conflicts=()
  dev_only="$(git -C "${repo_root}" rev-list --count "refs/heads/${integration_ref}..refs/heads/${develop_ref}" 2>/dev/null || echo 0)"
  int_only="$(git -C "${repo_root}" rev-list --count "refs/heads/${develop_ref}..refs/heads/${integration_ref}" 2>/dev/null || echo 0)"
  echo "integration-batch-merge: DIVERGENCE — develop and integration have diverged (NOT a fast-forward)"
  echo "integration-batch-merge:   develop-only commits:     ${dev_only}"
  echo "integration-batch-merge:   integration-only commits: ${int_only}"
  # Would-conflict file list, computed WITHOUT touching refs via `git merge-tree` (exit 1 = conflicts).
  mt_out="$(git -C "${repo_root}" merge-tree --write-tree --name-only "refs/heads/${develop_ref}" "refs/heads/${integration_ref}" 2>/dev/null)"
  mt_rc=$?
  if [ "${mt_rc}" -eq 1 ]; then
    while IFS= read -r p; do
      [ -n "${p}" ] && would_conflicts+=("${p}")
    done < <(printf '%s\n' "${mt_out}" | tail -n +2 | sed '/^$/,$d')
  fi
  if [ "${#would_conflicts[@]}" -gt 0 ]; then
    echo "integration-batch-merge:   would-conflict files:"
    local p
    for p in "${would_conflicts[@]}"; do
      echo "integration-batch-merge:     ${p}"
    done
  else
    echo "integration-batch-merge:   would-conflict files: (none — changes are file-disjoint)"
  fi
}

# Report the conflict classification (shared vs code) for the GIVEN path list (args).
report_conflict_classification() {
  local -a shared code
  shared=()
  code=()
  local p
  for p in "$@"; do
    if is_shared_file "${p}"; then shared+=("${p}"); else code+=("${p}"); fi
  done
  echo "integration-batch-merge:   conflict classification:"
  echo "integration-batch-merge:     shared (auto-resolve develop-authoritative): ${#shared[@]}"
  for p in "${shared[@]}"; do
    echo "integration-batch-merge:       ${p}"
  done
  echo "integration-batch-merge:     code (fail-closed, needs human):             ${#code[@]}"
  for p in "${code[@]}"; do
    echo "integration-batch-merge:       ${p}"
  done
}

# --sync: event-driven cross-machine push (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes).
# The land closure just advanced <develop>; push it to origin IMMEDIATELY (same round, not next tick).
do_sync() {
  if [ "${sync}" -ne 1 ]; then
    return 0
  fi
  if [ -f "${SCRIPT_DIR}/sync-lag-check.sh" ]; then
    local sync_out sync_rc
    sync_out="$(bash "${SCRIPT_DIR}/sync-lag-check.sh" --root "${repo_root}" --branch "${develop_ref}" --remote origin --push 2>&1)"
    sync_rc=$?
    printf '%s\n' "${sync_out}"
    if [ "${sync_rc}" -ne 0 ]; then
      echo "integration-batch-merge: SYNC-PUSH FAILED (exit ${sync_rc}) — develop advanced locally but origin/${develop_ref} NOT updated; the every-tick heartbeat will retry (divergence = human resolution)" >&2
    else
      echo "integration-batch-merge: sync-push ok (develop → origin, same round as the land closure)"
    fi
  else
    echo "integration-batch-merge: --sync requested but sync-lag-check.sh not found at ${SCRIPT_DIR}/sync-lag-check.sh; skipping event-driven push (heartbeat will cover it)" >&2
  fi
  return 0
}

# Real merge of `integration` into `develop` (merge commit) in a throwaway temp worktree, then advance
# develop with a CAS on the old tip. Shared-file conflicts auto-resolve develop-authoritative; a real
# code conflict fails closed (nothing moved). Returns 0 on success, 1 on fail-closed.
real_merge() {
  local merge_commit
  tmp_wt="$(mktemp -d "${TMPDIR:-/tmp}/integration-batch-merge.XXXXXX")" || { echo "integration-batch-merge: mktemp failed" >&2; return 1; }

  cleanup() {
    git -C "${repo_root}" worktree remove --force "${tmp_wt}" >/dev/null 2>&1 || true
    rm -rf "${tmp_wt}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  if ! git -C "${repo_root}" worktree add -q --detach "${tmp_wt}" "${develop_tip}" >/dev/null 2>&1; then
    echo "integration-batch-merge: real-merge failed — could not create temp worktree at ${tmp_wt}" >&2
    return 1
  fi

  # Merge integration into develop (detached HEAD at develop_tip). --no-commit: we decide when to
  # commit, after classifying and (if safe) auto-resolving shared-file conflicts.
  if ! git -C "${tmp_wt}" merge --no-ff --no-commit "refs/heads/${integration_ref}" >/dev/null 2>&1; then
    local -a conflicts
    conflicts=()
    while IFS= read -r p; do
      [ -n "${p}" ] && conflicts+=("${p}")
    done < <(git -C "${tmp_wt}" diff --name-only --diff-filter=U)

    if [ "${#conflicts[@]}" -eq 0 ]; then
      echo "integration-batch-merge: real-merge aborted for a non-conflict reason (nothing moved)" >&2
      git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
      return 1
    fi

    # Classify the ACTUAL conflicts.
    shared_conflicts=()
    code_conflicts=()
    local p
    for p in "${conflicts[@]}"; do
      if is_shared_file "${p}"; then shared_conflicts+=("${p}"); else code_conflicts+=("${p}"); fi
    done

    if [ "${#code_conflicts[@]}" -gt 0 ]; then
      # AC3 load-bearing: a REAL code conflict fails closed — never blind --ours/--theirs, no ref moved.
      echo "integration-batch-merge: REAL-MERGE FAIL-CLOSED — code conflicts need a human; nothing moved" >&2
      echo "integration-batch-merge:   code conflict files:" >&2
      for p in "${code_conflicts[@]}"; do
        echo "integration-batch-merge:     ${p}" >&2
      done
      if [ "${#shared_conflicts[@]}" -gt 0 ]; then
        echo "integration-batch-merge:   (shared files would auto-resolve develop-authoritative, but code conflicts block):" >&2
        for p in "${shared_conflicts[@]}"; do
          echo "integration-batch-merge:     ${p}" >&2
        done
      fi
      git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
      return 1
    fi

    # Only shared-file conflicts → auto-resolve develop-authoritative (AC2).
    echo "integration-batch-merge: auto-resolving shared-file conflicts develop-authoritative (${#shared_conflicts[@]}):"
    for p in "${shared_conflicts[@]}"; do
      echo "integration-batch-merge:   ${p}"
      resolve_as_ours "${tmp_wt}" "${p}"
    done
  fi

  # Commit the merge (uses git's prepared MERGE_MSG from the --no-commit merge).
  if ! git -C "${tmp_wt}" commit -q --no-edit; then
    echo "integration-batch-merge: real-merge commit failed (nothing moved)" >&2
    git -C "${tmp_wt}" merge --abort >/dev/null 2>&1 || true
    return 1
  fi
  merge_commit="$(git -C "${tmp_wt}" rev-parse HEAD)"

  # Advance develop with a CAS on the old tip (atomic; refuses if develop moved concurrently).
  if ! git -C "${repo_root}" update-ref "refs/heads/${develop_ref}" "${merge_commit}" "${develop_tip}"; then
    echo "integration-batch-merge: update-ref CAS failed — develop moved concurrently? Nothing changed." >&2
    return 1
  fi

  # POST-state measure (Contract): integration's tip must now be reachable from develop.
  if git -C "${repo_root}" merge-base --is-ancestor "refs/heads/${integration_ref}" "refs/heads/${develop_ref}"; then
    echo "integration-batch-merge: OK — develop real-merged to integration (merge commit ${merge_commit})"
    echo "integration-batch-merge: measure integration_ff_merges=0"
    do_sync
    return 0
  else
    echo "integration-batch-merge: post-measure FAILED — integration not ancestor of develop after real merge; needs human" >&2
    return 1
  fi
}

# ── main flow ───────────────────────────────────────────────────────────────────────────────────────

# Nothing pending? integration already absorbed into develop ⇒ measure=0, no-op.
if git -C "${repo_root}" merge-base --is-ancestor "refs/heads/${integration_ref}" "refs/heads/${develop_ref}"; then
  if [ "${dry_run}" -eq 1 ]; then
    echo "integration-batch-merge: DRY-RUN (no ref moved)"
    echo "integration-batch-merge: develop=${develop_tip} integration=${integration_tip}"
  fi
  echo "integration-batch-merge: OK — integration is already an ancestor of develop (nothing pending)"
  echo "integration-batch-merge: measure integration_ff_merges=0"
  exit 0
fi

# PRE-state: is develop an ancestor of integration (integration a descendant ⇒ fast-forward)?
if git -C "${repo_root}" merge-base --is-ancestor "refs/heads/${develop_ref}" "refs/heads/${integration_ref}"; then
  ff_possible=1
else
  ff_possible=0
fi

# What's pending on integration that develop doesn't have yet (the invoke surface)?
pending="$(git -C "${repo_root}" log --oneline "refs/heads/${develop_ref}..refs/heads/${integration_ref}" 2>/dev/null || true)"

if [ "${dry_run}" -eq 1 ]; then
  echo "integration-batch-merge: DRY-RUN (no ref moved)"
  echo "integration-batch-merge: develop=${develop_tip} integration=${integration_tip}"
  if [ "${ff_possible}" -eq 1 ]; then
    echo "integration-batch-merge: FF-OK — integration is a descendant of develop"
    echo "integration-batch-merge: pending on integration:"
    printf '%s\n' "${pending}" | sed 's/^/    /'
  else
    report_divergence
    if [ "${merge_mode}" -eq 1 ]; then
      report_conflict_classification "${would_conflicts[@]}"
    fi
    echo "integration-batch-merge: NOT-FAST-FORWARD — integration is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative)" >&2
    exit 1
  fi
  # Post-state measure (would-be): `git merge-base --is-ancestor <integration> <develop>`.
  if git -C "${repo_root}" merge-base --is-ancestor "refs/heads/${integration_ref}" "refs/heads/${develop_ref}"; then
    echo "integration-batch-merge: measure integration_ff_merges=0 (post: integration is ancestor of develop)"
  else
    echo "integration-batch-merge: measure integration_ff_merges=1 (post: integration NOT yet ancestor — merge pending)"
  fi
  exit 0
fi

if [ "${ff_possible}" -eq 1 ]; then
  # Perform the ref-level fast-forward with a CAS on the old develop tip (atomic; refuses if develop
  # moved concurrently — never a blind force-overwrite).
  if ! git -C "${repo_root}" update-ref "refs/heads/${develop_ref}" "${integration_tip}" "${develop_tip}"; then
    echo "integration-batch-merge: update-ref CAS failed — develop moved concurrently? Nothing changed." >&2
    exit 1
  fi

  # POST-state measure (Contract): integration's tip must now be reachable from develop.
  if git -C "${repo_root}" merge-base --is-ancestor "refs/heads/${integration_ref}" "refs/heads/${develop_ref}"; then
    echo "integration-batch-merge: OK — develop fast-forwarded to integration"
    echo "integration-batch-merge: measure integration_ff_merges=0"
    echo "integration-batch-merge: develop=${integration_tip}"
    do_sync
  else
    echo "integration-batch-merge: post-measure FAILED — integration not ancestor of develop after ff; needs human" >&2
    exit 1
  fi
  exit 0
fi

# NOT a fast-forward (true divergence) — the pre-merge report, then either fail closed (default) or
# real-merge (--merge).
report_divergence
if [ "${merge_mode}" -eq 0 ]; then
  echo "integration-batch-merge: NOT-FAST-FORWARD — integration is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative)" >&2
  exit 1
fi

real_merge
exit $?
