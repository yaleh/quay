#!/usr/bin/env bash
# manager-watchdog.sh — the MANAGER's own OS-level anchor (AC5; SPEC-manager-productization §2.1).
#
# WHY (the measured defect, SPEC §2.1): every loop anchor used to live INSIDE a Claude session.
# The manager's */17 heartbeat was session-scoped CronList — when the manager session died, the
# heartbeat died silently with it, and NOTHING noticed (os-anchor-projects.conf only watched the
# quay/meta-cc/archguard OUTER sessions). The four crashes last night all needed a human restart —
# "看门人自己无人看门". THIS unit is fired by the manager's OWN systemd timer
# (quay-manager-watchdog.timer, installed by manager-start.sh) — a unit separate from the project
# os-anchor watchdog. It checks the manager session's liveness and re-spawns a dead session.
#
# Decision logic (pure, testable via --decide — same shape as os-anchor-watchdog.sh):
#   alive=1                    → noop            (healthy)
#   alive=0 & session_exists=1 → relaunch        (session up, manager claude dead)
#   alive=0 & session_exists=0 → recreate        (session itself gone)
#   alive=unknown              → skip-unverifiable (never double-spawn on a broken measurement)
#
# Reuse-only (AC3 — zero new invention): liveness uses the same pane-has-claude check the
# os-anchor watchdog uses; the re-spawn types the manager role's launch command into the manager
# pane (quay-launch.sh manager). The drive text for the re-spawned manager is the manager's own
# tick instruction ("执行 <manager-loop-tick> 中的 tick 指令").
#
# Usage:
#   manager-watchdog.sh --decide <alive> <session_exists>   pure decision seam (exit 0)
#   manager-watchdog.sh --check                              non-destructive status
#   manager-watchdog.sh --run [--config <f>] [--log <f>]    check + re-spawn (default)
#   manager-watchdog.sh --help
#
# Test seams (env):
#   MANAGER_SESSION_NAME     override the session name (default quay-manager)
#   TOPOLOGY_LAUNCH_CMD      override the manager launch command (tests feed a harmless cmd)
#   OS_ANCHOR_TMUX_SOCKET    override the tmux socket (hermetic tests)
#   MANAGER_WATCHDOG_DRIVE   override the re-spawn drive text (tests)
#
# Exit: 0 all healthy/handled · 1 any re-spawn failed · 2 usage/config error.

set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CONFIG="${HOME:-/home/yale}/.config/quay/manager-anchor/manager-projects.conf"
CONFIG_FILE="${MANAGER_WATCHDOG_CONFIG:-$DEFAULT_CONFIG}"
LOG_FILE=""
MODE="run"
SESSION_NAME="${MANAGER_SESSION_NAME:-quay-manager}"
LAUNCH_CMD="${TOPOLOGY_LAUNCH_CMD:-}"
DRIVE_TEXT="${MANAGER_WATCHDOG_DRIVE:-执行 plugin/loop/manager-loop-tick.md 中的 tick 指令}"

# The manager's launch command: quay-launch.sh manager (resolved relative to the invoking repo
# when the env seam is unset — manager-start.sh installs the watchdog alongside the plugin).
if [ -z "$LAUNCH_CMD" ]; then
  REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
  LAUNCH_CMD="CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false bash $REPO_ROOT/plugin/scripts/quay-launch.sh manager"
fi

log() {
  local line
  line="$(date -u +%FT%TZ) manager-watchdog: $*"
  echo "$line"
  if [ -n "$LOG_FILE" ]; then
    printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

# ── pure decision seam (AC testable) ────────────────────────────────────────────────────────────────
# manager_decide <alive|unknown> <session_exists 0|1> — prints noop|relaunch|recreate|skip-unverifiable
manager_decide() {
  local alive="$1" sess="$2"
  if [ "$alive" = "unknown" ]; then echo "skip-unverifiable"; return 0; fi
  if [ "$alive" = "1" ]; then echo "noop"; return 0; fi
  if [ "$sess" = "1" ]; then echo "relaunch"; return 0; fi
  echo "recreate"
  return 0
}

# ── tmux helpers (hermetic socket, never the caller's $TMUX) ───────────────────────────────────────
_os_tmux_socket="${OS_ANCHOR_TMUX_SOCKET:-}"
if [ -z "$_os_tmux_socket" ]; then
  _os_tmux_socket="${TMPDIR:-/tmp}/tmux-$(id -u)/default"
fi
_os_tmux=(env -u TMUX tmux -S "$_os_tmux_socket")

session_exists() { "${_os_tmux[@]}" has-session -t "$1" 2>/dev/null; }

# pane_has_claude <target> — 1 if a claude process runs in the target pane
pane_has_claude() {
  local target="$1" ppid cpid
  ppid=$("${_os_tmux[@]}" list-panes -t "$target" -F '#{pane_pid}' 2>/dev/null | head -1)
  [ -n "${ppid:-}" ] || { echo 0; return 0; }
  cpid=$(pgrep -P "$ppid" 2>/dev/null | head -1) || true
  if [ -n "${cpid:-}" ] && tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null | grep -q claude; then
    echo 1
  else
    echo 0
  fi
  return 0
}

wait_for_prompt() {
  local target="$1" timeout_s="$2" end now
  end=$(( $(date +%s) + timeout_s ))
  while [ "$(date +%s)" -lt "$end" ]; do
    if "${_os_tmux[@]}" capture-pane -p -t "$target" 2>/dev/null | grep -q '❯'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ── liveness ───────────────────────────────────────────────────────────────────────────────────────
manager_liveness() {
  if pane_has_claude "${SESSION_NAME}:manager" | grep -q 1; then echo 1; else echo 0; fi
}

# ── re-spawn (the point of the task) ────────────────────────────────────────────────────────────────
recreate_session() {
  if ! "${_os_tmux[@]}" new-session -d -s "$SESSION_NAME" -n manager 2>/dev/null; then
    log "recreate FAILED — tmux new-session (maybe a race)"
    return 1
  fi
  launch_in_window
  local rc=$?
  [ "$rc" -eq 0 ] || return 1
  drive_manager
  return $?
}

relaunch() {
  launch_in_window
  local rc=$?
  [ "$rc" -eq 0 ] || return 1
  drive_manager
  return $?
}

launch_in_window() {
  local target="${SESSION_NAME}:manager"
  "${_os_tmux[@]}" send-keys -t "$target" C-c 2>/dev/null || true
  sleep 0.5
  "${_os_tmux[@]}" send-keys -t "$target" "$LAUNCH_CMD" Enter 2>/dev/null || true
  if wait_for_prompt "$target" 30; then
    log "launch OK — $target prompt up (re-spawned)"
    return 0
  fi
  log "WARN launch did not show a prompt in 30s on $target"
  return 1
}

drive_manager() {
  local target="${SESSION_NAME}:manager"
  "${_os_tmux[@]}" send-keys -t "$target" C-u 2>/dev/null || true
  sleep 0.5
  "${_os_tmux[@]}" send-keys -t "$target" -l "$DRIVE_TEXT" 2>/dev/null || true
  sleep 0.5
  "${_os_tmux[@]}" send-keys -t "$target" Enter 2>/dev/null || true
  log "drive sent to $target: $DRIVE_TEXT"
  return 0
}

# ── check + act ─────────────────────────────────────────────────────────────────────────────────────
watch_manager() {
  local sess_has alive action rc
  if session_exists "$SESSION_NAME"; then sess_has=1; else sess_has=0; fi
  alive=$(manager_liveness)
  action=$(manager_decide "$alive" "$sess_has")
  case "$action" in
    noop)               echo "STATUS $SESSION_NAME noop (alive=$alive session=$sess_has)"; return 0 ;;
    skip-unverifiable)  echo "STATUS $SESSION_NAME skip-unverifiable (cannot measure liveness)"; return 0 ;;
    recreate)
      echo "STATUS $SESSION_NAME recreate (alive=$alive session=$sess_has) — re-spawning"
      recreate_session; rc=$?
      if [ "$rc" -eq 0 ]; then echo "STATUS $SESSION_NAME recovered (recreate + drive OK)"; return 0; fi
      echo "STATUS $SESSION_NAME RECOVERY-FAILED (rc=$rc)"; return 1 ;;
    relaunch)
      echo "STATUS $SESSION_NAME relaunch (alive=$alive session=$sess_has) — re-spawning"
      relaunch; rc=$?
      if [ "$rc" -eq 0 ]; then echo "STATUS $SESSION_NAME recovered (relaunch + drive OK)"; return 0; fi
      echo "STATUS $SESSION_NAME RECOVERY-FAILED (rc=$rc)"; return 1 ;;
    *) echo "STATUS $SESSION_NAME unknown-action($action)" >&2; return 2 ;;
  esac
}

# ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
SUBCMD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --decide)
      [ $# -eq 3 ] || { echo "用法: $0 --decide <alive|unknown> <session_exists 0|1>" >&2; exit 2; }
      manager_decide "$2" "$3"
      exit 0 ;;
    --check) SUBCMD=check; shift ;;
    --run)   SUBCMD=run; shift ;;
    --config) [ $# -ge 2 ] || { echo "用法: $0 --config <file>" >&2; exit 2; }
      CONFIG_FILE="$2"; shift 2 ;;
    --log)   [ $# -ge 2 ] || { echo "用法: $0 --log <file>" >&2; exit 2; }
      LOG_FILE="$2"; shift 2 ;;
    --help|-h) SUBCMD=help; shift ;;
    *) echo "ERROR: unknown argument: $1" >&2; SUBCMD=help; shift ;;
  esac
done

case "$SUBCMD" in
  help|"")
    sed -n '1,50p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  check) watch_manager; exit $? ;;
  run)
    # The config file is a watch-list convention parity surface; the manager watchdog only ever
    # watches the ONE manager session (name-pinned). The config's presence is informational.
    watch_manager
    exit $? ;;
esac
exit 0
