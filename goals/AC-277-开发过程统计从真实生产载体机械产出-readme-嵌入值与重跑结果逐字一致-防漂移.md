---
id: AC-277
title: 开发过程统计从真实生产载体机械产出，README 嵌入值与重跑结果逐字一致（防漂移）
status: achieved
kind: criterion
goal: GOAL-021
criterion: >-
  bash -c '

  SCRIPT="plugin/scripts/dev-stats-collect.ts"

  if [ ! -f "$SCRIPT" ]; then echo "CAUSE=stats-script-absent — $SCRIPT does not
  exist yet, nothing to verify" >&2; exit 1; fi

  FRESH=$(node --experimental-strip-types "$SCRIPT" --json 2>/dev/null)

  if [ -z "$FRESH" ]; then echo "CAUSE=stats-script-produced-no-output — $SCRIPT
  ran but printed nothing" >&2; exit 1; fi

  MARK_START="<!-- dev-stats:start -->"

  MARK_END="<!-- dev-stats:end -->"

  if ! grep -qF "$MARK_START" README.md; then echo "CAUSE=readme-marker-absent —
  README.md has no $MARK_START block to compare against" >&2; exit 1; fi

  EMBEDDED=$(awk -v s="$MARK_START" -v e="$MARK_END" "\$0==s{f=1;next}
  \$0==e{f=0} f" README.md)

  python3 - "$FRESH" "$EMBEDDED" <<'P'

  import sys, json

  fresh = json.loads(sys.argv[1])

  embedded_text = sys.argv[2]

  missing = [k for k, v in fresh.items() if str(v) not in embedded_text]

  if missing: sys.stderr.write("CAUSE=stats-drift — freshly computed fields not
  found verbatim in README dev-stats block: %s\n" % ",".join(missing));
  sys.exit(1)

  sys.exit(0)

  P

  '
expect: exit 0 = plugin/scripts/dev-stats-collect.ts 存在且可执行、输出 JSON，其每个字段值都能在
  README.md 的 <!-- dev-stats:start/end --> 标记块文本里逐字找到（防止手填字面量与脚本实际产出脱节）。exit 1 且
  stderr 带 CAUSE=：stats-script-absent（脚本还不存在）/
  stats-script-produced-no-output（脚本跑了但没输出）/ readme-marker-absent（README 没有标记块）/
  stats-drift（重新计算的值与 README 里的不一致——真正的防漂移信号）。
origin: manager 2026-09-16 激活，随 GOAL-021 一并生效
activatedAt: 2026-09-16T23:33:21.682Z
statusLog:
  - at: 2026-09-16T23:33:21.682Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-17T00:25:44.214Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-16T23:33:21.681Z
---
