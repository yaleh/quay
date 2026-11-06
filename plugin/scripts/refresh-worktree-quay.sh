#!/usr/bin/env bash
# refresh-worktree-quay.sh — copy the MAIN checkout's current `.quay/` (config/gates/runtime
# carriers) into a linked WORKTREE's `.quay/` as a snapshot, so a full suite running IN the
# worktree (`cd ${worktree} && bash scripts/test.sh`) reads the SAME gitignored .quay/ data as a
# main-checkout run.
#
# WHY THIS EXISTS (gap-fan-in-worktree-quay-provisioning):
#   `.quay/` is gitignored ⇒ `git worktree add` copies NONE of it. The fan-in full suite runs
#   DIRECTLY in the task worktree (`cd ${worktree} && bash scripts/test.sh` — no
#   full-suite-runner provisioning step), so `<worktree>/.quay/config.yml` was absent or stale ⇒
#   the suite's repo-root resolution (`_findRepoRoot` walks up to `<worktree>/.quay/config.yml`)
#   plus the config/gates tests (M63 ts-typecheck, blocked-signal, cap-from-gate, monitor-mount,
#   run-identity — ruled-gap fan-in: 72 environmental REDs across 22 gate/telemetry/resource test
#   files, ALL green on the main checkout) failed environmentally. This is the OTHER half of
#   gap-gitignored-carriers: the carriers fix (QUAY_MAIN_CHECKOUT, full-suite-runner.ts) pointed
#   CHECKERS at the main checkout; this fixes the SUITE reading the worktree's OWN stale/absent
#   .quay/.
#
# WHAT A SNAPSHOT NEEDS (gap-worktree-quay-snapshot-copies-multi-gb-ledgers, 2026-11-06):
#   The suite needs the worktree `.quay/` to carry CURRENT state — `config.yml` (repo-root
#   resolution + provider map), gate definitions, control state (`worker-control.json`,
#   `promotion-control.json`), driver pid/anchor files, and the small current-state `.json`
#   carriers. It does NOT need the main checkout's append-only WRITE HISTORY.
#   Measured before this policy (this host, 2026-11-06): the main `.quay/` is 8.1 GB / 8,476 files;
#   the copy set alone was 4.02 GB across 8,385 files, of which the round ledgers were 3.4 GB
#   (`meta-driver-round.jsonl` 1.99 GB, `goal-round.jsonl` 349 MB, `measure-history.jsonl` 296 MB,
#   `verification-round.jsonl` 274 MB, `gate-events.jsonl` 206 MB …) and per-run debris
#   (`suite-load-*`, `*.log`) most of the FILE COUNT. One refresh cost 56.0 s and 8,129 `cp` +
#   8,130 `mkdir` + 8,129 `dirname` execs (24,390 execve total) — the dominant residual process
#   churn on this host once every suite had stopped.
#
# SEMANTICS (each mechanically enforced):
#   - Snapshot, NOT symlink: the worktree suite may WRITE its own .quay/ (checker-cost.jsonl,
#     gate-events via tmp, state files) — writes land in the worktree's copy, never the main.
#   - The exclusion set lives in ONE data declaration (`REFRESH_SNAPSHOT_EXCLUDE`, below) and does
#     two jobs: (a) it is turned into git pathspec excludes, so excluded paths are not even
#     ENUMERATED (the old hand-written `:(exclude).quay/node-compile-cache/**` was the only one, and
#     dropping it re-costs ~23 s per invocation on 346K+ ignored cache files); (b) it is the
#     per-path decision in the copy loop; (c) it prunes stale copies from a worktree snapshot made
#     before the policy existed. A new carrier is copied automatically — the declaration only names
#     what a snapshot must NOT carry.
#   - `&& self-check`: `REFRESH_SNAPSHOT_MAX_BYTES` bounds the snapshot; over ⇒ exit 3 (loud), and a
#     carrier that is not declared above cannot silently re-inflate every worktree. Unmeasurable ⇒
#     `NOT-EVALUATED` — a DISTINCT value, never reported as "within bound" ( epistemology hard rule
#     3b: a judge that cannot read its input must not return the same shape as "pass").
#   - Idempotent (cp -p overwrites stale copies). No-op on a main-checkout run (the guard below
#     detects the worktree IS the main).
#   - Config source = --root, else QUAY_MAIN_CHECKOUT (full-suite-runner's one-shot sets it), else
#     the git-derived main worktree (fan-in direct path — git rev-parse --git-common-dir: the parent
#     of the shared .git dir; ORDER-INDEPENDENT, not the first `git worktree list` entry).
#
# Usage:
#   bash plugin/scripts/refresh-worktree-quay.sh <worktree> [--root <main-repo>] [--dry-run]
#
# Exit codes: 0 = refreshed (or no-op); 2 = usage/env error; 3 = snapshot exceeds
# REFRESH_SNAPSHOT_MAX_BYTES (the copy already happened; the caller should surface it, not ignore it).

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "refresh-worktree-quay.sh — snapshot the main checkout's .quay/ (config/gates/runtime carriers) into a linked worktree so the full suite running there reads the same data as a main run"
  echo "usage: bash plugin/scripts/refresh-worktree-quay.sh <worktree> [--root <main-repo>] [--dry-run]"
  echo "exit: 0 refreshed/no-op; 2 usage/env error; 3 snapshot over REFRESH_SNAPSHOT_MAX_BYTES (base: NOT-EVALUATED)"
  exit 0
fi

set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────────────────────
# SNAPSHOT POLICY — the ONLY place the exclusion set lives. Data, not literals scattered through
# the copy loop. `plugin/test/refresh-worktree-quay.test.mjs` parses this block (markers included)
# and cross-checks it against the script's real behaviour: add a name here ⇒ it must stop being
# copied; remove it ⇒ it must be copied again.
# >>> REFRESH_SNAPSHOT_POLICY
# Globs are relative to `.quay/`. An entry means BOTH:
#   (a) never copy it from the main checkout into a worktree snapshot, and
#   (b) prune it from a worktree snapshot that still holds a stale copy (a worktree created before
#       this policy existed) — so an existing 4 GB snapshot shrinks on the next refresh.
# A leading `!` marks the CACHE CLASS: never copied, but the worktree's OWN copy is preserved —
# `scripts/test.sh:339` points NODE_COMPILE_CACHE at `<repo_root>/.quay/node-compile-cache`, and
# deleting the worktree's own warm cache on every refresh would re-pay compilation every run.
REFRESH_SNAPSHOT_EXCLUDE=(
  "!node-compile-cache/**"
  # Nested deliver-pipeline worktrees (~190 MB each): git lists them as a single directory entry, so
  # the copy loop can only ever fail on them (`cp: -r not specified`). Cache class, not prune class —
  # a real build worktree must never be deleted by a refresh.
  "!deliver-worktree-*"
  "manager-inbox/**"
  "outer-inbox/**"
  "*-round.jsonl"
  "*-outcome.jsonl"
  "gate-events.jsonl"
  "measure-history.jsonl"
  "checker-cost.jsonl"
  "ci-runs.jsonl"
  "doc-develop-sync.jsonl"
  "*.log"
  "suite-load-*"
  "suite-memory-evidence-*"
)

# Upper bound on the snapshot size (bytes). Measured with `du -sb` over `<worktree>/.quay` (the
# cache class excluded — it is the worktree's own). Over ⇒ exit 3. Unmeasurable ⇒ NOT-EVALUATED.
REFRESH_SNAPSHOT_MAX_BYTES=$((512 * 1024 * 1024))
# <<< REFRESH_SNAPSHOT_POLICY

worktree=""
root="${QUAY_MAIN_CHECKOUT:-}"
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) [ -n "${worktree}" ] && { echo "refresh-worktree-quay: unexpected arg: $1" >&2; exit 2; }
       worktree="${1}"; shift ;;
  esac
done

[ -n "${worktree}" ] || { echo "refresh-worktree-quay: <worktree> is required" >&2; exit 2; }
[ -d "${worktree}" ] || { echo "refresh-worktree-quay: worktree dir not found: ${worktree}" >&2; exit 2; }

# ── Policy helpers ────────────────────────────────────────────────────────────────────────────

# $1 = repo-relative path (`.quay/...`); $2 = mode: `copy` (may this be copied into a snapshot?)
# or `prune` (may a stale worktree copy be deleted?). The `!` cache class answers "no" to both —
# that IS its meaning (never copied, never pruned).
_snapshot_policy_matches() {
  local rel="${1#.quay/}" mode="$2" raw glob
  for raw in "${REFRESH_SNAPSHOT_EXCLUDE[@]}"; do
    if [ "${mode}" = "prune" ] && [ "${raw:0:1}" = "!" ]; then continue; fi
    glob="${raw#!}"
    # Unquoted ${glob} in a case pattern = shell glob match (`*` also crosses `/`). Deliberately the
    # same shape as a git pathspec without `:(glob)`, so the enumeration-side and the per-path-side
    # of this policy cannot disagree.
    case "${rel}" in ${glob}) return 0 ;; esac
    # A `dir/**` glob means the whole tree, DIRECTORY INCLUDED: git only ever enumerates FILES, so
    # the trailing-slash form only matters where a directory itself is tested (the size measure's
    # top-level walk) — without it `node-compile-cache/**` failed to match `node-compile-cache` and
    # the worktree's own 700M cache was counted as snapshot bytes (caught by AC1b).
    case "${rel}/" in ${glob}) return 0 ;; esac
  done
  return 1
}

# The pathspec excludes are DERIVED from the declaration: excluded paths are never enumerated.
# That is what keeps the enumeration cheap (the pre-policy script hard-coded exactly one such
# exclude for node-compile-cache, because enumerating 346K+ cache files cost ~23 s per invocation).
_snapshot_pathspec_excludes=()
for _raw in "${REFRESH_SNAPSHOT_EXCLUDE[@]}"; do
  _snapshot_pathspec_excludes+=(":(exclude).quay/${_raw#!}")
done
# The PRUNE pass enumerates the worktree's ignored paths and needs to SEE the excluded ones (they are
# exactly what it deletes) — except the cache class, which it never touches and which is expensive to
# walk. So it gets only the `!`-class excludes, not the whole declaration.
_snapshot_prune_pathspec_excludes=()
for _raw in "${REFRESH_SNAPSHOT_EXCLUDE[@]}"; do
  [ "${_raw:0:1}" = "!" ] || continue
  _snapshot_prune_pathspec_excludes+=(":(exclude).quay/${_raw#!}")
done

# Resolve the main checkout: --root / QUAY_MAIN_CHECKOUT / git-derived.
# The git-derived form is ORDER-INDEPENDENT: the main checkout is the parent of the repo's shared
# `.git` dir (`git rev-parse --git-common-dir`), NOT the first `git worktree list` entry — the list
# order is not guaranteed to place the main working tree first (a linked/detached worktree can be
# listed before it). gap-refresh-worktree-quay-main-derive.
if [ -z "${root}" ]; then
  # git >= 2.31: --path-format=absolute gives an absolute common-dir; older git returns a path
  # relative to ${worktree}, which we resolve against it.
  _common_dir="$(git -C "${worktree}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  if [ -z "${_common_dir}" ]; then
    _common_dir="$(git -C "${worktree}" rev-parse --git-common-dir 2>/dev/null)"
    case "${_common_dir}" in
      /*) ;;
      *) [ -n "${_common_dir}" ] && _common_dir="${worktree}/${_common_dir}" ;;
    esac
  fi
  if [ -n "${_common_dir}" ]; then
    root="$(cd "$(dirname "${_common_dir}")" 2>/dev/null && pwd -P)"
  fi
fi
[ -n "${root}" ] || { echo "refresh-worktree-quay: cannot resolve main checkout for ${worktree}" >&2; exit 2; }

# Linked-worktree guard: when the worktree IS the main checkout, there is nothing to refresh
# (a main-checkout run already reads its own live .quay/).
if [ "$(cd "${worktree}" && pwd -P)" = "$(cd "${root}" && pwd -P)" ]; then
  echo "refresh-worktree-quay: ${worktree} is the main checkout — no-op" >&2
  exit 0
fi
[ -d "${root}/.quay" ] || { echo "refresh-worktree-quay: main checkout has no .quay/ (${root}) — nothing to refresh" >&2; exit 0; }

if [ "${dry_run}" -eq 1 ]; then
  echo "refresh-worktree-quay: [dry-run] would copy ${root}/.quay -> ${worktree}/.quay (current state only; ${#REFRESH_SNAPSHOT_EXCLUDE[@]} policy exclude(s) declared; bound ${REFRESH_SNAPSHOT_MAX_BYTES} bytes)" >&2
  exit 0
fi

# ── Prune stale copies the policy no longer allows (migration for pre-policy worktrees) ───────
mkdir -p "${worktree}/.quay"
pruned=0
if [ -d "${worktree}/.quay" ]; then
  # ONLY gitignored/untracked paths are candidates. The snapshot's INPUT class is exactly
  # `git ls-files --others --ignored` (see the copy loop) — a TRACKED `.quay` carrier belongs to the
  # checkout, not to the snapshot, and deleting it would dirty the worktree and change what the
  # suite reads (caught for real: `.quay/ac-devci-ac4-carrier-written-by-round.jsonl` is tracked and
  # matches `*-round.jsonl`). Enumerating through git also skips the cache class for free (the
  # pathspec excludes are the same ones the copy loop derives).
  _stale=()
  while IFS= read -r _rel; do
    [ -n "${_rel}" ] || continue
    _snapshot_policy_matches "${_rel}" prune && _stale+=("${worktree}/${_rel}")
  done < <(git -C "${worktree}" ls-files --others --ignored --exclude-standard -- .quay/ "${_snapshot_prune_pathspec_excludes[@]}" 2>/dev/null)
  if [ "${#_stale[@]}" -gt 0 ]; then
    pruned="${#_stale[@]}"
    printf '%s\0' "${_stale[@]}" | xargs -0 -r rm -rf --
    # Directories that existed only to hold an excluded carrier (manager-inbox/, …) — drop the ones
    # the deletion emptied. Driven off the deleted paths, not a second full-tree walk.
    _stale_dirs=()
    for _p in "${_stale[@]}"; do _stale_dirs+=("${_p%/*}"); done
    printf '%s\0' "${_stale_dirs[@]}" | xargs -0 -r rmdir 2>/dev/null || true
  fi
fi

# ── Copy current state ────────────────────────────────────────────────────────────────────────
# `--reflink=auto` where the local cp supports it: on a reflink-capable FS (XFS with reflink=1 —
# verified on this host 2026-11-06) copies share extents, so bytes stay on the main side; elsewhere
# cp silently falls back to a real copy. Probed once so a non-GNU cp cannot turn every file into an
# error.
_cp_args=(-p)
if cp --reflink=auto --help >/dev/null 2>&1; then
  _cp_args=(-p --reflink=auto)
fi

copied=0
skipped=0
while IFS= read -r rel; do
  # The decision is the DECLARATION, not a case list: a new carrier is copied automatically and
  # only the declared exclusions are skipped. (Supersedes the interim hotfix bb23e77a1, which
  # hard-coded two driver ledgers in this loop and left gate-events / verification-round /
  # measure-history copied for want of the coverage this task adds — AC1-AC4 in
  # plugin/test/refresh-worktree-quay.test.mjs now pin the whole class.)
  if _snapshot_policy_matches "${rel}" copy; then
    skipped=$((skipped + 1)); continue
  fi
  mkdir -p "${worktree}/$(dirname "${rel}")"
  cp "${_cp_args[@]}" "${root}/${rel}" "${worktree}/${rel}" && copied=$((copied + 1)) || true
done < <(git -C "${root}" ls-files --others --ignored --exclude-standard -- .quay/ "${_snapshot_pathspec_excludes[@]}" 2>/dev/null)

echo "refresh-worktree-quay: copied ${copied} file(s) (${skipped} excluded by snapshot policy, ${pruned} stale pruned) from ${root}/.quay into ${worktree}/.quay" >&2

# ── Snapshot size bound (three-state: within / over / NOT-EVALUATED) ─────────────────────────
# Sums the top-level entries of the worktree `.quay/`, skipping the cache class — the worktree's own
# NODE_COMPILE_CACHE is legitimately multi-GB after a suite run and is not part of "the snapshot".
_snapshot_bytes=""
_snapshot_measurable=1
if command -v du >/dev/null 2>&1; then
  _du_out="$(du -sb -- "${worktree}/.quay"/* "${worktree}/.quay"/.[!.]* 2>/dev/null)"
  if [ -n "${_du_out}" ]; then
    while IFS=$'\t' read -r _bytes _path; do
      case "${_bytes}" in ''|*[!0-9]*) _snapshot_measurable=0; continue ;; esac
      [ -n "${_path}" ] || continue
      # Anything the policy excludes and that is STILL in the worktree is the cache class (the copy
      # loop wrote none of the others and the prune pass deleted the stale ones) — it belongs to the
      # worktree, not to the snapshot, so it is not counted.
      if _snapshot_policy_matches "${_path#"${worktree}/"}" copy; then continue; fi
      _snapshot_bytes=$(( ${_snapshot_bytes:-0} + _bytes ))
    done <<< "${_du_out}"
  else
    _snapshot_measurable=0
  fi
else
  _snapshot_measurable=0
fi

if [ "${_snapshot_measurable}" -eq 1 ] && [ -n "${_snapshot_bytes}" ]; then
  if [ "${_snapshot_bytes}" -gt "${REFRESH_SNAPSHOT_MAX_BYTES}" ]; then
    echo "refresh-worktree-quay: SNAPSHOT OVER BOUND — ${_snapshot_bytes} bytes > REFRESH_SNAPSHOT_MAX_BYTES=${REFRESH_SNAPSHOT_MAX_BYTES}" >&2
    echo "refresh-worktree-quay: a carrier that is NOT in REFRESH_SNAPSHOT_EXCLUDE is inflating this snapshot — declare it (or shrink it) in the policy block at the top of this script" >&2
    exit 3
  fi
  echo "refresh-worktree-quay: snapshot-size ${_snapshot_bytes} bytes (bound ${REFRESH_SNAPSHOT_MAX_BYTES}) — within bound" >&2
else
  echo "refresh-worktree-quay: snapshot-size NOT-EVALUATED — could not measure ${worktree}/.quay (du missing or unreadable); the size bound was NOT enforced this run" >&2
fi
exit 0
