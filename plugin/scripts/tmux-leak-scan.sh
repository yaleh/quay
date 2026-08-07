#!/usr/bin/env bash
# tmux-leak-scan.sh — SUITE-TAIL residual-leak assertion (AC1 of
# gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
#
# After a test run, NO tmux server process and NO /tmp dir carrying a test characteristic prefix
# (skv- / session-liveness- / ol-tok- / enter-repro-) may remain. This is the SECOND line of
# defense — the teardown fix (kill-session -t <name>, never kill-server) is primary; this scan
# covers the whole leak class at once and makes "the leak is gone" mechanically checkable.
#
# Why these prefixes (task body 更正 2026-08-05 08:55Z + cross-host reproduction 2026-08-06):
# the leak sources observed were skv- (send-keys-verified), session-liveness-/ol-* (session-liveness
# probes — the server argv carries the SESSION name `-s ol-halt` etc., not the tmpdir prefix),
# enter-repro- (the enter-repro fixture), and the cross-host-found family quay-sb-/sb-*,
# quay-topo-/topo-*, quay-isc-/isc-factory (session-bootstrap / session-topology /
# inner-session-check factory-built sessions).
#
# Process scan is SESSION-NAME anchored (`-s <prefix>`): a leaked tmux SERVER's argv retains the
# creating `tmux new-session -d -s <name>` command, so matching the session name is precise. A bare
# `ol-`/`sb-` grep would FALSE-POSITIVE on unrelated sockets (e.g. /tmp/tmuxisol-ac2-* contains
# "sol-"); anchoring to the `-s <name>` position keeps it to the test session families.
#
# Exit 0 = clean; exit 1 = residual leaks found (names printed to stderr). Never invokes `tmux`
# (a client call could itself be the only tmux process alive); scans `pgrep`/`ls` snapshots only.
set -uo pipefail

# session-name prefixes of the hermetic test helpers/factories (appear as `-s <name>` in argv).
leaked_procs=""
if command -v pgrep >/dev/null 2>&1; then
  leaked_procs="$(pgrep -a tmux 2>/dev/null | grep -E -- "-s (skv|ol|topo|isc|sb|enter-repro)-" || true)"
fi

# 2. /tmp dirs carrying a test characteristic prefix (the socket dirs the leaks leave behind).
leaked_dirs="$(ls -d /tmp/skv-* /tmp/session-liveness-* /tmp/ol-prod-* /tmp/enter-repro-* \
  /tmp/quay-sb-* /tmp/quay-topo-* /tmp/quay-isc-* /tmp/quay-init-tmux-* 2>/dev/null || true)"

if [ -n "${leaked_procs}" ] || [ -n "${leaked_dirs}" ]; then
  echo "tmux-leak-scan: FAIL — residual test tmux servers/dirs after the run (session names: skv-|ol-|topo-|isc-|sb-|enter-repro-; /tmp: skv-|session-liveness-|ol-prod-|enter-repro-|quay-sb-|quay-topo-|quay-isc-|quay-init-tmux-):" >&2
  if [ -n "${leaked_procs}" ]; then
    while IFS= read -r line; do [ -n "${line}" ] && echo "  tmux: ${line}" >&2; done <<< "${leaked_procs}"
  fi
  if [ -n "${leaked_dirs}" ]; then
    while IFS= read -r line; do [ -n "${line}" ] && echo "  /tmp: ${line}" >&2; done <<< "${leaked_dirs}"
  fi
  exit 1
fi

echo "tmux-leak-scan: clean — no residual test tmux servers/dirs (session names: skv-|ol-|topo-|isc-|sb-|enter-repro-; /tmp: skv-|session-liveness-|ol-prod-|enter-repro-|quay-sb-|quay-topo-|quay-isc-|quay-init-tmux-)"
exit 0
