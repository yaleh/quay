#!/usr/bin/env bash
# loop-driver-check.sh — 机械判定一个项目里「恰好一个循环驱动」在跑（AC4/AC5/AC6，
# gap-the-tick-doc-ships-three-contradictory-loop-drivers）。
#
# 唯一的合规驱动是 20 分钟 `CronCreate` cron（tick 文档冷启动步骤 4 / cold-start skill 步骤 4）。
# 驱动注册表 <root>/.quay/loop-driver.jsonl 记录「已经装了几个驱动」：
#   照文档从零装一次  = 1 行   → LIVE
#   照旧文档再起一个 `/loop` 或自排程 = 又多一行 → DOUBLE-TRIGGER
#   一行都没有        = 循环不会 tick → STALLED
# 唯一驱动不是 cron（被废弃的机制被装成了唯一驱动）= BANNED-MECHANISM
#
# 退出码：
#   0 LIVE             — 恰好 1 个驱动，且机制是 cron
#   3 STALLED          — 0 个驱动（循环不会 tick，从外面看却「装得好好的」——这正是本检查要抓的）
#   4 DOUBLE-TRIGGER   — ≥2 个驱动
#   5 BANNED-MECHANISM — 唯一的驱动不是 cron
#
# 纯读契约（与 monitor-mount-check.sh 同源）：本脚本只读注册表，不写任何东西。
# 用法: bash plugin/scripts/loop-driver-check.sh [<root>]    # <root> 缺省为 $(pwd)
set -uo pipefail

ROOT="${1:-$(pwd)}"
REG="$ROOT/.quay/loop-driver.jsonl"

python3 - "$REG" <<'PYEOF'
import json, os, sys
reg = sys.argv[1]
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
if n == 1:
    mech = drivers[0].get("mechanism")
    if mech != "cron":
        print(f"loop-driver: BANNED-MECHANISM (1) — the only registered driver is '{mech}', not 'cron' (the single sanctioned driver)")
        sys.exit(5)
    print(f"loop-driver: LIVE (1) — exactly one loop driver (cron {drivers[0].get('interval','?')})")
    sys.exit(0)
print(f"loop-driver: DOUBLE-TRIGGER ({n}) — {n} loop drivers registered; a literal reader double-installed")
sys.exit(4)
PYEOF
