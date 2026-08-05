#!/usr/bin/env bash
# inner-session-check.sh — 外层冷启动第 3 步的三态自检
# (gap-outer-self-checks-and-creates-inner-session)。
#
# 判定 inner 会话三态（AC1/AC2/AC3/AC4）：
#   healthy      窗口存在 + claude 进程存在 + transcript 有真实 user 消息（已被驱动过）
#   empty-shell  窗口存在 + claude 进程存在 + transcript 无真实 user 消息（被拉起但未驱动，
#                —— 11:40 watchdog 形态；外层 DRIVE 而非重建，不丢潜在上下文）
#   missing      窗口不存在 或 无 claude 进程（外层调 quay-topology.sh 两窗口工厂创建）
#
# 判据（AC1「判据用可信的」，与 topology-check.sh / transcript-delivery-check.ts 同源）：
#   窗口存在 —— tmux list-windows 按名寻址（pane 索引会漂，窗口名不会，session-launch-recipes §3）
#   进程活着 —— pane 本体或其任一子进程 cmdline 含 claude（与 topology-check.sh 的 has_claude_child
#              同判据：只认 claude 进程，避免把 shell 当会话本体）
#   user 消息 —— transcript-delivery-check.ts --is-fresh（无真实 user 消息 = fresh = 空壳）。
#               不用 pane 哈希 3 次假阳、不用 heartbeat 冻结 42 分钟假警（任务 Proposal ③）。
#
# transcript 解析优先级（可靠 > 启发式；全程不猜会话名）：
#   1. --transcript <path>                显式给出（测试接缝 / 外层已从配置知道 inner transcript）
#   2. SESSION_TRANSCRIPTS env            每行 "<名字> <会话id|绝对路径>"，取 inner 项
#                                          （与 session-liveness.sh 的 transcript_for 同格式同解析）
#   3. orchestration/session-liveness.env 同格式（source 该文件）
#   4. 发现（启发式，标 source=discovery）：$HOME/.claude/projects/<root-slug>/ 里最晚修改、
#      且不是外层自己（CLAUDE_CODE_SESSION_ID）的 *.jsonl——inner 由工厂新建时其 transcript 是
#      该目录最新的「非外层」jsonl。外层自己的 transcript 必含 user 消息，排除它才能区分 healthy。
#   5. 找不到 → transcriptFresh=true（无 transcript = fresh = 空壳判据；外层驱动不重建）
#
# 用法：
#   inner-session-check.sh [--session <sess>] [--transcript <path>] [--json]
#     --session <sess>  目标 tmux 会话（默认：SESSION_TMUX_SESSION → orchestration/session-liveness.env）
#     --transcript <p>  inner transcript.jsonl 路径（覆盖解析）
#     --json            JSON 输出（机器消费）；默认人读表格 + 退出码
#   TOPOLOGY_CLAUDE_PATTERN —— 覆盖「claude 进程」匹配串（测试用 exec -a claude-probe sleep 造进程）
#
# 输出 JSON：{ session, window, process, transcript, transcriptSource, transcriptFresh, state }
# 退出码：0 = 判定完成（state 在 stdout）· 1 = 无会话配置（fail-closed，绝不猜会话名）· 2 = 用法/环境错误
#
# 纯读契约：本脚本只读 tmux 状态、/proc、transcript 文件与配置，不写任何文件、不改任何会话。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="${SCRIPT_DIR}/transcript-delivery-check.ts"

SESSION="${SESSION_TMUX_SESSION:-}"
TRANSCRIPT=""
JSON=0
CLAUDE_PATTERN="${TOPOLOGY_CLAUDE_PATTERN:-claude}"

usage() {
  sed -n '1,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --transcript) TRANSCRIPT="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --session <sess> | --transcript <path> | --json)" >&2
      exit 2
      ;;
  esac
done

# 会话解析（与 topology-check.sh / quay-topology.sh 同源）：显式 > 环境 > session-liveness.env > fail-closed。
if [ -z "$SESSION" ]; then
  SESSION="${SESSION_TMUX_SESSION:-}"
fi
if [ -z "$SESSION" ] && [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
  _v="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$REPO_ROOT/orchestration/session-liveness.env" 2>/dev/null | head -1)"
  [ -n "$_v" ] && SESSION="$_v"
fi
if [ -z "$SESSION" ]; then
  echo "ERROR: no tmux session given — pass --session <sess> or set SESSION_TMUX_SESSION." >&2
  echo "       inner-session-check never guesses a session name (gap-init-guesses-the-tmux-session)." >&2
  exit 1
fi

# 窗口是否存在（按名字寻址）。
window_exists() {
  tmux list-windows -t "$1" -F '#{window_name}' 2>/dev/null | grep -qx "$2"
}

# pane 本体或其任一子进程的 cmdline 是否含 claude 特征（与 topology-check.sh 的 has_claude_child
# 同判据：只认 claude 进程；遍历全部子进程而非只取第一个——新起的子进程在 exec 前是瞬时 shell）。
has_claude_child() {
  local sess="$1" role="$2" ppid cpid cmd
  ppid="$(tmux list-panes -t "$sess:$role" -F '#{pane_pid}' 2>/dev/null | head -1)"
  [ -n "$ppid" ] || return 1
  cmd="$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)"
  case "$cmd" in *"$CLAUDE_PATTERN"*) return 0 ;; esac
  for cpid in $(pgrep -P "$ppid" 2>/dev/null); do
    cmd="$(tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null || true)"
    case "$cmd" in *"$CLAUDE_PATTERN"*) return 0 ;; *) continue ;; esac
  done
  return 1
}

# transcript 解析。返回值经全局 TR_PATH/TR_SOURCE 传递。
# 优先级：--transcript > SESSION_TRANSCRIPTS env > session-liveness.env > 发现（启发式）> none。
TR_PATH=""
TR_SOURCE="none"
resolve_transcript() {
  local v n
  if [ -n "$TRANSCRIPT" ]; then
    TR_PATH="$TRANSCRIPT"; TR_SOURCE="arg"; return 0
  fi
  # SESSION_TRANSCRIPTS env：每行 "<名字> <会话id|绝对路径>"，绝对路径直接用，会话 id 解析为
  # $HOME/.claude/projects/<root-slug>/<id>.jsonl（与 session-liveness.sh 的 transcript_for 同规则）。
  if [ -n "${SESSION_TRANSCRIPTS:-}" ]; then
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "inner" ]; then
        case "$v" in
          /*) TR_PATH="$v"; TR_SOURCE="config"; return 0 ;;
          *) TR_PATH="$HOME/.claude/projects/$(printf '%s' "$REPO_ROOT" | tr '/' '-')/$v.jsonl"; TR_SOURCE="config"; return 0 ;;
        esac
      fi
    done <<< "$SESSION_TRANSCRIPTS"
  fi
  # orchestration/session-liveness.env 里可能也有 SESSION_TRANSCRIPTS（管理者/项目配置）。
  if [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
    while read -r n v; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "inner" ]; then
        case "$v" in
          /*) TR_PATH="$v"; TR_SOURCE="config"; return 0 ;;
          *) TR_PATH="$HOME/.claude/projects/$(printf '%s' "$REPO_ROOT" | tr '/' '-')/$v.jsonl"; TR_SOURCE="config"; return 0 ;;
        esac
      fi
    done <<< "$(sed -n 's/^SESSION_TRANSCRIPTS=//p' "$REPO_ROOT/orchestration/session-liveness.env" 2>/dev/null)"
  fi
  # 发现（启发式）：$HOME/.claude/projects/<root-slug>/ 里最晚修改、且不是外层自己的 *.jsonl。
  # 排除外层自己的会话（CLAUDE_CODE_SESSION_ID）——外层自己的 transcript 必含 user 消息，不排除
  # 会把「空壳 inner」误判成「健康」（把外层的消息数到 inner 头上）。
  local slug my_id candidate
  slug="$(printf '%s' "$REPO_ROOT" | tr '/' '-')"
  my_id="${CLAUDE_CODE_SESSION_ID:-}"
  if [ -n "$my_id" ]; then
    candidate="$(ls -t "$HOME/.claude/projects/$slug"/*.jsonl 2>/dev/null | grep -v "/$my_id\.jsonl$" | head -1 || true)"
  else
    candidate="$(ls -t "$HOME/.claude/projects/$slug"/*.jsonl 2>/dev/null | head -1 || true)"
  fi
  if [ -n "$candidate" ]; then
    TR_PATH="$candidate"; TR_SOURCE="discovery"
  fi
  return 0
}

# transcriptFresh：无真实 user 消息 = true（空壳）。transcript-delivery-check.ts --is-fresh：
#   exit 0 = fresh（无 user 消息）· exit 1 = 非 fresh（有 user 消息）· exit 2 = IO/环境错误（fail loud）。
transcript_fresh() {
  local t="$1"
  if [ -z "$t" ]; then
    # 无 transcript 可查 = 无 user 消息（fresh claude 会话在首次输入前不写 jsonl）——空壳判据。
    echo "true"; return 0
  fi
  if node --experimental-strip-types "$CHECKER" --is-fresh "$t" >/dev/null 2>&1; then
    echo "true"; return 0
  fi
  local rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "ERROR: inner-session-check: transcript 读取失败（$t，exit 2）——fail loud" >&2
    return 2
  fi
  echo "false"; return 0
}

WINDOW_OK=0; PROCESS_OK=0
if window_exists "$SESSION" "inner"; then
  WINDOW_OK=1
  if has_claude_child "$SESSION" "inner"; then
    PROCESS_OK=1
  fi
fi

resolve_transcript
FRESH=""
if ! FRESH="$(transcript_fresh "$TR_PATH")"; then
  exit 2
fi

if [ "$WINDOW_OK" = "0" ] || [ "$PROCESS_OK" = "0" ]; then
  STATE="missing"
elif [ "$FRESH" = "true" ]; then
  STATE="empty-shell"
else
  STATE="healthy"
fi

if [ "$JSON" = 1 ]; then
  SESSION="$SESSION" WINDOW_OK="$WINDOW_OK" PROCESS_OK="$PROCESS_OK" \
  TR_PATH="$TR_PATH" TR_SOURCE="$TR_SOURCE" FRESH="$FRESH" STATE="$STATE" python3 - <<'PYEOF'
import json, os
print(json.dumps({
    "session": os.environ["SESSION"],
    "window": os.environ["WINDOW_OK"] == "1",
    "process": os.environ["PROCESS_OK"] == "1",
    "transcript": os.environ["TR_PATH"] or None,
    "transcriptSource": os.environ["TR_SOURCE"],
    "transcriptFresh": os.environ["FRESH"] == "true",
    "state": os.environ["STATE"],
}, ensure_ascii=False))
PYEOF
  exit 0
fi

printf '%-14s %s\n' "session" "$SESSION"
printf '%-14s %s\n' "window" "$([ "$WINDOW_OK" = 1 ] && echo present || echo missing)"
printf '%-14s %s\n' "process" "$([ "$PROCESS_OK" = 1 ] && echo present || echo missing)"
printf '%-14s %s\n' "transcript" "${TR_PATH:-none}"
printf '%-14s %s\n' "transcript-source" "$TR_SOURCE"
printf '%-14s %s\n' "transcript-fresh" "$FRESH"
printf '%-14s %s\n' "state" "$STATE"
exit 0
