#!/usr/bin/env bash
# tmux-leak-scan.sh — SUITE-TAIL residual-leak assertion (AC1 of
# gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
#
# After a test run, NO tmux server process and NO /tmp dir carrying a test characteristic prefix
# (skv- / session-liveness- / ol-tok- / enter-repro-) may remain. This is the SECOND line of
# defense — the teardown fix (kill-session -t <name>, never kill-server) is primary; this scan
# covers the whole leak class at once and makes "the leak is gone" mechanically checkable.
#
# DELTA form (gap-assert-clean-tree-premise-void-under-concurrent-writers, same family as
# assert-clean-tree.sh): the outer layer legitimately runs tmux sessions (send-keys remote-drive,
# skv- names) WHILE the suite runs — a pre-existing concurrent-writer tmux session is NOT this
# run's leak. --snapshot records the matching servers/dirs BEFORE the run; --check only flags
# items ABSENT from the snapshot. The absolute form (no flag) keeps the historical suite-tail
# semantics: ANY matching tmux server/dir is a leak.
#
# Usage:
#   tmux-leak-scan.sh --snapshot <workspace-root>   # record pre-existing matching servers/dirs
#   tmux-leak-scan.sh --check <workspace-root>      # delta: only NEW matches are leaks
#   tmux-leak-scan.sh                               # absolute (historical): any match is a leak
#
# Exit 0 = clean; exit 1 = residual leaks found (names printed to stderr). Never invokes `tmux`
# (a client call could itself be the only tmux process alive); scans `pgrep`/`ls` snapshots only.
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

prefixes='skv-|session-liveness-|ol-tok-|enter-repro-'

# gap-leak-residue-per-run-namespace-isolation (2026-08-13): when the runner delivered QUAY_RUN_ID,
# the suite's probe tmp root is the PER-RUN namespace /tmp/quay-run-<runId>/ (session-liveness-
# helpers.mjs probeRoot). This scan then covers ONLY that subtree — "本轮创建的东西 = 一棵子树" — so
# residue from a DIFFERENT run (a previous round, a concurrent worktree) is never attributed to this
# run (AC4 negative control), and the runner's unified cleanup has a PATH-OWNERSHIP + OWNER-LIVENESS
# criterion (dirHasLiveOwner) instead of the forbidden name-based kill. Without QUAY_RUN_ID (scoped /
# direct runs, legacy callers) the scan keeps the historical /tmp prefixes. The runId is a SHORT id
# (8 hex chars from the state-file UUID) so the tmux socket sun_path stays under the ~107-byte bound.
run_root=""
if [ -n "${QUAY_RUN_ID:-}" ]; then
  run_root="/tmp/quay-run-${QUAY_RUN_ID}"
fi
# Human-readable scan scope for messages (the run subtree when namespaced, else the prefix list).
scan_desc="${run_root}"
[ -n "${scan_desc}" ] || scan_desc="${prefixes}"

mode="absolute"
root=""
case "${1:-}" in
  --snapshot) mode="snapshot"; shift ;;
  --check)    mode="check";    shift ;;
esac
if [ "$mode" != "absolute" ]; then
  if [ "$#" -lt 1 ]; then
    echo "tmux-leak-scan: usage: $0 [--snapshot|--check] <workspace-root>" >&2
    exit 2
  fi
  root="$1"
fi

snapshot="${root}/.quay/tmux-leak-scan.snapshot"

# Normalized single sorted set of match lines (proc lines + dir lines), so `comm` is deterministic.
# Namespaced mode: dirs under the run's own subtree + tmux procs referencing it (a hermetic probe's
# `tmux -S /tmp/quay-run-<id>/...` client carries the run root in its argv). Legacy mode: the
# historical /tmp prefixes + procs carrying a characteristic prefix.
scan_matches() {
  local leaked_procs=""
  if command -v pgrep >/dev/null 2>&1; then
    if [ -n "$run_root" ]; then
      leaked_procs="$(pgrep -a tmux 2>/dev/null | grep -F "${run_root}" || true)"
    else
      leaked_procs="$(pgrep -a tmux 2>/dev/null | grep -E "${prefixes}" || true)"
    fi
  fi
  local leaked_dirs=""
  if [ -n "$run_root" ]; then
    leaked_dirs="$(ls -d "${run_root}"/* 2>/dev/null || true)"
  else
    leaked_dirs="$(ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/ol-tok-* /tmp/enter-repro-* 2>/dev/null || true)"
  fi
  {
    [ -n "$leaked_procs" ] && printf '%s\n' "$leaked_procs"
    [ -n "$leaked_dirs" ] && printf '%s\n' "$leaked_dirs"
  } | grep -v '^$' | sort
}

if [ "$mode" = "snapshot" ]; then
  mkdir -p "${root}/.quay"
  scan_matches > "$snapshot"
  echo "tmux-leak-scan: before-run snapshot recorded ($(wc -l < "$snapshot") pre-existing match line(s) in $snapshot)"
  exit 0
fi

if [ "$mode" = "check" ]; then
  if [ ! -f "$snapshot" ]; then
    echo "tmux-leak-scan: FAIL — no before-run snapshot at $snapshot (run --snapshot before the suite; fail closed)" >&2
    exit 1
  fi
  before="$(cat "$snapshot")"
  # BOUNDED REAP-WAIT (gap-leak-scan-reap-race-false-red): the suite's test-spawned tmux servers
  # (session-liveness-* hermetic probes, skv-/ol-tok-/enter-repro- families) are torn down at test
  # teardown by kill-session, but the server PROCESS exits and its /tmp socket dir is removed
  # ASYNCHRONOUSLY. Under load that exit can lag the run-end --check, so a still-exiting server was
  # swept as "NEW residual" → a false red (round 95: tests=4150 all pass, only the leak gate red;
  # round 96: light load, reaping won 2-10s before the scan → green). Fix: when NEW matches appear,
  # HOLD JUDGMENT and poll for up to $TMUX_LEAK_REAP_WAIT_MS (default 10000) — matches that clear
  # within the bound were reaping (transient), not a leak; only matches STILL PRESENT at the bound
  # are a REAL leak. A genuine leak (a server nobody killed) never clears, so the gate is NOT
  # weakened — it only stops flagging exit-in-progress. When the run is clean the first scan wins
  # immediately (zero added latency).
  reap_wait_ms="${TMUX_LEAK_REAP_WAIT_MS:-10000}"
  poll_ms="${TMUX_LEAK_REAP_POLL_MS:-250}"
  waited_ms=0
  new_matches=""
  saw_new=0
  while :; do
    after="$(scan_matches)"
    new_matches="$(comm -13 <(printf '%s\n' "$before" | grep -v '^$' | sort) <(printf '%s\n' "$after" | grep -v '^$' | sort))"
    if [ -z "$new_matches" ]; then
      if [ "$saw_new" -eq 1 ]; then
        echo "tmux-leak-scan: note — NEW match(es) cleared during reap-wait after ${waited_ms}ms (transient teardown residue, not a leak)" >&2
      fi
      rm -f "$snapshot"
      echo "tmux-leak-scan: clean — no NEW residual test tmux servers/dirs (delta vs the before-run snapshot)"
      exit 0
    fi
    saw_new=1
    if [ "$waited_ms" -ge "$reap_wait_ms" ]; then
      break
    fi
    sleep "$(awk -v ms="$poll_ms" 'BEGIN{printf "%.3f", ms/1000}')"
    waited_ms=$((waited_ms + poll_ms))
  done
  rm -f "$snapshot"
  echo "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs STILL PRESENT after ${waited_ms}ms reap-wait (delta vs the before-run snapshot; scan scope: ${scan_desc}):" >&2
  printf '%s\n' "$new_matches" >&2
  exit 1
fi

# absolute (historical) mode — same run-subtree / legacy-prefix split as scan_matches.
leaked_procs=""
if command -v pgrep >/dev/null 2>&1; then
  if [ -n "$run_root" ]; then
    leaked_procs="$(pgrep -a tmux 2>/dev/null | grep -F "${run_root}" || true)"
  else
    leaked_procs="$(pgrep -a tmux 2>/dev/null | grep -E "${prefixes}" || true)"
  fi
fi
if [ -n "$run_root" ]; then
  leaked_dirs="$(ls -d "${run_root}"/* 2>/dev/null || true)"
else
  leaked_dirs="$(ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/ol-tok-* /tmp/enter-repro-* 2>/dev/null || true)"
fi

if [ -n "${leaked_procs}" ] || [ -n "${leaked_dirs}" ]; then
  echo "tmux-leak-scan: FAIL — residual test tmux servers/dirs after the run (scan scope: ${scan_desc}):" >&2
  if [ -n "${leaked_procs}" ]; then
    while IFS= read -r line; do [ -n "${line}" ] && echo "  tmux: ${line}" >&2; done <<< "${leaked_procs}"
  fi
  if [ -n "${leaked_dirs}" ]; then
    while IFS= read -r line; do [ -n "${line}" ] && echo "  /tmp: ${line}" >&2; done <<< "${leaked_dirs}"
  fi
  exit 1
fi

echo "tmux-leak-scan: clean — no residual test tmux servers/dirs (scan scope: ${scan_desc})"
exit 0
