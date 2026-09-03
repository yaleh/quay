#!/usr/bin/env bash
# plugin/scripts/session-bootstrap.sh — 裸机会话引导（gap-no-formalized-bare-metal-session-bootstrap）。
#
# 从裸机（没有 tmux 会话）到一个「tmux 窗口布局 + 每窗一个 Claude Code 进程」的会话。
# quay:cold-start 假设这个会话已存在；本脚本是它之前的正式化一步——不再手敲 tmux 命令。
#
# 用法：
#   session-bootstrap.sh [<root>] [<layout>] [--session <sess>] [--dry-run] [--wait <s>]
#                        [--socket <path>] [--help]
#     <root>   项目根（默认 $(pwd)）。用于读 orchestration/session-config.env 的会话名，
#             以及定位 plugin/scripts/quay-launch.sh。
#     <layout> 命名窗口集：`manager/outer`（默认 outer）。
#             每个 token 必须是 manager|outer，按给定顺序创建（窗口按名寻址，顺序不影响正确性）。
#     --session <sess>  覆盖会话名（默认：SESSION_BOOTSTRAP_SESSION → SESSION_TMUX_SESSION →
#                       <root>/orchestration/session-config.env → fail-closed，绝不猜会话名）。
#     --dry-run         只打印将执行的命令，不实际改动（校验用）。
#     --wait <s>        每窗进程存活等待上限秒数（默认 20）。
#     --socket <path>   显式 tmux 控制套接字路径（等价 SESSION_BOOTSTRAP_TMUX_SOCKET）。
#                       测试/隔离用：向每个 tmux 调用注入 `-S <path>`，不依赖 TMUX_TMPDIR
#                       （某些环境忽略 TMUX_TMPDIR，显式 -S 才真正隔离，见 session-bootstrap.test.mjs）。
#
# 幂等（AC2）：窗口已存在且 claude 进程在位 ⇒ 不动；窗口缺失 ⇒ 建；窗口在但无 claude ⇒ 重拉。
# 存活验证（AC1/AC3）：每个窗口启动后必须确认 claude 进程真实存活——不是「命令已发出」。
#   判据复用 session-observation.sh 的 session_pid / quay-topology.sh 的 has_claude_child：
#   找 pane 进程（#\{pane_pid\}）或其任一子进程的 /proc/<pid>/cmdline 是否含 claude 特征
#   （SESSION_BOOTSTRAP_CLAUDE_PATTERN 覆盖，默认 claude）。任一窗口无法确认存活 ⇒ 逐名报
#   FAILED 并退出非零（fail-closed，与本仓其它引导步骤一致）。「不静默留半成品」：所有窗口
#   都先建/重拉/判一次，再统一逐窗报告状态——失败窗口点名，其它窗口也点名（ok 或 FAILED），
#   绝不让某个窗口悄悄建到一半没人知道。
#
# 启动命令：默认 `bash <root>/plugin/scripts/quay-launch.sh <role>`（从检查进仓库的
# .claude/launch.settings.json 读每角色的模型/环境变量，gap-crystallize-launch-config-into-
# checked-in-settings-file）——绝不手打一行 shell。测试接缝 SESSION_BOOTSTRAP_LAUNCH_CMD
# （全局）或 SESSION_BOOTSTRAP_LAUNCH_CMD_<ROLE>（单角色，ROLE 大写）喂无害命令
# （如 `bash -c 'exec -a claude-probe sleep 10000 & wait'`）避免真的起 claude。
#
# 依赖：tmux、jq（经 quay-launch.sh）。
#
# 与 quay-topology.sh 的关系：quay-topology.sh 是「项目拓扑」工厂（单窗口 outer；manager 跨项目，
# 不属于项目拓扑）。本脚本是更高一层的裸机引导入口，接受任意命名布局（含 manager 的完整布局）。
# outer 部分与 quay-topology.sh 的幂等/存活语义一致（同一 has_live_process 判据），
# 唯一差别是本脚本在统一验证阶段等待每窗进程真实存活（AC1 要求「确认活着」而非「命令已发出」）。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 参数解析：前两个位置参数 = root/layout；其余为旗标 ─────────────────────────────────────
SESSION="${SESSION_BOOTSTRAP_SESSION:-}"
SOCKET="${SESSION_BOOTSTRAP_TMUX_SOCKET:-}"
DRY_RUN=0
WAIT="${SESSION_BOOTSTRAP_WAIT:-20}"
POSITIONAL=()

usage() {
  sed -n '1,24p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --socket) SOCKET="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --wait) WAIT="$2"; shift 2 ;;
    --help|-h) usage ;;
    --*)
      echo "ERROR: unknown argument: $1 (expected [<root>] [<layout>] | --session <sess> | --dry-run | --wait <s>)" >&2
      exit 2
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
if [ "${#POSITIONAL[@]}" -gt 2 ]; then
  echo "ERROR: too many positional arguments (expected [<root>] [<layout>])" >&2
  exit 2
fi
ROOT="${POSITIONAL[0]:-$PWD}"
LAYOUT="${POSITIONAL[1]:-outer}"
if [ ! -d "$ROOT" ]; then
  echo "ERROR: root is not a directory: $ROOT" >&2
  exit 2
fi

# ── 布局解析：/ 分隔的角色集，每个角色 ∈ manager|outer，去重保留首次出现 ─────────────
LAYOUT_ROLES=()
IFS='/' read -r -a _tokens <<<"$LAYOUT"
for r in "${_tokens[@]:-}"; do
  [ -n "$r" ] || continue
  case "$r" in
    manager|outer) ;;
    *) echo "ERROR: unknown layout role: '$r' (expected manager|outer in <layout>, got '$LAYOUT')" >&2; exit 2 ;;
  esac
  _dup=0
  for _e in "${LAYOUT_ROLES[@]:-}"; do [ "$_e" = "$r" ] && _dup=1; done
  if [ "$_dup" = 0 ]; then LAYOUT_ROLES+=("$r"); fi
done
if [ "${#LAYOUT_ROLES[@]}" -lt 1 ]; then
  echo "ERROR: layout is empty: '$LAYOUT'" >&2
  exit 2
fi

# ── 会话解析：显式 > 环境 > session-config.env > fail-closed（绝不猜会话名）──────────────
if [ -z "$SESSION" ]; then
  SESSION="${SESSION_TMUX_SESSION:-}"
fi
if [ -z "$SESSION" ] && [ -f "$ROOT/orchestration/session-config.env" ]; then
  _v="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$ROOT/orchestration/session-config.env" 2>/dev/null | head -1)"
  [ -n "$_v" ] && SESSION="$_v"
fi
if [ -z "$SESSION" ]; then
  echo "ERROR: no tmux session given — pass --session <sess>, set SESSION_TMUX_SESSION, or set SESSION_TMUX_SESSION= in <root>/orchestration/session-config.env." >&2
  echo "       session-bootstrap never guesses a session name (gap-init-guesses-the-tmux-session 同源)." >&2
  exit 2
fi

CLAUDE_PATTERN="${SESSION_BOOTSTRAP_CLAUDE_PATTERN:-claude}"

# 启动命令：默认 quay-launch.sh <role>；SESSION_BOOTSTRAP_LAUNCH_CMD_<ROLE> 单角色优先，
# SESSION_BOOTSTRAP_LAUNCH_CMD 全局次之（测试接缝）。
launch_cmd() {
  local role="$1" key v
  key="SESSION_BOOTSTRAP_LAUNCH_CMD_$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')"
  v="${!key:-}"
  if [ -n "$v" ]; then printf '%s\n' "$v"; return; fi
  if [ -n "${SESSION_BOOTSTRAP_LAUNCH_CMD:-}" ]; then printf '%s\n' "$SESSION_BOOTSTRAP_LAUNCH_CMD"; return; fi
  printf 'bash %s/plugin/scripts/quay-launch.sh %s\n' "$ROOT" "$role"
}

# tmux 包装：--socket / SESSION_BOOTSTRAP_TMUX_SOCKET 设置时向每次调用注入 `-S <path>`，
# 使脚本可在隔离套接字上运行（测试接缝，见上）。默认无 -S，走 TMUX_TMPDIR / 默认套接字。
TMUX_BASE=()
if [ -n "$SOCKET" ]; then
  TMUX_BASE=(-S "$SOCKET")
fi
_tmux() {
  tmux "${TMUX_BASE[@]}" "$@"
}

# 窗口是否存在（按名寻址；pane 索引会漂，窗口名不会，session-launch-recipes §3）。
window_exists() {
  _tmux list-windows -t "$1" -F '#{window_name}' 2>/dev/null | grep -qx "$2"
}

# pane 进程或其任一子进程的 cmdline 是否含 claude 特征（与 session-observation.sh 的 session_pid /
# quay-topology.sh 的 has_claude_child 同判据：只认 claude 进程，避免把 shell 当成会话本体；
# 遍历全部子进程而非只取第一个——新起的子进程在 exec 前是瞬时 shell，只取第一个会误判）。
has_live_process() {
  local sess="$1" role="$2" ppid cpid cmd
  ppid="$(_tmux list-panes -t "$sess:$role" -F '#{pane_pid}' 2>/dev/null | head -1)"
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

# 轮询等待窗口内 claude 进程真实存活，至多 WAIT 秒。
wait_live() {
  local sess="$1" role="$2" deadline now
  deadline=$(( $(date +%s) + WAIT ))
  while :; do
    has_live_process "$sess" "$role" && return 0
    now="$(date +%s)"
    [ "$now" -lt "$deadline" ] || break
    sleep 0.5
  done
  has_live_process "$sess" "$role"
}

# ── 建/重拉每个角色（幂等），先统一做完，再统一验证 ───────────────────────────────────────
HAS_SESSION=0
if _tmux has-session -t "$SESSION" 2>/dev/null; then HAS_SESSION=1; fi
FAILED=0

for role in "${LAYOUT_ROLES[@]}"; do
  CMD="$(launch_cmd "$role")"

  action="in-place"
  if [ "$HAS_SESSION" = 0 ]; then
    action="create-session"
  elif window_exists "$SESSION" "$role"; then
    if has_live_process "$SESSION" "$role"; then
      action="in-place"
    else
      action="relaunch"
    fi
  else
    action="create-window"
  fi

  if [ "$DRY_RUN" = 1 ]; then
    case "$action" in
      create-session) echo "would-create-session: tmux new-session -d -s $SESSION -n $role \"$CMD\"" ;;
      create-window)  echo "would-create-window: tmux new-window -t $SESSION -n $role \"$CMD\"" ;;
      relaunch)       echo "would-relaunch: tmux send-keys -t $SESSION:$role \"$CMD\" Enter" ;;
      in-place)       echo "would-leave: $SESSION:$role (claude process present)" ;;
    esac
    HAS_SESSION=1   # 干跑：首个 would-create-session 之后，其余角色视为 would-create-window
    continue
  fi

  case "$action" in
    create-session)
      echo "create-session: tmux new-session -d -s $SESSION -n $role"
      if ! _tmux new-session -d -s "$SESSION" -n "$role" "$CMD"; then
        echo "FAILED: $SESSION:$role (session create failed)" >&2
        FAILED=1
      else
        echo "  launched: $SESSION:$role"
        HAS_SESSION=1
      fi
      ;;
    create-window)
      echo "create-window: tmux new-window -t $SESSION -n $role"
      if ! _tmux new-window -t "$SESSION" -n "$role" "$CMD"; then
        echo "FAILED: $SESSION:$role (window create failed)" >&2
        FAILED=1
      else
        echo "  launched: $SESSION:$role"
      fi
      ;;
    relaunch)
      echo "relaunch: $SESSION:$role (window present, no claude child)"
      if ! _tmux send-keys -t "$SESSION:$role" "$CMD" Enter; then
        echo "FAILED: $SESSION:$role (relaunch send-keys failed)" >&2
        FAILED=1
      fi
      ;;
    in-place)
      echo "in-place: $SESSION:$role (claude process present)"
      ;;
  esac
done

if [ "$DRY_RUN" = 1 ]; then
  echo "dry-run: layout '${LAYOUT_ROLES[*]}' on $SESSION (no changes made)"
  exit 0
fi

# ── 统一验证：每个窗口的 claude 进程必须真实存活（AC1/AC3），逐窗点名 ─────────────────────
ALL_OK=1
for role in "${LAYOUT_ROLES[@]}"; do
  if wait_live "$SESSION" "$role"; then
    echo "  verified: $SESSION:$role (claude process live)"
  else
    echo "FAILED: $SESSION:$role (no claude process after ${WAIT}s)" >&2
    ALL_OK=0
  fi
done

if [ "$FAILED" = 0 ] && [ "$ALL_OK" = 1 ]; then
  echo "bootstrap ok: $SESSION layout '${LAYOUT_ROLES[*]}' all windows live"
  exit 0
fi

echo "bootstrap FAILED: $SESSION layout '${LAYOUT_ROLES[*]}'" >&2
exit 1
