#!/usr/bin/env bash
# prefriction-count.sh — the nightly falsifiable dimension count
# (tasks/gap-axis-generator-question-what-range-every-standing-criterion, AC2).
#
# The falsifiable criterion replacing the vague AC9 is NOT "can it find defects" (proven: 36
# machine-filed gaps) — it is: "did it open a dimension BEFORE it hurt?" Counted nightly as
# newly-filed tasks with NO triggering failure/alarm/contradiction at filing time.
#   - post-friction (triggered): the task was filed BECAUSE a failure/alarm/contradiction existed
#     (a red suite, a crash/leak/OOM, a degrading metric, a watchdog firing, a contradiction).
#   - pre-friction (untouched): filed from an observation/question with nothing red at filing.
#
# Current count: 0 — every machine-opened dimension so far was post-friction (the 7 axes in
# orchestration/SYNTHESIS-axis-generation-2026-08-05.md all arose from being snagged). The count is
# a TREND criterion: prefriction_dimensions > 0 means the generator has started opening dimensions
# proactively (before they hurt), which is the mechanism's definition of self-evolving.
#
# Detection is CONSERVATIVE about pre-friction: the trigger pattern is deliberately LIBERAL (a task
# with any red-event evidence counts as post-friction), so a false "pre-friction > 0" is avoided —
# the band's meaningful signal is a real proactive open, not a parsing artifact.
#
# Contract measure: `bash plugin/scripts/prefriction-count.sh` -> stdout's prefriction_dimensions
# field (number). `--json` adds the per-task breakdown.
#
# Usage:
#   bash plugin/scripts/prefriction-count.sh [--since <git-since>] [--root <dir>] [--json]
#     --since   git date range for "newly-filed" (default: "24 hours ago" — the nightly window).
#               For a REPRODUCIBLE reading pass a fixed ISO instant (e.g.
#               --since "2026-08-05T00:00:00Z"): a rolling "24 hours ago" window is a trend measure
#               whose boundary moves with the clock, so a task committed right at the boundary can
#               roll in/out of the window between runs.
#     --root    repo root to count over (default: the repo containing this script)
#     --json    emit the per-task breakdown alongside prefriction_dimensions

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

# ── locations ──────────────────────────────────────────────────────────────────────────────────────
_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${1:-}"
if [ -z "${repo_root}" ] || [ "${repo_root}" = "--since" ] || [ "${repo_root}" = "--root" ] || [ "${repo_root}" = "--json" ]; then
  repo_root="$(cd "${_script_dir}/../.." && pwd)"
fi

since="24 hours ago"
json=0

while [ $# -gt 0 ]; do
  case "$1" in
    --since) since="${2:?--since requires a value}"; shift 2 ;;
    --root) repo_root="$2"; shift 2 ;;
    --json) json=1; shift ;;
    --since=*) since="${1#--since=}"; shift ;;
    --root=*) repo_root="${1#--root=}"; shift ;;
    *) shift ;;
  esac
done

# ── post-friction trigger evidence ────────────────────────────────────────────────────────────────
# A task body carrying ANY of these is treated as triggered (post-friction): a red event, an alarm,
# a crash/leak/block, a degradation/regression, or a contradiction — all things that "hurt" at
# filing time. This list is deliberately generous so pre-friction is not over-reported.
POST_FRICTION_RE='失败|崩溃|崩|卡死|死循环|堵死|泄漏|OOM|内存|超时|timeout|broken|断的|断了|断档|损坏|corrupt|\bfail(ed|ure|ing)?\b|\bcrash(ed|es)?\b|\bleak(ed|ing)?\b|state=red|红了|告警|报警|alarm|warning|\berror\b|exception|恶化|退化|degrad|漂移|drift|矛盾|contradict|不一致|撞上|今晚|missing|无法|blocked|卡在|警告'

# ── enumerate newly-filed tasks (git-added in the window) ─────────────────────────────────────────
if ! git -C "${repo_root}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "prefriction-count.sh: ${repo_root} is not a git working tree" >&2
  echo "prefriction_dimensions=0"
  exit 0
fi

mapfile -t new_files < <(git -C "${repo_root}" log --since "${since}" --diff-filter=A --name-only --pretty=format: -- 'tasks/*.md' 2>/dev/null | grep '\.md$' | sort -u)

prefriction=0
declare -a rows=()
for f in "${new_files[@]:-}"; do
  full="${repo_root}/${f}"
  if [ ! -f "${full}" ]; then
    # file was added then removed within the window — count nothing for it
    continue
  fi
  body="$(cat "${full}")"
  if printf '%s' "${body}" | grep -qE "${POST_FRICTION_RE}"; then
    rows+=("$(printf '{"file":"%s","triggered":true}' "${f}")")
  else
    prefriction=$((prefriction + 1))
    rows+=("$(printf '{"file":"%s","triggered":false}' "${f}")")
  fi
done

# Contract measure: the prefriction_dimensions field on stdout (parseable, never JSON-only).
echo "prefriction_dimensions=${prefriction}"
if [ "${json}" = "1" ]; then
  printf '{"window":"%s","newly_filed":%d,"prefriction_dimensions":%d,"tasks":[' "${since}" "${#new_files[@]}" "${prefriction}"
  printf '%s' "$(IFS=,; echo "${rows[*]:-}")"
  printf ']}\n'
fi
