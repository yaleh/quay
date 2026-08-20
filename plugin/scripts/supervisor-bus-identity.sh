#!/usr/bin/env bash
# supervisor-bus-identity.sh — the supervisor base layer's IDENTITY interface
# (tasks/gap-supervisor-message-bus-with-identity, supervisor step ⑤).
#
# The supervisor bus/inbox mechanism has been RETIRED
# (tasks/gap-inbox-message-bus-teardown, 人 2026-08-20 裁定范围A). The human retains this
# script as the control-plane identity shell — its usage skeleton and identity framing stay,
# while the bus-dependent subcommands are retired.
# No functional subcommand remains: a bare invocation prints usage and exits 0.
#
# Usage:
#   bash supervisor-bus-identity.sh
#   bash supervisor-bus-identity.sh --help
#
# Exit: 0 = usage / help (no functional subcommand remains)
#       2 = an unknown subcommand was passed (fail loud)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' >&2
}

sub="${1:-}"
if [ -n "$sub" ]; then
  echo "supervisor-bus-identity: unknown subcommand: $sub (the bus-dependent subcommands are retired)" >&2
  usage
  exit 2
fi

usage
exit 0
