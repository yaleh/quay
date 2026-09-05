#!/usr/bin/env bash
# periodic-push-backup.sh — B-machine periodic PUSH BACKUP to the backup remote.
# 2026-08-06 branch-cutover (orchestration/PLAN-develop-branch-cutover-2026-08-06.md): the backup
# remote is GitHub `origin` on BOTH machines; the pre-cutover local A↔B bare repo target is RETIRED.
# (origin task: gap-b-machine-periodic-push-backup-to-bare-repo, AC1/AC2/AC3.)
#
# NARROW scope: periodic COMMIT BACKUP only. This script:
#   * NEVER force-pushes — a non-fast-forward rejection means the bare repo has commits you lack,
#     so the local push is REFUSED and NOTHING on the bare repo is overwritten (no data loss). The
#     manual merge is gap-two-machine-collaboration-git-branch-claiming's scope, not this backup's.
#   * does NOT touch the claiming/authority/conflict logic — claim-task.sh / release-task.sh are
#     byte-unchanged (AC3). Claim markers (refs/heads/task/*) on the shared repo are protected by
#     git's own non-fast-forward rule even under --all (verified by periodic-push-backup.test.mjs).
#   * is IDEMPOTENT — an up-to-date push exits 0, so a cron firing every 10-15 min is harmless.
#   * emits the raw `git push 2>&1` output so the ## Contract measure
#     `git push 2>&1 | grep -c 'To.*quay-sync\|up-to-date'` matches (band push_ok >= 1).
#
# Deployment (2026-08-06 branch-cutover): the local A↔B bare repo (~/work/quay-sync.git) direct sync
# is RETIRED — GitHub `origin` is the sole cross-host sync point and is GitHub on BOTH machines
# (verify with `git remote -v` before cron-installing anywhere). The default (no args) pushes the
# CURRENT branch to `origin`; `--remote` pins a different name/path when needed.
#
# Usage:
#   periodic-push-backup.sh [--remote <name|path>] [--branch <branch>] [--all]
#                           [--root <repo>] [--dry-run] [--cron-line]
#                           [--no-verify-hook] [--verify-branches "<b1> <b2>"]
#
#   (no args)     push the CURRENT branch to `origin`
#   --remote      remote name OR filesystem path (default: origin; origin = GitHub on both machines)
#   --branch      push this local branch instead of the current branch
#   --all         push ALL local branches (opt-in; still NON-force — a diverged ref is rejected)
#   --root        repo root (default: auto-derived from this script's location)
#   --dry-run     `git push --dry-run` — show what WOULD be pushed, push nothing
#   --cron-line   print the one-line cron (a literal `git push`) to install on B's crontab; the
#                 branch is resolved at CRON TIME (`git branch --show-current`), so whatever is
#                 checked out on B gets backed up
#   --no-verify-hook   disable the post-push cross-machine-verify record hook (default: enabled)
#   --verify-branches  which branches count as "merge landing on the shared baseline" for the verify
#                 hook (default: "develop integration" — the FORK_BASELINE / MERGE_TARGET)
#
# CROSS-MACHINE VERIFICATION HOOK (gap-no-post-merge-cross-machine-verification-detection-latency-is-luck):
#   After a SUCCESSFUL push of a branch in `--verify-branches`, the pushed tip IS a merge landing on the
#   shared baseline → record it via cross-machine-verify.sh --record-merge (event-driven trigger of the
#   cross-machine VERIFICATION mechanism; idempotent — a merge note that already exists is skipped). This
#   makes the record robust: it fires at EVERY push boundary (the tick 3b land, the sync-lag-check
#   heartbeat push, a manual push), not just the one land path. The hook is only about RECORDING the
#   merge's identity; the actual VERIFY (a non-participating machine running the fast gate) is the loop
#   tick heartbeat (fast-mode 4b / orchestrator 3d).
#
# Exit codes:
#   0  push succeeded or everything up-to-date
#   1  non-fast-forward / divergence — backup NOT applied, nothing lost on the bare repo
#   2  usage / not a git repo / remote or branch missing
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
branch=""
all=0
dry_run=0
cron_line=0
verify_hook=1
verify_branches="develop integration"
log_path="${QUAY_BACKUP_LOG:-$HOME/.quay/quay-backup.log}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote) remote="${2:-}"; shift 2 ;;
    --branch) branch="${2:-}"; shift 2 ;;
    --all) all=1; shift ;;
    --root) repo_root="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --cron-line) cron_line=1; shift ;;
    --no-verify-hook) verify_hook=0; shift ;;
    --verify-branches) verify_branches="${2:-}"; shift 2 ;;
    --help|-h) sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; exit 0 ;;
    *) echo "periodic-push-backup: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "${remote}" ] || { echo "periodic-push-backup: empty --remote" >&2; exit 2; }

# ── --cron-line: print the one-line cron (a literal `git push`) ────────────────────────────────────
# The ## Contract invoke measure is `crontab -l 2>&1 | grep -c 'git push'` — the printed line MUST
# contain the literal string `git push`. Cadence */12 = every 12 min, inside the task's 10-15 min
# band (and under the AC15 backup-latency cap of 20 min). The branch is resolved at CRON TIME so B's
# CURRENT checkout is always the thing backed up.
if [ "${cron_line}" -eq 1 ]; then
  if [ "${all}" -eq 1 ]; then
    printf '%s\n' "*/12 * * * * cd ${repo_root} && git push --all ${remote} >> ${log_path} 2>&1"
  elif [ -n "${branch}" ]; then
    printf '%s\n' "*/12 * * * * cd ${repo_root} && git push ${remote} ${branch} >> ${log_path} 2>&1"
  else
    printf '%s\n' "*/12 * * * * cd ${repo_root} && git push ${remote} \"\$(git branch --show-current)\" >> ${log_path} 2>&1"
  fi
  exit 0
fi

# ── fail-closed preflight ──────────────────────────────────────────────────────────────────────────
if ! git -C "${repo_root}" rev-parse --git-dir >/dev/null 2>&1; then
  echo "periodic-push-backup: not a git repo: ${repo_root}" >&2
  exit 2
fi
# --remote is either a CONFIGURED remote name (`git remote get-url` succeeds) or a filesystem path to
# a (bare or non-bare) repo. FAIL-CLOSED on neither — a silent push to the wrong target is a data-loss
# risk, so an unresolvable remote is a hard error, never a fallback.
if ! git -C "${repo_root}" remote get-url "${remote}" >/dev/null 2>&1; then
  if [ ! -d "${remote}/.git" ] && [ ! -d "${remote}" ]; then
    echo "periodic-push-backup: remote not found (not a configured remote nor an existing path): ${remote}" >&2
    exit 2
  fi
fi

# ── resolve what to push ───────────────────────────────────────────────────────────────────────────
push_target=""
if [ "${all}" -eq 1 ]; then
  push_target="all branches"
else
  if [ -n "${branch}" ]; then
    if ! git -C "${repo_root}" show-ref --verify --quiet "refs/heads/${branch}"; then
      echo "periodic-push-backup: local branch not found: ${branch}" >&2
      exit 2
    fi
  else
    branch="$(git -C "${repo_root}" branch --show-current 2>/dev/null || true)"
    if [ -z "${branch}" ]; then
      echo "periodic-push-backup: cannot determine current branch (detached HEAD?) — pass --branch <branch> or --all" >&2
      exit 2
    fi
  fi
  push_target="${branch}"
fi

# ── the push (NEVER --force; a non-fast-forward is a manual-merge signal, not a backup action) ─────
push_cmd=(push)
if [ "${dry_run}" -eq 1 ]; then push_cmd+=(--dry-run); fi
push_cmd+=("${remote}")
if [ "${all}" -eq 1 ]; then push_cmd+=(--all); else push_cmd+=("${branch}"); fi

out="$(git -C "${repo_root}" "${push_cmd[@]}" 2>&1)"
rc=$?
# Raw git output — the ## Contract measure greps 'To.*quay-sync|up-to-date' here (band push_ok >= 1).
printf '%s\n' "${out}"

if [ "${rc}" -eq 0 ]; then
  if printf '%s\n' "${out}" | grep -qi 'up-to-date'; then
    echo "backup-ok: up-to-date (${push_target} → ${remote}) — nothing new to back up"
  else
    echo "backup-ok: pushed (${push_target} → ${remote})"
    # ── cross-machine verification record hook (event-driven trigger) ──────────────────────────
    # A pushed branch in the tracked set IS a merge landing on the shared baseline → record it.
    # Only on a REAL push (not up-to-date, not --dry-run). Idempotent.
    if [ "${verify_hook}" -eq 1 ] && [ "${dry_run}" -eq 0 ]; then
      # (vb/tip are assigned inside the loops below; a bare `vb tip` here would run as a command)
      pushed_branch=""
      if [ "${all}" -eq 1 ]; then
        # --all pushed everything; record only the tracked branches that exist locally.
        for vb in ${verify_branches}; do
          if git -C "${repo_root}" show-ref --verify --quiet "refs/heads/${vb}"; then
            tip="$(git -C "${repo_root}" rev-parse "refs/heads/${vb}" 2>/dev/null || true)"
            [ -n "${tip}" ] || continue
            echo "periodic-push-backup: verify-hook record merge ${vb}@${tip:0:12}"
            bash "${SCRIPT_DIR}/cross-machine-verify.sh" --record-merge "${tip}" --branch "${vb}" --root "${repo_root}" >/dev/null 2>&1 || true
          fi
        done
      else
        pushed_branch="${branch:-$(git -C "${repo_root}" branch --show-current 2>/dev/null || true)}"
        for vb in ${verify_branches}; do
          if [ "${pushed_branch}" = "${vb}" ]; then
            tip="$(git -C "${repo_root}" rev-parse "refs/heads/${vb}" 2>/dev/null || true)"
            [ -n "${tip}" ] || break
            echo "periodic-push-backup: verify-hook record merge ${vb}@${tip:0:12}"
            bash "${SCRIPT_DIR}/cross-machine-verify.sh" --record-merge "${tip}" --branch "${vb}" --root "${repo_root}" >/dev/null 2>&1 || true
            break
          fi
        done
      fi
    fi
  fi
  exit 0
fi

if printf '%s\n' "${out}" | grep -qiE 'non-fast-forward|fetch first|rejected'; then
  echo "backup-rejected: ${push_target} → ${remote} is NOT a fast-forward — the bare repo has commits you lack; NOTHING was overwritten (manual merge = gap-two-machine-collaboration-git-branch-claiming scope)" >&2
  exit 1
fi

echo "backup-error: git push failed (exit ${rc}); NOTHING was overwritten" >&2
printf '%s\n' "${out}" >&2
exit 2
