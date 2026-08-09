#!/usr/bin/env bash
# supervisor-health.sh — the supervisor base layer's HEALTH check
# (tasks/gap-supervisor-base-layer-outside-sessions-architecture, ## Contract measure:
#   `bash <supervisor 健康检查>` stdout 的 alive 字段).
#
# Is the base layer present and alive OUTSIDE any Claude session? The base layer is the part
# of the loop that must NOT die with an agent session (SPEC-integration-architecture §2):
#   os-anchor timer      — the OS-level systemd USER timer that outlives every Claude session
#                          (step ① — gap-loop-has-no-os-level-anchor; a session death can never
#                          take the timer with it)
#   delivery adapter     — supervisor-deliver.sh (step ③ — the ONE delivery implementation)
#   pure delivery check  — transcript-delivery-check.ts (the delivery verdict)
#   observe adapter      — pane-state-classify.ts (busy/idle/blocked shape classifier)
#   session liveness     — session-liveness.sh (the per-project monitor)
#
# "alive" here is the Contract band: the base layer process does not die with an agent session.
# The os-anchor timer's presence is the direct evidence (a systemd unit is not owned by any
# Claude session); the script components' presence + executability is the machinery evidence.
#
# Output (Contract measure):
#   alive: true|false
#   os_anchor_timer=active|inactive|missing
#   deliver_adapter=present|missing
#   delivery_checker=present|missing
#   observe_adapter=present|missing
#   session_liveness=present|missing
#
# Exit: 0 = alive · 1 = not alive (a base component missing / timer inactive) · 2 = usage error
#
# Test seams (used by plugin/test/supervisor-health.test.mjs):
#   SUPERVISOR_HEALTH_ROOT=<repo-root>          override where the scripts live (default: this repo)
#   SUPERVISOR_HEALTH_SKIP_SYSTEMCTL=1          treat the os-anchor timer as 'active' without
#                                               calling systemctl (hermetic tests)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"
REPO_ROOT="${SUPERVISOR_HEALTH_ROOT:-$(cd "$SELF_DIR/../.." 2>/dev/null && pwd || echo "$SELF_DIR/../..")}"

OS_ANCHOR_TIMER="quay-os-anchor-watchdog.timer"

alive=1
declare -a lines

probe() {
  # probe <label> <path> — a component is present when the file exists. Executability matters
  # only for .sh scripts (invoked directly by bash); .ts modules are run via
  # `node --experimental-strip-types` and are not chmod +x in this repo.
  local label="$1" path="$2"
  if [ -f "$path" ]; then
    if [[ "$path" == *.sh ]] && [ ! -x "$path" ]; then
      lines+=("${label}=missing")
      alive=0
    else
      lines+=("${label}=present")
    fi
  else
    lines+=("${label}=missing")
    alive=0
  fi
}

# ── os-anchor timer (the "outlives any session" evidence) ────────────────────────────────────────
if [ "${SUPERVISOR_HEALTH_SKIP_SYSTEMCTL:-0}" = "1" ]; then
  lines+=("os_anchor_timer=active")
else
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-active "$OS_ANCHOR_TIMER" >/dev/null 2>&1; then
      lines+=("os_anchor_timer=active")
    else
      lines+=("os_anchor_timer=inactive")
      alive=0
    fi
  else
    # systemctl unavailable (headless container / minimal env) → the timer cannot be evidenced.
    # That is a real "cannot verify the anchor" state, not a false alive.
    lines+=("os_anchor_timer=missing")
    alive=0
  fi
fi

# ── machinery components ─────────────────────────────────────────────────────────────────────────
probe "deliver_adapter" "$REPO_ROOT/plugin/scripts/supervisor-deliver.sh"
probe "delivery_checker" "$REPO_ROOT/plugin/scripts/transcript-delivery-check.ts"
probe "observe_adapter" "$REPO_ROOT/plugin/scripts/pane-state-classify.ts"
probe "session_liveness" "$REPO_ROOT/plugin/scripts/session-liveness.sh"

# ── emit (Contract measure: the `alive` field on stdout) ─────────────────────────────────────────
if [ "$alive" = "1" ]; then
  echo "alive: true"
else
  echo "alive: false"
fi
for l in "${lines[@]:-}"; do
  echo "$l"
done

exit $(( 1 - alive ))
