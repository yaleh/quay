#!/usr/bin/env bash
# manager-start.sh — C4/C5: `quay manager start`（无项目参数）独立拉起 manager。
# (gap-manager-productization-five-constraints AC1/AC2/AC5)
#
# 规格：SPEC-manager-productization-2026-08-05 §4.1。manager 的启动与启动项目完全分开：
#   - `manager start` 不接受任何项目参数（C5：两条命令分开，不是一条带参数的命令）
#   - 建自己的会话：独立 tmux session（`quay-manager`，名字来自 .quay/profiles.yml roles.manager.name），
#     不进任何项目的 session（C2：身份不属于任何单个项目）
#   - 设自己的家：$QUAY_GLOBAL_DIR/manager/（状态、tick 日志、观测器配置；C2）
#   - 起会话时锚点确定性建立（AC5）：装上 manager 自己的 `/loop` 作为其中一步——冷启动后锚点必然
#     在位。本脚本负责把「武装」的确定性步骤做成出厂命令（manager-arm-loop.sh），而不是靠谁记得。
#
# 2026-08-06 范围收窄（人裁定）：OS watchdog / OS cron / Desktop 定时任务全部禁用；唯一允许的调度
# 锚点是 Claude Code 自己的 loop/cron（AC5）。本脚本不装 systemd unit、不写 crontab。
#
# 用法：
#   manager-start.sh [--session <sess>] [--dry-run] [--json] [--home <dir>]
#     --session <sess>    目标 tmux 会话（默认：MANAGER_START_SESSION → 读
#                         <repo>/.quay/profiles.yml 的 roles.manager.name → quay-manager）
#     --dry-run           只打印将执行的命令，不实际改动（校验用）
#     --json              JSON 输出（机器消费）；默认人读表格 + 退出码
#     --home <dir>        覆盖 manager 家目录（默认 $QUAY_GLOBAL_DIR/manager/ → $HOME/.quay-global/manager/）
#
# 冷启动判据（gap-manager-cold-start-no-falsifiable-checklist AC2/AC4）：
#   本脚本在 manager 家下写一份可证伪产物——
#     <home>/cold-start-checklist.md   —— 5 条 observable consequences，
#                                        冷启动完成 = 五键全 true；一条为假 ⇒ 未完成
#   启动本身完成 SESSION-CREATED / HOME-CREATED / LOOP-ARMED 三键；CRON-EVIDENCED
#   与 CHECKLIST-REPORTED 由首 tick 填（manager-tick-core.md B4/A10）。
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
    --help|-h) usage ;;
    *)
      echo "ERROR: manager start accepts NO project args (C5: start 与 adopt 分开). Unknown argument: $1" >&2
      echo "       (expected --session <sess> | --dry-run | --json | --home <dir>)" >&2
      exit 2
      ;;
  esac
done

# ── 家目录（C2：不属于任何项目）────────────────────────────────────────────────────────────
QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"

# ── 会话名：显式 > 环境 > profiles.yml 的 roles.manager.name（AC154，profile 抽层后）→ quay-manager ──
if [ -z "$SESSION" ]; then
  if command -v python3 >/dev/null 2>&1; then
    if [ -f "$REPO_ROOT/.quay/profiles.yml" ]; then
      SESSION="$(python3 -c 'import sys,yaml; d=yaml.safe_load(open(sys.argv[1])) or {}; print(d.get("roles",{}).get("manager",{}).get("name",""))' "$REPO_ROOT/.quay/profiles.yml" 2>/dev/null)"
    elif [ -f "$REPO_ROOT/plugin/.quay/profiles.yml" ]; then
      SESSION="$(python3 -c 'import sys,yaml; d=yaml.safe_load(open(sys.argv[1])) or {}; print(d.get("roles",{}).get("manager",{}).get("name",""))' "$REPO_ROOT/plugin/.quay/profiles.yml" 2>/dev/null)"
    fi
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

# ── 冷启动可证伪产物（AC2/AC4）─────────────────────────────────────────────────────────────
# 写 checklist（缺则建）——单一正本，避免多处复制同一 heredoc 造成漂移。
_ensure_cold_start_artifacts() {
  # 家目录必须先建（幂等）。
  mkdir -p "$HOME_DIR"

  # <home>/cold-start-checklist.md —— 5 条 observable consequences。
  # 冷启动完成 = 五键全 true；一条为假 ⇒ 未完成。启动态填三键，首 tick 填其余（B4/A10）。
  CHECKLIST="$HOME_DIR/cold-start-checklist.md"
  if [ ! -f "$CHECKLIST" ]; then
    cat > "$CHECKLIST" <<'MDEOF'
# manager cold-start — observable consequences（falsifiable checklist）

冷启动完成判据 = 下列 5 条可证伪项**全部为真**。
一条为假 ⇒ manager 冷启动未完成。每键给出可检查判据与证据。

| # | Key | 可检查判据 | 证据 |
|---|---|---|---|
| 1 | SESSION-CREATED | `tmux has-session -t <SESSION>` 且 pane 有 claude 进程（非裸 bash） | 启动时已建会话（manager-start.sh） |
| 2 | HOME-CREATED | `<home>/identity` 存在，含 `role=manager` | 启动时已写（manager-start.sh） |
| 3 | LOOP-ARMED | `manager-arm-loop.sh --home <home> --validate` 退出 0，且 `<home>/loop-registry.txt` 恰一条 `[manager-tick]` | 启动时已武装（manager-arm-loop.sh；失败时 manager-start 非零退出） |
| 4 | CRON-EVIDENCED | `manager-arm-loop.sh --home <home> --verify-cron` 退出 0（注册表↔真 CronCreate/CronList 证据一致且新鲜） | 首 tick 填（manager-tick-core.md B4 记 `<home>/cron-evidence.jsonl`） |
| 5 | CHECKLIST-REPORTED | 本文件五键全为 true 且各有证据 | 全部填完后为 true |

启动态预期满足：#1 #2 #3（arm 失败时 manager-start 非零退出）。待首 tick：#4 #5。全 true 才可报 COMPLETE。
MDEOF
  fi
}

if [ "$DRY_RUN" = 1 ]; then
  cat <<EOF
would-create-home: mkdir -p $HOME_DIR
would-write-identity: $HOME_DIR/identity
would-write-checklist: $HOME_DIR/cold-start-checklist.md
would-launch-session: tmux new-session -d -s $SESSION -n manager "$LAUNCH_CMD"
would-arm-loop: $ARM_CMD --home $HOME_DIR
EOF
  exit 0
fi

# ── 建家（幂等）────────────────────────────────────────────────────────────────────────────
mkdir -p "$HOME_DIR"
IDENTITY="$HOME_DIR/identity"
if [ ! -f "$IDENTITY" ]; then
  printf 'role=manager\nsession=%s\ncreated=%s\n' "$SESSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$IDENTITY"
fi

# ── 冷启动可证伪产物（AC2/AC4）────────────────────────────────────────────────────────────
# 写 checklist（缺则建）。同一正本见函数定义。
_ensure_cold_start_artifacts

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

# 冷启动键（AC2 + AC5）：#1 SESSION-CREATED / #2 HOME-CREATED / #3 LOOP-ARMED 在启动后即为真；
# #4 CRON-EVIDENCED / #5 CHECKLIST-REPORTED 由首 tick 填。
CHECKLIST_EXISTS=$([ -f "$CHECKLIST" ] && echo true || echo false)

if [ "$JSON" = 1 ]; then
  cat <<EOF
{"session":"$SESSION","home":"$HOME_DIR","sessionState":"$SESSION_STATE","armState":"$ARM_STATE","checklist":"$CHECKLIST","checklistWritten":$CHECKLIST_EXISTS,"created":$([ "$CREATED_SESSION" = 1 ] && echo true || echo false)}
EOF
else
  printf '%-14s %s\n' "session" "$SESSION"
  printf '%-14s %s\n' "home" "$HOME_DIR"
  printf '%-14s %s\n' "session-state" "$SESSION_STATE"
  printf '%-14s %s\n' "arm-state" "$ARM_STATE"
  printf '%-14s %s\n' "checklist" "$CHECKLIST ($([ "$CHECKLIST_EXISTS" = true ] && echo 'written — 5 keys, #1-#3 启动态已真' || echo MISSING))"
  if [ "$ARM_STATE" = "armed" ]; then
    echo "manager started: $SESSION ($HOME_DIR)"
  else
    echo "manager started: $SESSION ($HOME_DIR) — WARNING: loop anchor not armed"
  fi
fi

# 失败即非零：会话建不起来或锚没装上都要大声，不能静默绿。
if [ "$CREATED_SESSION" = 0 ] && [ "$SESSION_STATE" = "in-place" ]; then
  exit 0
fi
[ "$ARM_STATE" = "armed" ] || exit 1
exit 0
