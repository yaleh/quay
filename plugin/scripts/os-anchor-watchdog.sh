#!/usr/bin/env bash
# os-anchor-watchdog.sh — the OS-level anchor for the two-layer loop
# (tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash).
#
# ⚠ NOT A SHIPPED DELIVERABLE (human ruling 2026-08-06): this is a quay-development-stage
# tool, not part of the product's delivery build. quay-init.sh never installs or invokes it
# (verified: 0 references). It requires an EXPLICIT human decision to install/enable —
# never install, enable, or re-enable it as a side effect of any automated flow (dispatch,
# cold-start, upgrade). The systemd unit was disabled 2026-08-06 after it revived a
# deliberately-decommissioned target (absence-inference cannot distinguish "crashed" from
# "intentionally stopped" — see tasks/gap-os-anchor-watchdog-lease-model-instead-of-
# absence-inference.md, already-diagnosed, not yet fixed). Files are kept on disk for
# reference/future use, not deleted.
#
# WHY (the measured defect, 2026-08-05): every loop anchor lived INSIDE a Claude
# session (CronCreate / ScheduleWakeup are session-scoped). A machine crash killed
# the session AND the anchor with it — the dead loop then looked IDENTICAL to a
# healthy one (all delivery-surface checks passed, last ticks self-reported
# healthy; meta-cc/archguard stalled 29h and nobody drove). Recovery was manual.
# THIS script is the anchor that lives OUTSIDE any Claude session: a systemd user
# timer (installed by os-anchor-install.sh) fires it periodically; it checks each
# project's session liveness + anchor presence and — when a session is missing —
# re-spawns the outer Claude session and drives the validated cold-start text.
#
# REUSE-ONLY (AC3 — zero new invention; every signal path is an already-validated
# capability):
#   * liveness      → session-observation.sh --once   (PSI/pane dual signal, validated)
#   * delivery      → send-keys-reliable.sh + transcript-delivery-check.ts
#                     (the 6 failure modes crystallized; transcript is the only
#                     trusted delivery signal)
#   * drive text    → the validated cold-start text ("执行 <tick doc> 中的 tick 指令"),
#                     the same text the manager hand-typed successfully tonight.
#
# The ONLY new behavior here is the TRIGGER (an OS-level timer) and the RE-SPAWN
# (re-create a tmux session / re-launch claude in the outer window) — neither can
# be "invented" since they are the point of the task; everything else delegates to
# the validated scripts.
#
# Decision logic (pure, testable via --decide):
#   halted=1                    → "halted"          (project parked; do not fight .halt)
#   alive=1                     → "noop"            (healthy — nothing to do)
#   alive=0 & session_exists=1  → "relaunch-outer"  (session up, outer claude dead)
#   alive=0 & session_exists=0  → "recreate-session"(session itself is gone)
#   alive=unknown               → "skip-unverifiable"(cannot measure liveness — never
#                                 double-spawn on a broken measurement)
#
# Config (pipe-delimited, one project per line; comments and blanks skipped):
#   name|root|tmux-session|outer-window|launch-cmd|drive-text|transcript
#     name            project label (logged)
#     root            absolute project root (helpers resolved under $root/plugin/scripts)
#     tmux-session    the tmux session name (e.g. quay-0)
#     outer-window    window name/index of the outer pane (e.g. "outer" or "1")
#     launch-cmd      the shell command that starts the outer Claude session
#                     (must resolve the provider env — use claude-deepseek or an
#                     equivalent wrapper; may carry `env A=B ...` assignments)
#     drive-text      the cold-start drive text (the outer tick instruction)
#     transcript      optional literal transcript jsonl path for the drive; empty =
#                     auto-discover the newest jsonl under ~/.claude/projects/<slug>/
#
# Config location: ${OS_ANCHOR_PROJECTS_FILE:-~/.config/quay/os-anchor/os-anchor-projects.conf}
# (the installer writes this default; override for tests / other machines).
#
# Usage:
#   os-anchor-watchdog.sh --decide <alive> <session_exists> <halted>   pure decision seam
#   os-anchor-watchdog.sh --check <name>          non-destructive status for one project
#   os-anchor-watchdog.sh --check-all             non-destructive status for all projects
#   os-anchor-watchdog.sh --run [--config <f>]    check all + re-spawn missing (default)
#   os-anchor-watchdog.sh --list-projects         print the parsed config
#   os-anchor-watchdog.sh --config <f>            override config file
#   os-anchor-watchdog.sh --log <f>               append a timestamped log line per project
#   os-anchor-watchdog.sh --help
#
# Exit: 0 all healthy/handled · 1 any re-spawn or drive failed · 2 usage/config error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CONFIG="${HOME:-/home/yale}/.config/quay/os-anchor/os-anchor-projects.conf"
PROJECTS_FILE="${OS_ANCHOR_PROJECTS_FILE:-$DEFAULT_CONFIG}"
LOG_FILE=""
MODE="run"

log() {
  local line
  line="$(date -u +%FT%TZ) os-anchor-watchdog: $*"
  echo "$line"
  if [ -n "$LOG_FILE" ]; then
    printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

# ── pure decision (AC1/AC2 testable seam) ────────────────────────────────────────
#   os_anchor_decide <alive|unknown> <session_exists 0|1> <halted 0|1>
#   prints: noop | relaunch-outer | recreate-session | halted | skip-unverifiable
os_anchor_decide() {
  local alive="$1" sess="$2" halted="$3"
  if [ "$halted" = "1" ]; then echo "halted"; return 0; fi
  if [ "$alive" = "unknown" ]; then echo "skip-unverifiable"; return 0; fi
  if [ "$alive" = "1" ]; then echo "noop"; return 0; fi
  if [ "$sess" = "1" ]; then echo "relaunch-outer"; return 0; fi
  echo "recreate-session"
  return 0
}

# ── tmux helpers ────────────────────────────────────────────────────────────────
# Use the real default server explicitly (env -u TMUX tmux -S ...), same as
# session-observation.sh L0 — never inherit a caller's $TMUX.
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

# wait_for_prompt <target> <timeout_s> — poll capture-pane for the Claude Code prompt
# glyph (❯). Works for a real claude TUI AND for the AC2 fixture TUI (which renders
# the same glyph). Exit 0 when the prompt appears, 1 on timeout.
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

# ── liveness via the VALIDATED capability (session-observation.sh --once) ──────────
# Returns: 1 (alive) / 0 (dead) / "unknown" (could not measure — helper missing or
# no SESSION-STATUS line). Never re-spawn on "unknown" (fail-safe against a broken
# measurement double-spawning a live session).
outer_liveness() {
  local name="$1" root="$2" session="$3" outer="$4"
  local sl="$root/plugin/scripts/session-observation.sh"
  [ -x "$sl" ] || { echo "unknown"; return 0; }
  local out line
  out=$(SESSION_TARGETS="${name} ${root} ${session}:${outer}" \
        SESSION_ROOT="$root" bash "$sl" --once 2>/dev/null || true)
  line=$(printf '%s\n' "$out" | awk -v n="$name" '$1=="SESSION-STATUS" && $2==n { print $0; exit }')
  [ -n "$line" ] || { echo "unknown"; return 0; }
  case "$line" in
    *alive=1*) echo 1 ;;
    *) echo 0 ;;
  esac
  return 0
}

# transcript discovery: newest jsonl under ~/.claude/projects/<slug>/ newer than a
# baseline mtime. The slug is the root path with '/' → '-'; this is the config-not-
# inferred rule's ONE unavoidable exception: a freshly re-spawned session has no id
# yet, so the newest file IS the new session. Documented best-effort; when the
# config carries a literal transcript path it is used instead.
transcript_for() {
  local root="$1" override="${2:-}" base_ts="$3"
  if [ -n "$override" ]; then echo "$override"; return 0; fi
  local slug dir
  slug="$(printf '%s' "$root" | tr '/' '-')"
  dir="${HOME:-/home/yale}/.claude/projects/${slug}"
  [ -d "$dir" ] || { echo ""; return 1; }
  local f newest="" newest_ts=0 ts
  for f in "$dir"/*.jsonl; do
    [ -e "$f" ] || continue
    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    if [ "$ts" -gt "$newest_ts" ]; then newest="$f"; newest_ts=$ts; fi
  done
  # require strictly newer than the pre-launch baseline (a brand-new session file)
  if [ -n "$newest" ] && [ "$newest_ts" -gt "$base_ts" ]; then
    echo "$newest"
    return 0
  fi
  echo ""
  return 1
}

# ── re-spawn (the ONLY new behavior: the point of the task) ─────────────────────
# recreate_session — the session itself is gone: build a minimal session with one
# outer window running the launch command, then drive.
recreate_session() {
  local name="$1" root="$2" session="$3" outer="$4" launch="$5" drive="$6" transcript_override="$7"
  if ! "${_os_tmux[@]}" new-session -d -s "$session" -n "$outer" -c "$root" 2>/dev/null; then
    log "$name: recreate-session FAILED — tmux new-session (maybe a race); falling back to relaunch"
    return 1
  fi
  launch_in_window "$name" "$session" "$outer" "$root" "$launch"
  local rc=$?
  [ "$rc" -eq 0 ] || return 1
  drive_outer "$name" "$session" "$outer" "$root" "$drive" "$transcript_override" ""
  return $?
}

# relaunch_outer — session exists, outer claude is dead: interrupt, clear, re-type
# the launch command into the existing outer pane, then drive.
relaunch_outer() {
  local name="$1" root="$2" session="$3" outer="$4" launch="$5" drive="$6" transcript_override="$7"
  launch_in_window "$name" "$session" "$outer" "$root" "$launch"
  local rc=$?
  [ "$rc" -eq 0 ] || return 1
  drive_outer "$name" "$session" "$outer" "$root" "$drive" "$transcript_override" ""
  return $?
}

# launch_in_window — C-c (interrupt anything), clear the line, then type the launch
# command. Idempotent: typing into an already-running TUI is harmless (send-keys
# queues keystrokes), and C-c first prevents command accumulation on a broken shell.
launch_in_window() {
  local name="$1" session="$2" outer="$3" root="$4" launch="$5"
  local target="${session}:${outer}"
  "${_os_tmux[@]}" send-keys -t "$target" C-c 2>/dev/null || true
  sleep 0.5
  "${_os_tmux[@]}" send-keys -t "$target" "cd $root && $launch" Enter 2>/dev/null || true
  if wait_for_prompt "$target" 30; then
    log "$name: relaunch/launch OK — $target prompt up (re-spawned)"
    return 0
  fi
  log "$name: WARN launch did not show a prompt in 30s on $target"
  return 1
}

# drive_outer — send the validated cold-start text + verify delivery (AC2 drive).
# The re-spawned session creates its transcript ONLY on its first input, so the transcript path is
# unknowable before the send. THE WHOLE FLOW IS ONE CALL (gap-supervisor-base-layer step ③):
# supervisor-deliver.sh is the single delivery implementation — it owns the reliable send, the
# new-transcript discovery (a re-spawned session's file appears on first committed input; the
# --root snapshot rule excludes the OLD session's file), and the pure delivery verification
# (transcript-delivery-check.ts — the only trusted signal). This consumer no longer hand-writes a
# send-keys sequence nor re-implements delivery checks — the "3 consumers each hand-write" defect
# (SPEC-integration-architecture §4.3f) is closed at the source.
drive_outer() {
  local name="$1" session="$2" outer="$3" root="$4" drive="$5" transcript_override="$6" prelaunch="${7:-}"
  local target="${session}:${outer}"
  local sdel="$root/plugin/scripts/supervisor-deliver.sh"
  [ -x "$sdel" ] || { log "$name: drive SKIPPED — no supervisor-deliver.sh (project not quay-init'd)"; return 1; }

  # deliver(target, payload) -> delivered|failed, by intent. Explicit --transcript when the
  # config carries one; otherwise --root (auto-discovery of the re-spawned session's file).
  # The window-name pre-flight gate (drive-target-check.sh) verifies the target window name
  # before any send — the watchdog drives the OUTER window (${session}:${outer}), so it must
  # set DRIVE_EXPECT_WINDOW_NAME to that window name (gap-drive-sent-to-manager-pane-not-inner).
  local out rc
  if [ -n "$transcript_override" ]; then
    out=$(DRIVE_EXPECT_WINDOW_NAME="$outer" SUPERVISOR_DELIVER_VERIFY_S=45 bash "$sdel" "$target" "$drive" --transcript "$transcript_override" 2>&1)
  else
    out=$(DRIVE_EXPECT_WINDOW_NAME="$outer" SUPERVISOR_DELIVER_VERIFY_S=45 bash "$sdel" "$target" "$drive" --root "$root" 2>&1)
  fi
  rc=$?
  if [ "$rc" -eq 0 ]; then
    log "$name: DRIVE OK — cold-start text delivered (real user message in transcript)"
    printf '%s\n' "$out" | sed 's/^/    /' | while IFS= read -r l; do log "$name: $l"; done
    return 0
  fi
  log "$name: DRIVE NOT YET DELIVERED (exit $rc) — retry next tick"
  printf '%s\n' "$out" | sed 's/^/    /' | while IFS= read -r l; do log "$name: $l"; done
  return 1
}

# ── per-project check + act ──────────────────────────────────────────────────────
# watch_project <name> <root> <session> <outer> <launch> <drive> <transcript>
#   prints "STATUS <name> <action> <detail>" — parseable, and is the AC2 real-run
#   evidence (session-missing → recreate-session → DRIVE OK).
watch_project() {
  local name="$1" root="$2" session="$3" outer="$4" launch="$5" drive="$6" transcript_override="${7:-}"
  # observer-registry (gap-observer-registry-target-decommission-and-criterion-invalidation):
  # a target registered OFFLINE is deliberately decommissioned — its criterion ("is the session
  # alive?") is INVALID. Report "decommissioned" and NEVER re-spawn it. This is the class-level
  # fix for consumer #1 (the watchdog revived a deliberately-decommissioned archguard).
  # Resolve the registry helper from THIS copy first (works for the repo copy + --audit's
  # synthetic config), falling back to the project's own plugin/scripts (works for the installed
  # watchdog copy under ~/.config/quay/os-anchor/).
  local _ow_reg=""
  if [ -x "$SELF_DIR/observer-registry.sh" ]; then
    _ow_reg="$SELF_DIR/observer-registry.sh"
  elif [ -x "$root/plugin/scripts/observer-registry.sh" ]; then
    _ow_reg="$root/plugin/scripts/observer-registry.sh"
  fi
  if [ -n "$_ow_reg" ] && "$_ow_reg" --is-offline "$name" >/dev/null 2>&1; then
    echo "STATUS $name decommissioned (offline per observer-registry — not re-spawning)"
    log "$name: decommissioned per observer-registry — not re-spawning"
    return 0
  fi
  # parked projects (.halt) are intentional — never fight them
  if [ -f "$root/.halt" ]; then
    echo "STATUS $name halted (project parked via .halt — not re-spawning)"
    log "$name: halted"
    return 0
  fi
  local sess_has alive action rc
  if session_exists "$session"; then sess_has=1; else sess_has=0; fi
  alive=$(outer_liveness "$name" "$root" "$session" "$outer")
  action=$(os_anchor_decide "$alive" "$sess_has" 0)
  case "$action" in
    noop)
      echo "STATUS $name noop (alive=$alive session=$sess_has)"
      log "$name: healthy (alive=$alive)"
      return 0 ;;
    halted)
      echo "STATUS $name halted"
      return 0 ;;
    skip-unverifiable)
      echo "STATUS $name skip-unverifiable (session-observation returned no verdict)"
      log "$name: unverifiable — skipping (never double-spawn on a broken measurement)"
      return 0 ;;
    recreate-session)
      echo "STATUS $name recreate-session (alive=$alive session=$sess_has) — re-spawning"
      log "$name: SESSION MISSING (alive=$alive session=$sess_has) — recreating session + outer"
      recreate_session "$name" "$root" "$session" "$outer" "$launch" "$drive" "$transcript_override"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        echo "STATUS $name recovered (recreate-session + drive OK)"
        return 0
      fi
      echo "STATUS $name RECOVERY-FAILED (recreate-session rc=$rc)"
      return 1 ;;
    relaunch-outer)
      echo "STATUS $name relaunch-outer (alive=$alive session=$sess_has) — re-spawning"
      log "$name: OUTER MISSING (alive=$alive session=$sess_has) — relaunching outer"
      relaunch_outer "$name" "$root" "$session" "$outer" "$launch" "$drive" "$transcript_override"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        echo "STATUS $name recovered (relaunch-outer + drive OK)"
        return 0
      fi
      echo "STATUS $name RECOVERY-FAILED (relaunch-outer rc=$rc)"
      return 1 ;;
    *)
      echo "STATUS $name unknown-action($action)" >&2
      return 2 ;;
  esac
}

# ── config parsing ───────────────────────────────────────────────────────────────
# Each non-comment, non-blank line: name|root|session|outer|launch|drive|transcript
# Launch/drive may contain spaces but not a literal '|' (documented contract).
print_projects() {
  [ -f "$PROJECTS_FILE" ] || { echo "ERROR: config not found: $PROJECTS_FILE" >&2; return 2; }
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    printf '%s\n' "$line"
  done < "$PROJECTS_FILE"
}

run_all() {
  local projects rc=0
  projects=$(print_projects) || return 2
  if [ -z "$projects" ]; then
    log "no projects configured in $PROJECTS_FILE"
    return 0
  fi
  local name root session outer launch drive transcript
  while IFS='|' read -r name root session outer launch drive transcript; do
    [ -n "${name:-}" ] || continue
    [ -n "${root:-}" ] || { echo "STATUS $name CONFIG-ERROR (missing root)" >&2; rc=1; continue; }
    if ! watch_project "$name" "$root" "$session" "$outer" "$launch" "$drive" "${transcript:-}"; then
      rc=1
    fi
  done <<< "$projects"
  return $rc
}

check_one() {
  local want="$1" found=0 rc=0 line
  while IFS='|' read -r name root session outer launch drive transcript; do
    [ -n "${name:-}" ] || continue
    if [ "$name" = "$want" ]; then
      found=1
      watch_project "$name" "$root" "$session" "$outer" "$launch" "$drive" "${transcript:-}" || rc=1
      break
    fi
  done < <(print_projects) || return 2
  if [ "$found" -ne 1 ]; then
    echo "STATUS $want not-found" >&2
    return 2
  fi
  return $rc
}

# ── CLI ─────────────────────────────────────────────────────────────────────────
# Order-independent option parsing: options may precede the subcommand
# (e.g. `--config <f> --check <name>`), and `--decide` is self-contained.
SUBCMD=""
CHECK_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --config)
      [ $# -ge 2 ] || { echo "用法: $0 --config <file> [subcommand]" >&2; exit 2; }
      PROJECTS_FILE="$2"; shift 2 ;;
    --log)
      [ $# -ge 2 ] || { echo "用法: $0 --log <file>" >&2; exit 2; }
      LOG_FILE="$2"; shift 2 ;;
    --decide)
      [ $# -eq 4 ] || { echo "用法: $0 --decide <alive|unknown> <session_exists 0|1> <halted 0|1>" >&2; exit 2; }
      os_anchor_decide "$2" "$3" "$4"
      exit 0 ;;
    --check)
      SUBCMD=check; [ $# -ge 2 ] || { echo "用法: $0 --check <name>" >&2; exit 2; }
      CHECK_NAME="$2"; shift 2 ;;
    --check-all) SUBCMD=check_all; shift ;;
    --run) SUBCMD=run; shift ;;
    --list-projects) SUBCMD=list; shift ;;
    --help|-h) SUBCMD=help; shift ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      SUBCMD=help; shift ;;
  esac
done

case "$SUBCMD" in
  list) print_projects; exit $? ;;
  help|"")
    sed -n '1,60p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  check)
    print_projects >/dev/null || exit 2
    check_one "$CHECK_NAME"
    exit $? ;;
  check_all|run)
    print_projects >/dev/null || exit 2
    run_all
    exit $? ;;
esac
exit 0
