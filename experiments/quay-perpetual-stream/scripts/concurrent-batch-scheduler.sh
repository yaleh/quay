#!/usr/bin/env bash
# concurrent-batch-scheduler.sh — thin wrapper over concurrent-batch-scheduler.mjs (DIR-044 increment
# 2). Mirrors task-schema-check.sh shape. A future `quay gate`/loop-driver invocation WRAPS the same
# module — never reimplements the assembly policy.
#   Usage: concurrent-batch-scheduler.sh [--root <dir>] <charter1.md> [charter2.md ...]
#   Exit:  0 = batch assembled (inspect stdout); 2 = usage/environment error.
set -u
if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--root <dir>] <charter1.md> [charter2.md ...]" >&2; exit 2
fi
if ! command -v node >/dev/null 2>&1; then echo "ERROR: node required" >&2; exit 2; fi
node "$(dirname "$0")/concurrent-batch-scheduler.mjs" "$@"
exit $?
