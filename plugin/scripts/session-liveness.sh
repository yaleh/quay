#!/usr/bin/env bash
# 外层监视器：看【外层】（不是内层），报五类事件。
#
# 产品化（orchestration/SPEC-outer-liveness-productization.md）：plugin/ 里是通用默认——
# 一个采用 quay 的项目只有一个自己的外层，所以默认【零配置】看本项目自己的外层；
# 多目标（管理者的三项目扇出）是可选能力，经 OUTER_TARGETS / OUTER_TICK_LOGS 或
# orchestration/outer-liveness.env 启用。
#
# 为什么存在：管理者文档 §2 要求「任一项目的外层进程消失 —— 立即报，不等三次」，
# 而 30 分钟一次的 tick 做不到「立即」。2026-08-03 实测发现管理者挂着两个看【内层】的
# 监视器（18h / 7.6h，当 quay 外层时挂的），而 quay 外层自己也挂了一个看内层的
# —— 内层被看两遍，三个外层没人看。
#
# 覆盖原则（Monitor 的 "silence is not success"）：只报「还活着」等于崩溃时静默。
# 因此三类事件都报：消失 / 恢复 / 活着但不推进。
#
# 产品化要点（AC1/AC2/AC3/AC9）：
#   - 本项目根自定位（同 inner-state.sh 的 BASH_SOURCE 惯例），不再硬编码任何绝对仓库路径；
#     OUTER_ROOT 是测试接缝（同 INNER_STATE_WORK_ROOT），生产调用方不设它。
#   - 默认目标的外层会话名经占位符 __QUAY_TMUX_SESSION__ 在 quay-init --loop 安装时被替换
#     （--tmux-session）；未替换（直接在 plugin 里跑源码）时按 <项目名>-0:outer 惯例回退。
#     运行时不做任何配置解析——不碰 YAML。
#   - 管理者的多目标配置落在 orchestration/outer-liveness.env（管理者的东西，不进 plugin）。
#     显式设置的环境变量 OUTER_TARGETS 优先于该文件；generic 项目没有该文件 → 零配置默认。
#   - 阈值（INTERVAL/STALL_MIN/LOOP_MIN/OVERDUE_MIN）含义与默认值见随包的外层 tick 文档
#     plugin/loop/orchestrator-loop-tick.md（AC5），不只活在脚本注释里。
#
# 用法：  plugin/scripts/outer-liveness.sh [--once]
#   --once   跑一轮，打印每个目标的 OUTER-STATUS 行（名字/活/pid），退出——
#            冷启动/安装后自检接缝（AC7，同 inner-state.sh 的 one-shot 惯例）。
# 环境：  INTERVAL / STALL_MIN / LOOP_MIN / OVERDUE_MIN（阈值）
#         OUTER_TARGETS / OUTER_TICK_LOGS（多目标覆盖；每行 "<名字> <仓根> <tmux目标>"）
#         OUTER_ROOT（测试接缝：覆盖自定位的项目根）

set -uo pipefail
INTERVAL=${INTERVAL:-60}
STALL_MIN=${STALL_MIN:-45}          # 未暂停的项目超过这么久没有新提交 = 停滞
LOOP_MIN=${LOOP_MIN:-20}            # 外层 loop 周期
OVERDUE_MIN=${OVERDUE_MIN:-45}      # 超过它就认为 loop 没在跑（>2× 周期，容忍跑重活的长 tick）
declare -A PREV_ALIVE PREV_STALL PREV_OVERDUE PREV_HASH PREV_IDLE

ONE_SHOT=false
case "${1:-}" in
  --once) ONE_SHOT=true ;;
  -h|--help) echo "用法: $0 [--once]"; exit 0 ;;
esac

# ── 本项目根：自定位（同 inner-state.sh）。OUTER_ROOT 是测试接缝，生产不设。 ──────────────
REPO_ROOT="${OUTER_ROOT:-}"
if [ -z "$REPO_ROOT" ]; then
  _ol_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$_ol_script_dir/../.." && pwd)"
fi

# ── 管理者的多目标配置（AC9）：orchestration/outer-liveness.env 存在则 source。
#    shell KEY=VALUE，不是 YAML。显式环境变量 OUTER_TARGETS 优先。 ───────────────────────
if [ -z "${OUTER_TARGETS:-}" ] && [ -f "$REPO_ROOT/orchestration/outer-liveness.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$REPO_ROOT/orchestration/outer-liveness.env" \
    || echo "outer-liveness: WARN 无法解析 $REPO_ROOT/orchestration/outer-liveness.env，回落到默认" >&2
  set +a
fi

# ── 默认目标（零配置）：本项目自己的外层窗口。会话名安装时被替换；未替换按 <项目名>-0 回退。 ──
# 注意（两个已踩过的坑）：占位符必须作为【裸赋值】出现，不能嵌在 ${} 里——否则替换后的会话值
# （含 :/.）会变成参数展开语法（${ol-cold:0.0:-}）静默产出垃圾目标；「是否已替换」的判据也不能
# 用完整占位符做字面比较——替换会同时改写比较的右值，让比较自洽、永远走回退分支。
_ol_session=__QUAY_TMUX_SESSION__
if [ -z "$_ol_session" ] || [[ "$_ol_session" == __QUAY_* ]]; then
  _ol_session_base="$(basename "$REPO_ROOT")-0"
else
  _ol_session_base="${_ol_session%%:*}"
fi
DEFAULT_TARGET="${_ol_session_base}:outer"

# 可被 OUTER_TARGETS 覆盖——存在的理由是【可测】（handoff rule 2：不能靠「干跑没有输出」
# 证明监视器会报，那与「它永远不报」同形）。用测试控制的探针 pane 做正控制，才是证据。
targets() {
  if [ -n "${OUTER_TARGETS:-}" ]; then printf '%s\n' "$OUTER_TARGETS"; return; fi
  # 零配置默认：本项目自己（名字=项目名、根=项目根、目标=外层窗口）。
  echo "$(basename "$REPO_ROOT") $REPO_ROOT $DEFAULT_TARGET"
}

# 各项目外层 tick 日志的路径。心跳信号是【tick 有没有按期跑】，不是【有没有新提交】——
# 2026-08-03 实测：外层空闲等输入时，进程活着且刚提交过，前三个事件全部静默，
# 而「空闲等下一个 tick」与「循环已死、永远不会再跑」在那个事件集里完全同形。
# fan-in 带来的提交还会把基于提交的计时器重置，让死循环更难被发现。
# 可被 OUTER_TICK_LOGS 覆盖（每行 "<名字> <tick日志路径>"）——与 OUTER_TARGETS 同理，为可测；
# 无匹配时返回空（判据不触发）。默认是本项目自己的 orchestration/tick-log.md。
tick_log_for() {
  if [ -n "${OUTER_TICK_LOGS:-}" ]; then
    while read -r n p; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "$1" ]; then printf '%s\n' "$p"; return 0; fi
    done <<< "$OUTER_TICK_LOGS"
    return 1
  fi
  echo "$REPO_ROOT/orchestration/tick-log.md"
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

    # --once 接缝：每轮每个目标报一行状态（冷启动/安装后自检用，AC7）。
    if [ "$ONE_SHOT" = true ]; then
      echo "OUTER-STATUS $name alive=$alive${pid:+ pid=$pid}"
    fi

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

    # 事件 5：转入空闲 / 恢复忙碌 —— 这是【及时】信号，事件 4 是 45 分钟后的兜底。
    #
    # 人 2026-08-03 指出：「我可以接受让 outer 等待，但应当是你及时知道发生了什么并决定让它等待。」
    # 原来的事件集只有滞后指标：外层跑完一次操作转入空闲时，进程活着、刚提交过，全部静默。
    #
    # 判据是相邻两轮（相隔一个 INTERVAL）的 pane 哈希是否相同。这不是忙等——一轮只抓一次。
    # 双向验过：忙的 pane 因为 TUI 有秒级递增计时器，哈希必变；空闲的必不变。
    # 不用 /proc CPU 增量：空闲的 Claude Code TUI 本身也在烧 CPU（实测 10 vs 132 jiffies，分离度太弱）。
    if [ "$alive" = "1" ]; then
      h=$(tmux capture-pane -p -t "$target" 2>/dev/null | md5sum | cut -c1-16)
      if [ -n "${PREV_HASH[$name]:-}" ]; then
        idle=$([ "$h" = "${PREV_HASH[$name]}" ] && echo 1 || echo 0)
        if [ "${PREV_IDLE[$name]:-unset}" != "unset" ] && [ "${PREV_IDLE[$name]}" != "$idle" ]; then
          if [ "$idle" = "1" ]; then
            tl=$(tick_log_for "$name"); tmin="?"
            [ -f "${tl:-/nonexistent}" ] && tmin=$(( ( $(date +%s) - $(stat -c %Y "$tl") ) / 60 ))
            halted=$([ -f "$root/.halt" ] && echo "（该项目已暂停，空闲是预期状态）" || echo "")
            # 噪声标定（管理者 3 个完整周期实测，2026-08-03）：健康循环是「刚记完 tick 才转空闲」
            # （tick 时距 ~1 分钟），每 20 分钟一对事件、三项目满载 18 次/小时，全是「一切正常」。
            # tmin < LOOP_MIN 的空闲 = 正常收尾 → 静默；tmin ≥ LOOP_MIN 或未知（无 tick 日志）=
            # 「空闲了但没记 tick」，loop 可能跑一半就停 / 已死 → 报。OUTER-RESUMED 保留不静默
            # （它便宜，且是唯一能确认 loop 还在按期触发的正向信号）。
            if [ "$tmin" = "?" ] || [ "$tmin" -ge "$LOOP_MIN" ]; then
              echo "OUTER-IDLE $name 的外层转入空闲等输入；tick 日志 ${tmin} 分钟前写过${halted}"
            fi
          else
            echo "OUTER-RESUMED $name 的外层恢复活动（此前空闲）"
          fi
        fi
        PREV_IDLE[$name]=$idle
      fi
      PREV_HASH[$name]=$h
    else
      PREV_HASH[$name]=""; PREV_IDLE[$name]="unset"
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
  [ "$ONE_SHOT" = true ] && break
  sleep "$INTERVAL"
done
