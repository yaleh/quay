#!/usr/bin/env bash
# dead-loop-check.sh — L2 持续健康判据：循环【在转】，不只是【装了】
# (tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed, AC1-AC4).
#
# 判据（Contract band）——loop_alive = alive：
#   最近 N 分钟内，目标项目 outer/inner transcript 有【新的 user 消息】 或 项目 git 有【提交】
#   ——任一存在 ⇒ alive；都无 ⇒ dead（dead-loop）。
#   transcript user 消息 = ~/.claude/projects/<项目slug>/*.jsonl 的顶层 type=user 记录
#     （取全部会话的最大时刻）。type=user 不仅含【外部输入】（send-keys / cron 注入 / 人打字），
#     也含【工具回执】（tool_result 以 user 消息写回）——所以一个在干活的循环（频繁工具调用）
#     会持续写 type=user，与「卡死在纯思考」（无工具调用、无提交）自然分开。
#   git 提交 = 循环产出过工作（inner 落地 / outer 提交 / 处置提交）。
#   已知盲区（诚实写明，任何点状判据都有）：一个会话若【纯思考且无任何工具调用】超过 N 分钟且
#     无提交，会与 dead-loop 同形——这是 L2 判据的固有分辨率极限；窗口 N 可调（默认 30 分钟 ≥
#     周期锚点 20 分钟，健康循环必然落一次驱动或提交）。
#   invariant liveness_independent_of_backlog = 1 —— 判据【不碰 backlog】：
#     队列空（queue-empty）与没人驱动（dead-loop）从此可区分：
#       队列空 + 有驱动/提交 = 健康空闲（alive）
#       队列满 + 无驱动/提交 = 没人驱动（dead）
#
# 出处：SPEC-complete-delivery-surface-2026-08-05.md 第 5 节 层次二（持续健康检查——动态、
#   运转期间周期性跑）。L1（交付完整性）判据检查「仪器铺没铺」；本判据补「循环转没转」——
#   一个从未运行过的循环与一个健康运行的循环在所有 L1 判据下【完全一样】（meta-cc/archguard
#   实测 29 小时零进展，quay-init + verify-* 却全绿 + 自报健康），只有 L2 的 transcript-user-
#   消息 + git-提交时间窗能把两者分开。
#
# 用法：
#   bash plugin/scripts/dead-loop-check.sh [--root <dir>] [--window <N 分钟>] [--json]
#     --root            目标项目根（git 仓库；默认 = 本仓库）
#     --window          时间窗分钟数（默认 30；与 session-liveness.sh OVERDUE_MIN 同量级；
#                       周期锚点 20 分钟 ⇒ 30 分钟窗内健康循环必然至少落一次驱动或提交）
#     --transcript-dir  显式 transcript 目录（测试接缝；默认 $HOME/.claude/projects/<slug>）
#     --json            输出 JSON（逐字段归因，供机械消费）
# 输出（stdout 可解析字段）：
#   loop_alive=alive|dead
#   has_transcript_user_msg=0|1
#   has_git_commit=0|1
#   window_minutes=N
#   liveness_independent_of_backlog=1
#
# Contract measure: `bash plugin/scripts/dead-loop-check.sh` -> stdout's loop_alive 字段
#   （alive 或 dead）。Contract invoke: `grep -rn 'transcript\|提交\|N 分钟' <dead-loop check>`
#   ——transcript / 提交 / N 分钟 三词都在本文件头里（判据的构成信号）。
#
# 测试：plugin/test/dead-loop-check.test.mjs（AC1 dead 正控 + AC2 负向 + AC6 node:test）。

set -uo pipefail

# ── 参数 ──────────────────────────────────────────────────────────────────────────────────────────
_dlc_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${DEAD_LOOP_ROOT:-}"
window_min="${DEAD_LOOP_WINDOW_MIN:-30}"
json=0
transcript_dir="${DEAD_LOOP_TRANSCRIPT_DIR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --root=*) root="${1#--root=}"; shift ;;
    --window) window_min="$2"; shift 2 ;;
    --window=*) window_min="${1#--window=}"; shift ;;
    --transcript-dir) transcript_dir="$2"; shift 2 ;;
    --transcript-dir=*) transcript_dir="${1#--transcript-dir=}"; shift ;;
    --json) json=1; shift ;;
    -h|--help)
      sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) shift ;;
  esac
done

# 非负整数校验（防御：传给窗口算术的值必须是数字）。
case "$window_min" in
  ''|*[!0-9]*) echo "dead-loop-check: --window 必须是分钟数（非负整数），收到 '${window_min}'" >&2; exit 2 ;;
esac

if [ -z "$root" ]; then
  root="$(cd "${_dlc_script_dir}/../.." && pwd)"
fi
# 默认 transcript 目录 = $HOME/.claude/projects/<slug>（slug = 根路径 / -> -，同 session-liveness.sh）。
if [ -z "$transcript_dir" ]; then
  transcript_dir="${HOME}/.claude/projects/$(printf '%s' "$root" | tr '/' '-')"
fi

# ── 纯函数 ────────────────────────────────────────────────────────────────────────────────────────

# dl_latest_user_msg_epoch <transcript> —— 该 transcript 最近一条顶层 type=user 记录的时间戳转
# epoch；输出空 = 取不到（无记录/解析失败）。模式 `"type":"user"` 只命中顶层：content 块的类型是
# text/thinking/tool_use/tool_result，message 对象的类型是 message——与 session-liveness.sh 同源。
# 性能：先只扫文件尾 500 行（最近一条 user 消息在活跃会话里必然近文件尾；tail 界 500 与
# session-liveness.sh 的 transcript_last_message_type 同约定），无匹配再全扫兜底。
dl_latest_user_msg_epoch() {
  local t=$1 line ts
  line=$(tail -n 500 "$t" 2>/dev/null | grep '"type":"user"' | tail -1)
  [ -n "$line" ] || line=$(grep '"type":"user"' "$t" 2>/dev/null | tail -1)
  [ -n "$line" ] || return 1
  ts=$(printf '%s' "$line" | grep -o '"timestamp":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$ts" ] || return 1
  date -d "$ts" +%s 2>/dev/null || return 1
}

# dl_latest_user_msg_across <dir> <now> <window_secs> —— 项目 transcript 目录下全部 *.jsonl
# （主会话 + subagents）的最近 user 消息 epoch 的最大值（= 该项目任一循环会话最近收到驱动的时刻）。
# 输出 0 = 目录不存在或没有任何可取到的 user 消息记录。
# 性能（实测 quay 项目 transcript 目录 1.4G / 6956 文件——全扫不可用）：
#   * `find -newermt "@<now-window>"` 只列 mtime 落在窗口内的文件——transcript 是追加写、写即更新
#     mtime，所以 mtime 早于窗口的文件不可能含窗口内的 user 消息，直接跳过；
#   * `-type f` 排除同名目录。窗口内活跃文件通常只有个位数，逐个 tail-grep 便宜。
dl_latest_user_msg_across() {
  local dir=$1 now=$2 window_secs=$3 max=0 ts f cutoff
  [ -d "$dir" ] || { echo 0; return 0; }
  cutoff=$(( now - window_secs ))
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if ts=$(dl_latest_user_msg_epoch "$f") && [ -n "$ts" ] && [ "$ts" -gt "$max" ] 2>/dev/null; then
      max=$ts
    fi
  done < <(find "$dir" -type f -name '*.jsonl' -newermt "@${cutoff}" 2>/dev/null)
  echo "$max"
}

# dl_latest_commit_epoch <root> —— 项目 git HEAD 提交时刻（epoch）。0 = 非 git 仓库/无提交。
dl_latest_commit_epoch() {
  local r=$1
  git -C "$r" log -1 --format=%ct 2>/dev/null || echo 0
}

# ── 判定 ──────────────────────────────────────────────────────────────────────────────────────────
now=$(date +%s)
window_secs=$(( window_min * 60 ))

# 1. transcript user 消息在窗内？
latest_user=$(dl_latest_user_msg_across "$transcript_dir" "$now" "$window_secs")
has_transcript=0
if [ -n "$latest_user" ] && [ "$latest_user" != "0" ]; then
  user_age=$(( now - latest_user ))
  [ "$user_age" -le "$window_secs" ] && has_transcript=1
fi

# 2. git 提交在窗内？
latest_commit=$(dl_latest_commit_epoch "$root")
has_commit=0
if [ -n "$latest_commit" ] && [ "$latest_commit" != "0" ]; then
  commit_age=$(( now - latest_commit ))
  [ "$commit_age" -le "$window_secs" ] && has_commit=1
fi

# 3. 融合（Contract band）：任一存在 ⇒ alive；都无 ⇒ dead。与 backlog 空无关（invariant）。
if [ "$has_transcript" = "1" ] || [ "$has_commit" = "1" ]; then
  loop_alive=alive
else
  loop_alive=dead
fi

# ── 输出（Contract measure：loop_alive 字段可解析）──────────────────────────────────────────────
echo "loop_alive=${loop_alive}"
echo "has_transcript_user_msg=${has_transcript}"
echo "has_git_commit=${has_commit}"
echo "window_minutes=${window_min}"
echo "liveness_independent_of_backlog=1"
if [ "$json" = "1" ]; then
  printf '{"loop_alive":"%s","has_transcript_user_msg":%s,"has_git_commit":%s,"window_minutes":%s,"liveness_independent_of_backlog":1,"transcript_dir":"%s","root":"%s"}\n' \
    "$loop_alive" "$has_transcript" "$has_commit" "$window_min" \
    "$(printf '%s' "$transcript_dir" | sed 's/"/\\"/g')" \
    "$(printf '%s' "$root" | sed 's/"/\\"/g')"
fi
