#!/usr/bin/env bash
# send-keys-reliable.sh — reliable cross-session send: the five-step algorithm from
# orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md as a script (AC1-AC3 of
# tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script).
#
# WHY (the five measured failure modes — each happened 2026-08-04, not inferred):
#   1. C-u only clears the CURRENT line (readline kill-line); a long multi-line message needs
#      many C-u presses (a 1554-byte message needed 30). → loop C-u + capture-pane until the
#      input box is empty, capped (N=50), fail loud on exhaustion.
#   2. Long text immediately followed by Enter is dropped by the receiver when rendering is not
#      done (the bytes reach tmux fine — Enter 58ms after the text — but the TUI never commits).
#      → after sending the text, poll capture-pane until two consecutive captures are equal.
#   3. Even idle + stable, Enter can still not commit. → the ONLY thing that counts is real
#      delivery (fault 5); on a first delivery timeout, send ONE independent Enter and re-poll.
#   4. "Committed" (input box empty) and "in the transcript" can be ~30s apart (queued). →
#      delivery confirmation is a BOUNDED poll of the transcript jsonl, never a single check.
#   5. The only trusted delivery signal is a REAL user message in the target session's own
#      transcript jsonl whose content contains the sent text. NO pane hash, NO whole-screen
#      equality (outer ruling F superseded send-keys-verified.sh's md5; ADR-016 Amendment
#      boundary (c) forbids it). The verdict is a PURE function in
#      plugin/scripts/transcript-delivery-check.ts (AC4) — no tmux, no hash, unit-testable.
#
# Usage:  plugin/scripts/send-keys-reliable.sh <tmux目标> <文本> <目标会话 transcript.jsonl>
# Exit:   0 = delivered (a real user message matching <文本> appeared in the transcript)
#         1 = failed, fail loud (undelivered after bounded retries — needs human)
#         2 = usage error
# Env:    RELIABLE_CLEAR_MAX          step-1 C-u cap                 (default 50)
#         RELIABLE_STABLE_TIMEOUT_S   step-3 stability bound         (default 10)
#         RELIABLE_DELIVERY_FIRST_S   first poll window before the retry Enter (default 15)
#         RELIABLE_DELIVERY_VERIFY_S  overall delivery bound         (default 60)
#         RELIABLE_DELIVERY_POLL_S    delivery poll interval         (default 5)
#
# Rules (TOOLS-SESSION-HANDOFF / send-keys-verified.sh precedent): no pipeline feeding $?
# (rule 2b) — every tmux/checker exit status is captured by `if cmd; then`, never `cmd | ...`
# then `$?`; no pgrep -f (rule 3). The text is sent with `send-keys -l` so key names inside the
# text are never interpreted as keys.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/transcript-delivery-check.ts"

# fail-loud precondition (gap-laydown-derivation-is-sensitive-to-reference-spelling-... AC4):
# a missing CHECKER must abort at STARTUP, never a silent assignment. The pre-fix script ran the
# whole delivery flow and only failed deep in the step-5 poll when node could not spawn the checker.
if [ ! -f "$CHECKER" ]; then
  echo "send-keys-reliable: 缺少校验器 $CHECKER——无法验证送达（依赖未铺？），fail loud" >&2
  exit 1
fi

TARGET="${1:-}"
TEXT="${2:-}"
TARGET_JSONL="${3:-}"

CLEAR_MAX="${RELIABLE_CLEAR_MAX:-50}"
STABLE_TIMEOUT_S="${RELIABLE_STABLE_TIMEOUT_S:-10}"
DELIVERY_FIRST_S="${RELIABLE_DELIVERY_FIRST_S:-15}"
DELIVERY_VERIFY_S="${RELIABLE_DELIVERY_VERIFY_S:-60}"
DELIVERY_POLL_S="${RELIABLE_DELIVERY_POLL_S:-5}"

usage() {
  echo "用法: $0 <tmux目标> <文本> <目标会话 transcript.jsonl 路径>" >&2
  echo "退出码: 0=已送达 · 1=未送达(已尽力,需人工) · 2=用法错误" >&2
}

[ -n "$TARGET" ] || { usage; exit 2; }
[ -n "$TEXT" ] || { echo "send-keys-reliable: 文本为空" >&2; exit 2; }
[ -n "$TARGET_JSONL" ] || { echo "send-keys-reliable: 缺少目标 transcript 路径" >&2; exit 2; }

# fail-loud precondition (gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure
# AC4): the delivery verdict depends on the pure checker; a MISSING checker means the whole
# deliver-confirmed-verdict promise is broken (the pre-fix script only ASSIGNED CHECKER at line 41
# and silently failed every delivery poll against a nonexistent file — set -uo pipefail cannot catch
# an assignment). Fail at startup with exit 1 + the missing path, never silently assign.
[ -f "$CHECKER" ] || { echo "send-keys-reliable: 缺少校验器 $CHECKER——无法验证送达（依赖未铺？），fail loud" >&2; exit 1; }

# Step 0. The target must exist (positive control: a nonexistent target → fail loud, never a
# silent 0). Nothing is sent before this check.
if ! tmux list-panes -t "$TARGET" -F '#{pane_pid}' >/dev/null 2>&1; then
  echo "send-keys-reliable: 目标 $TARGET 不存在——无法送达" >&2
  exit 1
fi

# Baseline for the delivery poll (fault 4): only content appended AFTER this byte offset may
# count as the NEW user message we just sent. The transcript only grows when the receiver
# commits, so clearing/sending never moves it.
baseline_bytes=0
if [ -f "$TARGET_JSONL" ]; then
  baseline_bytes=$(stat -c %s "$TARGET_JSONL" 2>/dev/null || true)
  baseline_bytes=$((baseline_bytes + 0))
fi

# pane_input_box_empty — the input box is the LAST '❯' prompt line; it is "empty" when nothing
# but whitespace follows the prompt. ADR-016 boundary (b): this reads the bottom input line — a
# targeted shape check, never a whole-screen equality/hash.
pane_input_box_empty() {
  local pane_text="$1"
  local input_line after nbsp
  input_line=$(printf '%s\n' "$pane_text" | grep '❯' | tail -n 1)
  [ -z "$input_line" ] && return 1   # no prompt line → cannot confirm empty → keep clearing
  after="${input_line#*❯}"
  # strip ANSI CSI sequences (capture-pane -p keeps color escapes; the typed text is plain)
  after=$(printf '%s' "$after" | sed -E $'s/\x1B\[[0-9;]*[A-Za-z]//g')
  # NBSP (U+00A0, bytes c2 a0): bash's [:space:] in the C locale does NOT include NBSP, so an EMPTY
  # Claude Code input box (whose prompt is ❯ + c2 a0 c2 a0) would otherwise be judged non-empty and
  # the clear loop would run all CLEAR_MAX=50 then fail loud. Strip the exact two-byte NBSP sequence
  # explicitly; do NOT rely on [:space:] locale behavior.
  nbsp=$'\302\240'
  after="${after//$nbsp/}"
  case "$after" in
    *[![:space:]]*) return 1 ;;   # non-whitespace (anything other than NBSP/spaces) → not empty
    *) return 0 ;;
  esac
}

# Step 0.5 (welcome-screen ghost text — gap-send-keys-reliable-welcome-screen-ghost-drive-fails):
# a FRESH session (target transcript absent, or present with ZERO real user messages) has no typed
# input yet — but its welcome screen renders a REAL ghost suggestion AFTER the prompt
# (`❯ Try "fix lint errors"`), which is VISIBLE text that the C-u clear loop can NEVER remove
# (the 11:40 watchdog drive failure root cause: the clear loop ran all CLEAR_MAX=50 against the
# ghost text and failed loud rc=1). A fresh session has nothing real to clear, so SKIP the clear
# loop and send directly. The verdict is the pure `--is-fresh` mode of the checker (exit 0 =
# fresh, 1 = not fresh, 2 = IO/usage → fail loud). The NBSP empty-box path below (step 1) still
# handles the NON-fresh case: an already-active session whose empty input box renders as
# `❯`+NBSP still walks the clear loop (AC2 — no regression).
fresh_session=0
if node --experimental-strip-types "$CHECKER" --is-fresh "$TARGET_JSONL" >/dev/null 2>&1; then
  fresh_session=1
else
  fresh_rc=$?
  if [ "$fresh_rc" -eq 2 ]; then
    echo "send-keys-reliable: transcript 读取失败（exit 2）——fail loud" >&2
    exit 1
  fi
  fresh_session=0
fi

# Step 1 (fault 1): loop C-u + capture-pane until the input box is empty; cap at CLEAR_MAX;
# fail loud on exhaustion rather than silently continuing. SKIPPED ENTIRELY on a fresh session
# (nothing to clear — the welcome screen's ghost suggestion is not removable input).
clear_ok=0
if [ "$fresh_session" -ne 1 ]; then
  i=0
  while [ "$i" -lt "$CLEAR_MAX" ]; do
    tmux send-keys -t "$TARGET" C-u
    pane=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null || true)
    if [ -z "$pane" ] || pane_input_box_empty "$pane"; then
      clear_ok=1
      break
    fi
    i=$((i + 1))
  done
  if [ "$clear_ok" -ne 1 ]; then
    echo "send-keys-reliable: 输入框在 ${CLEAR_MAX} 次 C-u 后仍未清空——fail loud，不静默继续" >&2
    exit 1
  fi
else
  echo "send-keys-reliable: fresh session（transcript 无 user 消息）——SKIP 清屏循环，直接发送"
fi

# Step 2 (fault 2, part 1): send the text literally.
tmux send-keys -t "$TARGET" -l "$TEXT"

# Step 3 (fault 2, part 2): wait until the receiver has finished rendering — two consecutive
# captures equal. Bounded (STABLE_TIMEOUT_S). If the pane never stabilizes we PROCEED anyway
# because step 5's delivery verification is the authoritative guard (a dropped Enter is exactly
# the case the retry Enter there catches).
stable=0
end=$(( $(date +%s) + STABLE_TIMEOUT_S ))
while [ "$(date +%s)" -lt "$end" ]; do
  a=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null || true)
  sleep 0.3
  b=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null || true)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then
    stable=1
    break
  fi
done
if [ "$stable" -ne 1 ]; then
  echo "send-keys-reliable: 警告——pane 在 ${STABLE_TIMEOUT_S}s 内未达到连续两次一致；继续提交（步骤 5 会验证真实送达）" >&2
fi

# Step 4 (fault 2, part 3): submit.
tmux send-keys -t "$TARGET" Enter

# run_checker — one delivery-verification attempt. exit 0 = delivered; 1 = not yet; 2 = IO/usage
# (a 2 is an environment failure: fail loud immediately, never poll a broken transcript). The
# checker is a PURE function (transcript-delivery-check.ts); no tmux, no hash, no fake TUI.
run_checker() {
  if out=$(node --experimental-strip-types "$CHECKER" --check "$TARGET_JSONL" --start "$baseline_bytes" --text "$TEXT" 2>&1); then
    return 0
  fi
  local code=$?
  if [ "$code" -eq 2 ]; then
    printf '%s\n' "$out" >&2 2>/dev/null || true
    echo "send-keys-reliable: transcript 校验失败（exit 2）——fail loud" >&2
    exit 1
  fi
  return 1
}

# Step 5 (faults 3/4/5): BOUNDED poll of the target transcript until a real user message
# matching TEXT appears (fault 4: a ~30s queuing delay is real — poll, never single-check). If
# the first window (DELIVERY_FIRST_S) expires with no match, send ONE independent Enter (fault
# 3's fix — a committed Enter can still fail to submit) and keep polling; if the OVERALL bound
# expires with no match → fail loud (needs human, never pretend success).
now=$(date +%s)
deadline_first=$(( now + DELIVERY_FIRST_S ))
deadline_total=$(( now + DELIVERY_VERIFY_S ))
phase=1
delivered=0
while [ "$(date +%s)" -lt "$deadline_total" ]; do
  if run_checker; then
    delivered=1
    echo "send-keys-reliable: 已送达 $TARGET（transcript 出现内容匹配的真实 user message）"
    [ -n "${out:-}" ] && printf '%s\n' "$out"
    break
  fi
  if [ "$phase" -eq 1 ] && [ "$(date +%s)" -ge "$deadline_first" ]; then
    echo "send-keys-reliable: ${DELIVERY_FIRST_S}s 内未见送达——补发一次独立 Enter（故障 3 修法），重新计时" >&2
    tmux send-keys -t "$TARGET" Enter
    phase=2
  fi
  sleep "$DELIVERY_POLL_S"
done

if [ "$delivered" -ne 1 ]; then
  echo "send-keys-reliable: FAIL——${DELIVERY_VERIFY_S}s 有界轮询后 transcript 仍未出现内容匹配的真实 user message（已含一次独立 Enter 补发）；需要人工，不假装成功" >&2
  exit 1
fi

exit 0
