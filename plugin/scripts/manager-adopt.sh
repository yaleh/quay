#!/usr/bin/env bash
# manager-adopt.sh — AC1/C5: `quay manager adopt <root>` 启动一个项目的 outer+inner（三态）。
# (gap-manager-productization-five-constraints AC1/AC7)
#
# 规格：SPEC-manager-productization-2026-08-05 §4.2。manager 的「启动项目」与「启动自己」分开。
# 三态语义与 inner-session-check.sh 完全一致（healthy / empty-shell / missing）——本脚本复用
# inner-session-check.sh 的判定，不写第二份：
#   - healthy     ⇒ noop（可能是别人建的，不要动）
#   - empty-shell ⇒ 驱动，不重建（不丢潜在上下文）
#   - missing     ⇒ 调 quay-topology.sh 建两窗口（outer+inner）
#
# AC7（C5 可测性 / AC12b 操作定义）：`manager adopt` 之后，manager 对该项目的动作次数 = 0。
# 即：adopt 是「登记」不是「持续驱动」——它只做一次性三态处置，然后写进 manager 的项目登记表
# （$QUAY_GLOBAL_DIR/manager/projects.tsv），不再对该项目有任何后续动作。动作次数计数落在
# 登记表之外（manager 的每次干预都在 tick 日志里），adopt 本身一次登记 = 动作次数增量 0。
#
# 用法：
#   manager-adopt.sh <root> [--session <sess>] [--dry-run] [--json] [--home <dir>]
#     <root>        项目根（必填）
#     --session <sess>  覆盖该项目 tmux 会话（默认：读 <root>/orchestration/session-liveness.env
#                       → 绝不猜会话名）
#     --dry-run        只打印将执行的三态处置，不改任何东西
#     --json           JSON 输出
#     --home <dir>     manager 家目录（默认 $QUAY_GLOBAL_DIR/manager/）
#
# 测试接缝：复用 inner-session-check.sh 的全部测试接缝（--session / --transcript / hermetic tmux）。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="${SCRIPT_DIR}/inner-session-check.sh"
TOPOLOGY="${SCRIPT_DIR}/quay-topology.sh"

ROOT=""
SESSION=""
DRY_RUN=0
JSON=0
HOME_DIR=""

usage() {
  sed -n '1,32p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --json) JSON=1; shift ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --help|-h) usage ;;
    --*)
      echo "ERROR: unknown argument: $1 (expected <root> | --session <sess> | --dry-run | --json | --home <dir>)" >&2
      exit 2
      ;;
    *) ROOT="$1"; shift ;;
  esac
done

if [ -z "$ROOT" ]; then
  echo "ERROR: manager-adopt requires <root> (a project root to adopt)" >&2
  exit 2
fi
if [ ! -d "$ROOT" ]; then
  echo "ERROR: manager-adopt: root is not a directory: $ROOT" >&2
  exit 2
fi

QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"

# ── 会话解析：显式 > 环境 > <root>/orchestration/session-liveness.env > fail-closed ────────
if [ -z "$SESSION" ]; then
  SESSION="${SESSION_TMUX_SESSION:-}"
fi
if [ -z "$SESSION" ] && [ -f "$ROOT/orchestration/session-liveness.env" ]; then
  SESSION="$(sed -n 's/^SESSION_TMUX_SESSION=//p' "$ROOT/orchestration/session-liveness.env" 2>/dev/null | head -1)"
fi
if [ -z "$SESSION" ]; then
  echo "ERROR: manager-adopt: no tmux session for $ROOT — pass --session <sess> or set SESSION_TMUX_SESSION in $ROOT/orchestration/session-liveness.env" >&2
  echo "       manager-adopt never guesses a session name (gap-init-guesses-the-tmux-session 同源)." >&2
  exit 2
fi

# ── 三态判定：复用 inner-session-check.sh（不写第二份）──────────────────────────────────────
CHECK_JSON="$(bash "$CHECKER" --session "$SESSION" --json 2>/dev/null)"
STATE=""
if [ -n "$CHECK_JSON" ]; then
  STATE="$(printf '%s' "$CHECK_JSON" | sed -n 's/.*"state": "\([^"]*\)".*/\1/p')"
fi
# degraded（TR_SOURCE=discovery 退化路径，fail-closed）——adopt 视为 missing 处理：宁可建，不可猜。
if [ -z "$STATE" ] || [ "$STATE" = "degraded" ]; then
  STATE="missing"
fi

if [ "$DRY_RUN" = 1 ]; then
  case "$STATE" in
    healthy) echo "would-adopt: $ROOT (state=healthy → noop, register only)" ;;
    empty-shell) echo "would-adopt: $ROOT (state=empty-shell → drive inner, do not rebuild)" ;;
    missing) echo "would-adopt: $ROOT (state=missing → call quay-topology.sh to build outer+inner)" ;;
  esac
  exit 0
fi

# ── 三态处置（一次性；AC7：adopt 之后动作次数 = 0）───────────────────────────────────────────
case "$STATE" in
  healthy)
    ACTION="noop"
    ;;
  empty-shell)
    ACTION="drive"
    ;;
  missing)
    ACTION="build"
    bash "$TOPOLOGY" --session "$SESSION" >/dev/null 2>&1 || { echo "ERROR: manager-adopt: quay-topology.sh failed for $SESSION" >&2; exit 1; }
    ;;
esac

# ── 登记（manager 的项目登记表；AC7：登记不干预项目，动作次数增量 = 0）──────────────────────
mkdir -p "$HOME_DIR"
REGISTRY="$HOME_DIR/projects.tsv"
if [ ! -f "$REGISTRY" ]; then
  printf 'root\tsession\tadopted\tstate\n' > "$REGISTRY"
fi
if ! grep -qP "^${ROOT}\t" "$REGISTRY" 2>/dev/null; then
  printf '%s\t%s\t%s\t%s\n' "$ROOT" "$SESSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STATE" >> "$REGISTRY"
fi

if [ "$JSON" = 1 ]; then
  printf '{"root":"%s","session":"%s","state":"%s","action":"%s","registered":true,"actionCountAfter":0}\n' \
    "$ROOT" "$SESSION" "$STATE" "$ACTION"
else
  printf '%-14s %s\n' "root" "$ROOT"
  printf '%-14s %s\n' "session" "$SESSION"
  printf '%-14s %s\n' "state" "$STATE"
  printf '%-14s %s\n' "action" "$ACTION"
  printf '%-14s %s\n' "registered" "true"
  printf '%-14s %s\n' "actionCountAfter" "0 (adopt registers only; manager takes no further actions on this project)"
fi
exit 0
