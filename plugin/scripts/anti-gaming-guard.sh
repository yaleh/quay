#!/usr/bin/env bash
# anti-gaming-guard.sh — thin wrapper delegating to anti-gaming-guard.ts. The module IS the
# definition; the `.sh` wraps it for quay gate invocation.
#
# Usage:
#   anti-gaming-guard.sh --cov-source <machine|subjective> --cov-capped <true|false> \
#                         --cov-inflatable <true|false> --adjudication <pursue|abandon|fold|none> [--json]
#
# Exit codes: 0 = PASS (all checks pass); 1 = FAIL (one or more checks fail); 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 --cov-source <machine|subjective> --cov-capped <true|false> --cov-inflatable <true|false> --adjudication <pursue|abandon|fold|none> [--json]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/anti-gaming-guard.ts" "$@"
exit $?
