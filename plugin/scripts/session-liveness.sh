#!/usr/bin/env bash
# 会话存活监视：看【任意一个 Claude Code 会话】（外层或内层）活不活、闲不闲、心跳逾期没有。
#
# 泛化（SPEC-outer-liveness-productization.md AC10-13，2026-08-03）：原名 outer-liveness.sh，
# 名字取窄了——进程存活、pane 忙闲、心跳逾期这套逻辑对任何 Claude Code 会话都成立，与「外层」
# 无关。内层更需要它：内层跑重活、死掉代价更大，而 inner-state.sh 只看工作产出，内层死了它只会
# 看到「没有新遥测」，与「在思考难题」完全同形。AC10 的判据：outer-* 的字样只出现在默认值里，
# 不出现在概念里——事件名 SESSION-*、环境变量 SESSION_*、文件名 session-liveness.sh 都是通用的；
# 唯一「外层」残留是默认心跳路径（orchestration/tick-log.md，那是外层的 tick 日志）。
#
# 事件：
#   SESSION-GONE / SESSION-BACK      会话进程消失 / 恢复
#   SESSION-STALL                    活着但 ≥STALL_MIN 分钟无新提交（未暂停的项目）
#   SESSION-IDLE / SESSION-RESUMED   相邻两轮 pane 哈希相同=空闲；转换后一个轮询周期内报出
#   SESSION-OVERDUE                  心跳文件 mtime ≥OVERDUE_MIN（未暂停的项目）——会话可能已死
#   SESSION-STATUS                   --once 接缝：每目标一行（名字/活/pid）
#
# 心跳（AC11，可参数化）：外层的心跳是 tick 日志，内层的不是。SESSION_HEARTBEATS 按名字给心跳
# 路径，`stat -c %Y` 对文件与目录都成立（内层建议用 `.workflow-events/`——它的工作产出，
# gitignored、不脏工作树）。默认心跳是 `$REPO_ROOT/orchestration/tick-log.md`（外层 tick 日志）。
#
# 产品化要点（AC1/AC2/AC3/AC9）：
#   - 本项目根自定位（同 inner-state.sh 的 BASH_SOURCE 惯例），不硬编码任何绝对仓库路径；
#     SESSION_ROOT 是测试接缝（同 INNER_STATE_WORK_ROOT），生产调用方不设它。
#   - 默认目标的目标会话名优先级（gap-quay-init-rewrites-an-executable-instead-of-generating-config
#     AC1）：
#       1. 环境变量 SESSION_TMUX_SESSION（显式设置，最高）
#       2. orchestration/session-liveness.env（quay-init --loop 安装时生成/更新的每项目配置）
#       3. 默认值：项目根 basename + "-0"（未配置时的回退）
#     原则：可执行文件一律原样复制，只生成配置——quay-init --loop 已不再改写本脚本
#     （安装期占位符机制已移除），会话名经上面的 env/配置/默认值解析；运行时不做
#     任何配置解析——不碰 YAML。
#   - 管理者的多目标配置落在 orchestration/session-liveness.env（管理者的东西，不进 plugin）。
#     显式设置的环境变量 SESSION_TARGETS 优先于该文件；generic 项目没有该文件 → 零配置默认。
#   - 阈值（INTERVAL/STALL_MIN/LOOP_MIN/OVERDUE_MIN）含义与默认值见随包的两份 tick 文档（AC5）。
#
# 用法：  plugin/scripts/session-liveness.sh [--once]
#   --once   跑一轮，打印每个目标的 SESSION-STATUS 行，退出（冷启动/安装后自检接缝，AC7）。
# 环境：  INTERVAL / STALL_MIN / LOOP_MIN / OVERDUE_MIN（阈值）
#         SESSION_TARGETS / SESSION_HEARTBEATS（多目标覆盖；每行 "<名字> <仓根> <tmux目标>"）
#         SESSION_ROOT（测试接缝：覆盖自定位的项目根）

set -uo pipefail
INTERVAL=${INTERVAL:-60}
STALL_MIN=${STALL_MIN:-45}          # 未暂停的项目超过这么久没有新提交 = 停滞
LOOP_MIN=${LOOP_MIN:-20}            # 会话的预期活动/心跳周期
OVERDUE_MIN=${OVERDUE_MIN:-45}      # 超过它就认为会话没在动（>2× 周期，容忍跑重活的长时段）
declare -A PREV_ALIVE PREV_STALL PREV_OVERDUE PREV_HASH PREV_IDLE

# ── 版本可见性（2026-08-03 管理者建议，非规格）──
# 启动时打一行指纹到 stderr——「跑的是哪个版本」可从外部查：对比这行的 md5 与当前文件的 md5，
# 不同即此实例载入的是旧代码（进程握着旧 inode，从外部看不出）。同一族失效今天第四次：
# 进程握旧文件、pgrep 写死旧路径、盯错层的监视器、旧日志报绿。比再加一个事件更有价值。
printf 'session-liveness: starting pid=%s file=%s md5=%s\n' \
  "$$" "$(basename "${BASH_SOURCE[0]}")" "$(md5sum "${BASH_SOURCE[0]}" 2>/dev/null | cut -c1-16)" >&2

ONE_SHOT=false
case "${1:-}" in
  --once) ONE_SHOT=true ;;
  -h|--help) echo "用法: $0 [--once]"; exit 0 ;;
esac

# ── 本项目根：自定位（同 inner-state.sh）。SESSION_ROOT 是测试接缝，生产不设。 ──────────────
REPO_ROOT="${SESSION_ROOT:-}"
if [ -z "$REPO_ROOT" ]; then
  _sl_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$_sl_script_dir/../.." && pwd)"
fi

# ── 管理者的多目标配置（AC9）：orchestration/session-liveness.env 存在则 source。
#    shell KEY=VALUE，不是 YAML。显式环境变量 SESSION_TARGETS 优先。 ───────────────────────
if [ -z "${SESSION_TARGETS:-}" ] && [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$REPO_ROOT/orchestration/session-liveness.env" \
    || echo "session-liveness: WARN 无法解析 $REPO_ROOT/orchestration/session-liveness.env，回落到默认" >&2
  set +a
fi

# ── 默认目标（零配置）：本项目自己的会话。会话名优先级见文件头（env → 配置 → 默认值）。 ──
# 注意（两个已踩过的坑，历史）：占位符曾经必须作为【裸赋值】出现、不能嵌在 ${} 里——替换后的
# 会话值（含 :/.）会变成参数展开语法静默产出垃圾目标；「是否已替换」的判据也不能用完整占位符做
# 字面比较。2026-08-03 起脚本不再被 quay-init 改写（可执行文件原样复制、只生成配置），这两个坑
# 随之失去存在前提——会话名一律经 env / orchestration/session-liveness.env / 默认值解析。
# 环境变量显式设置优先（先钉住，避免被配置文件 source 覆盖）：env > 配置 > 默认值。
_sl_session_env="${SESSION_TMUX_SESSION:-}"
if [ -z "${SESSION_TARGETS:-}" ] && [ -f "$REPO_ROOT/orchestration/session-liveness.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$REPO_ROOT/orchestration/session-liveness.env" \
    || echo "session-liveness: WARN 无法解析 $REPO_ROOT/orchestration/session-liveness.env，回落到默认" >&2
  set +a
fi
if [ -n "$_sl_session_env" ]; then
  SESSION_TMUX_SESSION="$_sl_session_env"
fi
_sl_session="${SESSION_TMUX_SESSION:-}"
if [ -z "$_sl_session" ]; then
  _sl_session_base="$(basename "$REPO_ROOT")-0"
else
  _sl_session_base="${_sl_session%%:*}"
fi
DEFAULT_TARGET="${_sl_session_base}:outer"

# 可被 SESSION_TARGETS 覆盖——存在的理由是【可测】（handoff rule 2：不能靠「干跑没有输出」
# 证明监视器会报，那与「它永远不报」同形）。用测试控制的探针 pane 做正控制，才是证据。
targets() {
  if [ -n "${SESSION_TARGETS:-}" ]; then printf '%s\n' "$SESSION_TARGETS"; return; fi
  # 零配置默认：本项目自己（名字=项目名、根=项目根、目标=<会话>:outer 窗口）。
  echo "$(basename "$REPO_ROOT") $REPO_ROOT $DEFAULT_TARGET"
}

# 各目标的【心跳】文件路径（AC11 可参数化）。心跳 = 这个会话活着时会定期写的东西：
# 外层是 tick 日志，内层是它的工作产出（.workflow-events/ 之类）。心跳信号是【有没有按期在动】，
# 不是【有没有新提交】——2026-08-03 实测：会话空闲等输入时，进程活着且刚提交过，前三个事件全部
# 静默，而「空闲等下一个心跳」与「会话已死、永远不会再动」在那个事件集里完全同形。
# 可被 SESSION_HEARTBEATS 覆盖（每行 "<名字> <心跳路径>"）——与 SESSION_TARGETS 同理，为可测；
# 无匹配时返回空（判据不触发）。默认是外层 tick 日志（这是唯一保留的「外层」字样：默认值）。
heartbeat_for() {
  if [ -n "${SESSION_HEARTBEATS:-}" ]; then
    while read -r n p; do
      [ -n "${n:-}" ] || continue
      if [ "$n" = "$1" ]; then printf '%s\n' "$p"; return 0; fi
    done <<< "$SESSION_HEARTBEATS"
    return 1
  fi
  echo "$REPO_ROOT/orchestration/tick-log.md"
}

session_pid() {  # 按窗口名寻址；pane 索引会漂。找 pane shell 的第一个 claude 子进程。
  local t=$1 ppid cpid
  ppid=$(tmux list-panes -t "$t" -F '#{pane_pid}' 2>/dev/null | head -1) || true
  [ -n "${ppid:-}" ] || { echo ""; return; }
  cpid=$(pgrep -P "$ppid" 2>/dev/null | head -1) || true
  # 只认 claude 进程，避免把 shell 当成会话本体
  if [ -n "${cpid:-}" ] && tr '\0' ' ' < "/proc/$cpid/cmdline" 2>/dev/null | grep -q claude; then
    echo "$cpid"
  else
    echo ""
  fi
}

while true; do
  while read -r name root target; do
    [ -n "${name:-}" ] || continue
    pid=$(session_pid "$target")
    alive=$([ -n "$pid" ] && echo 1 || echo 0)

    # --once 接缝：每轮每个目标报一行状态（冷启动/安装后自检用，AC7）。
    if [ "$ONE_SHOT" = true ]; then
      echo "SESSION-STATUS $name alive=$alive${pid:+ pid=$pid}"
    fi

    # 事件 1/2：消失与恢复
    if [ "${PREV_ALIVE[$name]:-unset}" != "unset" ] && [ "${PREV_ALIVE[$name]}" != "$alive" ]; then
      if [ "$alive" = "0" ]; then
        echo "SESSION-GONE $name 的会话进程消失（目标 $target）——立即报"
      else
        echo "SESSION-BACK $name 的会话已恢复（pid $pid）"
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
          echo "SESSION-STALL $name 的会话活着但 ${mins} 分钟无新提交（未暂停）——可能卡住或在跑重活"
        fi
        PREV_STALL[$name]=$stalled
      fi
    else
      PREV_STALL[$name]=0
    fi

    # 事件 5：转入空闲 / 恢复忙碌 —— 这是【及时】信号，事件 4 是 OVERDUE_MIN 分钟后的兜底。
    #
    # 人 2026-08-03 指出：「我可以接受让 outer 等待，但应当是你及时知道发生了什么并决定让它等待。」
    # 原来的事件集只有滞后指标：会话跑完一次操作转入空闲时，进程活着、刚提交过，全部静默。
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
            hb=$(heartbeat_for "$name"); hmin="?"
            [ -f "${hb:-/nonexistent}" ] && hmin=$(( ( $(date +%s) - $(stat -c %Y "$hb") ) / 60 ))
            halted=$([ -f "$root/.halt" ] && echo "（该项目已暂停，空闲是预期状态）" || echo "")
            # 噪声标定（管理者 3 个完整周期实测，2026-08-03）：健康循环是「刚动过（写了心跳）才转
            # 空闲」（心跳时距 ~1 分钟），每 20 分钟一对事件、三项目满载 18 次/小时，全是「一切正常」。
            # hmin < LOOP_MIN 的空闲 = 正常收尾 → 静默；hmin ≥ LOOP_MIN 或未知（无心跳文件）=
            # 「空闲了但没动」，会话可能跑一半就停 / 已死 → 报。SESSION-RESUMED 保留不静默
            # （它便宜，且是唯一能确认会话还在按期活动的正向信号）。
            if [ "$hmin" = "?" ] || [ "$hmin" -ge "$LOOP_MIN" ]; then
              echo "SESSION-IDLE $name 的会话转入空闲等输入；心跳 ${hmin} 分钟前更新${halted}"
            fi
          else
            echo "SESSION-RESUMED $name 的会话恢复活动（此前空闲）"
          fi
        fi
        PREV_IDLE[$name]=$idle
      fi
      PREV_HASH[$name]=$h
    else
      PREV_HASH[$name]=""; PREV_IDLE[$name]="unset"
    fi

    # 事件 4：心跳逾期——会话活着、项目未暂停，但心跳文件超过 OVERDUE_MIN 未被更新。
    # 用文件 mtime 而不是解析表内时刻：本仓的 tick 时刻本身就写成 "12:0xZ" 这类模糊值，解析不可靠。
    # stat -c %Y 对文件与目录都成立（目录 mtime = 最新子项创建时刻，适合 .workflow-events/ 这类心跳）。
    hb=$(heartbeat_for "$name")
    if [ "$alive" = "1" ] && [ ! -f "$root/.halt" ] && [ -e "${hb:-/nonexistent}" ]; then
      hmod=$(stat -c %Y "$hb" 2>/dev/null || echo 0)
      if [ "$hmod" != "0" ]; then
        omin=$(( ( $(date +%s) - hmod ) / 60 ))
        overdue=$([ "$omin" -ge "$OVERDUE_MIN" ] && echo 1 || echo 0)
        if [ "$overdue" = "1" ] && [ "${PREV_OVERDUE[$name]:-0}" = "0" ]; then
          echo "SESSION-OVERDUE $name 的会话活着，但心跳 ${omin} 分钟未更新（预期周期 ${LOOP_MIN} 分钟）——会话可能已死，它会静默地永远空闲"
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
