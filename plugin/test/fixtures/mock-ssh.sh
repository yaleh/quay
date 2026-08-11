#!/usr/bin/env bash
# mock-ssh.sh — hermetic stand-in for `ssh` in cross-host delivery tests
# (tasks/gap-supervisor-deliver-cross-host-target-support, AC2/AC3).
#
# Emulates a REMOTE host that runs a tmux server with a Claude Code session + a transcript file.
# The "remote" transcript is a REAL local temp file the test controls (SUPERVISOR_DELIVER_MOCK_TRANSCRIPT
# and/or the path passed as --transcript), so the whole cross-host round-trip stays on one machine
# while the PRODUCTION scripts exercise the REAL ssh-forwarding code path: SUPERVISOR_DELIVER_SSH=<this>
# substitutes for `ssh` everywhere the scripts / checker / classifier would spawn it.
#
# Protocol: $1 = host, then the remote command exactly as ssh would join argv into ONE string
# (the scripts pass a single shell command string as their last ssh arg; the checker passes
# `cat <path>` as separate argv which `"$*"` re-joins). Every invocation is APPENDED to
# $SUPERVISOR_DELIVER_MOCK_LOG (one line per ssh call) so a test can assert the exact
# three-send-keys (C-u / -l payload / Enter) + cat + stat call SEQUENCE and the HOST.
#
# Emulated remote behavior:
#   tmux capture-pane -p -t <tgt>      → $SUPERVISOR_DELIVER_MOCK_PANE (default: the ❯ waiting-input prompt)
#   tmux send-keys -t <tgt> C-u|Enter  → no-op
#   tmux send-keys -t <tgt> -l <text>  → append a REAL user JSONL record to $SUPERVISOR_DELIVER_MOCK_TRANSCRIPT
#                                        (the payload the script forwarded with printf %q is decoded)
#   tmux list-windows / display-message→ $SUPERVISOR_DELIVER_MOCK_WINDOW (the window the gate expects)
#   cat <path>                         → cat <path> (the "remote" transcript is a real local file)
#   test -f <path>                     → file-exists test on <path>
#   stat -c %s|%Y <path>               → stat of <path>
#   ls <dir>/*.jsonl                   → ls of <dir> (remote --root discovery; a leading ~ expands to
#                                        $SUPERVISOR_DELIVER_MOCK_HOME, the "remote home")
set -u
MOCK_LOG="${SUPERVISOR_DELIVER_MOCK_LOG:-}"
MOCK_WINDOW="${SUPERVISOR_DELIVER_MOCK_WINDOW:-inner}"
MOCK_PANE="${SUPERVISOR_DELIVER_MOCK_PANE:-❯}"
MOCK_TRANSCRIPT="${SUPERVISOR_DELIVER_MOCK_TRANSCRIPT:-}"
MOCK_HOME="${SUPERVISOR_DELIVER_MOCK_HOME:-$HOME}"

host="$1"; shift
cmd="$*"
[ -z "$MOCK_LOG" ] || printf 'HOST=%s CMD=%s\n' "$host" "$cmd" >> "$MOCK_LOG"

# expand a leading ~ to $MOCK_HOME (a remote shell would expand ~; the mock must do the same, since
# its own ~ is the LOCAL home — the two differ in the --root remote-discovery tests)
expand_tilde() {
  local p="$1"
  if [ "${p:0:1}" = "~" ]; then printf '%s%s' "$MOCK_HOME" "${p#\~}"; else printf '%s' "$p"; fi
}

case "$cmd" in
  tmux\ *capture-pane*)
    printf '%s\n' "$MOCK_PANE"
    exit 0
    ;;
  tmux\ *send-keys*)
    # The -l literal-text send is forwarded by the scripts as
    #   `... -l "$(printf '%s' '<base64>' | base64 -d)"`
    # (payload base64-embedded for ssh's argv-join); the other sends are plain keys (C-u / Enter).
    # Recover the base64 and decode it, then materialize the delivery the way a real remote tmux
    # would — a REAL user message appended to the transcript. If no transcript is configured the
    # mock stays silent (the "receiver dropped it" simulation — the deliver path must NOT report
    # delivered).
    if [[ "$cmd" == *"base64 -d"* ]]; then
      b64="$(printf '%s' "$cmd" | sed -n "s/.*'\([A-Za-z0-9+/=]*\)'.*base64.*/\1/p")"
      payload="$(printf '%s' "$b64" | base64 -d 2>/dev/null || true)"
      if [ -n "$MOCK_TRANSCRIPT" ] && [ -n "$payload" ]; then
        printf '{"type":"user","message":{"role":"user","content":"%s"}}\n' "$payload" >> "$MOCK_TRANSCRIPT"
      fi
    fi
    exit 0
    ;;
  tmux\ *list-windows*)
    printf '%s\n' "$MOCK_WINDOW"
    exit 0
    ;;
  tmux\ *display-message*)
    printf '%s\n' "$MOCK_WINDOW"
    exit 0
    ;;
  cat\ *)
    cat "$(expand_tilde "${cmd#cat }")" 2>/dev/null
    exit $?
    ;;
  test\ -f\ *)
    [ -f "$(expand_tilde "${cmd#test -f }")" ] && exit 0 || exit 1
    ;;
  stat\ *)
    # stat -c <fmt> <path>
    fmt="${cmd#stat -c }"; fmt="${fmt%% *}"
    p="$(expand_tilde "${cmd##* }")"
    stat -c "$fmt" "$p" 2>/dev/null
    exit $?
    ;;
  ls\ *)
    # UNQUOTED expansion so the trailing `*.jsonl` glob expands (the remote shell would glob it; the
    # mock must too). Test paths carry no spaces.
    p="$(expand_tilde "${cmd#ls }")"
    ls $p 2>/dev/null
    exit 0
    ;;
  *)
    echo "mock-ssh: unhandled remote command: $cmd" >&2
    exit 1
    ;;
esac
