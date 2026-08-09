#!/usr/bin/env bash
# cross-machine-verify.sh — cross-machine VERIFICATION of post-merge delivery.
# (tasks/gap-no-post-merge-cross-machine-verification-detection-latency-is-luck)
#
# THE GAP IT CLOSES: a wrong merge resolution has NO mechanism that finds it. Detection latency d is
# pure luck — the 4+3 real defects from today's cross-machine merges were caught by ad-arm1's
# cold-start gate (a machine that happened to exist and happened to be running a gate), NOT by the
# merging machine's own suite (which had not run since 07:07Z while 161 commits landed). The conflict
# cost model (orchestration/ANALYSIS-when-should-B-develop-vs-only-file-tasks-2026-08-06.md) shows
# mechanical conflict resolution is negligible (c=0.006h) and essentially ALL cost is p·d — a wrong
# resolution that stays undetected. The parent environment masks the parent's defects (the verifying
# environment == the defect-producing environment), so the VERIFIER must be a machine that did NOT
# participate in the merge — a structural requirement, not redundancy.
#
# THE MECHANISM (slot-refill double-trigger pattern, per the task's Chosen mechanism — the SAME
# pattern the cross-machine sync mechanism uses; NO system crontab, this is the shipped mechanism):
#   1. event-driven (accelerated): at land time the MERGING machine records the merge it just landed
#      (`--record-merge <sha>` — called right after the land closure, same round). The merger identity
#      is therefore recorded by the ONLY machine that knows it — no attribution guessing.
#   2. tick-heartbeat (fallback must-run): every loop tick (both machines) UNCONDITIONALLY runs
#      `--verify` — it asks "are there merges a NON-participating machine can verify?" and runs the
#      fast gate for each. It does NOT depend on any completion event.
#
# SHARED STATE: git notes, pushed to the shared remote (origin) like the sync mechanism uses origin
# refs. Two notes refs:
#   refs/notes/quay-cmv-merge    per merge commit  {"type":"merge","sha":..,"branch":..,
#                                                    "merger_machine":"<hostname>","at":"<ISO commit time>"}
#   refs/notes/quay-cmv-verdict  per merge commit  {"type":"verdict","verifier_machine":"<hostname>",
#                                                    "at":"<ISO verdict time>","verdict":"green|red",
#                                                    "gate":"<name>","files":[...]}   (appendable)
# The notes refs ride the upgrade channel with the plugin (referenced from plugin/loop/*.md → derived
# laydown set) and are the ONLY shared cross-machine channel besides the git refs themselves. A machine
# that did NOT record the merge fetches the notes and verifies. Merges with NO merge note (the land
# event was missed) are surfaced as UNATTRIBUTED and are NOT verified (fail-closed: you cannot prove
# non-participation for a merge you cannot attribute).
#
# THE FAST GATE: cold-start/smoke level (NOT the full suite — the full suite is 38 min and does not fit
# the d budget). Default = the cold-start gate `laydown-set-check.sh` (derived laydown set green) — the
# SAME gate that actually caught today's 4+3 defects. Override with `--gate "<command>"`. The gate MUST
# name the failing file on red (negative control AC3: deliberately break a tested function → the gate
# goes red AND names the file; a gate that cannot see a broken change is no gate at all).
#
# MEASUREMENT (the ## Contract surface):
#   detection_latency_h = post_merge_latency_h in `--report --json` — verified merge: verdict time −
#     merge commit time; pending merge: now − merge commit time. Mechanically readable, never recalled.
#   verifier_is_participant = (--report --json `verifier_machine` == `merger_machine` ? 1 : 0), band 0.
#
# Usage:
#   cross-machine-verify.sh [--root <repo>] [--remote <name>] [--branches "<b1> <b2>"]
#                           [--machine <id>] [--no-push] [--json] [--gate <cmd>]
#                           (--record-merge <sha> [<sha>...] | --verify | --report | --help)
#
#   --record-merge <sha>...  event-driven RECORD — the merging machine records the merges it just
#                            landed (idempotent: a merge note that already exists is skipped). Attaches
#                            a quay-cmv-merge note (merger_machine = this machine) and pushes notes.
#   --verify                 the heartbeat/event-driven VERIFY action — fetch notes, find merges on the
#                            target branches that (a) have a merge note, (b) merger_machine != this
#                            machine, (c) have NO verdict yet from a non-participating machine; run the
#                            fast gate for each (oldest first); attach a quay-cmv-verdict note and push.
#   --report (default)       AC5 — list merges on the target branches with their merge/verdict notes;
#                            show which are unverified and how long each has waited; output the
#                            verifier_machine/merger_machine/post_merge_latency_h fields (--json).
#   --gate-run               run the fast gate directly and print its verdict JSON (the negative-control
#                            surface — AC3). Default gate: laydown-set-check.sh.
#   --gate <cmd>             override the fast-gate command (used by --verify / --gate-run). Default:
#                            `laydown-set-check.sh --root <repo>` (the cold-start gate).
#   --root <repo>            repo root (default: auto-derived from this script's location).
#   --remote <name>          notes remote (default: origin).
#   --branches "<b1> <b2>"   the merge-target branches to track (default: "develop integration").
#   --machine <id>           machine identity (default: `hostname`). Same namespace for merger and
#                            verifier so verifier_is_participant is mechanically comparable.
#   --no-push                never fetch/push notes (measure-only / local demo; default OFF).
#
# Exit codes:
#   0  success (recorded / verified / report emitted / gate green)
#   1  gate verdict red (--gate / --verify when a gate goes red) / report found unverified merges
#   2  usage / not a git repo / remote missing / branch missing / bad sha (fail-closed)
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
branches="develop integration"
machine="$(hostname 2>/dev/null || echo unknown)"
mode="report"
json=0
no_push=0
gate_cmd=""
merge_shas=()

MERGE_REF="quay-cmv-merge"
VERDICT_REF="quay-cmv-verdict"

usage() { sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; exit 0; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --record-merge) mode="record-merge"; shift ;;
    --verify) mode="verify"; shift ;;
    --report) mode="report"; shift ;;
    --gate-run) mode="gate"; shift ;;
    --gate) gate_cmd="${2:-}"; shift 2 ;;
    --root) repo_root="${2:-}"; shift 2 ;;
    --remote) remote="${2:-}"; shift 2 ;;
    --branches) branches="${2:-}"; shift 2 ;;
    --branch) branches="${2:-}"; shift 2 ;;   # singular alias — the wiring (orchestrator 3b / periodic-push-backup hook) passes one branch
    --machine) machine="${2:-}"; shift 2 ;;
    --no-push) no_push=1; shift ;;
    --json) json=1; shift ;;
    --help|-h) usage ;;
    -*) echo "cross-machine-verify: unknown argument: $1" >&2; exit 2 ;;
    *) merge_shas+=("$1"); shift ;;
  esac
done

[ -n "${remote}" ] || { echo "cross-machine-verify: empty --remote" >&2; exit 2; }
[ -n "${branches}" ] || { echo "cross-machine-verify: empty --branches" >&2; exit 2; }

# ── fail-closed preflight ──────────────────────────────────────────────────────────────────────────
if ! git -C "${repo_root}" rev-parse --git-dir >/dev/null 2>&1; then
  echo "cross-machine-verify: not a git repo: ${repo_root}" >&2
  exit 2
fi
for b in ${branches}; do
  if ! git -C "${repo_root}" show-ref --verify --quiet "refs/heads/${b}"; then
    echo "cross-machine-verify: local branch not found: ${b}" >&2
    exit 2
  fi
done
if ! git -C "${repo_root}" remote get-url "${remote}" >/dev/null 2>&1; then
  echo "cross-machine-verify: remote not found: ${remote}" >&2
  exit 2
fi

# ── helpers ────────────────────────────────────────────────────────────────────────────────────────
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# commit_iso <sha> — committer date ISO-8601 (the authoritative "merge commit time" for d).
commit_iso() {
  git -C "${repo_root}" show -s --format=%cI "$1" 2>/dev/null || iso_now
}

# note_show <ref> <sha> — the note message for a commit, or "" if none.
note_show() {
  git -C "${repo_root}" notes --ref="$1" show "$2" 2>/dev/null || true
}

# note_has <ref> <sha> — true if a note exists for the commit in the ref.
note_has() {
  git -C "${repo_root}" notes --ref="$1" list 2>/dev/null | grep -q " $2$"
}

# note_add <ref> <msg> <sha> — attach a note (caller guards against an existing note).
note_add() {
  git -C "${repo_root}" notes --ref="$1" add -m "$2" "$3" >/dev/null 2>&1
}

# note_append <ref> <msg> <sha> — append to the note (creates it if absent). Verdicts accumulate so
# the report reads the LAST verifier's conclusion.
note_append() {
  git -C "${repo_root}" notes --ref="$1" append -m "$2" "$3" >/dev/null 2>&1
}

fetch_notes() {
  git -C "${repo_root}" fetch "${remote}" \
    "refs/notes/${MERGE_REF}:refs/notes/${MERGE_REF}" \
    "refs/notes/${VERDICT_REF}:refs/notes/${VERDICT_REF}" >/dev/null 2>&1 || true
}

push_notes() {
  git -C "${repo_root}" push "${remote}" \
    "refs/notes/${MERGE_REF}:refs/notes/${MERGE_REF}" \
    "refs/notes/${VERDICT_REF}:refs/notes/${VERDICT_REF}" >/dev/null 2>&1 || true
}

# parse_notes <msg> — parse a note message (possibly multiple JSON objects concatenated) into
# newline-delimited compact JSON, oldest first. Returns empty for an unparseable/absent note.
parse_notes() {
  printf '%s' "$1" | python3 -c '
import json, sys
text = sys.stdin.read()
objs = []
i = 0
while i < len(text):
    j = text.find("{", i)
    if j == -1: break
    depth = 0
    found = False
    for k in range(j, len(text)):
        if text[k] == "{": depth += 1
        elif text[k] == "}":
            depth -= 1
            if depth == 0:
                try:
                    objs.append(json.loads(text[j:k+1]))
                except Exception:
                    pass
                i = k + 1
                found = True
                break
    if not found:
        i = j + 1
for o in objs:
    print(json.dumps(o, sort_keys=True))
' 2>/dev/null || true
}

# epoch <iso> — epoch seconds from an ISO timestamp (for the wait/latency math).
epoch() {
  python3 - "$1" <<'PYEOF' 2>/dev/null || echo 0
import sys, datetime
try:
    s = sys.argv[1].replace("Z", "+00:00")
    print(int(datetime.datetime.fromisoformat(s).timestamp()))
except Exception:
    print(0)
PYEOF
}

# hours_between <start_iso> <end_iso> — decimal hours (rounded to 2 places).
hours_between() {
  python3 - "$1" "$2" <<'PYEOF' 2>/dev/null || echo 0
import sys, datetime
def ep(s):
    s = s.replace("Z", "+00:00")
    return datetime.datetime.fromisoformat(s).timestamp()
try:
    print(round((ep(sys.argv[2]) - ep(sys.argv[1])) / 3600.0, 2))
except Exception:
    print(0)
PYEOF
}

# ── the fast gate (cold-start/smoke level — the ad-arm1 gate class) ────────────────────────────────
# run_gate <sha> → prints ONE JSON line {"verdict":"green|red|error","gate":...,"files":[...]},
#               exit code = verdict (0 green, 1 red, 2 error).
run_gate() {
  local sha="${1:-HEAD}"
  local cmd
  if [ -n "${gate_cmd}" ]; then
    cmd="${gate_cmd}"
  else
    cmd="bash ${SCRIPT_DIR}/laydown-set-check.sh --root ${repo_root}"
  fi
  # The gate name = basename of the LAST token that looks like a script path (default cmd's last
  # token is --root <repo>; an override like `bash /path/gate.sh` has the gate path as the last
  # path-like token). basename so the verdict note records a stable, short gate id.
  local gate_name="$(printf '%s' "${cmd}" | awk '{for(i=1;i<=NF;i++) if ($i ~ /\.(sh|ts|mjs|tsx)$/) g=$i} END{print g}' | xargs -r basename 2>/dev/null)"
  [ -n "${gate_name}" ] || gate_name="gate"
  local out rc
  out="$(cd "${repo_root}" && bash -c "${cmd}" 2>&1)"
  rc=$?
  local verdict="green"
  if [ "${rc}" -eq 1 ]; then verdict="red"; elif [ "${rc}" -ne 0 ]; then verdict="error"; fi
  local files
  files="$(printf '%s' "${out}" | python3 -c '
import re, sys
out = sys.stdin.read()
hits = []
# Failure-context lines: failing-test markers AND stack/error traces (an import-error test file
# names itself in a stack trace, not on a ✖/not ok line).
for line in out.splitlines():
    if ("✖" in line or "not ok" in line or "FAIL" in line.upper()
        or "Error" in line or "error" in line.lower()
        or re.search(r"\bat\s+[^ ]+\.(?:mjs|js|ts|sh)", line)):
        for m in re.findall(r"(plugin/[A-Za-z0-9_./-]+\.(?:test\.mjs|mjs|js|ts|sh))", line):
            if m not in hits:
                hits.append(m)
print("\n".join(hits))
' 2>/dev/null || true)"
  local files_json="[]"
  if [ -n "${files}" ]; then
    files_json="$(printf '%s\n' "${files}" | python3 -c '
import json, sys
print(json.dumps([l for l in sys.stdin.read().splitlines() if l.strip()]))
' 2>/dev/null || echo "[]")"
  fi
  printf '{"verdict":"%s","gate":"%s","files":%s}\n' "${verdict}" "${gate_name}" "${files_json}"
  [ "${verdict}" = "green" ] && return 0
  [ "${verdict}" = "red" ] && return 1
  return 2
}

# ── branch detection for a recorded merge ──────────────────────────────────────────────────────────
# detect_branch <sha> — the first tracked branch that contains the sha (default: first branch).
detect_branch() {
  local sha="$1" b
  for b in ${branches}; do
    if git -C "${repo_root}" merge-base --is-ancestor "${sha}" "refs/heads/${b}" 2>/dev/null; then
      printf '%s' "${b}"
      return 0
    fi
  done
  printf '%s' "${branches%% *}"
}

# All commits on the tracked branches that carry a quay-cmv-merge note (recorded merges), oldest
# first. Output: "<sha> <branch>" per line.
enumerate_recorded_merges() {
  [ "${no_push}" -eq 0 ] && fetch_notes
  local noted="$(git -C "${repo_root}" notes --ref="${MERGE_REF}" list 2>/dev/null | awk '{print $2}' || true)"
  [ -n "${noted}" ] || return 0
  local sha br out=""
  for sha in ${noted}; do
    for br in ${branches}; do
      if git -C "${repo_root}" merge-base --is-ancestor "${sha}" "refs/heads/${br}" 2>/dev/null; then
        out="${out}${sha} ${br}\n"
        break
      fi
    done
  done
  printf '%b' "${out}" | sort -k1 | while IFS= read -r line; do
    [ -n "${line}" ] && printf '%s\n' "${line}"
  done
}

# unattributed_commits_list — commits on the tracked branches that landed AFTER the mechanism started
# tracking (baseline = the recorded merge with the OLDEST merged_at) but have NO merge note. These are
# merges whose event-driven record was missed: they cannot be cross-machine verified (no merger
# identity to prove non-participation) → fail-closed, surfaced, never silently assumed verified.
# Without a recorded merge the baseline is not established (pre-mechanism) → prints nothing.
unattributed_commits_list() {
  local rec_ms="$(git -C "${repo_root}" notes --ref="${MERGE_REF}" list 2>/dev/null | awk '{print $2}' || true)"
  [ -n "${rec_ms}" ] || return 0
  local baseline="" baseline_ts="" r b_ts
  for r in ${rec_ms}; do
    b_ts="$(commit_iso "${r}")"
    if [ -z "${baseline_ts}" ] || [ "$(epoch "${b_ts}")" -lt "$(epoch "${baseline_ts}")" ]; then
      baseline="${r}"; baseline_ts="${b_ts}"
    fi
  done
  [ -n "${baseline}" ] || return 0
  local br br_tip c
  for br in ${branches}; do
    br_tip="$(git -C "${repo_root}" rev-parse "refs/heads/${br}" 2>/dev/null || true)"
    [ -n "${br_tip}" ] || continue
    for c in $(git -C "${repo_root}" log "${br}" --format=%H -n 300 2>/dev/null || true); do
      note_has "${MERGE_REF}" "${c}" && continue
      if git -C "${repo_root}" merge-base --is-ancestor "${baseline}" "${c}" 2>/dev/null; then
        printf '%s %s\n' "${c:0:12}" "${br}"
      fi
    done
  done
}

# merge_status <sha> <branch> — prints JSON for one recorded merge with its verdict state.
merge_status() {
  local sha="$1" br="$2"
  local merge_msg="$(note_show "${MERGE_REF}" "${sha}")"
  local merge_note="$(parse_notes "${merge_msg}" | tail -n 1)"
  local merger="$(printf '%s' "${merge_note}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("merger_machine","unknown"))
except Exception: print("unknown")')"
  local merged_at="$(printf '%s' "${merge_note}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("at",""))
except Exception: print("")')"
  [ -n "${merged_at}" ] || merged_at="$(commit_iso "${sha}")"

  local verdict_note="$(note_show "${VERDICT_REF}" "${sha}")"
  local vline="$(parse_notes "${verdict_note}" | python3 -c '
import json, sys
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
print(lines[-1] if lines else "")
')"
  local verified="false" verdict="null" verifier="null" verdict_at="null" vlat="null"
  if [ -n "${vline}" ]; then
    local vv vvm vat
    vv="$(printf '%s' "${vline}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("verdict",""))
except Exception: print("")')"
    vvm="$(printf '%s' "${vline}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("verifier_machine",""))
except Exception: print("")')"
    vat="$(printf '%s' "${vline}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("at",""))
except Exception: print("")')"
    # A verdict counts ONLY when the verifier is not the merger (AC4 structural requirement).
    if [ -n "${vvm}" ] && [ "${vvm}" != "${merger}" ]; then
      verified="true"; verdict="${vv}"; verifier="${vvm}"; verdict_at="${vat}"
      vlat="$(hours_between "${merged_at}" "${vat}")"
    fi
  fi
  local wait_h now_iso
  if [ "${verified}" = "true" ]; then
    wait_h="${vlat}"
  else
    now_iso="$(iso_now)"
    wait_h="$(hours_between "${merged_at}" "${now_iso}")"
  fi
  python3 -c '
import json, sys
def s(x): return None if x == "null" else x
print(json.dumps({"sha":sys.argv[1],"branch":sys.argv[2],"merger_machine":sys.argv[3],
  "merged_at":sys.argv[4],"verified":sys.argv[5] == "true","verdict":s(sys.argv[6]),
  "verifier_machine":s(sys.argv[7]),"verdict_at":s(sys.argv[8]),
  "wait_h":float(sys.argv[9]),"post_merge_latency_h":float(sys.argv[10])}))
' "${sha}" "${br}" "${merger}" "${merged_at}" "${verified}" "${verdict}" "${verifier}" "${verdict_at}" "${wait_h}" "${wait_h}"
}

# ── MODE: record-merge (event-driven, the merging machine) ────────────────────────────────────────
mode_record_merge() {
  if [ "${#merge_shas[@]}" -eq 0 ]; then
    echo "cross-machine-verify: --record-merge requires at least one <sha> (the merges this machine just landed)" >&2
    return 2
  fi
  [ "${no_push}" -eq 0 ] && fetch_notes
  local now="$(iso_now)" recorded=0 skipped=0 missing=0 sha br ctime
  for sha in "${merge_shas[@]}"; do
    if ! git -C "${repo_root}" cat-file -e "${sha}^{commit}" >/dev/null 2>&1; then
      echo "cross-machine-verify: not a commit: ${sha}" >&2
      missing=$((missing + 1))
      continue
    fi
    if note_has "${MERGE_REF}" "${sha}"; then
      skipped=$((skipped + 1))
      continue
    fi
    br="$(detect_branch "${sha}")"
    ctime="$(commit_iso "${sha}")"
    note_add "${MERGE_REF}" "{\"type\":\"merge\",\"sha\":\"${sha}\",\"branch\":\"${br}\",\"merger_machine\":\"${machine}\",\"at\":\"${ctime}\",\"recorded_at\":\"${now}\"}" "${sha}"
    echo "recorded merge: ${sha:0:12} branch=${br} merger_machine=${machine} at=${ctime}"
    recorded=$((recorded + 1))
  done
  [ "${no_push}" -eq 0 ] && push_notes
  echo "cross-machine-verify: record-merge done (recorded ${recorded} / skipped ${skipped} / missing ${missing})"
  return 0
}

# ── MODE: gate (negative-control surface) ──────────────────────────────────────────────────────────
mode_gate() {
  local gsha="${merge_shas[0]:-HEAD}"
  run_gate "${gsha}"
  return $?
}

# ── MODE: verify (heartbeat / event-driven — a NON-participating machine runs the fast gate) ───────
mode_verify() {
  local verified=0 skipped_participant=0 skipped_unattributed=0 skipped_done=0 reds=0 errors=0
  local line sha br merge_msg merger vnote already now gres grc gv gfiles ggate merged_at lat
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    sha="${line%% *}"
    br="${line#* }"
    merge_msg="$(note_show "${MERGE_REF}" "${sha}")"
    merger="$(parse_notes "${merge_msg}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("merger_machine","unknown"))
except Exception: print("unknown")')"
    if [ "${merger}" = "unknown" ] || [ -z "${merger}" ]; then
      echo "verify: skip ${sha:0:12} — unattributed merge (no merger identity); fail-closed, NOT verified"
      skipped_unattributed=$((skipped_unattributed + 1))
      continue
    fi
    if [ "${merger}" = "${machine}" ]; then
      echo "verify: skip ${sha:0:12} — this machine (${machine}) IS the merger; a parent cannot verify its own merge (AC4)"
      skipped_participant=$((skipped_participant + 1))
      continue
    fi
    vnote="$(note_show "${VERDICT_REF}" "${sha}")"
    already="$(parse_notes "${vnote}" | python3 -c '
import json, sys
me = sys.argv[1]
for l in sys.stdin.read().splitlines():
    if not l.strip(): continue
    try: o = json.loads(l)
    except Exception: continue
    if o.get("verifier_machine") and o.get("verifier_machine") != me:
        print("yes"); break
' "${merger}")"
    if [ "${already}" = "yes" ]; then
      skipped_done=$((skipped_done + 1))
      continue
    fi
    now="$(iso_now)"
    echo "verify: verifying ${sha:0:12} (merger=${merger}, verifier=${machine}) — running fast gate..."
    gres="$(run_gate "${sha}")"
    grc=$?
    gv="$(printf '%s' "${gres}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("verdict","error"))
except Exception: print("error")')"
    gfiles="$(printf '%s' "${gres}" | python3 -c 'import json,sys
try: print(json.dumps(json.loads(sys.stdin.read()).get("files",[])))
except Exception: print("[]")')"
    ggate="$(printf '%s' "${gres}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("gate",""))
except Exception: print("")')"
    merged_at="$(parse_notes "${merge_msg}" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("at",""))
except Exception: print("")')"
    [ -n "${merged_at}" ] || merged_at="$(commit_iso "${sha}")"
    note_append "${VERDICT_REF}" "{\"type\":\"verdict\",\"verifier_machine\":\"${machine}\",\"at\":\"${now}\",\"verdict\":\"${gv}\",\"gate\":\"${ggate}\",\"files\":${gfiles}}" "${sha}"
    lat="$(hours_between "${merged_at}" "${now}")"
    if [ "${gv}" = "red" ]; then
      reds=$((reds + 1))
      echo "verify: ${sha:0:12} verdict=RED post_merge_latency_h=${lat} files=${gfiles} — DETECTED by cross-machine gate"
    elif [ "${gv}" = "green" ]; then
      verified=$((verified + 1))
      echo "verify: ${sha:0:12} verdict=green post_merge_latency_h=${lat}"
    else
      errors=$((errors + 1))
      echo "verify: ${sha:0:12} gate error — verdict not recorded (verdict=error)"
    fi
  done < <(enumerate_recorded_merges)
  # Unattributed merges (landed but never recorded — the event-driven record was missed): cannot be
  # verified (no merger identity) → fail-closed, counted, NOT verified. Never silently assumed.
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    echo "verify: skip ${line} — unattributed merge (no merger identity); fail-closed, NOT verified"
    skipped_unattributed=$((skipped_unattributed + 1))
  done < <(unattributed_commits_list)
  [ "${no_push}" -eq 0 ] && push_notes
  echo "cross-machine-verify: verify done (green ${verified} / red ${reds} / gate-error ${errors} / skipped-participant ${skipped_participant} / skipped-unattributed ${skipped_unattributed} / already-verified ${skipped_done})"
  [ "${reds}" -eq 0 ]
  return $?
}

# ── MODE: report (default, AC5 — the ## Contract measure surface) ──────────────────────────────────
mode_report() {
  local report_merges=""
  local n_unverified=0 n_verified=0
  local newest_pending="" newest_pending_wait="0"
  local line sha br st w
  while IFS= read -r line; do
    [ -n "${line}" ] || continue
    sha="${line%% *}"
    br="${line#* }"
    st="$(merge_status "${sha}" "${br}")"
    report_merges="${report_merges}${st}\n"
    if [ "$(printf '%s' "${st}" | python3 -c 'import json,sys
o=json.loads(sys.stdin.read()); print("true" if o.get("verified") else "false")')" = "true" ]; then
      n_verified=$((n_verified + 1))
    else
      n_unverified=$((n_unverified + 1))
      w="$(printf '%s' "${st}" | python3 -c 'import json,sys
print(json.loads(sys.stdin.read())["wait_h"])')"
      if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)" "${w}" "${newest_pending_wait}" 2>/dev/null; then
        newest_pending="${sha}"; newest_pending_wait="${w}"
      fi
      if [ -z "${newest_pending}" ]; then newest_pending="${sha}"; newest_pending_wait="${w}"; fi
    fi
  done < <(enumerate_recorded_merges)

  # Top-level ## Contract fields — the target merge is the one the invariant cares most about: the
  # OLDEST unverified merge (its wait IS the current detection latency d). verifier_machine is the
  # machine that ACTUALLY gave the verdict (from the verdict note), not the report runner — so
  # verifier_is_participant mechanically proves AC4 (the verifier is not the merger) once verified.
  local target_sha="${newest_pending}"
  local top_status=""
  if [ -n "${target_sha}" ]; then
    top_status="$(merge_status "${target_sha}" "${branches%% *}")"
  else
    # No pending merges → report the most recent VERIFIED merge (if any) as the last measured d.
    local last_status="$(printf '%b' "${report_merges}" | tail -n 1)"
    if [ -n "${last_status}" ] && [ "$(printf '%s' "${last_status}" | python3 -c 'import json,sys
print("1" if json.loads(sys.stdin.read()).get("verified") else "0")')" = "1" ]; then
      top_status="${last_status}"
    fi
  fi
  local top_merger="null" top_verifier="null" top_lat="0"
  if [ -n "${top_status}" ]; then
    top_merger="$(printf '%s' "${top_status}" | python3 -c 'import json,sys
o=json.loads(sys.stdin.read()); print(json.dumps(o["merger_machine"]))')"
    top_verifier="$(printf '%s' "${top_status}" | python3 -c 'import json,sys
o=json.loads(sys.stdin.read()); v=o.get("verifier_machine")
print(json.dumps(v) if v else "null")')"
    top_lat="$(printf '%s' "${top_status}" | python3 -c 'import json,sys
o=json.loads(sys.stdin.read()); print(o.get("post_merge_latency_h",0))')"
  fi
  local verifier_is_participant=0 tmv tvv
  if [ "${top_verifier}" != "null" ] && [ "${top_merger}" != "null" ]; then
    tmv="$(printf '%s' "${top_merger}" | tr -d '"')"
    tvv="$(printf '%s' "${top_verifier}" | tr -d '"')"
    [ "${tmv}" = "${tvv}" ] && verifier_is_participant=1
  fi
  local post_lat="${top_lat:-0}"
  if [ -n "${newest_pending}" ]; then post_lat="${newest_pending_wait}"; fi

  # Unattributed commits (landed AFTER the mechanism started tracking, but with NO merge note) —
  # fail-closed visibility (shared helper; baseline = the recorded merge with the OLDEST merged_at).
  local unattr_list="$(unattributed_commits_list)" unattr_count=0
  unattr_count="$(printf '%s' "${unattr_list}" | grep -c . || true)"

  if [ "${json}" -eq 1 ]; then
    python3 -c '
import json, sys
merges = []
for l in sys.stdin.read().splitlines():
    if l.strip(): merges.append(json.loads(l))
out = {
  "verifier_machine": json.loads(sys.argv[1]),
  "merger_machine": json.loads(sys.argv[2]),
  "verifier_is_participant": int(sys.argv[3]),
  "post_merge_latency_h": float(sys.argv[4]),
  "unverified_merges": int(sys.argv[5]),
  "verified_merges": int(sys.argv[6]),
  "unattributed_commits": int(sys.argv[7]),
  "merges": merges,
  "notes_refs": ["refs/notes/" + sys.argv[8], "refs/notes/" + sys.argv[9]],
  "machine": sys.argv[10],
}
print(json.dumps(out, indent=2))
' "${top_verifier}" "${top_merger}" "${verifier_is_participant}" "${post_lat}" "${n_unverified}" "${n_verified}" "${unattr_count}" "${MERGE_REF}" "${VERDICT_REF}" "${machine}" <<< "$(printf '%b' "${report_merges}")"
  else
    echo "cross-machine-verify: report (machine=${machine})"
    echo "  verifier_machine: $(printf '%s' "${top_verifier}" | tr -d '"')"
    echo "  merger_machine: $(printf '%s' "${top_merger}" | tr -d '"')"
    echo "  verifier_is_participant: ${verifier_is_participant}  (band 0)"
    echo "  post_merge_latency_h: ${post_lat}  (band 0..1)"
    echo "  unverified_merges: ${n_unverified} / verified_merges: ${n_verified} / unattributed_commits: ${unattr_count}"
    if [ "${n_unverified}" -gt 0 ] || [ "${unattr_count}" -gt 0 ]; then
      echo "  UNVERIFIED — the detection latency d for each pending merge is its wait_h (this is the failure surface):"
    else
      echo "  all recorded merges cross-machine verified"
    fi
    printf '%b' "${report_merges}" | while IFS= read -r l; do
      [ -n "${l}" ] || continue
      printf '%s' "${l}" | python3 -c 'import json,sys
o=json.loads(sys.stdin.read())
print("  " + o["sha"][:12] + " " + o["branch"] + " merger=" + o["merger_machine"] + " verified=" + str(o["verified"]) + " verdict=" + str(o["verdict"]) + " verifier=" + str(o["verifier_machine"]) + " wait_h=" + str(o["wait_h"]))'
    done
    if [ "${unattr_count}" -gt 0 ]; then
      echo "  unattributed commits (landed but NOT recorded by a merger — cannot prove non-participation, NOT verified):"
      printf '%b' "${unattr_list}" | while IFS= read -r l; do [ -n "${l}" ] && echo "    ${l}"; done
    fi
  fi
  [ "${n_unverified}" -eq 0 ] && [ "${unattr_count}" -eq 0 ]
  return $?
}

# ── dispatch ───────────────────────────────────────────────────────────────────────────────────────
case "${mode}" in
  record-merge) mode_record_merge ;;
  verify) mode_verify ;;
  gate) mode_gate ;;
  report) mode_report ;;
  *) echo "cross-machine-verify: unknown mode ${mode}" >&2; exit 2 ;;
esac
exit $?
