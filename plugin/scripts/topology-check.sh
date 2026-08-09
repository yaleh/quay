#!/usr/bin/env bash
# topology-check.sh — 两窗口拓扑在位检查（gap-tmux-session-topology-no-factory-definition, AC3；
# 两窗口修正：gap-manager-baked-into-project-topology-factory——manager 跨项目，不属于项目拓扑）。
#
# 校验 `<project>-N:outer / :inner` 两窗口结构是否真的在位：每个窗口存在，
# 且每个窗口里有一个 claude 进程（不是单 bash 窗口——meta-cc-3/archguard-4 实测只有
# 单个 bash 窗口、无 claude 进程，那正是本检查要消除的失败形态）。
# manager 是跨项目的、由人另行启动，不在本检查的判据内。
#
# 判据（AC3 的正/负控制）：
#   - 单 bash 窗口（无 claude）⇒ 校验必报缺（每个拓扑窗口 MISSING）
#   - 两窗口在位、每层有 claude 进程 ⇒ 通过（exit 0）
#   - 窗口在但无 claude（纯 bash）⇒ 报 NO-CLAUDE
#
# 窗口按名字寻址（pane 索引会漂，窗口名不会，session-launch-recipes §3）。
#
# 用法：
#   topology-check.sh [--session <sess>] [--json]
#     --session <sess>  目标 tmux 会话（默认：TOPOLOGY_SESSION → SESSION_TMUX_SESSION →
#                       orchestration/session-liveness.env 的 SESSION_TMUX_SESSION）
#     --json            JSON 输出（机器消费）
#
# 测试接缝：
#   TOPOLOGY_SESSION      — 覆盖目标会话
#   TOPOLOGY_CLAUDE_PATTERN — 覆盖「claude 进程」的匹配串（默认 claude）。测试用
#                              `exec -a claude-probe sleep` 造进程，靠它命中。
#
# 纯读契约：本脚本只读 tmux 状态与 /proc，不写任何文件、不改任何会话。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SESSION="${TOPOLOGY_SESSION:-}"
JSON=0
CLAUDE_PATTERN="${TOPOLOGY_CLAUDE_PATTERN:-claude}"

usage() {
  sed -n '1,28p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --session <sess> | --json)" >&2
      exit 2
      ;;
  esac
done

# 会话解析（与 quay-topology.sh 同源）：显式 > 环境 > session-liveness.env > fail-closed。
if [ -z "$SESSION" ]; then
  SESSION="${SESSION_TMUX_SESSION:-}"
fi
if [ -z "$SESSION" ] && [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
  _v="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$REPO_ROOT/orchestration/session-liveness.env" 2>/dev/null | head -1)"
  [ -n "$_v" ] && SESSION="$_v"
fi
if [ -z "$SESSION" ]; then
  echo "ERROR: no tmux session given — pass --session <sess> or set SESSION_TMUX_SESSION." >&2
  echo "       topology-check never guesses a session name (gap-init-guesses-the-tmux-session)." >&2
  exit 2
fi

ROLES="outer inner"

# 窗口是否存在（按名字寻址）。
window_exists() {
  tmux list-windows -t "$1" -F '#{window_name}' 2>/dev/null | grep -qx "$2"
}

# pane 本体或其任一子进程的 cmdline 是否含 claude 特征（与 session-liveness.sh 的 session_pid
# 同判据：只认 claude 进程，避免把 shell 当成会话本体；遍历全部子进程而非只取第一个——新起的
# 子进程在 exec 前是瞬时 shell，只取第一个会误判 no-claude）。
has_claude_child() {
  local sess="$1" role="$2" ppid cpid cmd
  ppid="$(tmux list-panes -t "$sess:$role" -F '#{pane_pid}' 2>/dev/null | head -1)"
  [ -n "$ppid" ] || return 1
  # pane 进程本身可能就是 claude（窗口直接 exec claude 的形态）；先查本体再查子进程。
  cmd="$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)"
  case "$cmd" in *"$CLAUDE_PATTERN"*) return 0 ;; esac
  for cpid in $(pgrep -P "$ppid" 2>/dev/null); do
    cmd="$(tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null || true)"
    case "$cmd" in *"$CLAUDE_PATTERN"*) return 0 ;; *) continue ;; esac
  done
  return 1
}

ALL_OK=1
# 逐角色状态（tab 分隔 role/state，交给 python3 转 JSON 或直接打印）。
STATES=""
for role in $ROLES; do
  state="ok"
  if ! window_exists "$SESSION" "$role"; then
    state="missing"
  elif ! has_claude_child "$SESSION" "$role"; then
    state="no-claude"
  fi
  if [ "$state" != "ok" ]; then ALL_OK=0; fi
  STATES+="$role	$state"$'\n'
done

if [ "$JSON" = 1 ]; then
  SESSION="$SESSION" ALL_OK="$ALL_OK" STATES="$STATES" python3 - <<'PYEOF'
import json, os, sys
states_lines = os.environ["STATES"].splitlines()
windows = {}
for line in states_lines:
    if not line:
        continue
    role, state = line.split("\t")
    windows[role] = state
print(json.dumps({
    "session": os.environ["SESSION"],
    "ok": os.environ["ALL_OK"] == "1",
    "windows": windows,
}, ensure_ascii=False))
PYEOF
  exit $(( ALL_OK == 1 ? 0 : 1 ))
else
  while IFS=$'\t' read -r role state; do
    [ -n "$role" ] || continue
    printf '%-22s %s\n' "$SESSION:$role" "$state"
  done <<<"$STATES"
  if [ "$ALL_OK" = 1 ]; then
    echo "topology OK: $SESSION has the two-window topology ($(echo "$ROLES" | tr '\n' ' ')) each with a claude process"
    exit 0
  else
    echo "topology INCOMPLETE: $SESSION is missing a topology window or a claude process" >&2
    exit 1
  fi
fi
