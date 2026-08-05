#!/usr/bin/env bash
# tmux-leak-scan.sh — SUITE-TAIL residual-leak assertion (AC1 of
# gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
#
# After a test run, NO tmux server process and NO /tmp dir carrying a test characteristic prefix
# (skv- / session-liveness- / ol-tok- / enter-repro-) may remain. This is the SECOND line of
# defense — the teardown fix (kill-session -t <name>, never kill-server) is primary; this scan
# covers the whole leak class at once and makes "the leak is gone" mechanically checkable.
#
# Why these prefixes (task body 更正 2026-08-05 08:55Z): the leak sources observed on the manager
# box were skv- (send-keys-verified), session-liveness- (session-liveness probes), ol-tok- (the
# token-counter probe session), and enter-repro- (the enter-repro fixture).
#
# Exit 0 = clean; exit 1 = residual leaks found (names printed to stderr). Never invokes `tmux`
# (a client call could itself be the only tmux process alive); scans `pgrep`/`ls` snapshots only.
set -uo pipefail

prefixes='skv-|session-liveness-|ol-tok-|enter-repro-'

# 1. tmux server processes whose argv carries a test characteristic prefix. A tmux SERVER's argv
#    (Linux) retains the creating command, so a leaked server appears as e.g.
#    `tmux new-session -d -s skv-ok bash`.
leaked_procs=""
if command -v pgrep >/dev/null 2>&1; then
  leaked_procs="$(pgrep -a tmux 2>/dev/null | grep -E "${prefixes}" || true)"
fi

# 2. /tmp dirs carrying a test characteristic prefix (the socket dirs the leaks leave behind).
leaked_dirs="$(ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/ol-tok-* /tmp/enter-repro-* 2>/dev/null || true)"

if [ -n "${leaked_procs}" ] || [ -n "${leaked_dirs}" ]; then
  echo "tmux-leak-scan: FAIL — residual test tmux servers/dirs after the run (prefixes: skv-|session-liveness-|ol-tok-|enter-repro-):" >&2
  if [ -n "${leaked_procs}" ]; then
    while IFS= read -r line; do [ -n "${line}" ] && echo "  tmux: ${line}" >&2; done <<< "${leaked_procs}"
  fi
  if [ -n "${leaked_dirs}" ]; then
    while IFS= read -r line; do [ -n "${line}" ] && echo "  /tmp: ${line}" >&2; done <<< "${leaked_dirs}"
  fi
  exit 1
fi

echo "tmux-leak-scan: clean — no residual test tmux servers/dirs (prefixes: skv-|session-liveness-|ol-tok-|enter-repro-)"
exit 0
