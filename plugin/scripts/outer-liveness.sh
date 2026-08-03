#!/usr/bin/env bash
# 管理者的监视器：看三个项目的【外层】，不是内层。
#
# 为什么存在：管理者文档 §2 要求「任一项目的外层进程消失 —— 立即报，不等三次」，
# 而 30 分钟一次的 tick 做不到「立即」。2026-08-03 实测发现管理者挂着两个看【内层】的
# 监视器（18h / 7.6h，当 quay 外层时挂的），而 quay 外层自己也挂了一个看内层的
# —— 内层被看两遍，三个外层没人看。
#
# 覆盖原则（Monitor 的 "silence is not success"）：只报「还活着」等于崩溃时静默。
# 因此三类事件都报：消失 / 恢复 / 活着但不推进。

set -uo pipefail
INTERVAL=${INTERVAL:-60}
STALL_MIN=${STALL_MIN:-45}          # 未暂停的项目超过这么久没有新提交 = 停滞
declare -A PREV_ALIVE PREV_STALL PREV_OVERDUE

# 各项目外层 tick 日志的路径与其 loop 周期（分钟）。
# 心跳信号是【tick 有没有按期跑】，不是【有没有新提交】——
# 2026-08-03 实测：外层空闲等输入时，进程活着且刚提交过，前三个事件全部静默，
# 而「空闲等下一个 tick」与「循环已死、永远不会再跑」在那个事件集里完全同形。
# fan-in 带来的提交还会把基于提交的计时器重置，让死循环更难被发现。
tick_log_for() {
  case "$1" in
    quay)      echo "/home/yale/work/quay/orchestration/tick-log.md" ;;
    archguard) echo "/home/yale/work/archguard/orchestration/tick-log.md" ;;
    meta-cc)   echo "/home/yale/work/meta-cc/orchestration/tick-log.md" ;;
  esac
}
LOOP_MIN=${LOOP_MIN:-20}                 # 外层 loop 周期
OVERDUE_MIN=${OVERDUE_MIN:-45}           # 超过它就认为 loop 没在跑（>2× 周期，容忍跑重活的长 tick）

targets() {
  echo "quay      /home/yale/work/quay      quay-0:outer"
  echo "archguard /home/yale/work/archguard archguard-2:outer"
  echo "meta-cc   /home/yale/work/meta-cc   meta-cc-4:outer"
}

outer_pid() {  # 按窗口名寻址；pane 索引会漂
  local t=$1 ppid cpid
  ppid=$(tmux list-panes -t "$t" -F '#{pane_pid}' 2>/dev/null | head -1) || true
  [ -n "${ppid:-}" ] || { echo ""; return; }
  cpid=$(pgrep -P "$ppid" 2>/dev/null | head -1) || true
  # 只认 claude 进程，避免把 shell 当成外层
  if [ -n "${cpid:-}" ] && tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null | grep -q claude; then
    echo "$cpid"
  else
    echo ""
  fi
}

while true; do
  while read -r name root target; do
    [ -n "${name:-}" ] || continue
    pid=$(outer_pid "$target")
    alive=$([ -n "$pid" ] && echo 1 || echo 0)

    # 事件 1/2：消失与恢复
    if [ "${PREV_ALIVE[$name]:-unset}" != "unset" ] && [ "${PREV_ALIVE[$name]}" != "$alive" ]; then
      if [ "$alive" = "0" ]; then
        echo "OUTER-GONE $name 的外层进程消失（窗口 $target）——管理者文档 §2：立即报"
      else
        echo "OUTER-BACK $name 的外层已恢复（pid $pid）"
      fi
    fi
    PREV_ALIVE[$name]=$alive

    # 事件 3：活着但不推进（只对未暂停的项目判；暂停期间不推进是正常的）
    if [ "$alive" = "1" ] && [ ! -f "$root/.halt" ]; then
      last=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)
      if [ "$last" != "0" ]; then
        mins=$(( ( $(date +%s) - last ) / 60 ))
        stalled=$([ "$mins" -ge "$STALL_MIN" ] && echo 1 || echo 0)
        if [ "$stalled" = "1" ] && [ "${PREV_STALL[$name]:-0}" = "0" ]; then
          echo "OUTER-STALL $name 的外层活着但 ${mins} 分钟无新提交（未暂停）——可能卡住或在跑重活"
        fi
        PREV_STALL[$name]=$stalled
      fi
    else
      PREV_STALL[$name]=0
    fi

    # 事件 4：loop 逾期——外层活着、项目未暂停，但 tick 日志超过 OVERDUE_MIN 未被写过。
    # 用文件 mtime 而不是解析表内时刻：本仓的 tick 时刻本身就写成 "12:0xZ" 这类模糊值，解析不可靠。
    tl=$(tick_log_for "$name")
    if [ "$alive" = "1" ] && [ ! -f "$root/.halt" ] && [ -f "${tl:-/nonexistent}" ]; then
      tmod=$(stat -c %Y "$tl" 2>/dev/null || echo 0)
      if [ "$tmod" != "0" ]; then
        omin=$(( ( $(date +%s) - tmod ) / 60 ))
        overdue=$([ "$omin" -ge "$OVERDUE_MIN" ] && echo 1 || echo 0)
        if [ "$overdue" = "1" ] && [ "${PREV_OVERDUE[$name]:-0}" = "0" ]; then
          echo "OUTER-LOOP-OVERDUE $name 的外层活着，但 tick 日志 ${omin} 分钟未更新（loop 周期 ${LOOP_MIN} 分钟）——loop 可能已死，它会静默地永远空闲"
        fi
        PREV_OVERDUE[$name]=$overdue
      fi
    else
      PREV_OVERDUE[$name]=0
    fi
  done < <(targets)
  sleep "$INTERVAL"
done
