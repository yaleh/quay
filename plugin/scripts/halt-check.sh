#!/usr/bin/env bash
# halt-check.sh — the THREE-LAYER UNIFIED `.halt` check point
# (orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md §2.8,
#  task gap-spec-p2-halt-three-layer-mechanical-enforcement).
#
# THE PROBLEM IT SOLVES (SPEC 2.8): 停机对三层同时机械生效,不靠自觉.
# Before this script, each layer read `.halt` with its OWN shape at its OWN tick boundary:
#   * outer  — tick-prose `[ -f .halt ]` in orchestrator-loop-tick.md step 0d
#   * inner  — `supervisor-preempt.sh halt-check` + `slot-refill.ts` (the dispatch code mount)
#   * manager— `[ -f .halt ]` per-project in manager-loop-tick.md step 1a
# SPEC 2.8 unifies: ONE check point, ONE fail-closed shape, and the COMBINATION CRITERION
# (`无 .halt` **且** 长期无产出(>24h) ⇒ **未标记的停摆**,必须升级) made mechanical — the
# "只读不判会稳定产生「看见但没发现」" hole.
#
# THIS SCRIPT IS THAT UNIFIED CHECK POINT. Every layer's tick entry + key loop point calls
# `halt-check.sh --for <layer>`, and `.halt` placed ⇒ the NEXT execution point stops.
#
# Fail-closed semantics (the exact shape from gap-halt-sentinel-path-mismatch — never fail open):
#   * ENOENT (no file)      → halted=false — the common, expected non-halted state.
#   * file exists           → halted=true  (empty file still halts — the sentinel is the pause).
#   * any OTHER read error  → halted=true, reason names the failure (a fail-open shape on an
#     unreadable sentinel already caused a real safety miss — never silently fall through).
#
# The combination criterion (SPEC 2.8, invariant halt_combination_mechanical): when NOT halted
# AND the workspace's last commit is older than --stall-threshold (default 24h), the layer is in
# an UNMARKED STALL — mechanically reported (stall=true), never a silent "看见但没发现".
#
# Usage:
#   halt-check.sh [--for <outer|inner|manager>] [--root <dir>] [--json]
#                 [--stall-threshold <hours>] [--projects <dir1,dir2,...>] [--help]
#
#   --for <layer>    which layer is checking (outer|inner|manager). Validated. Carried into the
#                    output so a three-layer run yields three `halted` fields (the Contract measure
#                    `three_layer_halt_effective`, band 3).
#   --root <dir>     workspace root whose `.halt` is read (default: auto-derived from this script's
#                    location — the repo root in-tree, or the installed target project).
#   --json           machine-readable JSON object (PURE READ — never mutates). Fields:
#                    layer, root, halted, halted_reason, stall, stall_reason,
#                    last_commit_age_hours, stall_threshold_hours, and (with --projects) a
#                    `projects` array (name, root, halted, halted_reason, last_commit_age_hours,
#                    stall, stall_reason per project).
#   --stall-threshold <hours>   the "long no-output" cutoff for the combination criterion
#                               (default 24; 0 = any commit age > 0 fires, for tests / strict tiers).
#   --projects <dir1,dir2,...>  ALSO report per-project .halt + last-commit age + stall for each
#                               listed project dir (the outer/manager A3/A5 three-project reading).
#                               Each project's `.halt` is read with the same fail-closed shape. A
#                               relative entry is resolved under --root; an absolute entry is used
#                               as-is (label = the directory basename).
#
# Output shape (default, non-JSON — a SUPERSET of supervisor-preempt.sh halt-check's lines, so it
# is a drop-in read for anything that greps `halted=`):
#   halted=true|false
#   reason=<reason-or-empty>
#   layer=<outer|inner|manager>
#   stall=true|false
#   stall_reason=<...>
#   last_commit_age_hours=<float|null>
# With --projects, one `project_<label>.halted=...` line per project (and `.reason`, `.stall`,
# `.stall_reason`, `.last_commit_age_hours`), after the layer-scope fields.
#
# Exit status: 0 always for the check itself (a check, not a gate — same contract as
# supervisor-preempt.sh halt-check). Usage errors exit 2.
#
# Env seams (hermetic tests):
#   HALT_CHECK_ROOT        override workspace root (default: auto-derived).
#
# Test: plugin/test/halt-check.test.mjs

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"
ROOT="${HALT_CHECK_ROOT:-$(cd "$SELF_DIR/../.." 2>/dev/null && pwd || echo "$SELF_DIR/../..")}"
LAYER=""
JSON=0
STALL_THRESHOLD=24
PROJECTS=""
# Unit separator (0x1f) — NON-whitespace IFS, so bash `read` preserves empty fields. No text
# content (halt reasons, stall reasons, paths) contains 0x1f.
USEP=$'\x1f'

usage() {
  sed -n '2,56p' "$0" | sed 's/^# \{0,1\}//'
}

# ── fail-closed .halt read (mirrors supervisor-preempt.sh halt-check EXACTLY) ─────────────────────────
# Emits `halted=<bool>` + `reason=<...>` to stdout. 0 always.
halt_for_root() {
  local root="$1" halt_path="$root/.halt" content
  if [ -f "$halt_path" ]; then
    content="$(cat "$halt_path" 2>/dev/null && printf '\n')" || {
      echo "halted=true"
      echo "reason=FAIL-CLOSED: could not read .halt sentinel at $halt_path"
      return 0
    }
    content="$(printf '%s' "$content" | sed -n '1p' | cut -c1-200)"
    [ -n "$content" ] || content=".halt sentinel present (empty)"
    echo "halted=true"
    echo "reason=$content"
    return 0
  fi
  # Not present: is it a plain ENOENT or a genuine failure (dir in the way, perm denied…)?
  if [ ! -e "$halt_path" ]; then
    echo "halted=false"
    echo "reason="
    return 0
  fi
  if [ ! -r "$halt_path" ]; then
    echo "halted=true"
    echo "reason=FAIL-CLOSED: .halt sentinel present but unreadable at $halt_path"
    return 0
  fi
  echo "halted=true"
  echo "reason=FAIL-CLOSED: .halt sentinel present but not a readable file at $halt_path"
  return 0
}

# ── last-commit age (hours, decimal) for a workspace root ─────────────────────────────────────────────
# `git log -1 --format=%ct` is the mechanical "产出" probe (SPEC 2.8's 长期无产出). A root that is
# not a git repo, or has no commits, yields `null` (cannot confirm staleness — fail-safe, never a
# false stall alarm).
last_commit_age_hours() {
  local root="$1" ts now diff
  ts="$(git -C "$root" log -1 --format=%ct 2>/dev/null)" || { echo "null"; return 0; }
  [ -n "$ts" ] || { echo "null"; return 0; }
  now="$(date +%s 2>/dev/null)" || { echo "null"; return 0; }
  diff=$(( now - ts ))
  [ "$diff" -lt 0 ] && diff=0
  awk -v d="$diff" 'BEGIN { printf "%.2f", d / 3600 }'
}

# ── combination criterion (SPEC 2.8): !halted && age > threshold ⇒ unmarked stall ─────────────────────
# Emits stall=true|false + stall_reason. PURE.
compute_stall() {
  local root="$1" threshold="$2" halted="$3" age threshold_num
  if [ "$halted" = "true" ]; then
    echo "stall=false"
    echo "stall_reason=halted (marked stop — the .halt sentinel is present, so this is not an unmarked stall)"
    return 0
  fi
  age="$(last_commit_age_hours "$root")"
  if [ "$age" = "null" ]; then
    echo "stall=false"
    echo "stall_reason=cannot determine last-commit age at $root (not a git repo / no commits) — fail-safe, no stall alarm"
    return 0
  fi
  threshold_num="$(printf '%s' "$threshold" | awk '{ printf "%.2f", $1 }')"
  if awk -v a="$age" -v t="$threshold_num" 'BEGIN { exit !(a > t) }'; then
    echo "stall=true"
    echo "stall_reason=unmarked stall (SPEC 2.8): no .halt AND last commit $age h ago > ${threshold_num} h threshold"
  else
    echo "stall=false"
    echo "stall_reason=no .halt and last commit $age h ago within ${threshold_num} h threshold — not stalled"
  fi
  return 0
}

# ── one record, ONE LINE, unit-separated:
#    name USEP root USEP halted USEP reason USEP age USEP stall USEP stall_reason
assemble_record() {
  local name="$1" root="$2" halted reason age stall stall_reason halt_out stall_out
  halt_out="$(halt_for_root "$root")"
  halted="$(printf '%s\n' "$halt_out" | sed -n 's/^halted=//p')"
  reason="$(printf '%s\n' "$halt_out" | sed -n 's/^reason=//p')"
  age="$(last_commit_age_hours "$root")"
  if [ "$halted" = "true" ]; then
    stall="false"
    stall_reason="halted (marked stop — the .halt sentinel is present, so this is not an unmarked stall)"
  else
    stall_out="$(compute_stall "$root" "$STALL_THRESHOLD" "false")"
    stall="$(printf '%s\n' "$stall_out" | sed -n 's/^stall=//p')"
    stall_reason="$(printf '%s\n' "$stall_out" | sed -n 's/^stall_reason=//p')"
  fi
  printf '%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\n' "$name" "$root" "$halted" "$reason" "$age" "$stall" "$stall_reason"
}

# ── project list parsing: label USEP absroot per line ─────────────────────────────────────────────────
resolve_projects() {
  local name proot label
  for name in ${PROJECTS//,/ }; do
    [ -n "$name" ] || continue
    case "$name" in
      /*) proot="$name"; label="$(basename "$name")" ;;
      *)  proot="$ROOT/$name"; label="$name" ;;
    esac
    printf '%s\x1f%s\n' "$label" "$proot"
  done
}

# ── arg parsing ───────────────────────────────────────────────────────────────────────────────────────
i=1
while [ "$i" -le "$#" ]; do
  a="${!i}"
  case "$a" in
    --for)
      i=$(( i + 1 ))
      LAYER="${!i:-}"
      ;;
    --root)
      i=$(( i + 1 ))
      ROOT="${!i:-$ROOT}"
      ;;
    --json) JSON=1 ;;
    --stall-threshold)
      i=$(( i + 1 ))
      STALL_THRESHOLD="${!i:-24}"
      ;;
    --projects)
      i=$(( i + 1 ))
      PROJECTS="${!i:-}"
      ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "halt-check: unknown arg $a" >&2
      usage >&2
      exit 2
      ;;
  esac
  i=$(( i + 1 ))
done

case "$LAYER" in
  outer|inner|manager) ;;
  "")
    echo "halt-check: --for <outer|inner|manager> is required (the layer doing the check)" >&2
    exit 2
    ;;
  *)
    echo "halt-check: unknown layer '$LAYER' (expected outer|inner|manager)" >&2
    exit 2
    ;;
esac

# ── compute the layer-scope record ────────────────────────────────────────────────────────────────────
MAIN_REC="$(assemble_record "$LAYER" "$ROOT")"
IFS=$'\x1f' read -r rec_name rec_root rec_halted rec_reason rec_age rec_stall rec_stall_reason <<<"$MAIN_REC"

# ── compute per-project records (one unit-separated line each) ────────────────────────────────────────
PROJECT_RECS=""
if [ -n "$PROJECTS" ]; then
  while IFS=$'\x1f' read -r label proot; do
    [ -n "$label" ] || continue
    PROJECT_RECS+="$(assemble_record "$label" "$proot")"$'\n'
  done < <(resolve_projects)
fi

if [ "$JSON" = "1" ]; then
  python3 - "$LAYER" "$rec_root" "$rec_halted" "$rec_reason" "$rec_stall" "$rec_stall_reason" "$rec_age" "$STALL_THRESHOLD" "$PROJECT_RECS" <<'PYEOF'
import json, sys

layer, root, halted, reason, stall, stall_reason, age, threshold, proj_recs = sys.argv[1:10]
out = {
    "layer": layer,
    "root": root,
    "halted": halted == "true",
    "halted_reason": reason,
    "stall": stall == "true",
    "stall_reason": stall_reason,
    "last_commit_age_hours": float(age) if age != "null" else None,
    "stall_threshold_hours": float(threshold),
}
projects = []
for line in proj_recs.splitlines():
    if not line:
        continue
    parts = line.split("\x1f")
    if len(parts) != 7:
        continue
    pname, proot, phalted, preason, page, pstall, pstall_reason = parts
    projects.append({
        "name": pname,
        "root": proot,
        "halted": phalted == "true",
        "halted_reason": preason,
        "last_commit_age_hours": float(page) if page != "null" else None,
        "stall": pstall == "true",
        "stall_reason": pstall_reason,
    })
if projects:
    out["projects"] = projects
json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
print()
PYEOF
else
  echo "halted=$rec_halted"
  echo "reason=$rec_reason"
  echo "layer=$LAYER"
  echo "stall=$rec_stall"
  echo "stall_reason=$rec_stall_reason"
  echo "last_commit_age_hours=$rec_age"
  if [ -n "$PROJECT_RECS" ]; then
    while IFS=$'\n' read -r line; do
      [ -n "$line" ] || continue
      IFS=$'\x1f' read -r pname proot phalted preason page pstall pstall_reason <<<"$line"
      echo "project_$pname.halted=$phalted"
      echo "project_$pname.reason=$preason"
      echo "project_$pname.last_commit_age_hours=$page"
      echo "project_$pname.stall=$pstall"
      echo "project_$pname.stall_reason=$pstall_reason"
    done <<<"$PROJECT_RECS"
  fi
fi
exit 0
