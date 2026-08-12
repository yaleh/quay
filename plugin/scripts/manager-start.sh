#!/usr/bin/env bash
# manager-start.sh — C4/C5: `quay manager start`（无项目参数）独立拉起 manager。
# (gap-manager-productization-five-constraints AC1/AC2/AC5)
#
# 规格：SPEC-manager-productization-2026-08-05 §4.1。manager 的启动与启动项目完全分开：
#   - `manager start` 不接受任何项目参数（C5：两条命令分开，不是一条带参数的命令）
#   - 建自己的会话：独立 tmux session（`quay-manager`，名字来自 _launchSpec.roles.manager.name），
#     不进任何项目的 session（C2：身份不属于任何单个项目）
#   - 设自己的家：$QUAY_GLOBAL_DIR/manager/（状态、tick 日志、观测器配置；C2）
#   - 起会话时锚点确定性建立（AC5）：装上 manager 自己的 `/loop` 作为其中一步——冷启动后锚点必然
#     在位。本脚本负责把「武装」的确定性步骤做成出厂命令（manager-arm-loop.sh），而不是靠谁记得。
#   - 挂 idle-watch 的确定性步骤（AC5，gap-manager-cold-start-no-falsifiable-checklist 缺陷1）：
#     bash 不能调 Monitor 工具 ⇒ 本脚本把「挂载意图」写成家目录下 idle-watch-mount.txt（要执行的
#     Monitor 命令 + 两个核实判据），manager 会话照此执行。真机制是 session-liveness-mount.sh +
#     Monitor 事件（非独立进程，pgrep 看不到）——判据 = monitor-mount-check.sh --json
#     （mounted+targetOk）+ session-liveness.sh --once（SESSION-STATUS 行）。
#
# 2026-08-06 范围收窄（人裁定）：OS watchdog / OS cron / Desktop 定时任务全部禁用；唯一允许的调度
# 锚点是 Claude Code 自己的 loop/cron（AC5）。本脚本不装 systemd unit、不写 crontab。
#
# 用法：
#   manager-start.sh [--session <sess>] [--dry-run] [--json] [--home <dir>] [--check-idle-watch]
#     --session <sess>    目标 tmux 会话（默认：MANAGER_START_SESSION → 读
#                         <repo>/plugin/skills/manager 的 _launchSpec.roles.manager.name → quay-manager）
#     --dry-run           只打印将执行的命令，不实际改动（校验用）
#     --json              JSON 输出（机器消费）；默认人读表格 + 退出码
#     --home <dir>        覆盖 manager 家目录（默认 $QUAY_GLOBAL_DIR/manager/ → $HOME/.quay-global/manager/）
#     --check-idle-watch  只核实 idle-watch 是否挂好（monitor-mount-check + --once 接缝），不改动
#
# 测试接缝：
#   MANAGER_START_SESSION         覆盖会话名
#   MANAGER_START_HOME            覆盖家目录（等价 --home）
#   MANAGER_LAUNCH_CMD            覆盖「拉起会话」的运行命令（默认 <repo>/plugin/scripts/quay-launch.sh manager）
#   MANAGER_ARM_CMD               覆盖「武装 loop」命令（默认 <repo>/plugin/scripts/manager-arm-loop.sh；
#                                 测试可喂 `true` 等无害命令）
#   TOPOLOGY_LOCK_DIR / TOPOLOGY_LOCK_RETRIES / TOPOLOGY_LOCK_STALE_SECONDS
#                                 传给 quay-topology.sh 的单飞锁参数（本脚本对 manager 会话复用同一锁）
#
# 纯读/少写契约：本脚本只建 manager 自己的家与会话，不碰任何项目的文件/会话。
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SESSION="${MANAGER_START_SESSION:-}"
DRY_RUN=0
JSON=0
HOME_DIR="${MANAGER_START_HOME:-}"
CHECK_IDLE_WATCH=0

usage() {
  sed -n '1,46p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --json) JSON=1; shift ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --check-idle-watch) CHECK_IDLE_WATCH=1; shift ;;
    --help|-h) usage ;;
    *)
      echo "ERROR: manager start accepts NO project args (C5: start 与 adopt 分开). Unknown argument: $1" >&2
      echo "       (expected --session <sess> | --dry-run | --json | --home <dir> | --check-idle-watch)" >&2
      exit 2
      ;;
  esac
done

# ── 家目录（C2：不属于任何项目）────────────────────────────────────────────────────────────
QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"

# ── 会话名：显式 > 环境 > launch settings 的 _launchSpec.roles.manager.name → quay-manager ──
if [ -z "$SESSION" ]; then
  if command -v jq >/dev/null 2>&1 && [ -f "$REPO_ROOT/.claude/launch.settings.json" ]; then
    SESSION="$(jq -r '._launchSpec.roles.manager.name // empty' "$REPO_ROOT/.claude/launch.settings.json" 2>/dev/null)"
  fi
fi
if [ -z "$SESSION" ]; then
  SESSION="quay-manager"
fi

# ── 启动命令（默认 quay-launch.sh manager；测试接缝覆盖）────────────────────────────────────
LAUNCH_CMD="${MANAGER_LAUNCH_CMD:-bash $REPO_ROOT/plugin/scripts/quay-launch.sh manager}"

# ── 武装 loop 命令（AC5：起会话时锚点确定性建立；默认 manager-arm-loop.sh）──────────────────
# 值 = 一个可执行路径（脚本 / 命令）。manager-start 用 `bash <path> --home …` 调用。
ARM_CMD="${MANAGER_ARM_CMD:-$REPO_ROOT/plugin/scripts/manager-arm-loop.sh}"

# ── --check-idle-watch：只核实 idle-watch 是否挂好，不改动（AC3 判据的机械执行面）────────────
# 真机制 = session-liveness-mount.sh + Monitor 事件（非独立进程）。判据两条：
#   ① mounted + targetOk（monitor-mount-check.sh --json）——挂上了、挂对仓库
#   ② 至少一条 SESSION-STATUS（session-liveness.sh --once）——观测者真能产事件
# 缺一即未挂好，exit 1。
if [ "$CHECK_IDLE_WATCH" = 1 ]; then
  MOUNT_JSON="$("${MANAGER_MOUNT_CHECK_CMD:-bash $REPO_ROOT/plugin/scripts/monitor-mount-check.sh}" --json 2>/dev/null)"
  MOUNTED="$(printf '%s' "$MOUNT_JSON" | sed -n 's/.*"mounted": *\(true\|false\).*/\1/p' | head -1)"
  TARGET_OK="$(printf '%s' "$MOUNT_JSON" | sed -n 's/.*"targetOk": *\(true\|false\).*/\1/p' | head -1)"
  ONCE_OUT="$(bash "$REPO_ROOT/plugin/scripts/session-liveness.sh" --once 2>&1)"
  STATUS_LINES="$(printf '%s\n' "$ONCE_OUT" | grep -c 'SESSION-STATUS' || true)"
  OK=1
  [ "$MOUNTED" = "true" ] || OK=0
  [ "$TARGET_OK" = "true" ] || OK=0
  [ "${STATUS_LINES:-0}" -ge 1 ] || OK=0
  if [ "$JSON" = 1 ]; then
    printf '{"mounted":%s,"targetOk":%s,"sessionStatusLines":%s,"ok":%s}\n' \
      "$([ "$MOUNTED" = "true" ] && echo true || echo false)" \
      "$([ "$TARGET_OK" = "true" ] && echo true || echo false)" \
      "${STATUS_LINES:-0}" \
      "$([ "$OK" = 1 ] && echo true || echo false)"
  else
    printf '%-18s %s\n' "mounted" "$MOUNTED"
    printf '%-18s %s\n' "target-ok" "$TARGET_OK"
    printf '%-18s %s\n' "session-status-lines" "${STATUS_LINES:-0}"
    if [ "$OK" = 1 ]; then
      echo "idle-watch-delivering: mounted + targetOk + at least one SESSION-STATUS"
    else
      echo "idle-watch-NOT-OK: run the Monitor mount in the manager session per <home>/idle-watch-mount.txt" >&2
    fi
  fi
  [ "$OK" = 1 ] || exit 1
  exit 0
fi

if [ "$DRY_RUN" = 1 ]; then
  cat <<EOF
would-create-home: mkdir -p $HOME_DIR
would-write-identity: $HOME_DIR/identity
would-launch-session: tmux new-session -d -s $SESSION -n manager "$LAUNCH_CMD"
would-arm-loop: $ARM_CMD --home $HOME_DIR
would-mount-idle-watch: write $HOME_DIR/idle-watch-mount.txt (manager session mounts session-liveness-mount.sh via Monitor; verify with monitor-mount-check.sh --json + session-liveness.sh --once)
EOF
  exit 0
fi

# ── 建家（幂等）────────────────────────────────────────────────────────────────────────────
mkdir -p "$HOME_DIR"
IDENTITY="$HOME_DIR/identity"
if [ ! -f "$IDENTITY" ]; then
  printf 'role=manager\nsession=%s\ncreated=%s\n' "$SESSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$IDENTITY"
fi

# ── 建独立会话（幂等：会话已存在且 claude 在位 ⇒ 不动）────────────────────────────────────
CREATED_SESSION=0
if tmux has-session -t "$SESSION" 2>/dev/null; then
  SESSION_STATE="in-place"
else
  # 复用 quay-topology.sh 的单飞锁语义：双创建者竞态不双重创建（AC6）。manager 会话与项目会话
  # 不同锁名（锁按会话名寻址），互不争抢。
  if tmux new-session -d -s "$SESSION" -n manager "$LAUNCH_CMD" >/dev/null 2>&1; then
    CREATED_SESSION=1
    SESSION_STATE="created"
  else
    # 可能恰好被并发创建者抢先——再查一次，仍不在则报错。
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      SESSION_STATE="in-place"
    else
      echo "ERROR: manager-start: could not create tmux session $SESSION" >&2
      exit 1
    fi
  fi
fi

# ── 武装 loop（AC5：冷启动后锚点必然在位；幂等 + 哨兵清扫见 manager-arm-loop.sh）──────────
if ! bash "$ARM_CMD" --home "$HOME_DIR" >/tmp/manager-arm.out 2>&1; then
  echo "WARNING: manager-start: arm-loop step failed (see /tmp/manager-arm.out) — anchor not guaranteed" >&2
  ARM_STATE="failed"
else
  ARM_STATE="armed"
fi

# ── 挂 idle-watch（AC5：冷启动后观测锚点必然在位；gap-manager-cold-start-no-falsifiable-checklist
#    缺陷1）。bash 不能调 Monitor 工具，本步把「挂载意图」写成家目录下的确定性工件——
#    manager 会话照此执行 Monitor 挂载；判据是两条机械可答的核实（--check-idle-watch 已实现）：
#    monitor-mount-check.sh --json 的 mounted+targetOk，与 session-liveness.sh --once 的
#    SESSION-STATUS 行。写成文件而不是只打印，是让「该挂 idle-watch」这个动作有落点——
#    冷启动后任何一轮 tick / 任何外部核实都能回来对账。──────────────────────────────────────
IDLE_WATCH_INTENT="$HOME_DIR/idle-watch-mount.txt"
mkdir -p "$HOME_DIR"
cat > "$IDLE_WATCH_INTENT" <<EOF
# manager idle-watch mount intent — 由 manager 会话执行（bash 不能调 Monitor 工具）。
# 真机制 = session-liveness-mount.sh（exec session-liveness.sh）+ Monitor 事件；非独立进程，
# pgrep/TaskList 看不到——唯一证据是是否还在发事件。来源：manager-start.sh 冷启动步骤。
# 生成：$(date -u +%Y-%m-%dT%H:%M:%SZ)
#
# 执行（在 manager 会话内，Monitor 工具）：
#   Monitor({command: "$REPO_ROOT/plugin/scripts/session-liveness-mount.sh",
#            description: "manager idle-watch: quay outer/inner 转闲 (SESSION-IDLE/OVERDUE/GONE/BACK)",
#            persistent: true, timeout_ms: 3600000})
#
# 核实（两条判据，缺一即未挂好；外部可跑 \`quay manager start --check-idle-watch\`）：
#   ① bash $REPO_ROOT/plugin/scripts/monitor-mount-check.sh --json   # mounted=true 且 targetOk=true
#   ② bash $REPO_ROOT/plugin/scripts/session-liveness.sh --once      # 至少一条 SESSION-STATUS
#
# 6 分钟阈值、事件 triage 见 plugin/loop/manager-loop-tick.md §1.4/§1.6。
EOF
if [ -f "$IDLE_WATCH_INTENT" ]; then
  IDLE_WATCH_STATE="intent-written"
else
  IDLE_WATCH_STATE="failed"
  echo "WARNING: manager-start: could not write idle-watch mount intent to $IDLE_WATCH_INTENT" >&2
fi

if [ "$JSON" = 1 ]; then
  cat <<EOF
{"session":"$SESSION","home":"$HOME_DIR","sessionState":"$SESSION_STATE","armState":"$ARM_STATE","idleWatchState":"$IDLE_WATCH_STATE","created":$([ "$CREATED_SESSION" = 1 ] && echo true || echo false)}
EOF
else
  printf '%-14s %s\n' "session" "$SESSION"
  printf '%-14s %s\n' "home" "$HOME_DIR"
  printf '%-14s %s\n' "session-state" "$SESSION_STATE"
  printf '%-14s %s\n' "arm-state" "$ARM_STATE"
  printf '%-14s %s\n' "idle-watch" "$IDLE_WATCH_STATE ($HOME_DIR/idle-watch-mount.txt)"
  if [ "$ARM_STATE" = "armed" ]; then
    echo "manager started: $SESSION ($HOME_DIR)"
  else
    echo "manager started: $SESSION ($HOME_DIR) — WARNING: loop anchor not armed"
  fi
  echo "idle-watch: run the Monitor mount per $IDLE_WATCH_INTENT, then \`quay manager start --check-idle-watch\`"
fi

# 失败即非零：会话建不起来或锚没装上都要大声，不能静默绿。
if [ "$CREATED_SESSION" = 0 ] && [ "$SESSION_STATE" = "in-place" ]; then
  exit 0
fi
[ "$ARM_STATE" = "armed" ] || exit 1
exit 0
