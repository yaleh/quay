#!/usr/bin/env bash
# tmux-isolated.sh — the L0 defense (tasks/gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX).
#
# The two whole-machine crashes (vhs / transformer, 2026-08-04) both came from a sub-agent's
# throwaway shell calling bare `tmux kill-server` and killing the real default server that hosts
# the live quay sessions (quay-0). `env -u TMUX` as a LAUNCH-SIDE habit cannot be remembered by
# every caller — the evidence is pinned in the task body:
#     $TMUX   overrides TMUX_TMPDIR   — setting only TMUX_TMPDIR does not isolate a process that
#                                       inherited $TMUX
#     -S/-L   overrides $TMUX         — an explicit -S/-L always isolates
# This helper makes the isolation STRUCTURAL (a call form, not a caller's memory): every invocation
# is forced onto a PRIVATE per-user socket, so even the most dangerous command (`kill-server`) can
# only kill the isolated socket, never the default server.
#
# Form:
#     env -u TMUX tmux -S "<${TMPDIR:-${XDG_RUNTIME_DIR:-/tmp}}>/tmux-$(id -u).sock" "$@"
#   - explicit `-S` overrides any inherited $TMUX; `env -u TMUX` strips $TMUX so it cannot re-inject
#     a socket via TMUX_TMPDIR confusion. BOTH are required (AC1).
#   - the socket is per-user and lives under TMPDIR / ${XDG_RUNTIME_DIR:-/tmp} (AC1).
#   - fail-closed (AC1): if the socket cannot be pinned to the private path, or a caller tries to
#     override the socket with their own `-S`/`-L`, this script ERRORS (exit 3) rather than silently
#     falling back to the default server.
#
# Real-server scripts (session-observation.sh's read-only pane probes, quay-init.sh's session detection)
# MUST NOT go through this helper — they need the DEFAULT server's real sessions. They use the
# equivalent explicit-socket form `env -u TMUX tmux -S "${TMPDIR:-/tmp}/tmux-$(id -u)/default" ...`
# and declare it in their header (AC3: 迁移或明示).
#
# Usage:
#   plugin/scripts/tmux-isolated.sh <tmux-subcommand> [args...]
#   plugin/scripts/tmux-isolated.sh --show-socket    # print the resolved private socket (test seam)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

BASE="${TMPDIR:-${XDG_RUNTIME_DIR:-/tmp}}"
SOCK="$BASE/tmux-$(id -u).sock"

# ── test seam ───────────────────────────────────────────────────────────────────────────────────────
# Print the resolved socket path and exit. Never forwards to tmux. Used by plugin/test
# to assert AC1's path shape (uid + under TMPDIR/XDG_RUNTIME_DIR/tmp) without starting a server.
if [ "${1:-}" = "--show-socket" ]; then
  printf '%s\n' "$SOCK"
  exit 0
fi

# ── fail-closed self-checks (AC1) ───────────────────────────────────────────────────────────────────
# invariant `helper_uses_explicit_S = 1` (Contract): this script ALWAYS passes `-S "$SOCK"` before
# any caller args. A caller may not smuggle their own `-S`/`-L` — they override $TMUX and would
# silently defeat the isolation (fail-closed, never a silent fallback to the default server).
for arg in "$@"; do
  case "$arg" in
    -S|-L|-S*|-L*)
      echo "tmux-isolated: REFUSE caller-supplied socket flag '$arg' — the isolated socket is fixed; use the equivalent default-socket form for real-server access" >&2
      exit 3 ;;
  esac
done

# Socket must be non-empty, contain the uid, and live under the allowed base.
if [ -z "$SOCK" ]; then
  echo "tmux-isolated: ERROR empty socket path — refusing to fall back to the default server" >&2
  exit 3
fi
case "$SOCK" in
  *"$(id -u)"*) ;;
  *) echo "tmux-isolated: ERROR socket path '$SOCK' lacks uid — refusing to touch the default server" >&2; exit 3 ;;
esac
case "$SOCK" in
  "$BASE"/*) ;;
  *) echo "tmux-isolated: ERROR socket path '$SOCK' not under base '$BASE' — refusing" >&2; exit 3 ;;
esac

# `env -u TMUX` must actually strip the inherited $TMUX (the `$TMUX` overrides TMUX_TMPDIR` trap).
if env -u TMUX sh -c '[ -n "${TMUX:-}" ]'; then
  echo "tmux-isolated: ERROR env -u TMUX failed to strip \$TMUX" >&2
  exit 3
fi

# ── the call form (AC1) ─────────────────────────────────────────────────────────────────────────────
exec env -u TMUX tmux -S "$SOCK" "$@"
