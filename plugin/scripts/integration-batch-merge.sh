#!/usr/bin/env bash
# integration-batch-merge.sh — the integration→develop batch-merge helper of the two-line branch
# model (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point, AC3).
#
# Under the two-line model the outer verification-round batch-merges `integration` → `develop` as a
# FAST-FORWARD. This is structurally conflict-free because `integration` only ever received merges
# from `task/<id>` branches that themselves forked from `develop` (independent) or `integration`
# (declared dependency) — so `integration` is ALWAYS a descendant of `develop` (SPEC §4). The red
# window no longer stops dispatch: tasks merge into `integration` while the suite is red; only the
# batch-merge to `develop` waits for green.
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
# The helper performs a REF-LEVEL fast-forward (`git update-ref` with a CAS on the old develop tip) so
# it never touches the working tree and never needs `integration`/`develop` checked out. It exits
# non-zero — WITHOUT moving any ref — when integration is NOT a descendant of develop (true divergence;
# needs a human, never an automatic --ours/--theirs).
#
# Usage:
#   integration-batch-merge.sh [--root <repo>] [--develop <ref>] [--integration <ref>] [--dry-run] [--sync]
#   --root        repo root (default: auto-derived from this script's location)
#   --develop     develop ref (default: develop)
#   --integration integration ref (default: integration)
#   --dry-run     check ff-ability + report the measure WITHOUT moving any ref
#   --sync        (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes) after a successful
#                 fast-forward, IMMEDIATELY push the advanced <develop> ref to origin via
#                 sync-lag-check.sh (the event-driven trigger of the cross-machine sync mechanism —
#                 the push happens in the SAME round as the land closure, not at the next tick).
#                 The merge is the primary outcome; a push failure (non-fast-forward = a real
#                 cross-machine divergence) is REPORTED and does not roll the ref back — the
#                 every-tick heartbeat retries it.
#
# Exit codes:
#   0  fast-forward performed (or, with --dry-run, ff-ability verified)
#   1  NOT a fast-forward (integration is not a descendant of develop) — nothing moved
#   2  usage / missing ref
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
develop_ref="develop"
integration_ref="integration"
dry_run=0
sync=0

usage() {
  sed -n '2,44p' "${BASH_SOURCE[0]}" | sed -n 's/^# \{0,1\}//p' >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --develop) develop_ref="$2"; shift 2 ;;
    --integration) integration_ref="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
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
    echo "integration-batch-merge: NOT-FAST-FORWARD — develop has commits integration lacks (divergence); needs human" >&2
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

if [ "${ff_possible}" -ne 1 ]; then
  echo "integration-batch-merge: NOT-FAST-FORWARD — integration is not a descendant of develop" >&2
  echo "integration-batch-merge: develop has commits integration lacks; refusing to overwrite. Needs a human." >&2
  exit 1
fi

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
else
  echo "integration-batch-merge: post-measure FAILED — integration not ancestor of develop after ff; needs human" >&2
  exit 1
fi

# ── --sync: event-driven cross-machine push (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes) ──
# The land closure just advanced <develop>; push it to origin IMMEDIATELY (same round, not next tick).
# A push failure (non-fast-forward = origin has commits this repo lacks — a real divergence) is
# REPORTED but does not fail the merge: the ref already advanced locally, and the every-tick heartbeat
# (sync-lag-check.sh --push) will keep retrying until a human resolves the divergence.
if [ "${sync}" -eq 1 ]; then
  if [ -f "${SCRIPT_DIR}/sync-lag-check.sh" ]; then
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
fi

exit 0
