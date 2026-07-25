#!/usr/bin/env bash
# drivable-workspace-check.sh — thin wrapper delegating to drivable-workspace-check.ts (module IS
# the definition; mirrors the it0-dod-check.sh/.ts wrapper shape).
#
# Usage:
#   drivable-workspace-check.sh <path> [<path> ...] [--registry <file>]
#
# Exit codes: 0 = all paths covered; 1 = at least one path NOT covered; 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path> [<path> ...] [--registry <file>]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/drivable-workspace-check.ts" "$@"
exit $?
