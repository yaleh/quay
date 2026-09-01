#!/usr/bin/env bash
# outer-session-check.sh — manager-adopt 的三态自检（判定 outer 会话，单窗口拓扑）
# (gap-manager-adopt-outer-role-check-broken：manager-adopt.sh 曾复用一个把窗口角色硬编码为
#  "inner" 的三态检查器，而 manager-adopt 要启动的是 outer —— 本脚本把角色换成
#  "outer"，状态机形状（window_exists / has_claude_child / transcript_fresh）与该旧检查器
#  完全一致)。
#
# 判定 outer 会话四态：
#   healthy      窗口存在 + claude 进程存在 + transcript 有真实 user 消息（已被驱动过）
#   empty-shell  窗口存在 + claude 进程存在 + transcript 无真实 user 消息（被拉起但未驱动）
#   missing      窗口不存在 或 无 claude 进程（manager-adopt 调 quay-topology.sh 单窗口工厂创建）
#   degraded     窗口+进程存在，但 transcript 仅由发现启发式解析（TR_SOURCE=discovery）——
#                旧启发式会认错 transcript，无法信任 healthy/empty-shell 判定；fail-closed（不猜）
#
# 判据（AC1「判据用可信的」，与 topology-check.sh / transcript-delivery-check.ts 同源）：
#   窗口存在 —— tmux list-windows 按名寻址（pane 索引会漂，窗口名不会）
#   进程活着 —— pane 本体或其任一子进程 cmdline 含 claude（只认 claude 进程，避免把 shell 当会话本体）
#   user 消息 —— transcript-delivery-check.ts --is-fresh（无真实 user 消息 = fresh = 空壳）
#
# transcript 解析优先级（可靠 > 启发式；全程不猜会话名）：
#   1. --transcript <path>                显式给出（测试接缝 / 调用方已从配置知道 outer transcript）
#   2. SESSION_TRANSCRIPTS env            每行 "<名字> <会话id|绝对路径>"，取 outer 项
#   3. orchestration/session-liveness.env 同格式（source 该文件）
#   4. 发现（启发式，标 source=discovery）：$HOME/.claude/projects/<root-slug>/ 里最晚修改、
#      且不是自己（CLAUDE_CODE_SESSION_ID）的 *.jsonl。退化路径：TR_SOURCE=discovery 必须不静默——
#      stderr 报警 + state=degraded（fail-closed），绝不报 healthy
#   5. 找不到 → transcriptFresh=true（无 transcript = fresh = 空壳判据）
#
# 用法：
#   outer-session-check.sh [--session <sess>] [--transcript <path>] [--json]
#     --session <sess>  目标 tmux 会话（默认：SESSION_TMUX_SESSION → orchestration/session-liveness.env）
#     --transcript <p>  outer transcript.jsonl 路径（覆盖解析）
#     --json            JSON 输出（机器消费）；默认人读表格 + 退出码
#   TOPOLOGY_CLAUDE_PATTERN —— 覆盖「claude 进程」匹配串（测试用 exec -a claude-probe sleep 造进程）
#
# 输出 JSON：{ session, window, process, transcript, transcriptSource, transcriptFresh, state }
#   state ∈ healthy|empty-shell|missing|degraded（degraded = TR_SOURCE=discovery 退化路径，fail-closed）
# 退出码：0 = 判定完成（state 在 stdout）· 1 = 无会话配置（fail-closed，绝不猜会话名）· 2 = 用法/环境错误
#
# 纯读契约：本脚本只读 tmux 状态、/proc、transcript 文件与配置，不写任何文件、不改任何会话。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
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
  echo "       outer-session-check never guesses a session name (gap-init-guesses-the-tmux-session)." >&2
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

# outer_claude_pid — the outer window's claude process PID (the process↔session 1:1 anchor
# for discovery: its environ's CLAUDE_CODE_SESSION_ID IS the transcript filename). Echoes the
# PID or returns 1. Same traversal as has_claude_child but returns the actual PID.
outer_claude_pid() {
  local sess="$1" role="$2" ppid cpid cmd
  ppid="$(tmux list-panes -t "$sess:$role" -F '#{pane_pid}' 2>/dev/null | head -1)"
  [ -n "$ppid" ] || return 1
  cmd="$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)"
  case "$cmd" in *"$CLAUDE_PATTERN"*) echo "$ppid"; return 0 ;; esac
  for cpid in $(pgrep -P "$ppid" 2>/dev/null); do
    cmd="$(tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null || true)"
    case "$cmd" in *"$CLAUDE_PATTERN"*) echo "$cpid"; return 0 ;; *) continue ;; esac
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
      if [ "$n" = "outer" ]; then
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
      if [ "$n" = "outer" ]; then
        case "$v" in
          /*) TR_PATH="$v"; TR_SOURCE="config"; return 0 ;;
          *) TR_PATH="$HOME/.claude/projects/$(printf '%s' "$REPO_ROOT" | tr '/' '-')/$v.jsonl"; TR_SOURCE="config"; return 0 ;;
        esac
      fi
    done <<< "$(sed -n 's/^SESSION_TRANSCRIPTS=//p' "$REPO_ROOT/orchestration/session-liveness.env" 2>/dev/null)"
  fi
  # 发现（结构性）：outer 窗口 claude 进程 PID → environ 的 CLAUDE_CODE_SESSION_ID → transcript
  # 文件名（进程↔会话 1:1，唯一不会认错的映射）。旧启发式「最晚 jsonl 排除 CLAUDE_CODE_SESSION_ID」
  # 会退化成「最新 jsonl 不是自己」，在 manager 跨项目场景下前提错（可能认错项目 transcript），
  # 故仍标 source=discovery 且 fail-closed（degraded）。
  local slug claude_pid sid cpid environ_unreadable=""
  slug="$(printf '%s' "$REPO_ROOT" | tr '/' '-')"
  claude_pid="$(outer_claude_pid "$SESSION" "outer")" || claude_pid=""
  if [ -n "$claude_pid" ]; then
    # 顶层 claude 的 environ；顶层通常不带 session id（启动时未赋），其 worker/MCP 直接子进程带。
    if [ -r "/proc/$claude_pid/environ" ]; then
      sid="$(tr '\0' '\n' < "/proc/$claude_pid/environ" 2>/dev/null | sed -n 's/^CLAUDE_CODE_SESSION_ID=//p' | head -1)"
    else
      environ_unreadable=1
    fi
    if [ -z "$sid" ]; then
      for cpid in $(pgrep -P "$claude_pid" 2>/dev/null); do
        if [ -r "/proc/$cpid/environ" ]; then
          sid="$(tr '\0' '\n' < "/proc/$cpid/environ" 2>/dev/null | sed -n 's/^CLAUDE_CODE_SESSION_ID=//p' | head -1)"
        else
          environ_unreadable=1
        fi
        [ -n "$sid" ] && break
      done
    fi
    if [ -n "$sid" ]; then
      local p="$HOME/.claude/projects/$slug/$sid.jsonl"
      if [ -f "$p" ]; then
        TR_PATH="$p"; TR_SOURCE="discovery-pid"
        return 0
      fi
    fi
  fi
  # 结构性发现失败：PID 存在但 /proc environ 不可读（非 Linux / hidepid / 权限）——明确报警，
  # 不允许静默回退到旧启发式。若下方回退找到候选，TR_SOURCE=discovery 会再报警一次 + state=degraded。
  if [ -n "$environ_unreadable" ]; then
    echo "WARNING: outer-session-check: /proc environ unreadable for the outer claude pid — cannot structurally resolve the outer transcript (non-Linux host / hidepid / permission). Any DISCOVERY fallback below is LOUD (stderr + state=degraded), never a silent healthy." >&2
  fi
  # 无 PID / 无 session id → 退回旧启发式（best-effort；TR_SOURCE=discovery 区分于 discovery-pid）。
  # 退化路径不静默：下方调用方统一处理 TR_SOURCE=discovery —— stderr 报警 + state=degraded。
  local my_id candidate
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
    echo "ERROR: outer-session-check: transcript 读取失败（$t，exit 2）——fail loud" >&2
    return 2
  fi
  echo "false"; return 0
}

WINDOW_OK=0; PROCESS_OK=0
if window_exists "$SESSION" "outer"; then
  WINDOW_OK=1
  if has_claude_child "$SESSION" "outer"; then
    PROCESS_OK=1
  fi
fi

resolve_transcript

# TR_SOURCE=discovery = 退化路径（旧启发式）。「对结论错证据」静默报 healthy 正是要消灭的形态。
# 不静默：stderr 报警 + state=degraded（fail-closed）。--json 消费者读 transcriptSource==discovery
# 时同样报警。
if [ "$TR_SOURCE" = "discovery" ]; then
  echo "WARNING: outer-session-check: transcript resolved via DISCOVERY heuristic (TR_SOURCE=discovery) — the legacy fallback can misidentify transcripts in a multi-project topology; marking state=degraded (fail-closed), NOT healthy/empty-shell. Structurally resolve the outer transcript (--transcript / SESSION_TRANSCRIPTS) before trusting this self-check." >&2
fi

FRESH=""
if ! FRESH="$(transcript_fresh "$TR_PATH")"; then
  exit 2
fi

if [ "$WINDOW_OK" = "0" ] || [ "$PROCESS_OK" = "0" ]; then
  STATE="missing"
elif [ "$TR_SOURCE" = "discovery" ]; then
  STATE="degraded"
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
