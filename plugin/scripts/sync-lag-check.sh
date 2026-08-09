#!/usr/bin/env bash
# sync-lag-check.sh — cross-machine sync: mechanical lag measurement + push decision for the
# FORK_BASELINE branch (quay: develop). The missing call-site mechanism for periodic-push-backup.sh
# (tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes).
#
# THE GAP IT CLOSES: cross-machine sync had NO mechanism — both A and B accumulated unpushed work
# (A 26 / B 98) and B fell 405 behind over ~6h, discovered only because a human looked.
# periodic-push-backup.sh shipped but had ZERO live callers. This script is the CALL SITE.
#
# THE MECHANISM (slot-refill double-trigger pattern, per the task's Chosen mechanism):
#   1. tick-heartbeat (fallback, must-run): every loop tick, run this script (default / --push) —
#      it UNCONDITIONALLY asks if local <branch> leads origin/<branch> and pushes if so. It does NOT
#      depend on any completion event.
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
# rejection, never silent loss. Pull/downsync is a separate concern (gap-a-to-b-code-downsync-*).
#
# Usage:
#   sync-lag-check.sh [--branch <ref>] [--remote <name>] [--root <repo>]
#                     [--push] [--json] [--dry-run] [--push-script <path>]
#
#   (no args)   measure + push-if-leading (the tick-heartbeat / event-driven action)
#   --branch    branch to sync (default: develop — the FORK_BASELINE)
#   --remote    remote to sync against (default: origin)
#   --root      repo root (default: auto-derived from this script's location)
#   --push      explicit push-if-leading (same as no-args; for the tick docs' self-documentation)
#   --json      measure ONLY, machine-readable (AC3) — never mutates, never pushes
#   --dry-run   measure + report what WOULD be pushed, push nothing
#   --push-script  override the push backend (default: sibling periodic-push-backup.sh)
#
# Exit codes:
#   0  synced (pushed, or already in sync / nothing to push) / --json success
#   1  push rejected (non-fast-forward — divergence; nothing overwritten) / push backend error
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
mode="push"      # push | json | dry-run
push_script="${SCRIPT_DIR}/periodic-push-backup.sh"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch) branch="${2:-}"; shift 2 ;;
    --remote) remote="${2:-}"; shift 2 ;;
    --root) repo_root="${2:-}"; shift 2 ;;
    --push) mode="push"; shift ;;
    --json) mode="json"; shift ;;
    --dry-run) mode="dry-run"; shift ;;
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
  if [ "${mode}" = "dry-run" ]; then
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
