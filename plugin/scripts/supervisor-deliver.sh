#!/usr/bin/env bash
# supervisor-deliver.sh — the supervisor base layer's DELIVERY interface
# (tasks/gap-supervisor-base-layer-outside-sessions-architecture, step ③).
#
# deliver(target, payload) -> delivered | failed — expressed BY INTENT, never by terminal
# verbs. This is the ONLY delivery implementation: a consumer that wants text to reach a
# Claude Code session calls THIS and learns delivered|failed. No consumer hand-writes a
# tmux send-keys sequence.
#
# WHY ONE PLACE (SPEC-integration-architecture §4.3f): the ONE unreliable operation — TUI
# keystroke injection — goes from "3 agents each hand-write" to "one hardened implementation
# + real TUI e2e". The NBSP counterexample (2026-08-04): send-keys-reliable.sh was broken for
# hours and all 3 consumers bypassed it with their own sequences — the bypass is the symptom
# of "the narrow interface doesn't exist". THIS adapter is the narrow interface.
#
# WHY INTENT (AC5b): under `claude -p` the delivery mechanism becomes a process launch, but the
# caller's contract — deliver a payload, learn delivered|failed — does not change. Replacing
# this adapter is the whole TUI→-p migration of the delivery path.
#
# DELEGATES TO (reuse, never re-invent):
#   send-keys-reliable.sh         the hardened 5-step clear/send/submit/poll procedure
#   transcript-delivery-check.ts  the pure delivery verdict (the only trusted signal)
# A FRESH-session path (transcript file absent — a re-spawned session creates its transcript
# only on first committed input): direct reliable send + bounded wait for the file + pure verify.
# The transcript is resolved here so callers never discover it themselves:
#   --transcript <path>  the literal transcript jsonl (a known session)
#   --root <path>        auto-discover the newest transcript under ~/.claude/projects/<slug>/
#                        (slug = <path> with '/' → '-'; the config-not-inferred rule's one
#                        documented exception, same as os-anchor-watchdog.sh)
#
# Usage:
#   supervisor-deliver.sh <tmux-target> <payload> [--transcript <path>|--root <path>]
#   supervisor-deliver.sh <host>:<tmux-target> <payload> [--transcript <path>|--root <path>]
#   supervisor-deliver.sh <tmux-target> <payload> --host <fqdn> [--transcript <path>|--root <path>]
# Exit: 0 = delivered (a real user message matching <payload> in the target transcript)
#       1 = failed (undelivered after bounded retries — needs human)
#       2 = usage / environment error (fail loud)
# Env:  SUPERVISOR_DELIVER_VERIFY_S   overall delivery bound (default 60)
#       SUPERVISOR_DELIVER_HOST       resolved remote host (empty = local); also set by --host/<host>:
#       SUPERVISOR_DELIVER_SSH        ssh binary (default `ssh`; a test mock substitutes this)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELIABLE="$SELF_DIR/send-keys-reliable.sh"
CHECKER="$SELF_DIR/transcript-delivery-check.ts"

TARGET="${1:-}"
PAYLOAD="${2:-}"
TRANSCRIPT=""
ROOT=""
HOST=""
VERIFY_S="${SUPERVISOR_DELIVER_VERIFY_S:-60}"

usage() {
  echo "用法: $0 <tmux目标|host:tmux目标> <文本> [--transcript <transcript.jsonl>|--root <项目根>] [--host <fqdn>] [--verify-s <秒>]" >&2
  echo "退出码: 0=已送达 · 1=未送达(需人工) · 2=用法/环境错误" >&2
}

# ── arg parse ────────────────────────────────────────────────────────────────────────────────────
i=3
while [ "$i" -le "$#" ]; do
  case "${!i}" in
    --transcript)
      i=$(( i + 1 ))
      [ "$i" -le "$#" ] || { usage; exit 2; }
      TRANSCRIPT="${!i}"
      ;;
    --root)
      i=$(( i + 1 ))
      [ "$i" -le "$#" ] || { usage; exit 2; }
      ROOT="${!i}"
      ;;
    --verify-s)
      i=$(( i + 1 ))
      [ "$i" -le "$#" ] || { usage; exit 2; }
      VERIFY_S="${!i}"
      ;;
    --host)
      i=$(( i + 1 ))
      [ "$i" -le "$#" ] || { usage; exit 2; }
      HOST="${!i}"
      ;;
    *)
      usage
      exit 2
      ;;
  esac
  i=$(( i + 1 ))
done

[ -n "$TARGET" ] || { usage; exit 2; }
[ -n "$PAYLOAD" ] || { echo "supervisor-deliver: 文本为空" >&2; exit 2; }
{ [ -n "$TRANSCRIPT" ] || [ -n "$ROOT" ]; } || { echo "supervisor-deliver: 需要 --transcript 或 --root 以解析目标会话 transcript" >&2; exit 2; }
{ [ -n "$TRANSCRIPT" ] && [ -n "$ROOT" ]; } && { echo "supervisor-deliver: --transcript 与 --root 二选一" >&2; exit 2; }

# ── cross-host target resolution (gap-supervisor-deliver-cross-host-target-support) ──────────
# Two target forms:
#   <host>:<tmux-target>   e.g. ad-arm1.wan.hwang.men:archguard-0:outer — the first ':'-segment
#                          (the part BEFORE the <session>:<window> pair) is the HOST. A local tmux
#                          target is <session>:<window> — exactly ONE ':' — so the implicit host form
#                          is only taken when the target carries at least TWO ':'.
#   --host <fqdn>          the explicit form — TARGET is a plain tmux target, HOST separate.
# When HOST is set, every tmux interaction below routes through `ssh $HOST tmux …` (the env pair
# SUPERVISOR_DELIVER_HOST / SUPERVISOR_DELIVER_SSH — the SAME seam the checker and classifier read),
# so a cross-host delivery keeps the identical three-send-keys + pure-verify surface.
HOST="${HOST:-}"
SSH_BIN="${SUPERVISOR_DELIVER_SSH:-ssh}"
if [[ "$TARGET" == *:*:* ]]; then
  implicit_host="${TARGET%%:*}"
  TARGET="${TARGET#*:}"
  if [ -n "$HOST" ] && [ "$HOST" != "$implicit_host" ]; then
    echo "supervisor-deliver: --host '$HOST' 与目标前缀 '$implicit_host' 冲突——二选一" >&2
    exit 2
  fi
  [ -n "$HOST" ] || HOST="$implicit_host"
fi

# ── remote-aware delivery helpers (gap-supervisor-deliver-cross-host-target-support) ──────────
# Every tmux interaction routes through these: LOCAL → bare `tmux` (resolves via TMUX_TMPDIR);
# CROSS-HOST → ONE `ssh $HOST tmux …` round-trip per call, args shell-quoted (printf %q). The
# fresh path's three send-keys (C-u / literal text / Enter) are THREE separate ssh invocations —
# the same "三次分开调用" the local path uses, forwarded over ssh.
tmux_cmd() {
  local a q=""
  if [ -n "$HOST" ]; then
    for a in "$@"; do q+="$(printf '%q ' "$a")"; done
    "$SSH_BIN" "$HOST" "tmux ${q}"
  else
    tmux "$@"
  fi
}

send_key() {  # send_key <C-u|Enter>
  tmux_cmd send-keys -t "$TARGET" "$1"
}

send_text_literal() {  # send_text_literal <text> — the -l payload, forwarded exactly over ssh
  if [ -n "$HOST" ]; then
    local q
    q="$(printf '%q' "$1")"
    "$SSH_BIN" "$HOST" "tmux send-keys -t $(printf '%q' "$TARGET") -l ${q}"
  else
    tmux send-keys -t "$TARGET" -l "$1"
  fi
}

file_exists() {  # file_exists <path> — existence test that works locally AND on the remote host
  if [ -n "$HOST" ]; then
    "$SSH_BIN" "$HOST" "test -f $(printf '%q' "$1")" 2>/dev/null
  else
    [ -e "$1" ]
  fi
}

# fail-loud precondition: the delivery verdict depends on the pure checker; a missing checker
# means the deliver-confirmed promise is broken (same rule as send-keys-reliable.sh).
[ -f "$CHECKER" ] || { echo "supervisor-deliver: 缺少校验器 $CHECKER——无法验证送达（依赖未铺？），fail loud" >&2; exit 1; }

# ── transcript resolution ────────────────────────────────────────────────────────────────────────
# --transcript → literal, even if the file does not exist yet (fresh — the file appears on the
# session's first committed input).
# --root → re-spawn mode. The delivery target is the transcript that appears AFTER the send (a
# freshly re-spawned session creates its file on first committed input). A PRE-SEND SNAPSHOT of
# EXISTING paths is kept and the wait loop looks for a file NOT in the snapshot — the just-
# re-spawned session's own file (the same config-not-inferred exception os-anchor-watchdog.sh
# documents). TRANSCRIPT is deliberately NOT resolved to any pre-existing file here: the newest
# pre-existing jsonl is the OLD session's file and is not the delivery target.
PRE_SEND_SNAPSHOT=""
proj_dir=""
if [ -n "$ROOT" ]; then
  slug="$(printf '%s' "$ROOT" | tr '/' '-')"
  proj_dir="${HOME:-/home/yale}/.claude/projects/${slug}"
  if [ -d "$proj_dir" ]; then
    PRE_SEND_SNAPSHOT="$(ls "$proj_dir"/*.jsonl 2>/dev/null | sort | tr '\n' ' ')"
  fi
fi

# ── delivery ─────────────────────────────────────────────────────────────────────────────────────
# Two modes:
#   * --transcript <path> with an EXISTING file → a known, long-lived session: delegate the whole
#     hardened procedure (clear/send/submit/poll) to send-keys-reliable.sh.
#   * --root <path>, OR --transcript whose file does not exist yet → a freshly re-spawned session
#     (its transcript appears only on first committed input): the fresh path — nothing to clear
#     (the welcome-screen ghost text is not removable input — same rule as send-keys-reliable's
#     is-fresh skip), direct send, bounded wait for the file, then pure verify.
# The --root mode ALWAYS takes the fresh path: for a re-spawned session the newest pre-existing
# jsonl is the OLD session's file and is not the delivery target; the target is the file that
# appears after the send (the snapshot rule below).
if [ -z "$ROOT" ] && [ -n "$TRANSCRIPT" ] && file_exists "$TRANSCRIPT"; then
  if [ -f "$RELIABLE" ] && [ -x "$RELIABLE" ]; then
    RELIABLE_DELIVERY_VERIFY_S="$VERIFY_S" \
    SUPERVISOR_DELIVER_HOST="$HOST" \
    SUPERVISOR_DELIVER_SSH="$SSH_BIN" \
    bash "$RELIABLE" "$TARGET" "$PAYLOAD" "$TRANSCRIPT"
    exit $?
  fi
  echo "supervisor-deliver: 缺少可靠投递脚本 $RELIABLE——fail loud" >&2
  exit 1
fi

# ── fresh-session path (transcript absent, or re-spawn via --root) ──────────────────────────────
echo "supervisor-deliver: fresh-session 直接投递 + 有界等待（$([ -n "$TRANSCRIPT" ] && echo "等待 $TRANSCRIPT" || echo "--root 自动发现新 transcript")）" >&2

# Pre-flight target verification (gap-drive-sent-to-manager-pane-not-inner — the three
# disciplines): the target must NAME a window (`quay-0:inner`), never a numeric index, and the
# window name must equal the expected name (env DRIVE_EXPECT_WINDOW_NAME, default `inner`).
# Fail-closed before any direct send-keys — a wrong target (e.g. window 0 = claude/manager) is
# never silently driven. The delegation path (existing --transcript → send-keys-reliable.sh) runs
# the same gate inside send-keys-reliable.sh; the fresh path runs it here.
if [ ! -f "$SELF_DIR/drive-target-check.sh" ]; then
  echo "supervisor-deliver: 缺少前置校验 $SELF_DIR/drive-target-check.sh——无法确认目标是 inner，fail loud" >&2
  exit 1
fi
if ! DRIVE_EXPECT_WINDOW_NAME="${DRIVE_EXPECT_WINDOW_NAME:-inner}" \
     SUPERVISOR_DELIVER_HOST="$HOST" SUPERVISOR_DELIVER_SSH="$SSH_BIN" \
     bash "$SELF_DIR/drive-target-check.sh" "$TARGET"; then
  echo "supervisor-deliver: 目标 $TARGET 未通过前置校验（非 inner 或数字索引）——中止，不发送" >&2
  exit 1
fi

# ── can-receive pre-flight (gap-supervisor-deliver-no-wait-for-idle-retry) ──────────
# Same bounded can-receive wait as send-keys-reliable.sh's step 0: the fresh path does its own direct
# send-keys, so it runs the check HERE rather than delegating. The judgment is the SAME
# pane-state-classify `--can-receive-wait` seam (waiting-input is the only receivable state; a
# non-receivable target is waited on — bounded, re-judge each round — and only a bound expiry fails
# loud, needs human). A freshly re-spawned session that has not rendered its prompt yet is waited on,
# never blindly driven. SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S / _POLL_S bound the wait.
CAN_RECEIVE_WAIT_S="${SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S:-30}"
CAN_RECEIVE_POLL_S="${SUPERVISOR_DELIVER_CAN_RECEIVE_POLL_S:-2}"
if [ ! -f "$SELF_DIR/pane-state-classify.ts" ]; then
  echo "supervisor-deliver: 缺少分类器 $SELF_DIR/pane-state-classify.ts——无法判定目标可接收，fail loud" >&2
  exit 1
fi
if ! SUPERVISOR_DELIVER_HOST="$HOST" SUPERVISOR_DELIVER_SSH="$SSH_BIN" \
     node --experimental-strip-types "$SELF_DIR/pane-state-classify.ts" --can-receive-wait "$TARGET" --wait "$CAN_RECEIVE_WAIT_S" --poll "$CAN_RECEIVE_POLL_S"; then
  echo "supervisor-deliver: 目标 $TARGET 在 ${CAN_RECEIVE_WAIT_S}s 内未转为 waiting-input——fail loud 需人工，不发送（不假装送达）" >&2
  exit 1
fi
echo "supervisor-deliver: 目标 $TARGET 可接收（waiting-input）——继续投递" >&2

# Direct reliable send: fresh session has nothing to clear → C-u (harmless), literal text, Enter.
# Cross-host: THREE separate `ssh <host> tmux send-keys` invocations (the "三次分开调用" contract).
send_key C-u 2>/dev/null || true
sleep 0.5
send_text_literal "$PAYLOAD" 2>/dev/null || true
sleep 0.5
send_key Enter 2>/dev/null || true

# Bounded wait for the transcript file to appear (the send is what creates it — fault 4's
# queuing delay is real; poll, never single-check). With --root, prefer a file NOT in the
# pre-send snapshot (the re-spawned session's own file), newest by mtime; with an explicit
# --transcript, wait for exactly that path.
now=$(date +%s)
deadline=$(( now + VERIFY_S ))
while [ "$(date +%s)" -lt "$deadline" ] && { [ -z "$TRANSCRIPT" ] || [ ! -e "$TRANSCRIPT" ]; }; do
  if [ -n "$ROOT" ] && [ -n "$proj_dir" ] && [ -d "$proj_dir" ]; then
    best=""; best_ts=0
    for f in "$proj_dir"/*.jsonl; do
      [ -e "$f" ] || continue
      case " $PRE_SEND_SNAPSHOT " in *" $f "*) continue ;; esac   # skip pre-existing (old session)
      ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
      if [ "$ts" -gt "$best_ts" ]; then best="$f"; best_ts=$ts; fi
    done
    [ -n "$best" ] && TRANSCRIPT="$best"
  fi
  sleep 2
done

if [ -z "$TRANSCRIPT" ] || [ ! -e "$TRANSCRIPT" ]; then
  echo "supervisor-deliver: FAIL——${VERIFY_S}s 内未出现新 transcript（fresh-session 投递后无落盘）；需要人工" >&2
  exit 1
fi

# Verify delivery via the pure checker (the only trusted signal): a real user message whose
# content contains the payload, appended since baseline 0 (a fresh file — nothing precedes it).
out=$(node --experimental-strip-types "$CHECKER" --check "$TRANSCRIPT" --start 0 --text "$PAYLOAD" 2>&1)
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "supervisor-deliver: 已送达 $TARGET（fresh-session；transcript 出现内容匹配的真实 user message）"
  printf '%s\n' "$out" | sed 's/^/    /'
  exit 0
fi
if [ "$rc" -eq 2 ]; then
  printf '%s\n' "$out" >&2
  echo "supervisor-deliver: transcript 校验失败（exit 2）——fail loud" >&2
  exit 1
fi
echo "supervisor-deliver: FAIL——${VERIFY_S}s 有界等待后 transcript 仍未出现内容匹配的真实 user message；需要人工，不假装成功" >&2
printf '%s\n' "$out" | sed 's/^/    /' >&2
exit 1
