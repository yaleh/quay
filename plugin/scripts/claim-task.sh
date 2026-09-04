#!/usr/bin/env bash
# claim-task.sh — claim a task on the CLAIM REMOTE by pushing an empty `task/<id>` marker branch.
# 2026-08-06 branch-cutover (orchestration/PLAN-develop-branch-cutover-2026-08-06.md): the claim
# remote is GitHub `origin`; the pre-cutover local A↔B bare repo target is RETIRED.
# (origin task: gap-two-machine-collaboration-git-branch-claiming, AC1/AC2/AC4.)
#
# Protocol (task body "选定机制"):
#   * push an empty marker commit to `refs/heads/task/<id>` on the shared bare repo = CLAIM
#   * the branch already exists on the shared repo = ALREADY CLAIMED (either machine owns it)
#   * merge the task work + delete the branch = RELEASE (see release-task.sh)
#   * `--check-touches` runs the single-source checkTouchesPair (via claim-task.ts) against the
#     in-flight `task/*` branches on the shared repo: a candidate whose `## Touches` overlap an
#     in-flight peer is REFUSED (AC2) — pick a different task.
#
# The push is the ATOMIC claim primitive: two machines racing to claim the SAME task — one wins, the
# other gets a non-fast-forward rejection (git's inherent compare-and-swap on ref creation; verified
# 2026-08-06 with two clones of a shared bare repo). The claim marker is an ORPHAN COMMIT on the empty
# tree — a pure existence marker; the actual work happens on the LOCAL `task/<id>` branch in the
# machine's own worktree and is never pushed to the claim ref. The marker's commit message carries
# `quay-claim <id> <hostname> <ISO>` and its author date is the claim time, so another machine can
# inspect `--status` and — when the claim is provably stale (author date older than `--stale-after`,
# default 6h) — take it over with `--reclaim` (guarded by `--force-with-lease` CAS so two concurrent
# reclaims of the same stale claim cannot both win).
#
# The claim remote (GitHub `origin` in the branch-cutover model) is the ONLY cross-host state store
# — telemetry inProgress files and worktree dirs are local; git branches are visible to both machines.
# So the claim is built on git, not on a
# shared-filesystem assumption (the same root cause that makes the QUAY_GLOBAL_DIR single-flight lock
# die across hosts). FAIL-CLOSED: without an explicit `--remote` / `$QUAY_CLAIM_REMOTE` this script
# exits 2 — a single-machine workspace does not claim (the loop skips the claim step entirely when no
# claim remote is configured), so single-machine dispatch is byte-for-behavior unchanged.
#
# Usage:
#   claim-task.sh <task-id> [--root <repo>] [--remote <remote>] [--check-touches] [--sync] [--dry-run]
#   claim-task.sh --status <task-id> [--root <repo>] [--remote <remote>]
#   claim-task.sh --reclaim <task-id> [--stale-after <hours>] [--root <repo>] [--remote <remote>]
#
#   --root          repo root (default: auto-derived from this script's location)
#   --remote        the claim remote (a git remote name or a filesystem path; GitHub origin in the
#                   branch-cutover model). Default:
#                   $QUAY_CLAIM_REMOTE; REQUIRED (fail-closed — no silent claim on an unstated remote).
#   --check-touches AC2: refuse the claim if the candidate's ## Touches overlap any in-flight task/*
#   --sync          (gap-two-peer-quay-developers-continuous-bidirectional-merge AC1/AC3) BEFORE
#                   claiming, run the DOWNSYNC half of the bidirectional merge: pull the fork-baseline
#                   (default develop) from the claim remote into the local branch, so this machine
#                   "develops on latest" (the human frame: both machines continuously apply latest and
#                   develop on latest, symmetric). Delegates to sync-lag-check.sh --pull; a TRUE
#                   divergence (local AND remote each have commits the other lacks) FAILS CLOSED — the
#                   claim is refused with the divergence reported, never a blind merge at claim time.
#   --sync-branch   the branch to downsync with --sync (default: develop — the FORK_BASELINE).
#   --dry-run       check everything WITHOUT pushing the claim branch
#   --stale-after   (--reclaim only) reclaim only when the existing claim's commit is older than this
#                   many hours (default 6)
#
# Exit codes:
#   0  claimed (the empty task/<id> marker is now on the claim remote) — or would be (--dry-run)
#   1  not claimed: already-claimed / touches-overlap (--check-touches) / reclaim refused (not stale) /
#      --sync downsync refused (true divergence — nothing moved, resolve before claiming)
#   2  usage / no claim remote / task file missing / remote unreachable
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
EMPTY_TREE="$(git hash-object -w -t tree /dev/null 2>/dev/null || git hash-object -t tree /dev/null)"

# ── helpers ─────────────────────────────────────────────────────────────────────────────────────────

# A branch ref must point to a commit; the claim marker is an orphan commit on the empty tree whose
# author date == claim time. The commit message records who/what/when for --status / --reclaim.
marker_commit() {
  local id="$1" host iso
  host="$(hostname 2>/dev/null || echo unknown)"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git -C "$repo_root" commit-tree "$EMPTY_TREE" -m "quay-claim ${id} ${host} ${iso}"
}

# Fetch the raw `<sha>\trefs/heads/task/<id>` lines from the shared repo. FAIL-CLOSED on an
# unreachable remote (the caller's `|| { ...; exit 2; }` fires — a command-substitution subshell's
# `exit` cannot propagate, so the check MUST be inline at the call site, never inside a helper).
# `git ls-remote --heads <remote> 'refs/heads/task/*'` exits 0 with EMPTY output when there are no
# task branches, and non-zero on a genuinely unreachable remote.

validate_id() {
  local id="$1"
  case "$id" in
    ''|*' '*) echo "claim-task: invalid task id: '$id'" >&2; exit 2 ;;
    */*) echo "claim-task: task id must be a single path segment (no '/'): '$id'" >&2; exit 2 ;;
  esac
  if ! printf '%s' "$id" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    echo "claim-task: invalid task id (must match ^[A-Za-z0-9][A-Za-z0-9._-]*$): '$id'" >&2
    exit 2
  fi
}

# ── claim mode ──────────────────────────────────────────────────────────────────────────────────────

do_claim() {
  local id="$1"
  validate_id "$id"
  [ -n "$remote" ] || { echo "claim-task: no claim remote — set QUAY_CLAIM_REMOTE or pass --remote" >&2; exit 2; }
  [ -f "$repo_root/tasks/$id.md" ] || { echo "claim-task: task file not found: tasks/$id.md" >&2; exit 2; }

  # 0. --sync: the DOWNSYNC half of the bidirectional merge (two peer developers — "develop on latest").
  #    Pull the fork-baseline from the claim remote into the LOCAL branch BEFORE claiming, so this
  #    machine develops on the peer's latest (not a stale baseline). Fail-closed on a true divergence.
  if [ "${sync}" -eq 1 ]; then
    if [ -f "${SCRIPT_DIR}/sync-lag-check.sh" ]; then
      local sync_out sync_rc
      sync_out="$(bash "${SCRIPT_DIR}/sync-lag-check.sh" --root "${repo_root}" --branch "${sync_branch}" --remote "${remote}" --pull 2>&1)"
      sync_rc=$?
      printf '%s\n' "${sync_out}"
      if [ "${sync_rc}" -ne 0 ]; then
        echo "claim-task: --sync downsync FAILED (exit ${sync_rc}) — local ${sync_branch} and ${remote}/${sync_branch} diverged or remote unreachable; resolve before claiming (never a blind merge at claim time)" >&2
        exit 1
      fi
    else
      echo "claim-task: --sync requested but sync-lag-check.sh not found at ${SCRIPT_DIR}/sync-lag-check.sh; skipping downsync" >&2
    fi
  fi

  # One network call, fail-closed on an unreachable shared repo.
  local heads
  heads="$(git -C "$repo_root" ls-remote --heads "$remote" 'refs/heads/task/*' 2>&1)" || {
    echo "claim-task: shared claim remote unreachable: $remote" >&2
    printf '%s\n' "$heads" >&2
    exit 2
  }

  # 1. Already claimed? (atomic existence check on the shared repo). EXACT ref match (awk $2 ==
  # ref) — a grep substring would false-positive on a sibling task/<id-prefix> claim.
  if printf '%s\n' "$heads" | awk -v ref="refs/heads/task/$id" '$2 == ref {found=1} END {exit !found}'; then
    echo "already-claimed: task/$id is claimed on $remote (either machine owns it)"
    exit 1
  fi

  # 2. AC2 touches check — refuse if the candidate overlaps an in-flight peer.
  if [ "${check_touches:-0}" -eq 1 ]; then
    local inflight verdict
    inflight="$(printf '%s\n' "$heads" | sed 's#.*refs/heads/task/##' | paste -sd, -)"
    if [ -n "$inflight" ]; then
      verdict="$(node --no-warnings --experimental-strip-types "$SCRIPT_DIR/claim-task.ts" \
        --task "$repo_root/tasks/$id.md" --root "$repo_root" --in-flight "$inflight" 2>&1 || true)"
      if ! printf '%s' "$verdict" | grep -q '^claimable'; then
        printf '%s\n' "$verdict"
        exit 1
      fi
    fi
  fi

  # 3. Dry-run? report without pushing.
  if [ "${dry_run:-0}" -eq 1 ]; then
    echo "would-claim: task/$id → $remote (dry-run; no branch pushed)"
    exit 0
  fi

  # 4. Push the marker — the ATOMIC claim. A concurrent claim of the same task is rejected as
  #    non-fast-forward (the loser gets the "already-claimed" branch below).
  local mark
  mark="$(marker_commit "$id")"
  if git -C "$repo_root" push -q "$remote" "$mark:refs/heads/task/$id" 2>/dev/null; then
    echo "claimed: task/$id → $remote"
    exit 0
  else
    echo "already-claimed: task/$id push rejected on $remote (another machine claimed first)"
    exit 1
  fi
}

# ── status mode ─────────────────────────────────────────────────────────────────────────────────────

do_status() {
  local id="$1"
  validate_id "$id"
  [ -n "$remote" ] || { echo "claim-task: no claim remote — set QUAY_CLAIM_REMOTE or pass --remote" >&2; exit 2; }

  local heads
  heads="$(git -C "$repo_root" ls-remote --heads "$remote" 'refs/heads/task/*' 2>&1)" || {
    echo "claim-task: shared claim remote unreachable: $remote" >&2
    printf '%s\n' "$heads" >&2
    exit 2
  }
  local sha
  sha="$(printf '%s\n' "$heads" | awk -v ref="refs/heads/task/$id" '$2 == ref {print $1}' | head -1)"
  if [ -z "$sha" ]; then
    echo "unclaimed: task/$id (no claim branch on $remote)"
    exit 0
  fi

  local info
  info="$(git -C "$repo_root" fetch -q "$remote" "refs/heads/task/$id" 2>/dev/null \
    && git -C "$repo_root" log -1 --format='%ai|%s' FETCH_HEAD 2>/dev/null || echo 'unknown|unknown')"
  echo "claimed: task/$id sha=$sha $info"
  exit 0
}

# ── reclaim mode (stale-claim recovery) ─────────────────────────────────────────────────────────────

do_reclaim() {
  local id="$1"
  validate_id "$id"
  [ -n "$remote" ] || { echo "claim-task: no claim remote — set QUAY_CLAIM_REMOTE or pass --remote" >&2; exit 2; }

  local heads
  heads="$(git -C "$repo_root" ls-remote --heads "$remote" 'refs/heads/task/*' 2>&1)" || {
    echo "claim-task: shared claim remote unreachable: $remote" >&2
    printf '%s\n' "$heads" >&2
    exit 2
  }
  local cur
  cur="$(printf '%s\n' "$heads" | awk -v ref="refs/heads/task/$id" '$2 == ref {print $1}' | head -1)"
  if [ -z "$cur" ]; then
    echo "unclaimed: task/$id (no claim branch to reclaim — claim it normally)"
    exit 1
  fi

  # Staleness gate: read the existing claim commit's author date. Only a claim OLDER than
  # --stale-after hours may be taken over (never a fresh claim — that is the other machine's live
  # work). An unreadable claim commit is treated as stale-eligible? NO — fail-closed: refuse.
  local authordate now_epoch stale_epoch stale_threshold
  if ! git -C "$repo_root" fetch -q "$remote" "refs/heads/task/$id" 2>/dev/null; then
    echo "reclaim-refused: task/$id claim unreadable on $remote (fetch failed) — do not guess" >&2
    exit 1
  fi
  authordate="$(git -C "$repo_root" log -1 --format='%ai' FETCH_HEAD 2>/dev/null || true)"
  if [ -z "$authordate" ]; then
    echo "reclaim-refused: task/$id claim has no readable author date on $remote — do not guess" >&2
    exit 1
  fi
  now_epoch="$(date +%s)"
  stale_epoch="$(date -d "$authordate" +%s 2>/dev/null || echo '')"
  if [ -z "$stale_epoch" ]; then
    echo "reclaim-refused: task/$id cannot parse claim author date '$authordate' — do not guess" >&2
    exit 1
  fi
  stale_threshold=$((stale_after * 3600))
  if [ $((now_epoch - stale_epoch)) -lt "$stale_threshold" ]; then
    local age_h
    age_h="$(awk -v d="$((now_epoch - stale_epoch))" 'BEGIN { printf "%.1f", d/3600 }')"
    echo "reclaim-refused: task/$id claim is ${age_h}h old (< ${stale_after}h) — not stale"
    exit 1
  fi

  # CAS-safe takeover: --force-with-lease only wins if the remote ref is STILL what we observed.
  # Two concurrent reclaims of the same stale claim → one wins, one is refused.
  local mark
  mark="$(marker_commit "$id")"
  if git -C "$repo_root" push -q --force-with-lease="refs/heads/task/$id:$cur" "$remote" "$mark:refs/heads/task/$id" 2>/dev/null; then
    echo "reclaimed: task/$id (took over stale claim on $remote)"
    exit 0
  else
    echo "reclaim-failed: task/$id force-with-lease push refused on $remote (claim moved concurrently)"
    exit 1
  fi
}

# ── arg parse ────────────────────────────────────────────────────────────────────────────────────────

mode="claim"
check_touches=0
dry_run=0
sync=0
sync_branch="develop"
stale_after=6
id=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --remote) remote="$2"; shift 2 ;;
    --check-touches) check_touches=1; shift ;;
    --sync) sync=1; shift ;;
    --sync-branch) sync_branch="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --status) mode="status"; shift ;;
    --reclaim) mode="reclaim"; shift ;;
    --stale-after) stale_after="$2"; shift 2 ;;
    --help|-h) sed -n '2,55p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "claim-task: unknown option: $1" >&2; exit 2 ;;
    *) id="$1"; shift ;;
  esac
done

if [ -z "$id" ]; then
  echo "claim-task: missing task id" >&2
  sed -n '2,55p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi

case "$mode" in
  claim)   do_claim "$id" ;;
  status)  do_status "$id" ;;
  reclaim) do_reclaim "$id" ;;
esac
