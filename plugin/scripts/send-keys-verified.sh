#!/usr/bin/env bash
# send-keys-verified.sh — 跨项目 send-keys 助手：封装「C-u → 文本 → Enter」三次分开调用，
# 并在发完后确认送达（比较发送前后的 pane 哈希，未变则报失败）。管理者和各外层驱动别的会话时
# 用它，不要手工拼 send-keys。
#
# 为什么存在（交接文档待办 #3 的【预防】版，不是检测）：
#   2026-08-03 观察到 quay 外层输入框里有一行没发出去的文字。事后无法区分是 send-keys 丢了
#   Enter 还是灰色 ghost 建议，不可复现 → 不为它建检测（那是为一个无法复现的现象造仪器）。
#   但「合并调用会丢 Enter」和「发了但没送达」是真实风险，管理者每次都手工做同样的确认——
#   本机件就是把那个手工确认变成脚本。判据照旧要正控制（见 plugin/test/send-keys-verified.test.mjs）：
#   - 目标不存在 → tmux list-panes 失败 → 报失败（exit 1），绝不静默 0。
#   - 发送后 pane 哈希未变 → 未送达（吞输入/无回显/目标在忙）→ 报失败（exit 1）。
#
# 用法：  plugin/scripts/send-keys-verified.sh <tmux目标> <文本>
# 退出码：0 = 已送达（哈希变了）  1 = 未送达/目标不存在  2 = 用法错误
# 环境：  SEND_KEYS_SETTLE  发送后到读后哈希之间的秒数（默认 0.5）
#
# 规矩：要退出码就不要管道（rule 2b）——本脚本从不读管道后的 $?，判据检查变量是否为空；
#       永不 pgrep -f（rule 3）。文本经 `send-keys -l` 原样发送，文本里恰好出现 "Enter"/
#       "C-u" 这类键名不会被当成按键。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

TARGET="${1:-}"
TEXT="${2:-}"
SETTLE="${SEND_KEYS_SETTLE:-0.5}"

[ -n "$TARGET" ] || { echo "用法: $0 <tmux目标> <文本>" >&2; exit 2; }
[ -n "$TEXT" ] || { echo "send-keys-verified: 文本为空" >&2; exit 2; }

# 1. 目标必须存在（正控制：不存在 → 报失败，不静默）。
if ! tmux list-panes -t "$TARGET" -F '#{pane_pid}' >/dev/null 2>&1; then
  echo "send-keys-verified: 目标 $TARGET 不存在——无法送达" >&2
  exit 1
fi

hash_before=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null | md5sum | cut -c1-16)

# 2. 三次分开调用——合并会丢 Enter（本机件存在的第一个理由）。文本用 -l 原样发送。
tmux send-keys -t "$TARGET" C-u
tmux send-keys -t "$TARGET" -l "$TEXT"
tmux send-keys -t "$TARGET" Enter

sleep "$SETTLE"

hash_after=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null | md5sum | cut -c1-16)

# 3. 哈希未变 = 没送达（吞输入/无回显/目标在忙）。判据是「变了」或「没变」，不用管道退出码。
if [ -z "$hash_before" ] || [ -z "$hash_after" ] || [ "$hash_before" = "$hash_after" ]; then
  echo "send-keys-verified: 已发送但 pane 哈希未变（$hash_before）——可能未送达（目标吞输入/无回显/在忙），请人工检查" >&2
  exit 1
fi

echo "send-keys-verified: 已送达 $TARGET（哈希 $hash_before → $hash_after）"
exit 0
