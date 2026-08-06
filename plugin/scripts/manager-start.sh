#!/usr/bin/env bash
# manager-start.sh — `quay manager start`: the manager layer's INDEPENDENT cold start
# (SPEC-manager-productization-2026-08-05, C4/C5; charter gap-manager-productization-five-constraints).
#
# C4 — independent cold start with NO project args: on a bare machine (zero projects, zero
#      sessions), this ONE command brings up the manager itself. It therefore accepts NO
#      project arguments — any positional is a usage error.
# C2 — home/state/identity NOT in any single project: everything lives under
#      $QUAY_GLOBAL_DIR/manager/ (default ${HOME}/.quay-global/manager), never under a project.
# C5 — separate from `manager adopt`: this starts the MANAGER; `adopt <root>` starts a PROJECT's
#      outer+inner. Two commands, never a parameterized super-command (SPEC §4.3 — lifecycle,
#      fault isolation, partial-alive semantics, and AC12b testability all require the split).
# AC5 — persistent anchor: installs its OWN systemd user unit (quay-manager-watchdog.timer +
#       .service), SEPARATE from the project os-anchor watchdog (which watches quay/meta-cc/
#       archguard outer sessions only). The systemd timer IS the non-session-scoped heartbeat —
#       the old */17 CronList heartbeat was session-scoped and silently died with the session
#       (SPEC §2.1: "看门人自己无人看门", the four crashes last night needing human restart).
#
# What it does (idempotent):
#   1. home        mkdir -p $QUAY_GLOBAL_DIR/manager/
#   2. session     create the independent tmux session `quay-manager` (never inside any project
#                  session), running the manager role's launch command (quay-launch.sh manager →
#                  `claude`, Anthropic default model, per plugin/skills/manager/SKILL.md §5).
#                  Already alive ⇒ in-place noop.
#   3. OS anchor   write + (optionally) install quay-manager-watchdog.{timer,service} — the
#                  manager's OWN unit, separate from the project watchdog. The timer fires
#                  manager-watchdog.sh periodically (heartbeat + re-spawn).
#   4. observer    mount the manager observer by the START flow (write observer config into
#                  $MANAGER_HOME/observer.conf — not human hand-mounting, SPEC §6).
#
# Usage:
#   manager-start.sh [--dry-run] [--status]
#     --dry-run   print the plan, change nothing (validation / tests)
#     --status    report current manager state (session/home/unit), change nothing
# Rejects ANY positional arg (C4 — accepts NO project args).
#
# Test seams (env):
#   MANAGER_HOME            override $QUAY_GLOBAL_DIR/manager (tests use a temp dir)
#   MANAGER_SESSION_NAME    override the session name (default quay-manager)
#   MANAGER_SKIP_TMUX=1     skip real tmux (hermetic tests)
#   MANAGER_SKIP_SYSTEMCTL=1  write unit files but skip systemctl (hermetic tests)
#   MANAGER_INSTALL_DIR     override ~/.config/quay/manager-anchor
#   MANAGER_SYSTEMD_USER_DIR  override ~/.config/systemd/user
#   TOPOLOGY_LAUNCH_CMD     override the manager window launch command (tests feed a harmless cmd)
#   TOPOLOGY_LOCK_DIR       override the single-flight lock dir (tests isolate it)
#
# Exit: 0 success · 1 failure · 2 usage error (incl. any project arg → C4).
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"

GLOBAL_DIR="${QUAY_GLOBAL_DIR:-${HOME:-/tmp}/.quay-global}"
MANAGER_HOME="${MANAGER_HOME:-${GLOBAL_DIR}/manager}"
SESSION_NAME="${MANAGER_SESSION_NAME:-quay-manager}"
INSTALL_DIR="${MANAGER_INSTALL_DIR:-${HOME:-/home/yale}/.config/quay/manager-anchor}"
SYSTEMD_USER_DIR="${MANAGER_SYSTEMD_USER_DIR:-${HOME:-/home/yale}/.config/systemd/user}"
SKIP_TMUX="${MANAGER_SKIP_TMUX:-0}"
SKIP_SYSTEMCTL="${MANAGER_SKIP_SYSTEMCTL:-0}"
DRY_RUN=0
STATUS=0

TIMER_UNIT="quay-manager-watchdog.timer"
SERVICE_UNIT="quay-manager-watchdog.service"
CONFIG_FILE="$INSTALL_DIR/manager-projects.conf"
INSTALLED_WATCHDOG="$INSTALL_DIR/manager-watchdog.sh"
LOG_FILE="$INSTALL_DIR/manager-watchdog.log"
INTERVAL_MIN="${MANAGER_WATCHDOG_INTERVAL_MIN:-5}"
WATCHDOG="$SELF_DIR/manager-watchdog.sh"

usage() {
  sed -n '1,60p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

log() { echo "manager-start: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --status)  STATUS=1; shift ;;
    --help|-h) usage ;;
    -*) echo "manager-start: unknown argument: $1 (expected --dry-run | --status)" >&2; exit 2 ;;
    *)
      # C4 — the manager cold start accepts NO project arguments. A positional here is exactly
      # the C5 violation the SPEC forbids (`manager start` ≠ `manager adopt`). Fail closed.
      echo "manager-start: ERROR: accepts NO project arguments (SPEC C4/C5) — 'manager start' starts the MANAGER; use 'manager adopt <root>' to start a project's outer+inner. Got: $1" >&2
      exit 2
      ;;
  esac
done

# ── status ──────────────────────────────────────────────────────────────────────────────────────────
if [ "$STATUS" = 1 ]; then
  echo "manager status:"
  echo "  home:     $MANAGER_HOME ($([ -d "$MANAGER_HOME" ] && echo present || echo absent))"
  if [ "$SKIP_TMUX" = "1" ]; then
    echo "  session:  skipped (MANAGER_SKIP_TMUX=1)"
  elif tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "  session:  $SESSION_NAME (alive)"
  else
    echo "  session:  $SESSION_NAME (absent)"
  fi
  if [ "$SKIP_SYSTEMCTL" = "1" ]; then
    echo "  unit:     skipped (MANAGER_SKIP_SYSTEMCTL=1)"
  elif systemctl --user list-timers "$TIMER_UNIT" >/dev/null 2>&1; then
    echo "  unit:     $TIMER_UNIT (active)"
  else
    echo "  unit:     $TIMER_UNIT (not installed)"
  fi
  exit 0
fi

# ── 1. home ─────────────────────────────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  echo "would-create-home: mkdir -p $MANAGER_HOME"
else
  mkdir -p "$MANAGER_HOME" || die "cannot create manager home $MANAGER_HOME"
  log "home ready: $MANAGER_HOME"
fi

# ── 2. independent session (C2 identity — never inside any project session) ─────────────────────────
LAUNCH_CMD="${TOPOLOGY_LAUNCH_CMD:-bash $REPO_ROOT/plugin/scripts/quay-launch.sh manager}"
SESSION_ALIVE=0
if [ "$SKIP_TMUX" != "1" ] && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  SESSION_ALIVE=1
fi

if [ "$DRY_RUN" = 1 ]; then
  if [ "$SESSION_ALIVE" = 1 ]; then
    echo "in-place: $SESSION_NAME (already alive)"
  else
    echo "would-start: tmux new-session -d -s $SESSION_NAME -n manager \"$LAUNCH_CMD\""
  fi
elif [ "$SESSION_ALIVE" = 1 ]; then
  log "$SESSION_NAME already alive — in-place (idempotent)"
else
  if [ "$SKIP_TMUX" = "1" ]; then
    log "MANAGER_SKIP_TMUX=1 — skipped creating session (would run: $LAUNCH_CMD)"
  else
    tmux new-session -d -s "$SESSION_NAME" -n manager "$LAUNCH_CMD" \
      || die "cannot create manager session $SESSION_NAME"
    log "started $SESSION_NAME session (independent of any project session)"
  fi
fi

# ── 3. own OS anchor (AC5 — the persistent anchor, separate from the project watchdog) ──────────────
if [ "$DRY_RUN" = 1 ]; then
  echo "would-write-unit: $SERVICE_UNIT + $TIMER_UNIT (interval ${INTERVAL_MIN}min)"
else
  if [ ! -x "$WATCHDOG" ]; then
    echo "manager-start: WARNING: $WATCHDOG missing — skipping OS anchor install (manager runs session-scoped only)" >&2
  else
    mkdir -p "$INSTALL_DIR" "$SYSTEMD_USER_DIR" || die "cannot create manager anchor dirs"
    cp "$WATCHDOG" "$INSTALLED_WATCHDOG" || die "cannot copy watchdog to $INSTALLED_WATCHDOG"
    chmod +x "$INSTALLED_WATCHDOG"
    # config: the manager project registry (adopt writes here); starts empty.
    if [ ! -f "$CONFIG_FILE" ]; then
      printf '# manager-projects.conf — adopted projects (written by quay manager adopt)\n# format: name|root|tmux-session|drive-text\n' > "$CONFIG_FILE"
    fi
    local_user_bin="${HOME:-/home/yale}/.local/bin"
    cat > "$SYSTEMD_USER_DIR/$SERVICE_UNIT" <<EOF
[Unit]
Description=quay manager watchdog (session liveness + re-spawn, one shot)
Documentation=https://github.com/yaleh/quay

[Service]
Type=oneshot
Environment=PATH=$local_user_bin:/usr/local/go/bin:/home/yale/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=${HOME:-/home/yale}
ExecStart=$INSTALLED_WATCHDOG --run --config $CONFIG_FILE --log $LOG_FILE
EOF
    cat > "$SYSTEMD_USER_DIR/$TIMER_UNIT" <<EOF
[Unit]
Description=quay manager watchdog timer (periodic session liveness + re-spawn)
Documentation=https://github.com/yaleh/quay

[Timer]
OnBootSec=${INTERVAL_MIN}min
OnUnitActiveSec=${INTERVAL_MIN}min
Persistent=true

[Install]
WantedBy=timers.target
EOF
    log "wrote $SERVICE_UNIT + $TIMER_UNIT (interval ${INTERVAL_MIN}min, OWN unit separate from project os-anchor)"
    if [ "$SKIP_SYSTEMCTL" = "1" ]; then
      log "MANAGER_SKIP_SYSTEMCTL=1 — wrote files, skipped systemctl (hermetic)"
    else
      systemctl --user daemon-reload 2>/dev/null \
        || log "WARN: systemctl --user daemon-reload failed — is the user manager running?"
      systemctl --user enable --now "$TIMER_UNIT" 2>/dev/null \
        || log "WARN: enable --now $TIMER_UNIT failed (check user manager)"
      if systemctl --user list-timers "$TIMER_UNIT" >/dev/null 2>&1; then
        log "installed + active: $TIMER_UNIT (non-session-scoped heartbeat)"
      else
        log "installed files; verify with: systemctl --user list-timers"
      fi
    fi
  fi
fi

# ── 4. observer config (mounted by the start flow, not human hand-mounting) ─────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  echo "would-write-observer: $MANAGER_HOME/observer.conf"
else
  printf 'session=%s\nhome=%s\nwatchdog_unit=%s\nheartbeat=%s\n' \
    "$SESSION_NAME" "$MANAGER_HOME" "$TIMER_UNIT" "systemd-timer(${INTERVAL_MIN}min)" \
    > "$MANAGER_HOME/observer.conf"
  log "observer mounted: $MANAGER_HOME/observer.conf (heartbeat=$TIMER_UNIT, non-session-scoped)"
fi

# ── 5. action log (AC7 operational definition: adopt-after actions-count=0 is measurable here) ──────
if [ "$DRY_RUN" = 1 ]; then
  echo "would-init-actions-log: $MANAGER_HOME/actions.jsonl"
else
  [ -f "$MANAGER_HOME/actions.jsonl" ] || printf '{"ts":0,"event":"log-init","origin":"manager"}\n' > "$MANAGER_HOME/actions.jsonl" 2>/dev/null || true
fi

echo "quay-manager: started (session=$SESSION_NAME, home=$MANAGER_HOME)"
exit 0
