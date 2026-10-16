#!/usr/bin/env bash
# plugin/scripts/blocked-signal-check.sh — thin bash wrapper over inner-blocked-signal.ts's blocked-
# signal CONSUMPTION TIMEOUT / auto-upgrade (`--timeout`). Exists so the task's Contract invocation
# form `bash <blocked-signal-check.sh> --timeout` works literally (mirrors the cap-from-gate.sh /
# it0-*-check.sh wrapper convention), and a cron/watcher can ask "has a blocked signal gone stale?"
# without knowing the node incantation.
#
# What it does: a blocked signal (`.quay/inner-blocked.json` for target inner) that nobody consumes
# must not freeze inner forever (tonight's 92-minute false-block class). When the block is older than
# the escalation threshold (default 30m), it is auto-archived (升级/归档): the wait duration lands in
# telemetry, an escalation line is appended to `.quay/blocked-escalations.jsonl`, and the block file
# is removed. A fresh block is left untouched (the negative control — a consumed/young signal never
# escalates).
#
# Usage:
#   bash plugin/scripts/blocked-signal-check.sh --timeout [--max-age-ms N] [--root <dir>] [--target <name>]
#
# Exit codes: 0 = checked (escalated, not-stale, or no-block); 2 = usage error. On escalation, stdout
# carries a 升级/归档/escalate keyword line — the Contract measure
# `bash <blocked-signal-check.sh> --timeout 2>&1 | grep -c '升级|归档|escalate'` reads >= 1.
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TIMEOUT=0
MAX_AGE_MS=""
ROOT_ARG=""
TARGET_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) TIMEOUT=1 ;;
    --max-age-ms) MAX_AGE_MS="${2:-}"; shift ;;
    --root) ROOT_ARG="${2:-}"; shift ;;
    --target) TARGET_ARG="${2:-}"; shift ;;
    -h|--help) echo "Usage: bash $0 --timeout [--max-age-ms N] [--root <dir>] [--target <name>]" >&2; exit 0 ;;
    *) echo "blocked-signal-check: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$TIMEOUT" != "1" ]; then
  echo "blocked-signal-check: --timeout is required (this wrapper checks the blocked-signal consumption timeout)" >&2
  exit 2
fi

ARGS=(--timeout)
[ -n "$MAX_AGE_MS" ] && ARGS+=(--max-age-ms "$MAX_AGE_MS")
[ -n "$ROOT_ARG" ] && ARGS+=(--root "$ROOT_ARG")
[ -n "$TARGET_ARG" ] && ARGS+=(--target "$TARGET_ARG")

exec node "$SCRIPT_DIR/dist/inner-blocked-signal.js" "${ARGS[@]}"
