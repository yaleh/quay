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
declare -A PREV_ALIVE PREV_STALL

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
  done < <(targets)
  sleep "$INTERVAL"
done
