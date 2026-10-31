#!/usr/bin/env bash
# manager-tick-log-check.sh — AC5b: manager 每轮状态持久化——机械检查「上一轮 tick 没落行」。
# (gap-manager-productization-five-constraints AC5b)
#
# 规格：AC5b 判据：
#   ① 每轮 tick 必须落一行（写进 manager tick 日志，五列）；
#   ② 存在一条机械检查能报出「上一轮 tick 没落行」；
#   ③ 负控制——人为跳过一轮不写 ⇒ 该检查必须报红。
#
# 实测缺口（任务体）：orchestration/manager-tick-log.md 最后写入 2026-08-04 06:38（两天前），
# 而今天仓库 626 次提交、动过它的 0 次——「规则不缺，缺的是机械挂载点」。本脚本就是那个挂载点。
#
# 新鲜度判据 = 文件的最后写入时刻（mtime）。"上一轮 tick 落行" = 会话把一行写进 tick 日志 =
# 文件被追加写。跳过一轮不写 ⇒ mtime 停在上一轮 ⇒ 超时即报红。行内容判据（①）单独查：
# 日志必须存在且至少有一行 tick 行（非表头、非空）。tick 行有两种写法：
#   - 旧格式（2026-08-07 前）：行首 `| 2026-`（如 `| 2026-08-07 15:5xZ |`）；
#   - 新格式（2026-08-07 16:5x 起）：行首 `| HH:MMZ`（如 `| 17:3xZ |`，分钟可能含掩码 x）。
# 行判据同时数两种格式（gap-manager-tick-log-check-row-criterion-and-shrink-ratchet AC2）：
# 新格式-only 的日志也能通过判据①——修前旧正则只数 `| 2026-`，最近 24 轮新格式行一条没数进。
# 两条合起来：
#   - 没有 tick 行  ⇒ FAIL（一行都没写过）
#   - 有 tick 行但 mtime 超 STALE_HOURS ⇒ FAIL（上一轮 tick 没落行 / 跳了一轮）
#
# 缩水棘轮（同任务 AC3）：manager tick log 是 untrack（人裁定 46ba6360，git 无兜底），且可能被截
# （2026-08-09 00:22 的 read-modify-write 事故把全文截成 0 字节）。行判据只在「旧格式行一条不剩」
# 时逮住截断——277→5 行缩水（保留若干旧格式行）会静默 PASS。棘轮：行数基线，低于基线即报红。
# 基线存 git-tracked sidecar（默认 <LOG>.baseline，独立于 log，同一截断带不走它）；行数 ≥ 基线时
# 若增长则自动上调（只增的棘轮）；行数 < 基线 ⇒ FAIL shrink-detected。
#
# 为什么用 mtime 而不是解析行内时间戳：tick 行的第一列是掩码时间（如 `2026-08-07 03:4xZ`，
# `x` 是防误读的掩码），不可被 date 解析。而 AC5b 的判据本质是「有没有落行」，mtime 精确回答
# 这个问题，且可被 --stale-hours 缩小做负控制测试。
#
# 用法：
#   manager-tick-log-check.sh [--log <path>] [--stale-hours <n>] [--baseline <path>] [--json]
#     --log <path>        manager tick 日志（默认：$MANAGER_TICK_LOG → <repo>/orchestration/manager-tick-log.md）
#     --stale-hours <n>   超过 n 小时没有新 tick 行即报红（默认 24）
#     --baseline <path>   缩水棘轮基线 sidecar（默认 <LOG>.baseline；git-tracked，独立于 log）
#     --json              JSON 输出
#
# 测试接缝：--log 指向临时文件；--stale-hours 缩小（如 1）使负控制可测（人为跳过一行不写 ⇒ 报红）；
# --baseline 指向临时基线文件使缩水棘轮可测（写一个高基线 + 一个小 log ⇒ 报红）。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

LOG="${MANAGER_TICK_LOG:-${REPO_ROOT}/orchestration/manager-tick-log.md}"
STALE_HOURS="${MANAGER_TICK_STALE_HOURS:-24}"
BASELINE_PATH="${MANAGER_TICK_BASELINE:-}"
JSON=0

usage() {
  sed -n '1,43p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --log) LOG="$2"; shift 2 ;;
    --stale-hours) STALE_HOURS="$2"; shift 2 ;;
    --baseline) BASELINE_PATH="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: unknown argument: $1 (expected --log <path> | --stale-hours <n> | --baseline <path> | --json)" >&2
      exit 2
      ;;
  esac
done

# 非负整数校验（fail-closed：缺/坏值按用法错误处理，绝不静默用默认）。
case "$STALE_HOURS" in
  ''|*[!0-9]*) echo "ERROR: --stale-hours must be a non-negative integer, got: '$STALE_HOURS'" >&2; exit 2 ;;
esac

# 判据 ①：日志必须存在且至少有一行 tick 行（旧格式 `| YYYY-` / 新格式 `| HH:MMZ`，二选一）。
if [ ! -f "$LOG" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"no-log","staleHours":%s}\n' "$STALE_HOURS"
  else
    echo "manager-tick-log-check: FAIL — manager tick log not found: $LOG (no tick has ever landed)"
  fi
  exit 1
fi

# 先数 tick 行（新旧两格式）——缩水棘轮与 no-tick-row 判据都要用它。
TICK_ROWS="$(grep -cE '^\| *(20[0-9]{2}-|[0-9]{2}:[0-9x]{2}Z)' "$LOG" 2>/dev/null)"
TICK_ROWS="${TICK_ROWS:-0}"

# ── 缩水棘轮（AC3，gap-manager-tick-log-check-row-criterion-and-shrink-ratchet）─────────────────
# 基线 = 本文件之前见过的最大行数，存在 git-tracked sidecar（默认 <LOG>.baseline，独立于 log，
# 同一截断带不走它）。行数低于基线 ⇒ FAIL shrink-detected——277→5 行缩水（保留若干旧格式行）也
# 会被逮住，不再静默 PASS。行数 ≥ 基线且增长 ⇒ 自动上调基线（只增的棘轮）。基线缺失/坏值 ⇒
# 以当前行数 bootstrap（fail-open：首次运行不因无基线而误报红）。
LINES="$(wc -l < "$LOG" 2>/dev/null | tr -d ' ' || echo 0)"
LINES="${LINES:-0}"
[ -z "$BASELINE_PATH" ] && BASELINE_PATH="${LOG}.baseline"
BASELINE=""
if [ -f "$BASELINE_PATH" ]; then
  BASELINE="$(head -1 "$BASELINE_PATH" 2>/dev/null | tr -d ' ' || echo "")"
  case "$BASELINE" in
    ''|*[!0-9]*) BASELINE="" ;;  # 坏基线视同无基线（fail-open bootstrap，不因坏值误报红）
  esac
fi
if [ -z "$BASELINE" ]; then
  BASELINE="$LINES"
  printf '%s\n' "$LINES" > "$BASELINE_PATH" 2>/dev/null || true
elif [ "$LINES" -lt "$BASELINE" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"shrink-detected","staleHours":%s,"tickRows":%s,"lines":%s,"baseline":%s}\n' "$STALE_HOURS" "$TICK_ROWS" "$LINES" "$BASELINE"
  else
    echo "manager-tick-log-check: FAIL — tick log shrank to ${LINES} lines (baseline ${BASELINE}): possible truncation (277→5 form caught)"
  fi
  exit 1
elif [ "$LINES" -gt "$BASELINE" ]; then
  printf '%s\n' "$LINES" > "$BASELINE_PATH" 2>/dev/null || true
  BASELINE="$LINES"   # JSON 里报新基线（文件已上调，变量同步）
fi

if [ "$TICK_ROWS" = "0" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"no-tick-row","staleHours":%s,"tickRows":0}\n' "$STALE_HOURS"
  else
    echo "manager-tick-log-check: FAIL — no tick row found in $LOG (header or empty only)"
  fi
  exit 1
fi

# 判据 ②：mtime 新鲜度（"上一轮 tick 没落行" = 超时没有新写入）。
LAST_EPOCH="$(date -r "$LOG" +%s 2>/dev/null || echo "")"
if [ -z "$LAST_EPOCH" ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"unreadable-mtime","staleHours":%s}\n' "$STALE_HOURS"
  else
    echo "manager-tick-log-check: FAIL — cannot read mtime of $LOG (non-GNU date?)"
  fi
  exit 1
fi

NOW_EPOCH="$(date +%s)"
AGE_SECONDS=$(( NOW_EPOCH - LAST_EPOCH ))
AGE_HOURS=$(( AGE_SECONDS / 3600 ))

if [ "$AGE_SECONDS" -gt $(( STALE_HOURS * 3600 )) ]; then
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"reason":"stale","staleHours":%s,"ageHours":%s,"tickRows":%s,"lines":%s,"baseline":%s}\n' "$STALE_HOURS" "$AGE_HOURS" "$TICK_ROWS" "$LINES" "$BASELINE"
  else
    echo "manager-tick-log-check: FAIL — last tick write was ${AGE_HOURS}h ago (> ${STALE_HOURS}h): a round was skipped (tickRows=$TICK_ROWS)"
  fi
  exit 1
fi

if [ "$JSON" = 1 ]; then
  printf '{"ok":true,"staleHours":%s,"ageHours":%s,"tickRows":%s,"lines":%s,"baseline":%s}\n' "$STALE_HOURS" "$AGE_HOURS" "$TICK_ROWS" "$LINES" "$BASELINE"
else
  echo "manager-tick-log-check: PASS — last tick write ${AGE_HOURS}h ago (< ${STALE_HOURS}h; tickRows=$TICK_ROWS; lines=$LINES baseline=$BASELINE)"
fi
exit 0
