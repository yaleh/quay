#!/usr/bin/env bash
# quay-topology.sh — 单窗口会话拓扑工厂（gap-tmux-session-topology-no-factory-definition, AC2；
# 单窗口修正：gap-retire-inner-session-references——inner 已由 *-driver 取代，不再建 inner 窗口；
# manager 跨项目，不属于项目拓扑）。
#
# 把 `<project>-N:outer` 单窗口结构按出厂定义建出来
# （定义见 plugin/skills/session-topology/SKILL.md）。manager 是跨项目的，由人另行启动，
# 不属于项目拓扑——本工厂只建 outer。冷启动不再手工拼：
# 每个窗口的运行命令由 plugin/scripts/quay-launch.sh <role> 生成（从检查进仓库的
# .claude/launch.settings.json 读启动参数），本脚本只负责按定义摆窗口。
#
# 幂等：窗口已存在且 claude 进程在位 ⇒ 不动；窗口缺失 ⇒ 建；窗口在但无 claude ⇒ 重拉。
# 窗口按名字寻址（session-launch-recipes §3：pane 索引会漂，窗口名不会）。
#
# 用法：
#   quay-topology.sh [--session <sess>] [--dry-run]
#     --session <sess>  目标 tmux 会话（默认：TOPOLOGY_SESSION → SESSION_TMUX_SESSION →
#                       orchestration/session-config.env 的 SESSION_TMUX_SESSION）
#     --dry-run          只打印将执行的命令，不实际改动（校验用）
#
# 测试接缝：
#   TOPOLOGY_LAUNCH_CMD — 覆盖每个窗口的运行命令（默认 <repo>/plugin/scripts/quay-launch.sh <role>）。
#                         测试用它喂无害命令，避免真的起 claude。
#
# 依赖：tmux、jq（经 quay-launch.sh）。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SESSION="${TOPOLOGY_SESSION:-}"
DRY_RUN=0

usage() {
  sed -n '1,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --session <sess> | --dry-run)" >&2
      exit 2
      ;;
  esac
done

# 会话解析：--session / TOPOLOGY_SESSION → 环境 → session-config.env → fail-closed。
# 绝不猜一个会话名（gap-init-guesses-the-tmux-session 同源）。
if [ -z "$SESSION" ]; then
  SESSION="${SESSION_TMUX_SESSION:-}"
fi
if [ -z "$SESSION" ] && [ -f "$REPO_ROOT/orchestration/session-config.env" ]; then
  _v="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$REPO_ROOT/orchestration/session-config.env" 2>/dev/null | head -1)"
  [ -n "$_v" ] && SESSION="$_v"
fi
if [ -z "$SESSION" ]; then
  echo "ERROR: no tmux session given — pass --session <sess> or set SESSION_TMUX_SESSION." >&2
  echo "       quay-topology never guesses a session name (gap-init-guesses-the-tmux-session)." >&2
  exit 2
fi

# 拓扑窗口（单窗口 outer；inner 层已由 *-driver 后台进程取代，不再是 tmux 窗口）。manager 跨项目，不属于项目拓扑。
ROLES="outer"
LAUNCH_CMD_OVERRIDE="${TOPOLOGY_LAUNCH_CMD:-}"

launch_cmd() {
  local role="$1"
  if [ -n "$LAUNCH_CMD_OVERRIDE" ]; then
    printf '%s\n' "$LAUNCH_CMD_OVERRIDE"
  else
    printf 'bash %s/plugin/scripts/quay-launch.sh %s\n' "$REPO_ROOT" "$role"
  fi
}

# 窗口是否存在（按名字寻址）。
window_exists() {
  tmux list-windows -t "$1" -F '#{window_name}' 2>/dev/null | grep -qx "$2"
}

# pane 本体或其任一子进程是 claude（与 session-observation.sh 的 session_pid 同判据，但遍历全部
# 子进程而非只取第一个——新起的子进程在 exec 前是瞬时 shell，只取第一个会误判 no-claude）。
has_claude_child() {
  local sess="$1" role="$2" ppid cpid cmd
  ppid="$(tmux list-panes -t "$sess:$role" -F '#{pane_pid}' 2>/dev/null | head -1)"
  [ -n "$ppid" ] || return 1
  # pane 进程本身可能就是 claude（窗口直接 exec claude 的形态）；先查本体再查子进程。
  cmd="$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)"
  case "$cmd" in *claude*) return 0 ;; esac
  for cpid in $(pgrep -P "$ppid" 2>/dev/null); do
    cmd="$(tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null || true)"
    case "$cmd" in *claude*) return 0 ;; *) continue ;; esac
  done
  return 1
}

# ── 单飞锁（AC6，gap-manager-productization-five-constraints）──────────────────────────────────────
# 双创建者竞态（SPEC-manager-productization §7 裁定①：谁发现缺失谁创建，但创建必须走同一幂等入口+锁）：
# 两个并发调 quay-topology.sh 都判「会话缺失」⇒ 不锁会双重创建（两个新会话、两套窗口）。
# 锁保证「检查+创建」临界区单飞：先到者建，后到者等锁释放后再查（此时已 in-place，不再创建）。
#
# 锁原语：mkdir 原子创建（wx 语义）；获取失败 ⇒ 重试；超过存活窗口 ⇒ 陈旧回收（rmdir 后重试）。
# 锁目录可经 TOPOLOGY_LOCK_DIR 覆盖（测试接缝：指向临时目录）；默认 <TMPDIR>/quay-topology-locks/。
LOCK_BASE="${TOPOLOGY_LOCK_DIR:-${TMPDIR:-/tmp}/quay-topology-locks}"
LOCK_DIR="${LOCK_BASE}/$(printf '%s' "$SESSION" | tr '/ ' '__').lock"
LOCK_RETRIES="${TOPOLOGY_LOCK_RETRIES:-100}"       # 100 × 0.1s = 10s 上限
LOCK_STALE="${TOPOLOGY_LOCK_STALE_SECONDS:-60}"    # 超过 60s 的锁视为陈旧（创建者崩溃，可回收）
LOCK_ACQUIRED=0

acquire_lock() {
  local i=0 now lock_mtime
  # The lock dir's PARENT must exist for the atomic `mkdir` to have anything to create in — a fresh
  # /tmp (or a cleaned TMPDIR) has no quay-topology-locks/, so without this the atomic mkdir fails
  # with ENOENT and the retry loop spins to timeout while the lock is actually free.
  mkdir -p "$LOCK_BASE" 2>/dev/null || true
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ -d "$LOCK_DIR" ]; then
      lock_mtime="$(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0)"
      now="$(date +%s)"
      if [ -n "$lock_mtime" ] && [ "$lock_mtime" -gt 0 ] && [ $((now - lock_mtime)) -gt "$LOCK_STALE" ]; then
        # 陈旧回收：持有者崩溃遗留的锁（超时未释放），rmdir 后继续尝试获取。
        rmdir "$LOCK_DIR" 2>/dev/null && continue
      fi
    fi
    i=$((i + 1))
    if [ "$i" -ge "$LOCK_RETRIES" ]; then
      echo "ERROR: quay-topology: single-flight lock busy after ${LOCK_RETRIES} tries: $LOCK_DIR" >&2
      return 1
    fi
    sleep 0.1
  done
  LOCK_ACQUIRED=1
  return 0
}

release_lock() {
  if [ "$LOCK_ACQUIRED" = 1 ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    LOCK_ACQUIRED=0
  fi
}

if ! acquire_lock; then
  exit 1
fi
trap 'release_lock' EXIT

# 会话不存在 ⇒ 从零建：第一个角色（outer）即会话首窗（窗口 0）。
# FIRST 初始化空串：会话已存在时保持空，循环里 `[ "$role" = "$FIRST" ]` 在 set -u 下安全。
SESSION_EXISTED=1
FIRST=""
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  SESSION_EXISTED=0
  FIRST="${ROLES%% *}"
  CMD="$(launch_cmd "$FIRST")"
  if [ "$DRY_RUN" = 1 ]; then
    echo "would-create-session: tmux new-session -d -s $SESSION -n $FIRST \"$CMD\""
  else
    # tmux new-session -d is async from a concurrent peer's view: a second single-flight creator
    # that acquires the lock immediately after us can still see has-session as MISSING for a
    # moment even though we created it (the AC6 dual-creator race). Make the create IDEMPOTENT:
    # if new-session fails because the session already exists, treat it as in-place — the
    # single-flight invariant is exactly-one-session, not exactly-one-create-command.
    if tmux new-session -d -s "$SESSION" -n "$FIRST" "$CMD" 2>/dev/null; then
      echo "create-session: tmux new-session -d -s $SESSION -n $FIRST"
      echo "  launched: $SESSION:$FIRST"
    else
      echo "in-place: $SESSION:$FIRST (session appeared concurrently — single-flight preserved)"
      SESSION_EXISTED=1
      FIRST=""
    fi
  fi
fi

# 逐个角色确保窗口在位。首窗若是刚随会话创建，跳过（刚起的 claude 未就绪，直接判会误走重拉路径）。
for role in $ROLES; do
  if [ "$role" = "$FIRST" ] && [ "$SESSION_EXISTED" = 0 ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "would-create (first window): $SESSION:$role (the new session's window 0)"
    else
      echo "in-place: $SESSION:$role (first window of the new session)"
    fi
    continue
  fi
  if window_exists "$SESSION" "$role"; then
    if has_claude_child "$SESSION" "$role"; then
      echo "in-place: $SESSION:$role (claude process present)"
    else
      CMD="$(launch_cmd "$role")"
      if [ "$DRY_RUN" = 1 ]; then
        echo "would-relaunch: tmux send-keys -t $SESSION:$role \"$CMD\" Enter"
      else
        echo "relaunch: $SESSION:$role (window present, no claude child)"
        tmux send-keys -t "$SESSION:$role" "$CMD" Enter
      fi
    fi
  else
    CMD="$(launch_cmd "$role")"
    if [ "$DRY_RUN" = 1 ]; then
      echo "would-create-window: tmux new-window -t $SESSION -n $role \"$CMD\""
    else
      echo "create-window: tmux new-window -t $SESSION -n $role"
      tmux new-window -t "$SESSION" -n "$role" "$CMD"
    fi
  fi
done

echo "topology done: $SESSION ($(echo "$ROLES" | tr '\n' ' '))"
