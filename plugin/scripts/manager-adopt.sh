#!/usr/bin/env bash
# manager-adopt.sh — `quay manager adopt <root>`: start ONE project's outer+inner.
# (SPEC-manager-productization-2026-08-05, C5 + §4.2; charter gap-manager-productization-five-constraints AC1/AC7).
#
# C5 — separate from `manager start`: this drives a PROJECT; `start` starts the MANAGER.
#      Two commands (SPEC §4.3: lifecycle, fault isolation, partial-alive semantics, AC12b).
#
# The three-state judgment REUSES inner-session-check.sh (SPEC §4.2: "三态语义与
# inner-session-check.sh 完全一致——这不是巧合，应当复用同一段判定，而不是写第二份";
# charter AC1 "不写第二份判定"). inner-session-check.sh outputs {healthy, empty-shell, missing,
# degraded}; the adopt branch acts accordingly:
#   healthy      → noop  (may have been built by someone else — do not touch)
#   empty-shell  → drive-not-rebuild (claude present but not yet driven; preserve context —
#                 the project's own outer drives it, never a rebuild)
#   missing      → bash quay-topology.sh (the two-window outer+inner factory) then register
#   degraded     → fail-closed (the discovery heuristic cannot be trusted; never guess)
#
# AC7 (C5 testability, SPEC §4.3 #4) — after adopt, the manager's action count for that project
# is 0. Operationally: adopt appends ONE `adopt-register` event to $MANAGER_HOME/actions.jsonl and
# does NOTHING else to the project (no observer, no writes, no spawns). `grep -cv adopt-register`
# over that project's action log lines must be 0.
#
# Usage:
#   manager-adopt.sh <project-root> [--dry-run]
#     <project-root>  absolute path to a quay-init'd project workspace (has plugin/scripts/)
#     --dry-run       print the plan, change nothing (validation / tests)
#
# Test seams (env):
#   MANAGER_HOME            override $QUAY_GLOBAL_DIR/manager (tests use a temp dir)
#   MANAGER_SKIP_TMUX=1     skip real tmux (hermetic tests)
#   MANAGER_SKIP_SYSTEMCTL=1  skip systemctl (hermetic tests — os-anchor-install --add-project)
#   ADOPT_OVERRIDE_STATE    force the three-state verdict (healthy|empty-shell|missing|degraded)
#                           — lets tests exercise each branch without a live tmux (test seam only)
#
# Exit: 0 success · 1 failure (incl. degraded fail-closed) · 2 usage error.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"

GLOBAL_DIR="${QUAY_GLOBAL_DIR:-${HOME:-/tmp}/.quay-global}"
MANAGER_HOME="${MANAGER_HOME:-${GLOBAL_DIR}/manager}"
REGISTRY="$MANAGER_HOME/projects.conf"
ACTIONS_LOG="$MANAGER_HOME/actions.jsonl"
SKIP_TMUX="${MANAGER_SKIP_TMUX:-0}"
SKIP_SYSTEMCTL="${MANAGER_SKIP_SYSTEMCTL:-0}"
DRY_RUN=0
ADOPT_OVERRIDE_STATE="${ADOPT_OVERRIDE_STATE:-}"

usage() {
  sed -n '1,45p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

log() { echo "manager-adopt: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ── argument parsing: exactly one positional <project-root> (C5) ────────────────────────────────────
PROJECT_ROOT=""
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage ;;
    -*) echo "manager-adopt: unknown argument: $1 (expected <project-root> | --dry-run)" >&2; exit 2 ;;
    *)
      if [ -z "$PROJECT_ROOT" ]; then
        PROJECT_ROOT="$1"
      else
        EXTRA_ARGS+=("$1")
      fi
      shift ;;
  esac
done

if [ -z "$PROJECT_ROOT" ]; then
  echo "manager-adopt: requires exactly one <project-root> (e.g. /home/yale/work/meta-cc)" >&2
  exit 2
fi
if [ "${#EXTRA_ARGS[@]}" -gt 0 ]; then
  echo "manager-adopt: accepts exactly ONE project root — got extra: ${EXTRA_ARGS[*]}" >&2
  exit 2
fi

# ── project validity (must be a quay-init'd workspace) ──────────────────────────────────────────────
if [ ! -d "$PROJECT_ROOT/plugin/scripts" ]; then
  echo "manager-adopt: $PROJECT_ROOT has no plugin/scripts — not a quay-init'd workspace" >&2
  exit 2
fi

# ── resolve the project's tmux session (never guess; session-liveness.env is the source) ────────────
SESSION=""
if [ -f "$PROJECT_ROOT/orchestration/session-liveness.env" ]; then
  SESSION="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$PROJECT_ROOT/orchestration/session-liveness.env" 2>/dev/null | head -1)"
fi
[ -n "$SESSION" ] || SESSION="${PROJECT_NAME:-$(basename "$PROJECT_ROOT")}-0"

PROJECT_NAME="$(basename "$PROJECT_ROOT")"

# ── ensure manager home exists (adopt presumes the manager is running / start was called) ───────────
if [ "$DRY_RUN" = 1 ]; then
  echo "would-ensure-home: mkdir -p $MANAGER_HOME"
else
  mkdir -p "$MANAGER_HOME" || die "cannot create manager home $MANAGER_HOME"
fi

# ── 1. three-state judgment — REUSE inner-session-check.sh (no second copy of the verdict) ──────────
STATE=""
if [ -n "$ADOPT_OVERRIDE_STATE" ]; then
  STATE="$ADOPT_OVERRIDE_STATE"
elif [ "$SKIP_TMUX" = "1" ]; then
  # Hermetic path (tests without live tmux): no tmux ⇒ the window is absent ⇒ missing.
  STATE="missing"
else
  OUT="$(bash "$SELF_DIR/inner-session-check.sh" --session "$SESSION" --json 2>/dev/null || true)"
  STATE="$(printf '%s' "$OUT" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p')"
  # fail-closed: no verdict from the reused checker ⇒ degraded (never guess).
  [ -n "$STATE" ] || STATE="degraded"
fi

log "project=$PROJECT_NAME session=$SESSION state=$STATE"

case "$STATE" in
  healthy)
    if [ "$DRY_RUN" = 1 ]; then
      echo "healthy: $PROJECT_NAME sessions alive — noop (may have been built by someone else)"
    else
      log "$PROJECT_NAME already healthy — noop (spec §4.2: 已活 ⇒ noop, 可能是别人建的)"
    fi
    ;;
  empty-shell)
    if [ "$DRY_RUN" = 1 ]; then
      echo "empty-shell: $PROJECT_NAME claude present but not driven — drive-not-rebuild (outer drives; preserve context)"
    else
      log "$PROJECT_NAME empty-shell — drive-not-rebuild (outer drives; never rebuild, preserves potential context)"
    fi
    ;;
  degraded)
    # SPEC §4.2 + inner-session-check's own fail-closed: TR_SOURCE=discovery cannot be trusted.
    echo "manager-adopt: $PROJECT_NAME DEGRADED (verdict unresolvable / discovery heuristic) — fail-closed, NOT adopting (never guess)" >&2
    exit 1
    ;;
  missing)
    if [ "$DRY_RUN" = 1 ]; then
      echo "missing: $PROJECT_NAME sessions absent — would-call: bash $SELF_DIR/quay-topology.sh --session $SESSION"
    else
      log "$PROJECT_NAME missing — calling quay-topology.sh (two-window outer+inner factory)"
      if [ "$SKIP_TMUX" != "1" ]; then
        bash "$SELF_DIR/quay-topology.sh" --session "$SESSION" || die "quay-topology.sh failed for $PROJECT_NAME"
      else
        log "MANAGER_SKIP_TMUX=1 — skipped topology creation"
      fi
    fi
    ;;
  *)
    echo "manager-adopt: unknown state from inner-session-check: $STATE" >&2
    exit 1
    ;;
esac

# ── 2. register in the manager's project registry + OS anchor watch list ────────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  echo "would-register: $REGISTRY += ${PROJECT_NAME}|${PROJECT_ROOT}|${SESSION}"
  echo "would-add-to-os-anchor: bash $SELF_DIR/os-anchor-install.sh --add-project $PROJECT_ROOT"
else
  # registry (idempotent by name)
  [ -f "$REGISTRY" ] || printf '# manager projects registry (written by quay manager adopt)\n# format: name|root|tmux-session\n' > "$REGISTRY"
  if ! grep -q "^${PROJECT_NAME}|" "$REGISTRY" 2>/dev/null; then
    printf '%s|%s|%s\n' "$PROJECT_NAME" "$PROJECT_ROOT" "$SESSION" >> "$REGISTRY"
    log "registered $PROJECT_NAME in manager registry"
  else
    log "$PROJECT_NAME already in registry — leaving as-is"
  fi
  # OS anchor watch list (so the project's outer gets OS-level recovery too)
  if [ "$SKIP_SYSTEMCTL" = "1" ]; then
    log "MANAGER_SKIP_SYSTEMCTL=1 — skipped os-anchor-install --add-project (hermetic)"
  else
    bash "$SELF_DIR/os-anchor-install.sh" --add-project "$PROJECT_ROOT" >/dev/null 2>&1 \
      && log "registered $PROJECT_NAME in OS anchor watch list" \
      || log "WARN: os-anchor-install --add-project failed for $PROJECT_NAME (os-anchor not installed?)"
  fi
fi

# ── 3. AC7 — ONE adopt-register event, nothing else touches the project ─────────────────────────────
if [ "$DRY_RUN" = 1 ]; then
  echo "adopt-register (would-append): $ACTIONS_LOG += {\"project\":\"$PROJECT_NAME\",\"action\":\"adopt-register\"}"
else
  [ -f "$ACTIONS_LOG" ] || printf '{"ts":0,"event":"log-init","origin":"manager"}\n' > "$ACTIONS_LOG" 2>/dev/null || true
  printf '{"ts":%s,"project":"%s","action":"adopt-register","origin":"manager"}\n' \
    "$(date +%s)" "$(printf '%s' "$PROJECT_NAME" | sed 's/"/\\"/g')" >> "$ACTIONS_LOG" 2>/dev/null || true
fi

echo "manager-adopt: done — $PROJECT_NAME state=$STATE (adopt-after manager actions on project: 0)"
exit 0
