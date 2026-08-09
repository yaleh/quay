#!/usr/bin/env bash
# loop-driver-check.sh — 机械判定一个项目里「恰好一个循环驱动」在跑（AC4/AC5/AC6，
# gap-the-tick-doc-ships-three-contradictory-loop-drivers）。
#
# 唯一的合规驱动是 20 分钟 `CronCreate` cron（tick 文档冷启动步骤 4 / cold-start skill 步骤 4）。
# 驱动注册表 <root>/.quay/loop-driver.jsonl 记录「已经装了几个驱动」：
#   照文档从零装一次  = 1 行   → LIVE
#   照旧文档再起一个 `/loop` 或自排程 = 又多一行 → DOUBLE-TRIGGER
#   一行都没有        = 循环不会 tick → STALLED
#   唯一驱动不是 cron（被废弃的机制被装成了唯一驱动）= BANNED-MECHANISM
#
# 第二层（gap-loop-driver-check-ac3-layer2-cron-observability，本任务）：LIVE 判据换成
# **可观测来源**。第一层只数注册表行——注册表是**自述的**（数自己的行，不观测真实驱动）。
# CronCreate 建的 cron 是**会话内的**：CronList 列表住在会话进程里，bash 检查器看不到会话内的
# cron 列表（磁盘上没有 cron 配置；唯一磁盘痕迹是会话 transcript 里的历史 CronCreate/CronList
# 记录——那是过去式日志，死会话的 transcript 还躺着一份，grep 它会把「曾经建过」误读成「现在
# 活着」）。「注册表有一行、但那个驱动早已随会话而死」与「驱动活着」在行数上完全同形。
# 第二层把 LIVE 判据改为：注册表恰一行 cron **且** 该驱动有新鲜的可观测 last-alive 证据。
# 可观测证据 = 驱动每次 tick 会写的东西（session-liveness.sh 的外层多源心跳同族）：
#   git HEAD commit 时间、orchestration/tick-log.md mtime、.quay/verification-round.jsonl mtime、
#   docs/analysis/*.md 最新 mtime。任一在 LOOP_DRIVER_LIVENESS_MIN 分钟内 ⇒ 驱动活（LIVE）。
# 冷启动接缝：注册表 mtime = 最近一次安装时刻。刚写完注册表（< 窗口）但首 tick 还没到 ⇒ 仍报
# LIVE（给首 tick 留出宽限——冷启动契约 clean_start_exit=0 要求安装后立即报 LIVE）；注册表也陈旧
# （如 2 天前）且无可观测活动 ⇒ 陈旧注册，报 DEAD（AC3：陈旧注册不得报 LIVE）。
#
# 退出码：
#   0 LIVE             — 恰好 1 个驱动，机制是 cron，且可观测 last-alive 证据新鲜（或刚安装）
#   3 STALLED          — 0 个驱动（循环不会 tick，从外面看却「装得好好的」——正是本检查要抓的）
#   4 DOUBLE-TRIGGER   — ≥2 个驱动
#   5 BANNED-MECHANISM — 唯一的驱动不是 cron
#   6 DEAD             — 注册表恰一行 cron，但可观测 last-alive 证据陈旧且注册表本身也陈旧
#
# 纯读契约（与 monitor-mount-check.sh 同源）：本脚本只读注册表 + git log + stat，不写任何东西。
# 用法:
#   bash plugin/scripts/loop-driver-check.sh [<root>]         # <root> 缺省为 $(pwd)
#   bash plugin/scripts/loop-driver-check.sh --check [<root>] # --check = 显式第二层（可观测）
#                                                             # 模式；判据与无 --check 时相同
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

ROOT="$(pwd)"
case "${1:-}" in
  --check) ROOT="${2:-$(pwd)}" ;;
  *) ROOT="${1:-$(pwd)}" ;;
esac
REG="$ROOT/.quay/loop-driver.jsonl"
# 可观测 last-alive 窗口（分钟）：驱动每 20 分钟 tick 一次，3× 间隔留余量。测试可经环境覆盖。
LIVENESS_MIN="${LOOP_DRIVER_LIVENESS_MIN:-60}"

# observable_last_alive —— 可观测 last-alive 证据的 max mtime（epoch）。0 = 无任何源。
# 与 session-liveness.sh 的外层多源心跳（_outer_heartbeat_max_mtime）同族：驱动每次 tick 会写
# 这些文件 / 产生提交，任一新鲜即活。bash 检查器看不到会话内 CronList，但看得到这些文件 mtime。
observable_last_alive() {
  local root=$1 max=0 ts f
  # 1. HEAD commit 时间（驱动产出 = 提交；git log 失败 = 非 git 仓库 = 0）
  ts=$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)
  [ "${ts:-0}" -gt "$max" ] 2>/dev/null && max=$ts
  # 2. tick-log / 3. verification-round / 4. queue-state（文件 mtime）
  for f in \
    "$root/orchestration/tick-log.md" \
    "$root/.quay/verification-round.jsonl" \
    "$root/docs/analysis/batch2-queue-state.md" \
    "$root/docs/analysis/batch-queue-state.md"
  do
    if [ -e "$f" ]; then
      ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
      [ "${ts:-0}" -gt "$max" ] 2>/dev/null && max=$ts
    fi
  done
  # 5. docs/analysis/ 下最新 .md（分诊/分析记录；任一最近 mtime 即算产出）
  if [ -d "$root/docs/analysis" ]; then
    while IFS= read -r f; do
      [ -e "$f" ] || continue
      ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
      [ "${ts:-0}" -gt "$max" ] 2>/dev/null && max=$ts
    done < <(find "$root/docs/analysis" -maxdepth 1 -name '*.md' 2>/dev/null)
  fi
  echo "$max"
}

HB_MAX="$(observable_last_alive "$ROOT")"
NOW="$(date +%s)"
REG_MTIME=0
[ -f "$REG" ] && REG_MTIME="$(stat -c %Y "$REG" 2>/dev/null || echo 0)"

python3 - "$REG" "$HB_MAX" "$REG_MTIME" "$NOW" "$LIVENESS_MIN" <<'PYEOF'
import json, os, sys
reg, hb_max, reg_mtime, now, liveness_min = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
liveness_secs = liveness_min * 60

drivers = []
if os.path.isfile(reg):
    try:
        with open(reg, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        lines = []
    for ln in lines:
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if isinstance(d, dict) and "mechanism" in d:
            drivers.append(d)
n = len(drivers)
if n == 0:
    print("loop-driver: STALLED (0) — no loop driver registered; the loop will never tick")
    sys.exit(3)
if n >= 2:
    print(f"loop-driver: DOUBLE-TRIGGER ({n}) — {n} loop drivers registered; a literal reader double-installed")
    sys.exit(4)
# n == 1
mech = drivers[0].get("mechanism")
if mech != "cron":
    print(f"loop-driver: BANNED-MECHANISM (1) — the only registered driver is '{mech}', not 'cron' (the single sanctioned driver)")
    sys.exit(5)

# 第二层可观测判据（AC3）：注册表恰一行 cron。驱动活不活看可观测 last-alive 证据。
#   last_alive = max(可观测心跳, 注册表 mtime)。注册表 mtime = 最近一次安装时刻——
#   冷启动刚写完注册表（< 窗口）时首 tick 还没到，只有这一份新鲜信号 ⇒ 仍报 LIVE（宽限）。
#   全部陈旧（如注册表 2 天前、无任何可观测活动）⇒ 死驱动，报 DEAD，绝不报 LIVE。
last_alive = max(hb_max, reg_mtime)
age_secs = now - last_alive if last_alive else liveness_secs + 1
age_min = max(0, age_secs // 60)
fresh = bool(last_alive) and age_secs <= liveness_secs
if fresh:
    print(f"loop-driver: LIVE (1) — exactly one loop driver (cron {drivers[0].get('interval','?')}); observable activity {age_min}min old (window {liveness_min}min)")
    sys.exit(0)
print(f"loop-driver: DEAD (1) — registered cron has no fresh observable activity (last observable activity {age_min}min old, window {liveness_min}min); the driver died with its session")
sys.exit(6)
PYEOF
