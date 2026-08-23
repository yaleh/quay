#!/usr/bin/env bash
# plugin/scripts/promotion-driver-launch.sh — AC137：promotion-driver 的【生产启用】开关
# (tasks/gap-ac137-promotion-driver-production-enablement)。
#
# WHY THIS EXISTS（manager-phase-goal ### AC137，硬规则 5b 自指实例）：
#   AC130–136 七条 done 时，promotion-driver 机制存在但【没在跑】——`ps` 零命中、
#   .quay/promotion-outcome.jsonl 不存在。缺口是「谁按下开关」这一层：没有任何一条 AC
#   要求把驱动启动起来。本脚本就是那个开关：把 promotion-driver.ts 作为常驻进程启动 +
#   守护重启（异常退出/被 kill 后自动拉起），使 AC134-AC2 / AC135-AC2 / AC135-AC3 三条
#   「待外部」判据的窗口得以起算。
#
# 形态（⛔ AC137 判据不规定形态，本脚本自定）：纯 bash 守护循环（supervisor）。supervisor
#   用 setsid+nohup 从本脚本会话脱离，循环 spawn `node … promotion-driver.ts`、wait 其退出、
#   查停止哨兵后 sleep 重拉。不依赖 systemd / cron / tmux / 任何 Claude 会话锚点——单一真相
#   源是【进程】本身（同 promotion-driver.ts 头注释「停机态 = 进程信号」）。
#
# 权责边界（⛔ 只做 AC137 判据，不越界到 AC130–136 —— 那些是已 done 的任务）：
#   ✅ 启动/停止/状态/重启 promotion-driver 常驻进程（supervisor 守护）
#   ✅ 异常退出（含被 kill）后自动重拉（AC3 重启存活），每次重拉写一条 supervisor 事件
#   ⛔ 不改 promotion-driver.ts 逻辑（AC130-133 已覆盖）
#   ⛔ 不做任何 commit、不读/写 .halt、不翻 task status（驱动自己的 --apply 晋升除外）
#
# 稳定承载 + 死亡告警（gap-resident-driver-stable-carrier-liveness，AC1-3）：
#   AC1 稳定承载：启动入口自规范化到主检出（primary worktree）。supervisor 的 cmdline 脚本
#      路径 = 主检出，⛔ 非 worktrees/ —— worktree 是短命对象（ff 合并即移除），常驻
#      supervisor 挂在上面 = 驱动寿命 ≤ 该任务寿命（AC137 land 后 ~7s 双死的实测成因）。
#   AC2 死亡告警：`liveness` 子命令检测并报告 driver/supervisor 死亡（pid 文件指向【已不
#      存在的 pid】⇒ 报告 DEATH + 退出 1 + 写 liveness 事件；⛔ 载体停更 ≠ 一切正常）。
#   AC3 supervisor 死：kill -9 supervisor 后 liveness 报 supervisor_dead，且孤儿 driver
#      ⛔ 不再被 status/liveness 误判为「在跑」（running = supervisor_alive && driver_alive）。
#
# 用法：
#   bash plugin/scripts/promotion-driver-launch.sh start    [--root <repo>] [--interval <ms>]
#                                                            [--cap <n>] [--restart-delay <s>] [--run-id <id>]
#   bash plugin/scripts/promotion-driver-launch.sh stop      [--root <repo>]
#   bash plugin/scripts/promotion-driver-launch.sh status    [--root <repo>] [--json]
#   bash plugin/scripts/promotion-driver-launch.sh liveness  [--root <repo>] [--json]
#   bash plugin/scripts/promotion-driver-launch.sh restart   [--root <repo>] [--interval <ms>] …
#     --root <repo>        目标仓库根（缺省 = 本脚本 ../..）
#     --interval <ms>      驱动轮间隔（透传 promotion-driver --interval；缺省 = 驱动自己 30000）
#     --cap <n>            并发 cap（透传 --cap；缺省 = 驱动自己 5）
#     --restart-delay <s>  supervisor 重拉间隔秒（缺省 5；只作重拉节奏占位，非阈值）
#     --run-id <id>        驱动 run id（缺省 pm-prod-<start-epoch>；重拉保持同 id 便于追迹）
#     --json               status/liveness 输出机器可读 JSON
#
# 状态文件（<root>/.quay/，全部 gitignored 运行时态，⛔ 不进 git）：
#   promotion-driver.pid             驱动 pid（驱动 --pid-file 自写，外部观测 + kill 抓手）
#   promotion-driver-supervisor.pid  supervisor pid（本脚本写）
#   promotion-driver.log             驱动 stdout/stderr（append）
#   promotion-driver-supervisor.log  supervisor 事件（start/exit/respawn，append）
#   promotion-driver-liveness.log    liveness 告警事件（ok / DEATH deaths=…，append）
#   promotion-driver.stop            停止哨兵（存在 = stop 已请求，supervisor 不再重拉）
#
# Exit: 0 = 命令成功 / liveness 健康；1 = 运行/停止失败 / liveness 检出死亡；2 = 参数错误。

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  awk 'NR>=2 { if ($0 ~ /^[[:space:]]*$/) { print; next } if ($0 ~ /^#/) { sub(/^# ?/, ""); print; next } exit }' "$0"
  exit 0
fi

set -euo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"
REPO_ROOT_DEFAULT="$(cd "$SELF_DIR/../.." 2>/dev/null && pwd || true)"

if ! NODE_BIN="$(command -v node 2>/dev/null)"; then
  echo "promotion-driver-launch: node required" >&2
  exit 2
fi

# ── 主检出解析（AC1 稳定承载）────────────────────────────────────────────────────────
# 常驻 supervisor 不得由生命周期短于它的对象承载：若 --root 落在 git worktree 内（脚本自身
# 从 worktree 路径被调用即属此类），把 ROOT 规范化到 primary worktree（主检出），使 supervisor
# cmdline 的脚本路径 = 主检出（⛔ 非 worktrees/）。git 不可用 / 非 git 仓库 / 解析失败 ⇒
# 原样返回 ROOT（无 git 上下文，无从规范化，保持旧行为）。
_resolve_main_root() {
  local root="$1" main=""
  if command -v git >/dev/null 2>&1; then
    # ⛔ `|| true`：非 git 仓库 / git 解析失败时命令替换返回 0（不是靠 set -e 不触发的
    # 版本相关行为），main 为空 ⇒ 走 fallback 原样返回 ROOT。
    main="$(git -C "$root" worktree list --porcelain 2>/dev/null | awk '/^worktree / {print $2; exit}' || true)"
  fi
  if [ -n "$main" ] && [ -d "$main" ]; then
    printf '%s\n' "$main"
  else
    printf '%s\n' "$root"
  fi
}

# ── 参数解析 ──────────────────────────────────────────────────────────────────────────
CMD="${1:-start}"
shift || true

ROOT=""
INTERVAL=""
CAP=""
RESTART_DELAY="5"
RUN_ID=""
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    --interval) INTERVAL="${2:-}"; shift 2 ;;
    --cap) CAP="${2:-}"; shift 2 ;;
    --restart-delay) RESTART_DELAY="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --json) JSON=1; shift ;;
    *) echo "promotion-driver-launch: unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="${ROOT:-$REPO_ROOT_DEFAULT}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  echo "promotion-driver-launch: invalid --root: ${ROOT:-<empty>}" >&2
  exit 2
fi
ROOT="$(cd "$ROOT" && pwd)"

# ── 稳定承载（AC1, gap-resident-driver-stable-carrier-liveness）────────────────────
# worktree 是短命对象（ff 合并即移除）；常驻 supervisor 挂在上面 = 驱动寿命 ≤ 该任务寿命。
# 启动入口规范化到主检出：supervisor 的 --root 与 cmdline 脚本路径都指向主检出。
MAIN_ROOT="$(_resolve_main_root "$ROOT")"
if [ "$MAIN_ROOT" != "$ROOT" ]; then
  echo "promotion-driver-launch: relocating carrier worktree=$ROOT → main=$MAIN_ROOT" >&2
  ROOT="$MAIN_ROOT"
fi
# 规范化后的启动脚本路径（supervisor 的 cmdline 载体，⛔ 非 $0 的 worktree 路径）。
LAUNCH_SCRIPT="$ROOT/plugin/scripts/promotion-driver-launch.sh"

DRIVER="$ROOT/plugin/scripts/promotion-driver.ts"
STATE_DIR="$ROOT/.quay"
DRIVER_PID_FILE="$STATE_DIR/promotion-driver.pid"
SUPERVISOR_PID_FILE="$STATE_DIR/promotion-driver-supervisor.pid"
DRIVER_LOG="$STATE_DIR/promotion-driver.log"
SUPERVISOR_LOG="$STATE_DIR/promotion-driver-supervisor.log"
LIVENESS_LOG="$STATE_DIR/promotion-driver-liveness.log"
STOP_SENTINEL="$STATE_DIR/promotion-driver.stop"

[ -f "$DRIVER" ] || { echo "promotion-driver-launch: driver not found at $DRIVER" >&2; exit 2; }
mkdir -p "$STATE_DIR"

# 轻量校验（正整数/零——驱动自己还会二次校验；此处只防「坏配置 → 重启死循环」）。
_is_nonneg_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}
if [ -n "$INTERVAL" ] && ! _is_nonneg_int "$INTERVAL"; then
  echo "promotion-driver-launch: invalid --interval: $INTERVAL" >&2; exit 2
fi
if [ -n "$CAP" ] && ! _is_nonneg_int "$CAP"; then
  echo "promotion-driver-launch: invalid --cap: $CAP" >&2; exit 2
fi
if ! _is_nonneg_int "$RESTART_DELAY"; then
  echo "promotion-driver-launch: invalid --restart-delay: $RESTART_DELAY" >&2; exit 2
fi

_ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

pid_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}
driver_pid()      { [ -f "$DRIVER_PID_FILE" ] && cat "$DRIVER_PID_FILE" 2>/dev/null || true; }
supervisor_pid()  { [ -f "$SUPERVISOR_PID_FILE" ] && cat "$SUPERVISOR_PID_FILE" 2>/dev/null || true; }

# ── supervisor 循环（__supervise 模式的前台进程里运行）──────────────────────────────
run_supervisor() {
  set +e  # 驱动非零退出是常态（被 kill / 异常），不是 supervisor 的错误
  local child=""
  cleanup() {
    [ -n "$child" ] && kill "$child" 2>/dev/null || true
    exit 0
  }
  trap cleanup TERM INT HUP

  local args=(--root "$ROOT")
  [ -n "$CAP" ] && args+=(--cap "$CAP")
  [ -n "$INTERVAL" ] && args+=(--interval "$INTERVAL")
  args+=(--pid-file "$DRIVER_PID_FILE" --run-id "$RUN_ID")

  while true; do
    "$NODE_BIN" --experimental-strip-types "$DRIVER" "${args[@]}" >> "$DRIVER_LOG" 2>&1 &
    child=$!
    echo "$(_ts) supervisor: started driver pid=$child" >> "$SUPERVISOR_LOG"
    wait "$child"
    local code=$?
    child=""
    echo "$(_ts) supervisor: driver exited code=$code" >> "$SUPERVISOR_LOG"
    if [ -f "$STOP_SENTINEL" ]; then
      echo "$(_ts) supervisor: stop sentinel present; exiting" >> "$SUPERVISOR_LOG"
      rm -f "$STOP_SENTINEL" || true
      exit 0
    fi
    echo "$(_ts) supervisor: respawning driver in ${RESTART_DELAY}s" >> "$SUPERVISOR_LOG"
    sleep "$RESTART_DELAY"
  done
}

# ── status ───────────────────────────────────────────────────────────────────────────
cmd_status() {
  local spid dpid
  spid="$(supervisor_pid)"; dpid="$(driver_pid)"
  local sup_alive=0 drv_alive=0
  [ -n "$spid" ] && pid_alive "$spid" && sup_alive=1
  [ -n "$dpid" ] && pid_alive "$dpid" && drv_alive=1
  # running = 生产驱动「在服务」：supervisor 与 driver 都在。孤儿 driver（supervisor 死而
  # driver 进程还在）⛔ 不算 running（AC3(b)：不再被误判为「在跑」）。
  local running=0
  [ "$sup_alive" = "1" ] && [ "$drv_alive" = "1" ] && running=1
  local outcome_n=0 round_n=0
  [ -f "$STATE_DIR/promotion-outcome.jsonl" ] && outcome_n="$(wc -l < "$STATE_DIR/promotion-outcome.jsonl" | tr -d ' ')"
  [ -f "$STATE_DIR/promotion-round.jsonl" ] && round_n="$(wc -l < "$STATE_DIR/promotion-round.jsonl" | tr -d ' ')"
  if [ "$JSON" = "1" ]; then
    printf '{"supervisor_pid":%s,"driver_pid":%s,"supervisor_alive":%s,"driver_alive":%s,"running":%s,"outcome_records":%s,"round_records":%s}\n' \
      "${spid:-null}" "${dpid:-null}" "$sup_alive" "$drv_alive" "$running" "$outcome_n" "$round_n"
  else
    echo "promotion-driver: supervisor pid=${spid:-none} alive=$sup_alive · driver pid=${dpid:-none} alive=$drv_alive · running=$running · outcome_records=$outcome_n · round_records=$round_n"
  fi
  return 0
}

# ── start ────────────────────────────────────────────────────────────────────────────
cmd_start() {
  local spid
  spid="$(supervisor_pid)"
  if [ -n "$spid" ] && pid_alive "$spid"; then
    echo "already-running: supervisor pid=$spid"
    cmd_status
    return 0
  fi
  # 无活 supervisor；清掉孤儿驱动（supervisor 已死但驱动还在的中间态）。
  local dpid
  dpid="$(driver_pid)"
  if [ -n "$dpid" ] && pid_alive "$dpid"; then
    echo "orphan driver pid=$dpid (no live supervisor); killing" >&2
    kill -TERM "$dpid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$DRIVER_PID_FILE" "$SUPERVISOR_PID_FILE" "$STOP_SENTINEL"
  local run_id="${RUN_ID:-pm-prod-$(date +%s)}"
  setsid nohup bash "$LAUNCH_SCRIPT" __supervise --root "$ROOT" \
    ${CAP:+--cap "$CAP"} ${INTERVAL:+--interval "$INTERVAL"} \
    --restart-delay "$RESTART_DELAY" --run-id "$run_id" \
    >> "$SUPERVISOR_LOG" 2>&1 &
  local sup_pid=$!
  echo "$sup_pid" > "$SUPERVISOR_PID_FILE"
  # 等驱动真正 spawn（supervisor 首轮 spawn 后，驱动自己写 pid 文件）。
  local i
  for i in $(seq 1 20); do
    [ -f "$DRIVER_PID_FILE" ] && break
    sleep 0.5
  done
  echo "started: supervisor pid=$sup_pid run_id=$run_id"
  cmd_status
}

# ── stop ─────────────────────────────────────────────────────────────────────────────
cmd_stop() {
  local spid dpid
  spid="$(supervisor_pid)"; dpid="$(driver_pid)"
  local stopped=0
  touch "$STOP_SENTINEL"
  if [ -n "$spid" ] && pid_alive "$spid"; then kill -TERM "$spid" 2>/dev/null || true; stopped=1; fi
  if [ -n "$dpid" ] && pid_alive "$dpid"; then kill -TERM "$dpid" 2>/dev/null || true; stopped=1; fi
  local i
  for i in $(seq 1 20); do
    { [ -z "$spid" ] || ! pid_alive "$spid"; } && { [ -z "$dpid" ] || ! pid_alive "$dpid"; } && break
    sleep 0.5
  done
  # 兜底 kill -9（supervisor/驱动 10s 内未退出）。
  [ -n "$spid" ] && pid_alive "$spid" && kill -9 "$spid" 2>/dev/null || true
  [ -n "$dpid" ] && pid_alive "$dpid" && kill -9 "$dpid" 2>/dev/null || true
  rm -f "$DRIVER_PID_FILE" "$SUPERVISOR_PID_FILE" "$STOP_SENTINEL"
  if [ "$stopped" = "1" ]; then echo "stopped"; else echo "not-running"; fi
  return 0
}

# ── liveness（AC2 死亡告警 / AC3 supervisor 死检测）────────────────────────────────
# 检测并报告 driver/supervisor 的死亡：pid 文件指向【已不存在的 pid】是死亡的直接量（⛔
# 载体停更 ≠ 一切正常 —— AC137 land 后 supervisor 死了 33 分钟无人察觉的形态）。每次运行
# 写一条事件到 <root>/.quay/promotion-driver-liveness.log（append，gitignored），stdout
# 输出机器可读 verdict；检出死亡时退出 1（健康退出 0）。
cmd_liveness() {
  local spid dpid sup_alive drv_alive running deaths
  spid="$(supervisor_pid)"; dpid="$(driver_pid)"
  sup_alive=0; drv_alive=0
  [ -n "$spid" ] && pid_alive "$spid" && sup_alive=1
  [ -n "$dpid" ] && pid_alive "$dpid" && drv_alive=1
  running=0
  [ "$sup_alive" = "1" ] && [ "$drv_alive" = "1" ] && running=1
  deaths=""
  # supervisor 死：pid 文件在而进程不在。
  if [ -n "$spid" ] && [ "$sup_alive" = "0" ]; then deaths="supervisor_dead"; fi
  # driver 死：pid 文件在而进程不在。
  if [ -n "$dpid" ] && [ "$drv_alive" = "0" ]; then
    if [ -n "$deaths" ]; then deaths="$deaths,driver_dead"; else deaths="driver_dead"; fi
  fi
  # 孤儿 driver：supervisor 死而 driver 进程还在 —— ⛔ 不算「在跑」（AC3(b)）。
  if [ "$sup_alive" = "0" ] && [ "$drv_alive" = "1" ]; then
    if [ -n "$deaths" ]; then deaths="$deaths,driver_orphaned"; else deaths="driver_orphaned"; fi
  fi

  if [ "$JSON" = "1" ]; then
    printf '{"supervisor_pid":%s,"driver_pid":%s,"supervisor_alive":%s,"driver_alive":%s,"running":%s,"deaths":"%s"}\n' \
      "${spid:-null}" "${dpid:-null}" "$sup_alive" "$drv_alive" "$running" "${deaths:-none}"
  else
    echo "promotion-driver-liveness: supervisor_alive=$sup_alive · driver_alive=$drv_alive · running=$running · deaths=${deaths:-none}"
  fi

  # 持久报告（告警事件载体；deaths 空 = ok 心跳，非空 = DEATH 事件）。
  if [ -n "$deaths" ]; then
    echo "$(_ts) liveness: DEATH deaths=$deaths supervisor_pid=${spid:-none} driver_pid=${dpid:-none}" >> "$LIVENESS_LOG"
    return 1
  fi
  echo "$(_ts) liveness: ok supervisor_pid=${spid:-none} driver_pid=${dpid:-none}" >> "$LIVENESS_LOG"
  return 0
}

# ── 命令分派 ─────────────────────────────────────────────────────────────────────────
case "$CMD" in
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  liveness) cmd_liveness ;;
  restart)  cmd_stop >/dev/null; cmd_start ;;
  __supervise) RUN_ID="${RUN_ID:-pm-prod-$(date +%s)}"; run_supervisor ;;
  *) echo "promotion-driver-launch: unknown command: $CMD (expected start|stop|status|restart|liveness)" >&2; exit 2 ;;
esac
