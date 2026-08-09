#!/usr/bin/env bash
# os-anchor-install.sh — install/remove the OS-level loop watchdog on THIS machine
# (tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash, AC1).
#
# ⚠ NOT A SHIPPED DELIVERABLE (human ruling 2026-08-06): a quay-development-stage tool,
# not part of the product's delivery build — quay-init.sh never calls this script. Run it
# ONLY on explicit human request, never as a side effect of an automated flow. See
# os-anchor-watchdog.sh's matching header for the incident that prompted this.
#
# The loop previously had ZERO OS-level anchor: every anchor lived inside a Claude
# session (session-scoped CronCreate/ScheduleWakeup) and died with it. This installer
# creates a systemd USER timer (does NOT die with any Claude session) that fires
# os-anchor-watchdog.sh periodically. The watchdog reuses ONLY validated capabilities
# (session-liveness.sh / send-keys-reliable.sh + transcript-delivery-check.ts + the
# validated cold-start drive text) to check each project's session liveness + anchor
# presence and re-spawn a dead session automatically.
#
# Design:
#   * The installed watchdog + config live under ~/.config/quay/os-anchor/ — a STABLE
#     location independent of any repo checkout or worktree, so the timer keeps
#     working after this branch lands and after worktrees are cleaned up.
#   * Idempotent: re-running `install` overwrites the watchdog copy + config and
#     rewrites the systemd files; it never creates duplicate timers.
#   * Removable: `uninstall` disables the timer/service and removes the install dir.
#
# Usage:
#   os-anchor-install.sh [install] [--interval <minutes>] [--add-project <root>]
#   os-anchor-install.sh uninstall
#   os-anchor-install.sh status
#   os-anchor-install.sh --help
#
# Test seams (used by plugin/test/os-anchor-watchdog.test.mjs):
#   OS_ANCHOR_INSTALL_DIR        override ~/.config/quay/os-anchor
#   OS_ANCHOR_SYSTEMD_USER_DIR   override ~/.config/systemd/user
#   OS_ANCHOR_SKIP_SYSTEMCTL=1   write files but skip `systemctl` (hermetic tests)
#
# Exit: 0 success · 1 failure · 2 usage error

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
WATCHDOG="$SELF_DIR/os-anchor-watchdog.sh"

INSTALL_DIR="${OS_ANCHOR_INSTALL_DIR:-${HOME:-/home/yale}/.config/quay/os-anchor}"
SYSTEMD_USER_DIR="${OS_ANCHOR_SYSTEMD_USER_DIR:-${HOME:-/home/yale}/.config/systemd/user}"
SKIP_SYSTEMCTL="${OS_ANCHOR_SKIP_SYSTEMCTL:-0}"

# LAUNCH_CMD — the ONE place the watchdog relaunch command string lives
# (gap-os-anchor-watchdog-launch-missing-prompt-suggestions AC2: single-source to kill the
#  two-place double-drift the crystallize task noted; both default_projects() and --add-project
#  reference it). Carries the REQUIRED cold-start params per restart-plan §8
#  (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false): the
#  `--prompt-suggestions false` flag AND the `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`
#  env prefix — so a watchdog-relaunched session never regresses to ghost-suggestion-on.
LAUNCH_CMD="CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude-deepseek --model deepseek-v4-flash --permission-mode bypassPermissions --prompt-suggestions false"

TIMER_UNIT="quay-os-anchor-watchdog.timer"
SERVICE_UNIT="quay-os-anchor-watchdog.service"
CONFIG_FILE="$INSTALL_DIR/os-anchor-projects.conf"
INSTALLED_WATCHDOG="$INSTALL_DIR/os-anchor-watchdog.sh"
LOG_FILE="$INSTALL_DIR/watchdog.log"
INTERVAL_MIN=5

log() { echo "os-anchor-install: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# default_projects — emit the config entries the installer knows about. On THIS
# machine that is the repo the installer is invoked from (quay) plus the sibling
# meta-cc and archguard workspaces when they exist (AC4: three projects in scope).
# `--add-project <root>` appends one more.
default_projects() {
  local root="$REPO_ROOT" name session outer launch drive slug
  local -a lines=()

  # quay (the invoking repo)
  name="$(basename "$root")"
  session=$(awk -F= '/^SESSION_TMUX_SESSION=/{print $2; exit}' "$root/orchestration/session-liveness.env" 2>/dev/null || true)
  [ -n "$session" ] || session="${name}-0"
  launch="$LAUNCH_CMD"
  if [ -f "$root/plugin/loop/orchestrator-loop-tick.md" ]; then
    drive="执行 $root/plugin/loop/orchestrator-loop-tick.md 中的 tick 指令"
  else
    drive="执行 $root/orchestration/orchestrator-loop-tick.md 中的 tick 指令"
  fi
  lines+=("${name}|${root}|${session}|outer|${launch}|${drive}|")

  # siblings (meta-cc, archguard) — quay-init'd targets with the tick doc in orchestration/
  for sibling in "$HOME/work/meta-cc" "$HOME/work/archguard"; do
    if [ -d "$sibling/plugin/scripts" ] && [ -f "$sibling/orchestration/session-liveness.env" ]; then
      name="$(basename "$sibling")"
      session=$(awk -F= '/^SESSION_TMUX_SESSION=/{print $2; exit}' "$sibling/orchestration/session-liveness.env" 2>/dev/null || true)
      [ -n "$session" ] || session="${name}-0"
      if [ -f "$sibling/orchestration/orchestrator-loop-tick.md" ]; then
        drive="执行 $sibling/orchestration/orchestrator-loop-tick.md 中的 tick 指令"
      else
        drive="执行 $sibling/plugin/loop/orchestrator-loop-tick.md 中的 tick 指令"
      fi
      lines+=("${name}|${sibling}|${session}|outer|${launch}|${drive}|")
    fi
  done

  printf '%s\n' "${lines[@]}"
}

# write_config — merge existing config (preserve manual edits) with the default set:
# every default entry present, existing entries kept, nothing duplicated by name.
write_config() {
  mkdir -p "$INSTALL_DIR" || die "cannot create install dir $INSTALL_DIR"
  local tmp default_lines=()
  mapfile -t default_lines < <(default_projects)
  local line name
  # start from the existing config if present (preserves --add-project entries)
  if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
  fi
  local merged="$INSTALL_DIR/os-anchor-projects.conf.new"
  : > "$merged"
  printf '# os-anchor-projects.conf — generated by os-anchor-install.sh on %s\n' "$(date -u +%Y-%m-%d)" > "$merged"
  printf '# format: name|root|tmux-session|outer-window|launch-cmd|drive-text|transcript\n' >> "$merged"
  local seen=""
  # defaults first
  for line in "${default_lines[@]}"; do
    name="${line%%|*}"
    printf '%s\n' "$line" >> "$merged"
    seen="${seen} ${name}"
  done
  # then preserve any existing entries not already covered (e.g. --add-project)
  if [ -f "$CONFIG_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|\#*) continue ;; esac
      name="${line%%|*}"
      case " $seen " in *" $name "*) continue ;; esac
      printf '%s\n' "$line" >> "$merged"
      seen="${seen} ${name}"
    done < "$CONFIG_FILE"
  fi
  mv "$merged" "$CONFIG_FILE"
  rm -f "$CONFIG_FILE.bak"
}

# write_systemd — emit the timer + service unit files for `systemctl --user`.
write_systemd() {
  mkdir -p "$SYSTEMD_USER_DIR" || die "cannot create systemd user dir $SYSTEMD_USER_DIR"
  local service="$SYSTEMD_USER_DIR/$SERVICE_UNIT"
  local timer="$SYSTEMD_USER_DIR/$TIMER_UNIT"
  # PATH must reach ~/.local/bin (claude-deepseek) and the tools the watchdog uses.
  local user_bin="${HOME:-/home/yale}/.local/bin"
  cat > "$service" <<EOF
[Unit]
Description=quay OS-level loop watchdog (session liveness + anchor check, one shot)
Documentation=https://github.com/yaleh/quay

[Service]
Type=oneshot
Environment=PATH=$user_bin:/usr/local/go/bin:/home/yale/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=${HOME:-/home/yale}
ExecStart=$INSTALLED_WATCHDOG --run --config $CONFIG_FILE --log $LOG_FILE
EOF
  cat > "$timer" <<EOF
[Unit]
Description=quay OS-level loop watchdog timer (periodic session liveness + anchor check)
Documentation=https://github.com/yaleh/quay

[Timer]
OnBootSec=${INTERVAL_MIN}min
OnUnitActiveSec=${INTERVAL_MIN}min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  log "wrote $service"
  log "wrote $timer (interval ${INTERVAL_MIN}min)"
}

do_install() {
  [ -x "$WATCHDOG" ] || die "watchdog script missing: $WATCHDOG"
  mkdir -p "$INSTALL_DIR" || die "cannot create install dir $INSTALL_DIR"
  cp "$WATCHDOG" "$INSTALLED_WATCHDOG" || die "cannot copy watchdog to $INSTALLED_WATCHDOG"
  chmod +x "$INSTALLED_WATCHDOG"
  write_config
  write_systemd
  if [ "$SKIP_SYSTEMCTL" = "1" ]; then
    log "OS_ANCHOR_SKIP_SYSTEMCTL=1 — wrote files, skipped systemctl (hermetic)"
    return 0
  fi
  if ! systemctl --user daemon-reload 2>/dev/null; then
    log "WARN: systemctl --user daemon-reload failed — is the user manager running?"
  fi
  systemctl --user enable --now "$TIMER_UNIT" 2>/dev/null \
    || log "WARN: enable --now $TIMER_UNIT failed (check user manager)"
  if systemctl --user list-timers "$TIMER_UNIT" >/dev/null 2>&1; then
    log "installed + active: systemctl --user list-timers shows $TIMER_UNIT"
  else
    log "installed files; verify with: systemctl --user list-timers"
  fi
  log "config: $CONFIG_FILE"
  log "log:    $LOG_FILE"
  log "to remove: os-anchor-install.sh uninstall"
  return 0
}

do_uninstall() {
  if [ "$SKIP_SYSTEMCTL" != "1" ]; then
    systemctl --user disable --now "$TIMER_UNIT" 2>/dev/null || true
    systemctl --user disable --now "$SERVICE_UNIT" 2>/dev/null || true
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  rm -f "$SYSTEMD_USER_DIR/$TIMER_UNIT" "$SYSTEMD_USER_DIR/$SERVICE_UNIT"
  rm -rf "$INSTALL_DIR"
  log "uninstalled — timer/service removed, install dir removed"
  return 0
}

do_status() {
  echo "os-anchor status:"
  echo "  install dir:  $INSTALL_DIR"
  if [ -f "$CONFIG_FILE" ]; then
    echo "  config:"
    sed 's/^/    /' "$CONFIG_FILE" | grep -v '^    #'
  else
    echo "  config:      (absent — not installed)"
  fi
  if [ "$SKIP_SYSTEMCTL" = "1" ]; then
    echo "  systemd:     skipped (OS_ANCHOR_SKIP_SYSTEMCTL=1)"
  else
    systemctl --user list-timers "$TIMER_UNIT" 2>/dev/null | sed 's/^/  timer: /'
    echo "  --"
    systemctl --user list-timers --all 2>/dev/null | grep -c quay | sed 's/^/  quay-timer-count: /'
  fi
  if [ -f "$LOG_FILE" ]; then
    echo "  last log lines:"
    tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
  fi
  return 0
}

# ── CLI ─────────────────────────────────────────────────────────────────────────
ACTION=install
while [ $# -gt 0 ]; do
  case "$1" in
    install) ACTION=install; shift ;;
    uninstall) ACTION=uninstall; shift ;;
    status) ACTION=status; shift ;;
    --interval)
      [ $# -ge 2 ] || die "--interval <minutes> requires a value"
      case "$2" in *[!0-9]*) die "--interval must be a positive integer (minutes)" ;; esac
      INTERVAL_MIN="$2"; shift 2 ;;
    --add-project)
      [ $# -ge 2 ] || die "--add-project <root> requires a value"
      ADD_PROJECT="$2"; shift 2 ;;
    --help|-h)
      sed -n '1,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      log "ERROR: unknown argument: $1" >&2
      exit 2 ;;
  esac
done

if [ -n "${ADD_PROJECT:-}" ]; then
  # append (or keep) an explicitly requested project root in the config
  mkdir -p "$INSTALL_DIR"
  if [ -d "$ADD_PROJECT/plugin/scripts" ]; then
    local_name="$(basename "$ADD_PROJECT")"
    local_session=$(awk -F= '/^SESSION_TMUX_SESSION=/{print $2; exit}' "$ADD_PROJECT/orchestration/session-liveness.env" 2>/dev/null || true)
    [ -n "$local_session" ] || local_session="${local_name}-0"
    local_drive="执行 $ADD_PROJECT/orchestration/orchestrator-loop-tick.md 中的 tick 指令"
    local_line="${local_name}|${ADD_PROJECT}|${local_session}|outer|${LAUNCH_CMD}|${local_drive}|"
    if [ -f "$CONFIG_FILE" ]; then
      # avoid duplication by name
      if ! grep -q "^${local_name}|" "$CONFIG_FILE"; then
        printf '%s\n' "$local_line" >> "$CONFIG_FILE"
        log "added project $local_name ($ADD_PROJECT) to config"
      else
        log "$local_name already in config — leaving as-is"
      fi
    else
      write_config >/dev/null 2>&1 || true
      printf '%s\n' "$local_line" >> "$CONFIG_FILE"
      log "added project $local_name ($ADD_PROJECT) to config"
    fi
  else
    die "--add-project $ADD_PROJECT has no plugin/scripts — not a quay-init'd workspace"
  fi
  # fall through to install so the config is wired to a running timer
  ACTION=install
fi

case "$ACTION" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  status) do_status ;;
esac
exit 0
