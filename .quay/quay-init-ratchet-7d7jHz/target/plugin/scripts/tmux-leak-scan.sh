#!/usr/bin/env bash
# tmux-leak-scan.sh — SUITE-TAIL residual-leak assertion (AC1 of
# gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
#
# After a test run, NO tmux server process and NO /tmp dir carrying a test characteristic prefix
# (skv- / session-liveness- / ol-tok- / enter-repro- / quay-init-tmux- / quay-isc- / repro-rmsync-)
# may remain. The last three are the private-socket mkdtemp prefixes
# (gap-tmux-stale-not-honored-comment-private-socket-leak-scan) — `repro-rmsync-` is used over the
# bare `repro-` the AC named because `repro-` also matches ~25 human scratch files in /tmp (not
# test residue). This is the SECOND line of defense — the teardown fix (kill-session -t <name>,
# never kill-server) is primary; this scan covers the whole leak class at once and makes "the leak
# is gone" mechanically checkable.
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
#   tmux-leak-scan.sh --sweep <workspace-root>      # cure: reap matching servers + rm matching dirs
#   tmux-leak-scan.sh                               # absolute (historical): any match is a leak
#
# Exit 0 = clean; exit 1 = residual leaks found (names printed to stderr). The SCAN modes (snapshot/
# check/absolute) never invoke `tmux` (a client call could itself be the only tmux process alive) —
# they scan `pgrep`/`ls` snapshots only. `--sweep` is the exception: it invokes `tmux -S <socket>
# kill-server` to actually reap an orphaned server (socket-targeted, never an unqualified client).
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

prefixes='skv-|session-liveness-|ol-tok-|enter-repro-|quay-init-tmux-|quay-isc-|repro-rmsync-'

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
# --scope <dir> (gap-leak-residue-per-run-namespace-isolation 2026-08-13): override the scan scope
# to a TEST-LOCAL subroot. The default namespaced scope (/tmp/quay-run-<runId>/) is SHARED by every
# test in the suite, so leak-simulation tests see each other's fixtures as residue (round 131:
# tmux-leak-scan R2/R3 × test-isolation DELTA cross-flagged). A test passes --scope
# /tmp/quay-run-<runId>/leaktest-<pid>/ so the scan covers ONLY its own simulated leakage.
scope_dir=""
case "${1:-}" in
  --scope) scope_dir="${2:-}"; shift 2 ;;
esac
if [ -n "${scope_dir}" ]; then
  run_root="${scope_dir}"
fi
# Human-readable scan scope for messages (the run subtree when namespaced, else the prefix list).
scan_desc="${run_root}"
[ -n "${scan_desc}" ] || scan_desc="${prefixes}"

mode="absolute"
root=""
case "${1:-}" in
  --snapshot) mode="snapshot"; shift ;;
  --check)    mode="check";    shift ;;
  --sweep)    mode="sweep";    shift ;;
esac
if [ "$mode" != "absolute" ]; then
  if [ "$#" -lt 1 ]; then
    echo "tmux-leak-scan: usage: $0 [--snapshot|--check|--sweep] <workspace-root>" >&2
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
    leaked_dirs="$(ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/ol-tok-* /tmp/enter-repro-* /tmp/quay-init-tmux-* /tmp/quay-isc-* /tmp/repro-rmsync-* 2>/dev/null || true)"
  fi
  {
    [ -n "$leaked_procs" ] && printf '%s\n' "$leaked_procs"
    [ -n "$leaked_dirs" ] && printf '%s\n' "$leaked_dirs"
  } | grep -v '^$' | sort
}

# reap_wait_default — the HOST-DERIVED default reap-wait bound (gap-suite-leak-scan-ol-scd-g-
# teardown-slow). The suite's test-spawned tmux-server teardown latency scales with the MAIN-PHASE
# lane count (more lanes = more servers reaping concurrently under load), so a fixed 10000ms is a
# host-dependent constant (CLAUDE.md 硬规则 4 推论二). round 95 set 10000ms for a lighter load
# profile; under the current 16-lane load an ol-scd-g server still exits past 10000ms (4-round
# false-red, .prev -xie53B / 本轮 -D22itv). Default = max(10000, nproc × 2500): 4-core (historical)
# = 10000, 16-core = 40000. Reads the SAME nproc seam scripts/test.sh uses (RESOURCE_GATE_NPROC →
# nproc); TMUX_LEAK_REAP_WAIT_MS overrides the whole derivation for deterministic tests. A genuine
# leak never clears regardless of the bound, so widening only absorbs slow teardown — it never turns
# a leak green (AC2).
reap_wait_default() {
  local nproc_val
  nproc_val="${RESOURCE_GATE_NPROC:-$(nproc 2>/dev/null || echo 1)}"
  awk -v n="${nproc_val}" 'BEGIN { c = n * 2500; if (c < 10000) c = 10000; printf "%d", c }'
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
  # HOLD JUDGMENT and poll for up to the reap-wait bound (default reap_wait_default(), host-derived
  # — gap-suite-leak-scan-ol-scd-g-teardown-slow) — matches that clear within the bound were reaping
  # (transient), not a leak; only matches STILL PRESENT at the bound are a REAL leak. A genuine leak
  # (a server nobody killed) never clears, so the gate is NOT weakened — it only stops flagging
  # exit-in-progress. When the run is clean the first scan wins immediately (zero added latency).
  reap_wait_ms="${TMUX_LEAK_REAP_WAIT_MS:-$(reap_wait_default)}"
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

if [ "$mode" = "sweep" ]; then
  # --sweep (gap-tmux-leak-scan-sweep-orphaned-servers): the CURE for the orphan class --check can
  # only DETECT. A SIGKILL'd/panicked suite leaves hermetic tmux servers on their private sockets
  # (/tmp/quay-isc-* etc. — os.tmpdir()-direct mkdtemp) with no teardown left
  # to reap them (2026-08-29: pid 1406623 leaked 1h23m). Reuses scan_matches + prefixes (single
  # source of truth — sweep and scan never drift), but forces the LEGACY prefix scope: the run
  # namespace (/tmp/quay-run-<id>/) is empty at suite start (the runner's sweepRunNamespaces already
  # handles it), while the SIGKILL residue lives at /tmp/<prefix>*. An explicit --scope still
  # overrides (test confinement). Per match line: a proc line ("PID tmux -S <socket> ...") → extract
  # the socket and `tmux -S <socket> kill-server`; a dir line ("/tmp/<prefix>*") → rm -rf. best-effort:
  # exit 0 always (a failed cleanup never changes the verdict); idempotent (no orphans → no-op).
  if [ -z "$scope_dir" ]; then
    run_root=""
  fi
  scan_desc="${run_root}"
  [ -n "${scan_desc}" ] || scan_desc="${prefixes}"
  matches="$(scan_matches)"
  swept_servers=0
  swept_dirs=0
  # TWO PASSES, servers FIRST: scan_matches sorts its output, and `/` (dir lines) sorts BEFORE
  # `0-9` (proc lines) in ASCII — so a single sorted pass would `rm -rf` the socket dir before
  # kill-server could reach the server, leaving the server alive with its socket gone (删目录 ≠
  # 杀进程 — the exact orphan shape this task exists for). Pass 1 reaps every server while its
  # socket still exists; pass 2 then removes the dir lines.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      [0-9]*)   # proc line — "PID tmux -S <socket> ..."; reap that socket's server
        sock="$(printf '%s\n' "$line" | sed -nE 's/^[0-9]+ [^ ]* -S ([^ ]+).*/\1/p')"
        if [ -n "$sock" ] && command -v tmux >/dev/null 2>&1; then
          if tmux -S "$sock" kill-server >/dev/null 2>&1; then
            swept_servers=$((swept_servers + 1))
          fi
        fi
        ;;
    esac
  done <<< "$matches"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      /*)       # dir line — an absolute /tmp path; remove it (its server, if any, was reaped above)
        if rm -rf -- "$line" 2>/dev/null; then
          swept_dirs=$((swept_dirs + 1))
        fi
        ;;
    esac
  done <<< "$matches"
  echo "tmux-leak-scan: sweep — reaped ${swept_servers} orphaned server(s), removed ${swept_dirs} dir(s) (scan scope: ${scan_desc})"
  exit 0
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
  leaked_dirs="$(ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/ol-tok-* /tmp/enter-repro-* /tmp/quay-init-tmux-* /tmp/quay-isc-* /tmp/repro-rmsync-* 2>/dev/null || true)"
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
