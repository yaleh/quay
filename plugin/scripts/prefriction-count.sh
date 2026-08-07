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
# Detection is CONSERVATIVE about pre-friction: the trigger pattern is LIBERAL about *event evidence*
# (a task with any concrete red-event reference — a red suite, a crash/leak/OOM/hang, a watchdog or
# alarm firing, a countable failure figure — counts as post-friction), so a false "pre-friction > 0"
# is avoided. The event markers must be CONCRETE (see POST_FRICTION_RE below), not generic
# defect-description adjectives: bare 今晚 / missing / broken / 无法 / 不一致 matched 90.6% of
# newly-filed tasks by construction and deadened the signal (2026-08-06,
# gap-prefriction-trigger-regex-too-broad-signal-is-dead).
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
# A task body carrying ANY of these is treated as triggered (post-friction): a concrete EVENT MARKER
# — a red-suite state (state=red / SUITE-RED / full-suite red / red window), a crash/leak/OOM/hang,
# a watchdog/alarm firing, or a COUNTABLE failure figure (a non-zero test-failure count).
# Words are EVENT REFERENCES ONLY, per the invariant (each must correspond to a concrete event that
# existed at discovery time). Generic defect-description vocabulary — missing / broken / 无法 / 不一致 /
# fail / failure / error / 今晚 (tonight) — is deliberately EXCLUDED: those appear in any well-written
# gap-task body BY CONSTRUCTION (describing a defect requires saying what's missing/wrong) and cannot
# distinguish "filed because a red light existed" from "filed in ordinary defect prose".
# (2026-08-06, gap-prefriction-trigger-regex-too-broad-signal-is-dead: the previous list matched 90.6%
# of newly-filed tasks, deadening the signal. Bare '今晚' is a pure temporal reference. 'warning' was
# dropped too — '--no-warnings' is a pervasive Node flag. Countable failures require a NON-ZERO count
# ([1-9]...) so green "pass N / 0 failed" output and "AC6 fail-safe"-style hyphenated terms don't
# trigger (the `([^-]|$)` guard rejects fail followed by a hyphen, while still catching "3 failing
# tests" / "8 failed" — a real countable failure event.)
POST_FRICTION_RE='state=red|红了|SUITE-RED|full-suite red|red window|watchdog|OOM|out of memory|内存泄漏|memory leak|泄漏|卡死|死循环|死锁|崩溃|\bcrash(ed|es)?\b|\bhang(s|ing|ed)?\b|告警|报警|\balarm(s)?\b|[1-9][0-9]* ?fail(ed|ure|ing)?s?([^-]|$)|\bfailure(s)?[: =][ ]?[1-9][0-9]*'

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
