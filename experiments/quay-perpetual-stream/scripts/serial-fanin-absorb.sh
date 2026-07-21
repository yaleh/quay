#!/usr/bin/env bash
# serial-fanin-absorb.sh — thin wrapper over serial-fanin-absorb.mjs (DIR-044 increment 3). Mirrors
# task-schema-check.sh shape. Computes the deterministic fan-in plan; the driver executes it.
#   Usage: serial-fanin-absorb.sh --counter <N> <builds-manifest.json>
#   Exit:  0 = plan computed; 2 = usage/environment error.
set -u
if [ "$#" -lt 3 ]; then echo "Usage: $0 --counter <N> <builds-manifest.json>" >&2; exit 2; fi
if ! command -v node >/dev/null 2>&1; then echo "ERROR: node required" >&2; exit 2; fi
node "$(dirname "$0")/serial-fanin-absorb.mjs" "$@"
exit $?
