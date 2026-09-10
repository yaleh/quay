#!/usr/bin/env bash
# @instrument "Is the latest release FRESH — how far develop has run ahead of the latest release tag (重切触发, release_ahead vs recut threshold) and does the release 产物 tree drift from develop's mechanism set (漂移闸, drift_dirs)?"
# release-freshness-check.sh — release 新鲜度检查：重切触发 + 漂移闸 + 交付失联检测
# (gap-release-freshness-no-recut-mechanism, AC2/AC3;
#  gap-deliver-verification-trigger-orphaned-after-land-path-migration, AC4 — the --deliver signal).
#
# Answers "is the latest release fresh?" with three mechanical signals:
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
#   3. 交付失联检测 (deliver orphan detector, --deliver): how far develop has run ahead of the last
#        cross-host deliver (.quay/develop-deliver-state.json.lastDelivered, written by
#        develop-deliver-tgz.sh). deliver_ahead = `git rev-list --count lastDelivered..develop`;
#        when > --deliver-ahead (default 500) ⇒ deliver_state=stale ⇒ RED. When the state file is
#        MISSING / unreadable ⇒ deliver_state=not-evaluated ⇒ RED too, but DISTINGUISHABLY (硬规则 3b:
#        "file absent" must not be read as 合格 — that silence is how the trigger went 18 days
#        orphaned with nothing turning red).
#
# The delivery dir set is CROSS-REFERENCED (not an independent source): the authoritative list is
# DELIVERY_INVENTORY in plugin/scripts/verify-delivery-surface.ts. release-freshness-check mirrors
# the same dirs (DELIVERY_DIRS below); release-freshness-check.test.mjs selfchecks the mirror
# against the TS single source (a dir added there ⇒ the selfcheck goes red until this list is
# updated).
#
# Exit codes: 0 = FRESH (release_ahead <= threshold AND drift_dirs == 0 AND deliver not stale)
#             1 = STALE (recut WARN and/or drift reported — delivery surface not current — and/or
#                 deliver_state ∈ {stale, not-evaluated})
#             2 = usage/environment error
#
# Run:
#   bash plugin/scripts/release-freshness-check.sh [--root <dir>] [--tag <ref>] [--develop <ref>]
#       [--threshold <N>] [--json] [--list-drift] [--deliver] [--deliver-ahead <N>]
#
#   --root           repo root (default: auto-detected from this script's location)
#   --tag            release tag ref (default: newest `v*` semver tag via `git tag --list 'v*' | sort -V`)
#   --develop        develop ref (default: `develop`, falling back to `origin/develop`)
#   --threshold      recut threshold (default: 500)
#   --json           machine-readable output (a single JSON object)
#   --list-drift     print file-level A/D/M per drifted delivery dir (in addition to the count report)
#   --deliver        enable the deliver-freshness orphan-detector signal (reads .quay/develop-deliver-state.json)
#   --deliver-ahead  deliver stale threshold in commits (default: 500)
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
deliver=0
deliver_ahead_arg=""

usage() { sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --tag) tag_arg="${2:-}"; shift 2 ;;
    --develop) develop_arg="${2:-}"; shift 2 ;;
    --threshold) threshold="${2:-}"; shift 2 ;;
    --json) json_mode=1; shift ;;
    --list-drift) list_drift=1; shift ;;
    --deliver) deliver=1; shift ;;
    --deliver-ahead) deliver_ahead_arg="${2:-}"; shift 2 ;;
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

# deliver-ahead threshold (the "相差超阈值" signal, default mirrors the recut threshold; overridable).
deliver_ahead_threshold="${deliver_ahead_arg:-500}"
case "${deliver_ahead_threshold}" in
  ''|*[!0-9]*) echo "release-freshness-check: --deliver-ahead must be a non-negative integer: ${deliver_ahead_threshold}" >&2; exit 2 ;;
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

# ── 3. deliver freshness (orphan detector, gap-deliver-verification-trigger-orphaned-after-land-path-migration) ──
# Answers "has the low-frequency deliver trigger gone STALE — develop run ahead of the last delivered
# commit by more than --deliver-ahead commits, or was the state file never written at all?"
# .quay/develop-deliver-state.json (written by develop-deliver-tgz.sh) is the ONE record of the last
# successful cross-host deliver. A MISSING / unreadable state file is NOT 合格 — it is a distinguishable
# NOT-EVALUATED state that still REDs (硬规则 3b: today the "file absent" state was read as silence).
deliver_state=""
deliver_ahead=""
deliver_last_delivered=""
if [ "${deliver}" -eq 1 ]; then
  deliver_state_file="${root}/.quay/develop-deliver-state.json"
  if [ ! -f "${deliver_state_file}" ]; then
    deliver_state="not-evaluated"
  else
    deliver_last_delivered="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('lastDelivered',''))" "${deliver_state_file}" 2>/dev/null || echo "")"
    if [ "${deliver_last_delivered}" = "$(git rev-parse "${develop_ref}" 2>/dev/null || echo "")" ]; then
      deliver_state="fresh"
      deliver_ahead="0"
    elif [ -z "${deliver_last_delivered}" ]; then
      deliver_state="not-evaluated"
    elif ! git rev-parse --verify --quiet "${deliver_last_delivered}" >/dev/null 2>&1; then
      deliver_state="not-evaluated"     # lastDelivered present but unresolvable ⇒ cannot evaluate the gap
    else
      deliver_ahead="$(git rev-list --count "${deliver_last_delivered}".."${develop_ref}" 2>/dev/null || echo "")"
      case "${deliver_ahead}" in
        ''|*[!0-9]*) deliver_state="not-evaluated" ;;
        *) if [ "${deliver_ahead}" -gt "${deliver_ahead_threshold}" ]; then deliver_state="stale"; else deliver_state="fresh"; fi ;;
      esac
    fi
  fi
  if [ "${deliver_state}" != "fresh" ]; then
    verdict="STALE"     # stale OR not-evaluated both RED (not-evaluated stays distinguishable via deliver_state)
  fi
fi

# ── output ─────────────────────────────────────────────────────────────────────────────────────────
if [ "${json_mode}" -eq 1 ]; then
  # drift entries quoted as JSON strings: plugin/scripts:126->205
  _drift_json="$(IFS=,; printf '"%s"' "${drift_report[*]}" | sed 's/,/","/g')"
  _deliver_ahead_json="${deliver_ahead:-null}"
  printf '{"release_tag":"%s","develop":"%s","release_ahead":%s,"recut_threshold":%s,"recut_warn":%s,"drift_dirs":%s,"surface_delta":%s,"drift":[%s],"deliver_state":"%s","deliver_ahead":%s,"deliver_last_delivered":"%s","deliver_threshold":%s,"verdict":"%s"}\n' \
    "${tag}" "${develop_ref}" "${release_ahead}" "${threshold}" "${recut_warn}" \
    "${drift_dirs}" "${surface_delta}" \
    "${_drift_json}" "${deliver_state}" "${_deliver_ahead_json}" "${deliver_last_delivered}" "${deliver_ahead_threshold}" \
    "${verdict}"
else
  echo "release-freshness-check (root=${root})"
  echo "  release_tag=${tag} develop=${develop_ref}"
  echo "  release_ahead=${release_ahead} recut_threshold=${threshold} recut_warn=${recut_warn}"
  echo "  drift_dirs=${drift_dirs} surface_delta=${surface_delta}"
  for entry in "${drift_report[@]:-}"; do
    [ -n "${entry}" ] && echo "  drift: ${entry}"
  done
  if [ "${deliver}" -eq 1 ]; then
    echo "  deliver_state=${deliver_state} deliver_ahead=${deliver_ahead:-?} deliver_threshold=${deliver_ahead_threshold}"
    [ -n "${deliver_last_delivered}" ] && echo "  deliver_last_delivered=${deliver_last_delivered}"
  fi
  if [ "${recut_warn}" -eq 1 ]; then
    echo "  WARN: release is stale — develop is ${release_ahead} commits ahead of ${tag} (threshold ${threshold}); trigger a recut (DIR-123 / delivery)" >&2
  fi
  if [ "${drift_dirs}" -gt 0 ]; then
    echo "  WARN: release ${tag} 产物与 develop 机制集漂移 — ${drift_dirs} dir(s) count differ; run --list-drift for file-level A/D/M" >&2
  fi
  if [ "${deliver_state}" = "not-evaluated" ]; then
    echo "  WARN: deliver state is NOT-EVALUATED — .quay/develop-deliver-state.json missing or malformed; the low-frequency deliver trigger has never recorded a successful deliver (this is RED, not 合格)" >&2
  elif [ "${deliver_state}" = "stale" ]; then
    echo "  WARN: deliver is stale — develop is ${deliver_ahead} commits ahead of lastDelivered ${deliver_last_delivered} (threshold ${deliver_ahead_threshold}); the deliver trigger has stopped" >&2
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
