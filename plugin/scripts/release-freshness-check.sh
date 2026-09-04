#!/usr/bin/env bash
# @instrument "Is the latest release FRESH — how far develop has run ahead of the latest release tag (重切触发, release_ahead vs recut threshold) and does the release 产物 tree drift from develop's mechanism set (漂移闸, drift_dirs)?"
# release-freshness-check.sh — release 新鲜度检查：重切触发 + 漂移闸
# (gap-release-freshness-no-recut-mechanism, AC2/AC3).
#
# Answers "is the latest release fresh?" with two mechanical signals:
#
#   1. 重切触发 (recut trigger, AC2): how far develop has run ahead of the latest release tag.
#        release_ahead = `git rev-list --count <tag>..<develop>` (stdout number).
#        When release_ahead > recut threshold (default 500 — measure-first: 08-07=568, 08-11=2252,
#        ≈400-500/day growth), the release is stale ⇒ recut WARN. Threshold overridable via
#        --threshold; a fresh recut (tag moved to develop HEAD) drives release_ahead toward 0.
#   2. 漂移闸 (drift gate, AC3): the release 产物 (delivery-surface tree at the release tag) vs
#        develop's mechanism set (the same dirs at develop). Reuses the delivery-inventory idea
#        (verify-delivery-surface.ts DELIVERY_INVENTORY) against the release surface: per-dir
#        top-level non-hidden entry counts at the tag vs at develop; any difference ⇒
#        drift_dirs > 0, reported mechanically. --list-drift additionally lists the file-level
#        A/D/M per drifted dir.
#
# The delivery dir set is CROSS-REFERENCED (not an independent source): the authoritative list is
# DELIVERY_INVENTORY in plugin/scripts/verify-delivery-surface.ts. release-freshness-check mirrors
# the same dirs (DELIVERY_DIRS below); release-freshness-check.test.mjs selfchecks the mirror
# against the TS single source (a dir added there ⇒ the selfcheck goes red until this list is
# updated).
#
# Exit codes: 0 = FRESH (release_ahead <= threshold AND drift_dirs == 0)
#             1 = STALE (recut WARN and/or drift reported — delivery surface not current)
#             2 = usage/environment error
#
# Run:
#   bash plugin/scripts/release-freshness-check.sh [--root <dir>] [--tag <ref>] [--develop <ref>]
#       [--threshold <N>] [--json] [--list-drift]
#
#   --root       repo root (default: auto-detected from this script's location)
#   --tag        release tag ref (default: newest `v*` semver tag via `git tag --list 'v*' | sort -V`)
#   --develop    develop ref (default: `develop`, falling back to `origin/develop`)
#   --threshold  recut threshold (default: 500)
#   --json       machine-readable output (a single JSON object)
#   --list-drift print file-level A/D/M per drifted delivery dir (in addition to the count report)
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

root=""
tag_arg=""
develop_arg=""
threshold=""
json_mode=0
list_drift=0

usage() { sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --tag) tag_arg="${2:-}"; shift 2 ;;
    --develop) develop_arg="${2:-}"; shift 2 ;;
    --threshold) threshold="${2:-}"; shift 2 ;;
    --json) json_mode=1; shift ;;
    --list-drift) list_drift=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "release-freshness-check: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── root resolution ────────────────────────────────────────────────────────────────────────────────
if [ -z "${root}" ]; then
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
if ! cd "${root}" 2>/dev/null; then
  echo "release-freshness-check: cannot enter root: ${root}" >&2
  exit 2
fi
if [ ! -e .git ]; then
  echo "release-freshness-check: not a git worktree at ${root} — nothing to measure" >&2
  exit 2
fi

# ── threshold validation ──────────────────────────────────────────────────────────────────────────
if [ -z "${threshold}" ]; then
  threshold="500"
fi
case "${threshold}" in
  ''|*[!0-9]*) echo "release-freshness-check: --threshold must be a non-negative integer: ${threshold}" >&2; exit 2 ;;
esac

# ── ref resolution ─────────────────────────────────────────────────────────────────────────────────
# Release tag: the newest `v*` semver tag (default), overridable via --tag.
tag="${tag_arg:-$(git tag --list 'v*' | sort -V | tail -1)}"
if [ -z "${tag}" ]; then
  echo "release-freshness-check: no release tag found (git tag --list 'v*' is empty); pass --tag <ref>" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${tag}" >/dev/null 2>&1; then
  echo "release-freshness-check: release tag ref does not exist: ${tag}" >&2
  exit 2
fi

# Develop ref: default `develop`, falling back to `origin/develop` (a fresh clone may only have origin).
develop_ref="${develop_arg:-develop}"
if ! git rev-parse --verify --quiet "${develop_ref}" >/dev/null 2>&1; then
  if [ -z "${develop_arg}" ] && git rev-parse --verify --quiet "origin/develop" >/dev/null 2>&1; then
    develop_ref="origin/develop"
  else
    echo "release-freshness-check: develop ref does not exist: ${develop_ref}" >&2
    exit 2
  fi
fi

# ── 1. recut trigger (AC2) ─────────────────────────────────────────────────────────────────────────
# release_ahead = number of commits reachable from develop but not from the release tag.
release_ahead="$(git rev-list --count "${tag}".."${develop_ref}" 2>/dev/null || echo "0")"
case "${release_ahead}" in
  ''|*[!0-9]*)
    echo "release-freshness-check: git rev-list --count ${tag}..${develop_ref} failed" >&2
    exit 2
    ;;
esac
recut_warn=0
if [ "${release_ahead}" -gt "${threshold}" ]; then
  recut_warn=1
fi

# ── verdict ────────────────────────────────────────────────────────────────────────────────────────
verdict="FRESH"
if [ "${recut_warn}" -eq 1 ]; then
  verdict="STALE"
fi

# ── 2. drift gate (AC3) — release 产物 vs develop 机制集 ─────────────────────────────────────────
# Reuses the delivery-inventory idea (verify-delivery-surface.ts DELIVERY_INVENTORY — the 8
# delivery-surface dirs) against the release surface: per-dir top-level non-hidden entry count at
# the release tag vs at develop. Any count difference ⇒ drift_dirs>0, reported mechanically.
# --list-drift additionally lists the file-level A/D/M per drifted dir.
DELIVERY_DIRS=(plugin/scripts plugin/gate-scripts plugin/skills plugin/probes plugin/loop plugin/workflows plugin/agents plugin/vendor)

drift_dirs=0
declare -a drift_report=()
for d in "${DELIVERY_DIRS[@]}"; do
  tag_count="$(git ls-tree "${tag}" "${d}/" 2>/dev/null | awk '{print $NF}' | grep -v '^\.' | wc -l)"
  dev_count="$(git ls-tree "${develop_ref}" "${d}/" 2>/dev/null | awk '{print $NF}' | grep -v '^\.' | wc -l)"
  if [ "${tag_count}" != "${dev_count}" ]; then
    drift_dirs=$((drift_dirs + 1))
    drift_report+=("${d}:${tag_count}->${dev_count}")
  fi
done

# surface_delta = total file-level A/D/M across the delivery surface between tag and develop
# (counts every changed path — added, deleted, modified).
surface_delta="$(git diff --name-only "${tag}" "${develop_ref}" -- "${DELIVERY_DIRS[@]}" 2>/dev/null | wc -l)"

if [ "${drift_dirs}" -gt 0 ]; then
  verdict="STALE"
fi

# ── output ─────────────────────────────────────────────────────────────────────────────────────────
if [ "${json_mode}" -eq 1 ]; then
  # drift entries quoted as JSON strings: plugin/scripts:126->205
  _drift_json="$(IFS=,; printf '"%s"' "${drift_report[*]}" | sed 's/,/","/g')"
  printf '{"release_tag":"%s","develop":"%s","release_ahead":%s,"recut_threshold":%s,"recut_warn":%s,"drift_dirs":%s,"surface_delta":%s,"drift":[%s],"verdict":"%s"}\n' \
    "${tag}" "${develop_ref}" "${release_ahead}" "${threshold}" "${recut_warn}" \
    "${drift_dirs}" "${surface_delta}" \
    "${_drift_json}" "${verdict}"
else
  echo "release-freshness-check (root=${root})"
  echo "  release_tag=${tag} develop=${develop_ref}"
  echo "  release_ahead=${release_ahead} recut_threshold=${threshold} recut_warn=${recut_warn}"
  echo "  drift_dirs=${drift_dirs} surface_delta=${surface_delta}"
  for entry in "${drift_report[@]:-}"; do
    [ -n "${entry}" ] && echo "  drift: ${entry}"
  done
  if [ "${recut_warn}" -eq 1 ]; then
    echo "  WARN: release is stale — develop is ${release_ahead} commits ahead of ${tag} (threshold ${threshold}); trigger a recut (DIR-123 / delivery)" >&2
  fi
  if [ "${drift_dirs}" -gt 0 ]; then
    echo "  WARN: release ${tag} 产物与 develop 机制集漂移 — ${drift_dirs} dir(s) count differ; run --list-drift for file-level A/D/M" >&2
  fi
  if [ "${list_drift}" -eq 1 ] && [ "${drift_dirs}" -gt 0 ]; then
    echo "  file-level A/D/M between ${tag} and ${develop_ref} (delivery surface):"
    git diff --name-status "${tag}" "${develop_ref}" -- "${DELIVERY_DIRS[@]}" | sed 's/^/    /'
  fi
  echo "  verdict=${verdict}"
fi

if [ "${verdict}" = "STALE" ]; then
  exit 1
fi
exit 0
