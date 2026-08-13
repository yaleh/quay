#!/usr/bin/env bash
# sync-lag-check.sh — cross-machine sync: mechanical lag measurement + BIDIRECTIONAL sync decision
# for the FORK_BASELINE branch (quay: develop). The missing call-site mechanism for
# periodic-push-backup.sh (tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes) AND the
# bidirectional merge mechanism for TWO PEER quay developers
# (tasks/gap-two-peer-quay-developers-continuous-bidirectional-merge).
#
# THE GAP IT CLOSES: cross-machine sync had NO mechanism — both A and B accumulated unpushed work
# (A 26 / B 98) and B fell 405 behind over ~6h, discovered only because a human looked.
# periodic-push-backup.sh shipped but had ZERO live callers. This script is the CALL SITE.
#
# BIDIRECTIONAL (two peer developers, human frame 2026-08-06): the authority model is
# "develop/GitHub is the cross-machine convergence point" (orchestration/PLAN-develop-branch-cutover-
# 2026-08-06.md) — both machines continuously PUSH their local develop to origin/develop (upsync, the
# --push mode below) AND PULL origin/develop into their local develop (downsync, the --pull mode below).
# --pull is the downsync direction that makes "A 能拉到 B 最新 + B 能拉到 A 最新" real: each machine
# fast-forwards its local develop to origin/develop when it is strictly behind (a pure downsync — the
# peer's commits that local lacks are applied, "develop on latest"), and FAILS CLOSED on a TRUE
# divergence (both sides have commits the other lacks — that is the real bidirectional merge the
# loop's own red-window/merge handling resolves, never a blind --ours/--theirs here).
#
# THE MECHANISM (slot-refill double-trigger pattern, per the task's Chosen mechanism):
#   1. tick-heartbeat (fallback, must-run): every loop tick, run this script (default / --push + the
#      downsync --pull companion) — it UNCONDITIONALLY asks if local <branch> leads origin/<branch>
#      and pushes if so, and (with --pull) asks if origin/<branch> leads local <branch> and
#      fast-forwards if so. It does NOT depend on any completion event.
#   2. event-driven (accelerated): integration-batch-merge.sh --sync runs this right after a land
#      closure fast-forwards <branch> — the push happens in the SAME round, not waiting for the next tick.
#
# NO system crontab — this is the shipped mechanism. It lives in plugin/scripts/, is referenced from
# plugin/loop/*.md (so it rides the upgrade channel and is covered by the derived laydown set), and the
# actual push reuses the existing non-force/idempotent periodic-push-backup.sh body (byte-unchanged).
#
# SAFETY: the push is ALWAYS non-force (delegated to periodic-push-backup.sh). A non-fast-forward
# rejection means origin/<branch> has commits the local repo lacks (a real cross-machine divergence) —
# NOTHING is overwritten, the rejection is reported, and the next heartbeat retries. This is the
# fail-closed guarantee that makes the heartbeat safe to run unconditionally every tick.
#
# The Contract measure (`git rev-list --count origin/develop..develop`) is the local ref, NOT a fetch —
# the push is protected by git's own non-force rule, so a stale origin ref can only cause a fail-closed
# rejection, never silent loss. The downsync --pull DOES fetch (it must see the peer's latest to apply
# it) and fast-forwards local <branch> ONLY when local is strictly behind (no local commits to lose);
# a true divergence FAILS CLOSED with the behind/ahead surface reported — never blind --ours/--theirs.
#
# Usage:
#   sync-lag-check.sh [--branch <ref>] [--remote <name>] [--root <repo>]
#                     [--push] [--pull] [--json] [--dry-run] [--push-script <path>]
#
#   (no args)   measure + push-if-leading (the tick-heartbeat / event-driven upsync action)
#   --branch    branch to sync (default: develop — the FORK_BASELINE)
#   --remote    remote to sync against (default: origin)
#   --root      repo root (default: auto-derived from this script's location)
#   --push      explicit push-if-leading (same as no-args; for the tick docs' self-documentation)
#   --pull      DOWNSYNC (bidirectional merge): fetch origin/<branch>, and if local <branch> is
#               strictly behind (origin has commits local lacks, local has nothing origin lacks),
#               fast-forward local <branch> to origin/<branch> — "apply latest, develop on latest".
#               A TRUE divergence (local AND origin each have commits the other lacks) FAILS CLOSED
#               (nothing moved, the behind/ahead surface reported) — the real merge is the loop's.
#   --json      measure ONLY, machine-readable (AC3) — never mutates, never pushes
#   --dry-run   measure + report what WOULD be pushed/pulled, move nothing
#   --push-script  override the push backend (default: sibling periodic-push-backup.sh)
#
# Exit codes:
#   0  synced (pushed, or already in sync / nothing to push; pulled, or nothing to pull) / --json success
#   1  push rejected (non-fast-forward — divergence; nothing overwritten) / push backend error /
#      --pull TRUE divergence (nothing moved) / --pull fast-forward failed
#   2  usage / not a git repo / remote missing / local branch missing (fail-closed)
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$SCRIPT_DIR/../.." && pwd)"
branch="develop"
remote="origin"
mode="push"      # push | pull | json
dry_run=0
push_script="${SCRIPT_DIR}/periodic-push-backup.sh"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch) branch="${2:-}"; shift 2 ;;
    --remote) remote="${2:-}"; shift 2 ;;
    --root) repo_root="${2:-}"; shift 2 ;;
    --push) mode="push"; shift ;;
    --pull) mode="pull"; shift ;;
    --json) mode="json"; shift ;;
    --dry-run) dry_run=1; shift ;;
    --push-script) push_script="${2:-}"; shift 2 ;;
    --help|-h) sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; exit 0 ;;
    *) echo "sync-lag-check: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "${branch}" ] || { echo "sync-lag-check: empty --branch" >&2; exit 2; }
[ -n "${remote}" ] || { echo "sync-lag-check: empty --remote" >&2; exit 2; }

# ── fail-closed preflight ──────────────────────────────────────────────────────────────────────────
if ! git -C "${repo_root}" rev-parse --git-dir >/dev/null 2>&1; then
  echo "sync-lag-check: not a git repo: ${repo_root}" >&2
  exit 2
fi
if ! git -C "${repo_root}" show-ref --verify --quiet "refs/heads/${branch}"; then
  echo "sync-lag-check: local branch not found: ${branch}" >&2
  exit 2
fi
if ! git -C "${repo_root}" remote get-url "${remote}" >/dev/null 2>&1; then
  echo "sync-lag-check: remote not found: ${remote}" >&2
  exit 2
fi

# ── --pull: the DOWNSYNC direction (bidirectional merge, two peer developers) ───────────────────────
# The authority model (orchestration/PLAN-develop-branch-cutover-2026-08-06.md): develop/GitHub is the
# cross-machine convergence point; each machine pushes its develop to origin/develop (the --push path
# above) AND pulls origin/develop into its local develop. --pull is the pull direction: it FETCHES
# origin/<branch> (it must see the peer's latest — unlike the push, which is protected by git's own
# non-force rule even against a stale ref), then:
#   * strictly behind (behind > 0, unpushed == 0 — local has nothing origin lacks): fast-forward local
#     <branch> to origin/<branch>. Pure downsync — the peer's commits that local lacks are applied
#     ("apply latest and develop on latest"), no local work is at risk (local is an ancestor).
#   * TRUE divergence (behind > 0 AND unpushed > 0 — both sides have commits the other lacks): the real
#     bidirectional merge. FAIL CLOSED (nothing moved) with the behind/ahead surface reported — the
#     loop's own red-window/merge handling resolves it, never a blind --ours/--theirs here.
#   * in-sync (behind == 0): nothing to pull.
if [ "${mode}" = "pull" ]; then
  local_fetch_rc=0
  git -C "${repo_root}" fetch -q "${remote}" "${branch}" 2>/dev/null
  local_fetch_rc=$?
  if [ "${local_fetch_rc}" -ne 0 ]; then
    echo "sync-lag-check: --pull FETCH FAILED (exit ${local_fetch_rc}) — origin/${branch} unreachable; nothing pulled; the next heartbeat retries" >&2
    exit "${local_fetch_rc}"
  fi
  # Re-measure against the freshly-fetched ref (origin/<branch> now reflects the peer's latest).
  if git -C "${repo_root}" rev-parse --verify --quiet "refs/remotes/${remote}/${branch}" >/dev/null 2>&1; then
    pull_behind="$(git -C "${repo_root}" rev-list --count "refs/heads/${branch}..refs/remotes/${remote}/${branch}" 2>/dev/null || echo 0)"
    pull_unpushed="$(git -C "${repo_root}" rev-list --count "refs/remotes/${remote}/${branch}..refs/heads/${branch}" 2>/dev/null || echo 0)"
  else
    pull_behind="0"
    pull_unpushed="0"
  fi

  if [ "${dry_run}" -eq 1 ]; then
    echo "sync-lag-check: --pull DRY-RUN branch=${branch} remote=${remote} behind=${pull_behind} unpushed=${pull_unpushed} — WOULD fast-forward local ${branch} to origin/${branch} (no ref moved)"
    exit 0
  fi

  if [ "${pull_behind}" -eq 0 ] 2>/dev/null; then
    echo "sync-lag-check: --pull branch=${branch} remote=${remote} behind=0 — in-sync (nothing to pull)"
    exit 0
  fi

  if [ "${pull_unpushed}" -gt 0 ] 2>/dev/null; then
    echo "sync-lag-check: --pull DIVERGENCE branch=${branch} remote=${remote} behind=${pull_behind} unpushed=${pull_unpushed} — BOTH sides have commits the other lacks; NOT fast-forwarding (a real bidirectional merge is needed, not a blind --ours/--theirs); nothing moved" >&2
    exit 1
  fi

  # Strictly behind: fast-forward local <branch> to origin/<branch>.
  origin_tip="$(git -C "${repo_root}" rev-parse "refs/remotes/${remote}/${branch}" 2>/dev/null || true)"
  if [ -z "${origin_tip}" ]; then
    echo "sync-lag-check: --pull cannot resolve origin/${branch} tip; nothing moved" >&2
    exit 1
  fi
  if ! git -C "${repo_root}" update-ref "refs/heads/${branch}" "${origin_tip}"; then
    echo "sync-lag-check: --pull fast-forward FAILED — local ${branch} not updated; nothing moved" >&2
    exit 1
  fi
  echo "sync-lag-check: --pull branch=${branch} remote=${remote} fast-forwarded local ${branch} by ${pull_behind} commit(s) to origin/${branch} (apply latest, develop on latest)"
  exit 0
fi

# ── measure the lag (the ## Contract measure surface) ─────────────────────────────────────────────
# unpushed = `git rev-list --count origin/<branch>..<branch>`. When origin/<branch> does not exist yet
# (first publish), unpushed = the branch's full commit count (everything local is unpushed), behind = 0.
if git -C "${repo_root}" rev-parse --verify --quiet "refs/remotes/${remote}/${branch}" >/dev/null 2>&1; then
  unpushed="$(git -C "${repo_root}" rev-list --count "refs/remotes/${remote}/${branch}..refs/heads/${branch}" 2>/dev/null || echo 0)"
  behind="$(git -C "${repo_root}" rev-list --count "refs/heads/${branch}..refs/remotes/${remote}/${branch}" 2>/dev/null || echo 0)"
else
  unpushed="$(git -C "${repo_root}" rev-list --count "refs/heads/${branch}" 2>/dev/null || echo 0)"
  behind="0"
fi
leads=0; [ "${unpushed:-0}" -gt 0 ] 2>/dev/null && leads=1

# ── --json: measure ONLY (never mutates) — AC3 the sync lag is mechanically readable ───────────────
if [ "${mode}" = "json" ]; then
  if [ "${leads}" -eq 1 ]; then leads_json=true; else leads_json=false; fi
  if [ "${leads}" -eq 1 ]; then synced_json=false; else synced_json=true; fi
  printf '{"branch":"%s","remote":"%s","unpushed":%s,"behind":%s,"leads":%s,"synced":%s,"action":"measure-only","pushed":false}\n' \
    "${branch}" "${remote}" "${unpushed:-0}" "${behind:-0}" "${leads_json}" "${synced_json}"
  exit 0
fi

# ── the push decision ──────────────────────────────────────────────────────────────────────────────
if [ "${leads}" -eq 1 ]; then
  if [ "${dry_run}" -eq 1 ]; then
    echo "sync-lag-check: DRY-RUN branch=${branch} remote=${remote} unpushed=${unpushed} behind=${behind} — WOULD push (no ref moved)"
    exit 0
  fi
  echo "sync-lag-check: branch=${branch} remote=${remote} unpushed=${unpushed} behind=${behind} leads=true — pushing"
  out="$(bash "${push_script}" --root "${repo_root}" --branch "${branch}" --remote "${remote}" 2>&1)"
  rc=$?
  printf '%s\n' "${out}"
  if [ "${rc}" -ne 0 ]; then
    echo "sync-lag-check: PUSH FAILED (exit ${rc}) — origin/${branch} NOT updated; nothing overwritten; the next heartbeat retries" >&2
    exit "${rc}"
  fi
  # Post-push measure: the ## Contract measure `git rev-list --count origin/develop..develop` must be 0.
  after="$(git -C "${repo_root}" rev-list --count "refs/remotes/${remote}/${branch}..refs/heads/${branch}" 2>/dev/null || echo 0)"
  echo "sync-lag-check: synced (unpushed_after_tick=${after})"
  exit 0
fi

# Not leading: nothing to push. Report the state (behind is a pull/downsync concern, not a push).
echo "sync-lag-check: branch=${branch} remote=${remote} unpushed=0 behind=${behind} — in-sync (no push needed)"
exit 0
