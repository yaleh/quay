#!/usr/bin/env bash
# plugin/scripts/promotion-driver-launch.sh — 统一 driver supervisor（AC139）。
# (tasks/gap-ac139-unified-driver-subcommand)
#
# WHAT CHANGED（原 AC137 单 kind 脚本 → 统一 supervisor）：
#   AC139 裁定把 promotion-driver 与 worker-driver 的【启动面】收敛到一个 `quay` 子命令
#   （`quay driver <start|stop|drain|status|restart> --kind <promotion|worker>`）。本脚本是
#   那单一 supervisor：仓库里只此一份 respawn/守护循环，两个 kind 的差异全部由下方
#   【registry 表（数据）】承载，⛔ 非两份代码分支（AC139-2 取假：两个文件各有一个独立
#   supervisor 循环 ⇒ 假）。
#
# 继承（⛔ 非回退）gap-resident-driver-stable-carrier-liveness 的稳定承载 + 死亡告警修复：
#   AC1 稳定承载：_resolve_main_root() 主检出解析（仍保留——脚本层防御；CLI 层 AC139-4 另做
#       worktree 拒绝，两层不冲突：CLI 拒绝、脚本对直调 --root=worktree 规范化到主检出）。
#   AC2 死亡告警：liveness 子命令检测并报告 driver/supervisor 死亡（pid 文件指向已不存在的
#       pid ⇒ DEATH + 退出 1 + 写 liveness 事件；⛔ 载体停更 ≠ 一切正常）。
#   AC3 supervisor 死：kill -9 supervisor 后 liveness 报 supervisor_dead，孤儿 driver ⛔ 不再
#       被 status/liveness 误判为「在跑」（running = supervisor_alive && driver_alive）。
#
# 三处真实语义冲突的处置（AC139-1，⛔ 直接透传会静默改行为）：
#   ① --pid-file 两边不同义：promotion 单值覆盖（驱动自写自己的 pid）；worker append 每个
#      worker 子进程 pid。→ registry 里 KIND_PID_SELF 区分：promotion 把 --pid-file 指向驱动
#      pid 文件（驱动自写）；worker 把 --pid-file 指向 in-flight pid 文件（append），而 supervisor
#      自己用 $! 权威记录 worker 驱动自身 pid 到 <prefix>.pid。
#   ② worker 有第三种模式 --serve（MCP 控制面），promotion 没有。→ 本脚本不碰 --serve（那是
#      驱动自己的入口，非 supervisor 承载面）；supervisor 只守护常驻选择环/晋升环。
#   ③ 停机语义两套：promotion 杀在飞（stop sentinel + TERM + 兜底 kill -9）；worker .halt 不杀在飞。
#      → `stop` 与 `drain` 分立：两个 kind 都支持 stop（杀 supervisor+driver；worker ⛔ 不杀在飞
#      worker）与 drain（halt：写各自控制态文件 halted=true，只挡新派发/新一轮，⛔ 不杀在飞）。
#      promotion 的 drain 写 promotion-control.json（AC150-2，与 worker-control.json 同族不同文件）。
#      ⛔ 对不支持的动词直接报错（退出 2），不静默回落（registry 里 KIND_VERBS 声明）。
#
# 权责边界（⛔ 只做承载与入口，不改两驱动业务逻辑——选择环/晋升判定/fix worker）：
#   ✅ 启动/停止/排空/状态/重启/告警 promotion 与 worker 常驻进程（supervisor 守护）
#   ✅ 异常退出（含被 kill）后自动重拉，每次重拉写一条 supervisor 事件
#   ⛔ 不改 promotion-driver.ts / worker-driver.ts 逻辑
#   ⛔ 不做任何 commit、不读/写 .halt、不翻 task status（驱动自己的 --apply 晋升除外）
#
# 用法：
#   bash plugin/scripts/promotion-driver-launch.sh <start|stop|drain|status|restart|liveness> \
#       --kind <promotion|worker> [--root <repo>] [--interval <ms>] [--cap <n>]
#       [--restart-delay <s>] [--run-id <id>] [--json]
#     --kind <promotion|worker>  目标驱动（缺省 promotion；CLI 入口恒显式传）
#     --root <repo>        目标仓库根（缺省 = 本脚本 ../..）
#     --interval <ms>      驱动轮间隔（仅 promotion 透传；worker 常驻选择环无 --interval）
#     --cap <n>            并发 cap（promotion → --cap；worker → --concurrency；缺省 = 驱动自己）
#     --restart-delay <s>  supervisor 重拉间隔秒（缺省 5；只作重拉节奏占位，非阈值）
#     --run-id <id>        驱动 run id（缺省 pm-prod-/wk-prod-<start-epoch>；重拉保持同 id 便于追迹）
#     --json               status/liveness 输出机器可读 JSON
#
# 状态文件（<root>/.quay/，全部 gitignored 运行时态，⛔ 不进 git；<prefix> = promotion-driver|worker-driver）：
#   <prefix>.pid              驱动 pid（supervisor 权威写 $!；promotion 驱动也自写同值）
#   <prefix>-supervisor.pid   supervisor pid（本脚本写）
#   <prefix>.log              驱动 stdout/stderr（append）
#   <prefix>-supervisor.log   supervisor 事件（start/exit/respawn，append）
#   <prefix>-liveness.log     liveness 告警事件（ok / DEATH deaths=…，append）
#   <prefix>.stop             停止哨兵（存在 = stop 已请求，supervisor 不再重拉）
#   worker-driver-inflight.pid  worker 在飞 worker 子进程 pid（驱动 --pid-file append，仅观测）
#   载体（status 读）：promotion → promotion-outcome.jsonl + promotion-round.jsonl；
#                      worker   → worker-outcome.jsonl + worker-round.jsonl（AC138-3 无条件心跳）
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

# ── 主检出解析（AC1 稳定承载，gap-resident-driver-stable-carrier-liveness）───────────────
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

# ── registry 表（数据）── 两 kind 差异全在此，supervisor 循环只一份（AC139-2）────────────
# 每个 kind 声明：driver 脚本名、状态文件前缀、支持的动词、cap flag 名、是否透传 --interval、
# --pid-file 语义（自写自己 pid vs append 在飞 pids）、run-id 前缀、载体文件列表。
declare -A KIND_DRIVER=(
  [promotion]="promotion-driver.ts"
  [worker]="worker-driver.ts"
)
declare -A KIND_PREFIX=(
  [promotion]="promotion-driver"
  [worker]="worker-driver"
)
declare -A KIND_VERBS=(
  [promotion]="start stop drain status restart liveness"
  [worker]="start stop drain status restart liveness"
)
declare -A KIND_CAP_FLAG=(
  [promotion]="--cap"
  [worker]="--concurrency"
)
declare -A KIND_HAS_INTERVAL=(
  [promotion]="1"
  [worker]="0"
)
# promotion：驱动把 --pid-file 写为自己的 pid（单值覆盖，自写）；worker：--pid-file = append 在飞
# worker 子进程 pid（多值），故 worker 驱动自身 pid 由 supervisor 用 $! 权威写 <prefix>.pid。
declare -A KIND_PID_SELF=(
  [promotion]="1"
  [worker]="0"
)
declare -A KIND_RUN_PREFIX=(
  [promotion]="pm-prod"
  [worker]="wk-prod"
)
# 载体文件（相对 .quay/；首个 = 主载体，作 status 的 carrier_path）。
declare -A KIND_CARRIERS=(
  [promotion]="promotion-outcome.jsonl promotion-round.jsonl"
  [worker]="worker-outcome.jsonl worker-round.jsonl"
)
# 控制态文件（相对 .quay/；drain 写它、驱动判停读它）。promotion → promotion-control.json；
# worker → worker-control.json（两个 kind 独立，halting 一个不杀另一个——AC150-2）。
declare -A KIND_CONTROL_FILE=(
  [promotion]="promotion-control.json"
  [worker]="worker-control.json"
)

# ── 参数解析 ──────────────────────────────────────────────────────────────────────────
CMD="${1:-start}"
shift || true

KIND="promotion"
ROOT=""
INTERVAL=""
CAP=""
RESTART_DELAY="5"
RUN_ID=""
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --interval) INTERVAL="${2:-}"; shift 2 ;;
    --cap) CAP="${2:-}"; shift 2 ;;
    --restart-delay) RESTART_DELAY="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --json) JSON=1; shift ;;
    *) echo "promotion-driver-launch: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# kind 校验（registry 表里没有 = 未知 kind，⛔ 不静默回落）。
if [ -z "${KIND_DRIVER[$KIND]:-}" ]; then
  echo "promotion-driver-launch: unknown --kind: ${KIND:-<empty>} (expected promotion|worker)" >&2
  exit 2
fi

# 动词校验（AC139-1：各 kind 声明支持哪些，对不支持的直接报错，⛔ 不静默回落）。
# 内部动词 __supervise 不在此表（supervisor 自身模式，非用户动词）。
if [ "$CMD" != "__supervise" ]; then
  case " ${KIND_VERBS[$KIND]} " in
    *" $CMD "*) ;;
    *) echo "promotion-driver-launch: kind $KIND does not support '$CMD' (supports: ${KIND_VERBS[$KIND]})" >&2; exit 2 ;;
  esac
fi

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

# ── kind 派生变量（registry 数据 → 本脚本状态文件/载体/参数）──────────────────────────
PREFIX="${KIND_PREFIX[$KIND]}"
DRIVER="$ROOT/plugin/scripts/${KIND_DRIVER[$KIND]}"
STATE_DIR="$ROOT/.quay"
DRIVER_PID_FILE="$STATE_DIR/$PREFIX.pid"
SUPERVISOR_PID_FILE="$STATE_DIR/$PREFIX-supervisor.pid"
DRIVER_LOG="$STATE_DIR/$PREFIX.log"
SUPERVISOR_LOG="$STATE_DIR/$PREFIX-supervisor.log"
LIVENESS_LOG="$STATE_DIR/$PREFIX-liveness.log"
STOP_SENTINEL="$STATE_DIR/$PREFIX.stop"
INFLIGHT_PID_FILE="$STATE_DIR/$PREFIX-inflight.pid"
# --pid-file 传给驱动的目标：promotion = 驱动 pid 文件（自写）；worker = in-flight pid 文件（append）。
if [ "${KIND_PID_SELF[$KIND]}" = "1" ]; then
  PID_ARG_FILE="$DRIVER_PID_FILE"
else
  PID_ARG_FILE="$INFLIGHT_PID_FILE"
fi
# 载体文件绝对路径（空格分隔；首个 = 主载体）。
CARRIERS=""
CARRIER_PRIMARY=""
for c in ${KIND_CARRIERS[$KIND]}; do
  CARRIERS="$CARRIERS $STATE_DIR/$c"
  [ -z "$CARRIER_PRIMARY" ] && CARRIER_PRIMARY="$STATE_DIR/$c"
done
CARRIERS="${CARRIERS# }"

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

# 载体观测（AC139-3）：carrier_records = 全载体行数之和；last_record_ts = 全载体末条记录 ts 的
# 最大值（⛔ 只报计数无法区分「在长」与「停更」——载体停更与「一切正常」同形）。ts 字段是两种
# driver 的 outcome/round 记录共有的 ISO 时间戳键（record 首字段）。
_carrier_stats() {
  local f recs=0 ts="" last_ts=""
  for f in $CARRIERS; do
    if [ -f "$f" ]; then
      recs=$(( recs + $(wc -l < "$f" | tr -d ' ') ))
      ts="$(grep -o '"ts":"[^"]*"' "$f" 2>/dev/null | tail -n 1 | sed -nE 's/^"ts":"([^"]*)"$/\1/p')"
      if [ -n "$ts" ] && { [ -z "$last_ts" ] || [ "$ts" \> "$last_ts" ]; }; then
        last_ts="$ts"
      fi
    fi
  done
  printf '%s %s' "$recs" "$last_ts"
}

# ── supervisor 循环（__supervise 模式的前台进程里运行）── 单一循环，kind 差异由 registry 数据驱动 ──
run_supervisor() {
  set +e  # 驱动非零退出是常态（被 kill / 异常），不是 supervisor 的错误
  local child=""
  cleanup() {
    [ -n "$child" ] && kill "$child" 2>/dev/null || true
    exit 0
  }
  trap cleanup TERM INT HUP

  local args=(--root "$ROOT")
  [ -n "$CAP" ] && args+=( "${KIND_CAP_FLAG[$KIND]}" "$CAP" )
  if [ "${KIND_HAS_INTERVAL[$KIND]}" = "1" ] && [ -n "$INTERVAL" ]; then
    args+=(--interval "$INTERVAL")
  fi
  args+=(--pid-file "$PID_ARG_FILE" --run-id "$RUN_ID")

  # worker 并发缺省（对齐 inner=5，人双重裁定；gap-launch-script-worker-cap-broken AC2）：无显式 --cap
  # 时经定义点 env（worker-driver.ts MAX_TASK_SUBAGENTS_ENV）给驱动缺省并发 5，resolveConcurrency
  # 读到 5（⛔ 否则 resident 模式 taskCount=0 ⇒ 兜底 1）。只设 env、不把字面量写进驱动 argv。
  if [ "$KIND" = "worker" ] && [ -z "$CAP" ]; then
    export QUAY_MAX_TASK_SUBAGENTS=5
  fi

  while true; do
    "$NODE_BIN" --experimental-strip-types "$DRIVER" "${args[@]}" >> "$DRIVER_LOG" 2>&1 &
    child=$!
    # supervisor 权威记录驱动自身 pid（⛔ 不依赖驱动 --pid-file：worker 的 --pid-file 另作
    # 在飞 pids 用途；promotion 驱动自写同值，覆盖写幂等）。
    echo "$child" > "$DRIVER_PID_FILE"
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
  # driver 进程还在）⛔ 不算 running（AC3(b)：不再被误判为「在跑」）。alive 与 running 同值，
  # alive 是 AC139-3 的字段名，running 保留作 backward compat。
  local running=0
  [ "$sup_alive" = "1" ] && [ "$drv_alive" = "1" ] && running=1
  local stats last_ts="null"
  stats="$(_carrier_stats)"
  local recs="${stats%% *}"
  last_ts="${stats#* }"
  [ -z "$last_ts" ] && last_ts="null"
  # JSON 里 last_record_ts 是字符串（引号）或 null（⛔ 非引号裸值，否则 ISO 冒号产生非法 JSON）。
  local ts_json
  if [ "$last_ts" = "null" ]; then ts_json="null"; else ts_json="\"$last_ts\""; fi
  if [ "$JSON" = "1" ]; then
    printf '{"kind":"%s","supervisor_pid":%s,"driver_pid":%s,"supervisor_alive":%s,"driver_alive":%s,"alive":%s,"running":%s,"carrier_path":"%s","carrier_records":%s,"last_record_ts":%s}\n' \
      "$KIND" "${spid:-null}" "${dpid:-null}" "$sup_alive" "$drv_alive" "$running" "$running" "$CARRIER_PRIMARY" "$recs" "$ts_json"
  else
    echo "$PREFIX: kind=$KIND · supervisor pid=${spid:-none} alive=$sup_alive · driver pid=${dpid:-none} alive=$drv_alive · running=$running · carrier_path=$CARRIER_PRIMARY · carrier_records=$recs · last_record_ts=${last_ts}"
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
  local run_id="${RUN_ID:-${KIND_RUN_PREFIX[$KIND]}-$(date +%s)}"
  local extra_args=()
  # ⛔ 这里的 extra_args 传给【supervisor 自重启】（__supervise 模式），而 __supervise 的 arg 解析只认
  # --cap（本脚本自己的旗标），不认驱动旗标 KIND_CAP_FLAG（worker=--concurrency）——用后者会报
  # `unknown argument: --concurrency` 杀掉旧 supervisor、新 supervisor 起不来 = driver 停摆
  # （gap-launch-script-worker-cap-broken AC1）。驱动的 --concurrency 由 run_supervisor 映射。
  [ -n "$CAP" ] && extra_args+=( --cap "$CAP" )
  if [ "${KIND_HAS_INTERVAL[$KIND]}" = "1" ] && [ -n "$INTERVAL" ]; then
    extra_args+=( --interval "$INTERVAL" )
  fi
  setsid nohup bash "$LAUNCH_SCRIPT" __supervise --kind "$KIND" --root "$ROOT" \
    "${extra_args[@]}" --restart-delay "$RESTART_DELAY" --run-id "$run_id" \
    >> "$SUPERVISOR_LOG" 2>&1 &
  local sup_pid=$!
  echo "$sup_pid" > "$SUPERVISOR_PID_FILE"
  # 等驱动真正 spawn（supervisor 首轮 spawn 后写 <prefix>.pid）。
  local i
  for i in $(seq 1 20); do
    [ -f "$DRIVER_PID_FILE" ] && break
    sleep 0.5
  done
  echo "started: supervisor pid=$sup_pid kind=$KIND run_id=$run_id"
  cmd_status
}

# ── stop（硬停：杀 supervisor + 驱动；⛔ 不杀 worker 在飞子进程——那些在 in-flight pid 文件里，本函数不碰）─
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
  # 兜底 kill -9（supervisor/驱动 10s 内未退出）。⛔ 只针对 supervisor 与驱动自身，不扫 in-flight。
  [ -n "$spid" ] && pid_alive "$spid" && kill -9 "$spid" 2>/dev/null || true
  [ -n "$dpid" ] && pid_alive "$dpid" && kill -9 "$dpid" 2>/dev/null || true
  rm -f "$DRIVER_PID_FILE" "$SUPERVISOR_PID_FILE" "$STOP_SENTINEL"
  if [ "$stopped" = "1" ]; then echo "stopped"; else echo "not-running"; fi
  return 0
}

# ── drain（两个 kind 都支持，AC150-2）── halt 语义：只挡新派发/新一轮，⛔ 不杀在飞 ──
# 写 <kind>-control.json halted=true（driver-shared.ts 单一真相源停机态，读-改-写保留 preference/forced，
# 不破坏用户控制态）。不触碰 supervisor / driver / 在飞 worker 进程。promotion → promotion-control.json；
# worker → worker-control.json（两个 kind 独立，halting 一个不杀另一个）。
cmd_drain() {
  local control_file="$STATE_DIR/${KIND_CONTROL_FILE[$KIND]}"
  DRIVER_DRAIN_FILE="$control_file" DRIVER_DRAIN_KIND="$KIND" "$NODE_BIN" --experimental-strip-types - <<'NODE'
import fs from "node:fs";
import path from "node:path";
const file = process.env.DRIVER_DRAIN_FILE;
const kind = process.env.DRIVER_DRAIN_KIND || "worker";
// 与 driver-shared.ts 的 mergeControlState 同形（单一真相源：缺字段取缺省；读失败非 ENOENT 报错）。
const dflt = { schemaVersion: 1, halted: false, halted_by: null, halted_at: null, preference: {}, forced: [] };
let state = dflt;
try {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed && typeof parsed === "object") {
    state = {
      schemaVersion: 1,
      halted: typeof parsed.halted === "boolean" ? parsed.halted : dflt.halted,
      halted_by: typeof parsed.halted_by === "string" ? parsed.halted_by : null,
      halted_at: typeof parsed.halted_at === "string" ? parsed.halted_at : null,
      preference: parsed.preference && typeof parsed.preference === "object" && !Array.isArray(parsed.preference) ? parsed.preference : {},
      forced: Array.isArray(parsed.forced) ? parsed.forced : [],
    };
  }
} catch (e) {
  if (e && e.code !== "ENOENT") {
    console.error("promotion-driver-launch: drain: could not read " + file + ": " + e.message);
    process.exit(2);
  }
}
state.halted = true;
state.halted_by = "quay-driver-drain";
state.halted_at = new Date().toISOString();
fs.mkdirSync(path.dirname(file), { recursive: true });
const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
fs.renameSync(tmp, file);
console.log(`drained: ${kind} halted (no new dispatch; in-flight workers untouched) — control state at ` + file);
NODE
  return 0
}

# ── liveness（AC2 死亡告警 / AC3 supervisor 死检测）────────────────────────────────
# 检测并报告 driver/supervisor 的死亡：pid 文件指向【已不存在的 pid】是死亡的直接量（⛔
# 载体停更 ≠ 一切正常 —— AC137 land 后 supervisor 死了 33 分钟无人察觉的形态）。每次运行
# 写一条事件到 <root>/.quay/<prefix>-liveness.log（append，gitignored），stdout
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
    printf '{"kind":"%s","supervisor_pid":%s,"driver_pid":%s,"supervisor_alive":%s,"driver_alive":%s,"running":%s,"deaths":"%s"}\n' \
      "$KIND" "${spid:-null}" "${dpid:-null}" "$sup_alive" "$drv_alive" "$running" "${deaths:-none}"
  else
    echo "$PREFIX-liveness: kind=$KIND · supervisor_alive=$sup_alive · driver_alive=$drv_alive · running=$running · deaths=${deaths:-none}"
  fi

  # 持久报告（告警事件载体；deaths 空 = ok 心跳，非空 = DEATH 事件）。⛔ `DEATH deaths=` 必须相邻
  # （stable-carrier 测试的正则 /DEATH deaths=…/ 据此判死亡告警），kind 附加在 deaths 之后。
  if [ -n "$deaths" ]; then
    echo "$(_ts) liveness: DEATH deaths=$deaths kind=$KIND supervisor_pid=${spid:-none} driver_pid=${dpid:-none}" >> "$LIVENESS_LOG"
    return 1
  fi
  echo "$(_ts) liveness: ok kind=$KIND supervisor_pid=${spid:-none} driver_pid=${dpid:-none}" >> "$LIVENESS_LOG"
  return 0
}

# ── 命令分派 ─────────────────────────────────────────────────────────────────────────
case "$CMD" in
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  drain)    cmd_drain ;;
  status)   cmd_status ;;
  liveness) cmd_liveness ;;
  restart)  cmd_stop >/dev/null; cmd_start ;;
  __supervise) RUN_ID="${RUN_ID:-${KIND_RUN_PREFIX[$KIND]}-$(date +%s)}"; run_supervisor ;;
  *) echo "promotion-driver-launch: unknown command: $CMD (expected start|stop|drain|status|restart|liveness)" >&2; exit 2 ;;
esac
