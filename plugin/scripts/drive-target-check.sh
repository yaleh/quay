#!/usr/bin/env bash
# drive-target-check.sh — fail-closed pre-flight gate for a tmux target used to DRIVE or OBSERVE a
# Claude session window (tasks/gap-drive-sent-to-manager-pane-not-inner — the three disciplines).
#
# FALLBACK delivery path (human ruling 2026-08-12): the DEFAULT cross-session delivery channel is
# now NATIVE SendMessage (ListAgents addressing; busy targets receive directly; identity + platform
# are annotated). This gate is the fail-closed target-identity half of the FALLBACK tmux-drive
# path, used when native cross-session messages are unavailable: Claude Code < 2.1.224,
# Bedrock/AWS/GCP/Foundry, native Windows, or non-Claude targets. NOT deleted, behavior UNCHANGED.
#
# Incident (2026-08-10): the outer loop drove the inner via `quay-0:0.0` — window 0 was `claude`
# (the MANAGER, pid 2983389), not inner (`quay-0:inner`, pid 2989409). 6 send-keys in 2 dispatches
# all landed in the manager's input box, and the manager's transcript (b8dc91a6) was read as the
# inner's 26 times. Root cause: a numeric pane index substituted for an explicit window identity.
# This gate makes that structurally impossible for every drive/observe script that calls it:
#
#   Discipline ① (window NAME, never an index): the target must NAME a window (`quay-0:inner`).
#     A numeric pane/window index (`quay-0:0`, `quay-0:0.0`, `1.0`) is rejected SYNTACTICALLY,
#     before tmux is consulted, even if it happens to resolve to the right window — layout is
#     mutable; the name is not.
#   Discipline ② (pre-verify before EVERY capture-pane/send-keys): the target's window name is
#     read via `tmux display-message -p -t <target> "#{window_name}"` and must equal the expected
#     name (env DRIVE_EXPECT_WINDOW_NAME, default `inner`). The window part (after the last ':')
#     must ALSO be a real window name in the session (`list-windows` membership) — tmux's
#     display-message SILENTLY resolves a non-existent window name to the session's ACTIVE window
#     with rc=0, which would let a typo like `quay-0:innr` pass if the active window happened to
#     be inner. Non-matching / non-existent → FAIL CLOSED (exit 1), never a silent send.
#   Discipline ③ (delivered = the inner's OWN committed signal): callers wire this gate BEFORE the
#     send and keep the delivery verdict on committed inner signals only (a content-matching REAL
#     user message in the window-name-VERIFIED inner session's transcript — never send-keys exit
#     code, never pane echo, never "a transcript is growing"). This gate is the identity half of
#     that: "we are talking to inner, not manager".
#
# Usage:  bash drive-target-check.sh <tmux目标> [--expect <窗口名>]
# Exit:   0 = verified (target exists, not a numeric index, window name == expected)
#         1 = FAILED (numeric index / wrong window name / nonexistent target) — fail closed
#         2 = usage error
# Env:    DRIVE_EXPECT_WINDOW_NAME   the window name the target must resolve to (default `inner`)
#         DRIVE_TMUX=...             a tmux command/alias prefix (e.g. `tmux -S <sock>`) for
#                                    hermetic sockets; bare `tmux` resolves via TMUX_TMPDIR
#
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") <tmux目标> [--expect <窗口名>]"; fi
  exit 0
fi
set -uo pipefail

TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "drive-target-check: 缺少目标——用法: bash $(basename "$0") <tmux目标> [--expect <窗口名>]" >&2; exit 2; }

# Default the expected window name to the target's OWN window part (the part after the last ':'),
# so driving `session:outer` expects `outer` and `session:inner` expects `inner` — never a
# hardcoded `inner` that breaks non-inner drives (human 2026-08-12 裁定, gap-drive-sent-to-manager-
# pane-not-inner 三条纪律的 generalize：显式传 DRIVE_EXPECT_WINDOW_NAME 仍覆盖此推导)。
EXPECT="${DRIVE_EXPECT_WINDOW_NAME:-${TARGET##*:}}"
if [ "${2:-}" = "--expect" ]; then
  [ $# -ge 3 ] || { echo "drive-target-check: --expect 需要窗口名" >&2; exit 2; }
  EXPECT="$3"
fi
[ -n "$EXPECT" ] || { echo "drive-target-check: 期望窗口名为空——配置错误，fail closed" >&2; exit 2; }

TMUX_CMD="${DRIVE_TMUX:-tmux}"
HOST="${SUPERVISOR_DELIVER_HOST:-}"
SSH_BIN="${SUPERVISOR_DELIVER_SSH:-ssh}"

# tmux_cmd <args…> — run a gate tmux interaction locally or on the target host
# (gap-supervisor-deliver-cross-host-target-support). LOCAL: the DRIVE_TMUX command prefix (a bare
# `tmux` resolves via TMUX_TMPDIR — the hermetic-socket contract). CROSS-HOST: ONE
# `ssh <host> tmux <args…>` round-trip per call, each arg shell-quoted (printf %q) so a pane format
# like '#{window_name}' survives the remote re-parse as a single arg (an unquoted '#' at a word start
# would start a REMOTE comment and silently drop the format).
tmux_cmd() {
  local a q=""
  if [ -n "$HOST" ]; then
    for a in "$@"; do q+="$(printf '%q ' "$a")"; done
    "$SSH_BIN" "$HOST" "tmux ${q}"
  else
    $TMUX_CMD "$@"
  fi
}

# ── Discipline ①: numeric index rejection (structural — no tmux needed) ───────────────────────────
# The part after the last ':' is the window/pane part. A purely-numeric window part (0 / 0.0 / 1.0)
# is a numeric index — forbidden even if it happens to resolve to the right window.
win="${TARGET##*:}"
if [[ "$win" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "drive-target-check: FAIL——目标 '$TARGET' 使用数字索引（窗口部分 '$win'），纪律①禁止——只用窗口名（如 quay-0:inner），索引作废" >&2
  exit 1
fi

# ── Resolve the session (the part before the last ':'; empty for a bare-session target) ───────────
sess="${TARGET%:*}"
[ "$sess" = "$TARGET" ] && sess=""

# ── Discipline ② part 1: the window part must be a REAL window name in the session ───────────────
# tmux's display-message resolves a NON-existent window name to the session's ACTIVE window with
# rc=0 — a typo (`quay-0:innr`) would silently read the active window. `list-windows` membership
# closes that hole. The pane suffix (`inner.0`) is stripped for the membership check.
if [ -n "$sess" ]; then
  if ! wins="$( tmux_cmd list-windows -t "$sess" -F '#{window_name}' 2>/dev/null )"; then
    echo "drive-target-check: FAIL——会话 '$sess' 不存在（目标 '$TARGET' 无法送达）" >&2
    exit 1
  fi
  base="$win"
  if [[ "$base" =~ ^(.*)\.[0-9]+$ ]]; then base="${BASH_REMATCH[1]}"; fi
  if [ -n "$base" ]; then
    if ! printf '%s\n' "$wins" | grep -qxF "$base"; then
      echo "drive-target-check: FAIL——目标 '$TARGET' 的窗口部分 '$base' 不是会话 '$sess' 里的真实窗口名（tmux display-message 会把不存在的窗口名静默解析到活动窗口）——中止" >&2
      exit 1
    fi
  fi
fi

# ── Discipline ② part 2: the resolved window name must equal the expected name ───────────────────
resolved="$( tmux_cmd display-message -p -t "$TARGET" '#{window_name}' 2>/dev/null | tr -d '\r\n' | sed 's/[[:space:]]*$//' )"
if [ -z "$resolved" ]; then
  echo "drive-target-check: FAIL——目标 '$TARGET' 不存在（display-message 未解析到窗口名）——无法送达" >&2
  exit 1
fi
if [ "$resolved" != "$EXPECT" ]; then
  echo "drive-target-check: FAIL——目标 '$TARGET' 的窗口名是 '$resolved'，期望 '$EXPECT'；非 '$EXPECT' 即中止（fail-closed）" >&2
  exit 1
fi

echo "drive-target-check: OK——目标 '$TARGET' 窗口名 '$resolved' == 期望 '$EXPECT'"
exit 0
