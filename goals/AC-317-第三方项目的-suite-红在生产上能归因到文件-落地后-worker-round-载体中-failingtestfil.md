---
id: AC-317
title: 第三方项目的 suite 红在生产上能归因到文件——落地后 worker-round 载体中 failingTestFiles 非空
  ≥1（落地前基线 51 次 / 0 次）
status: active
kind: criterion
goal: GOAL-027
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: 不在
  git 仓库内" >&2; exit 3; }

  cd "$root"

  T="${QUAY_THIRD_PARTY_ROOT:-/data/home/yale/work/claudecodeui}"

  C="$T/.quay/worker-round.jsonl"

  [ -f "$C" ] || { echo "NOT-EVALUATED: 第三方生产载体不存在：$C（用 QUAY_THIRD_PARTY_ROOT
  指向一个由 quay driver 驱动的第三方项目）" >&2; exit 3; }

  [ -e "$T/packages/quay-native" ] && { echo "NOT-EVALUATED: $T 是 quay
  自身形态，不是第三方项目" >&2; exit 3; }

  since=$(git log develop
  --grep='gap-suite-failure-attribution-third-party-layout' --format=%cI
  2>/dev/null | tail -1)

  [ -n "$since" ] || { echo "CAUSE=归因修复尚未落地 develop（develop 上没有提及
  gap-suite-failure-attribution-third-party-layout 的提交）——落地前基线：该载体 3 天 51 次
  retry_exemptions 中 failingTestFiles 非空 0 次" >&2; exit 1; }

  python3 - "$C" "$since" <<'P'

  import json, sys

  from datetime import datetime

  carrier, since = sys.argv[1], datetime.fromisoformat(sys.argv[2])

  att = unatt = bad = 0

  for line in open(carrier, encoding="utf-8"):
      if not line.strip():
          continue
      try:
          r = json.loads(line)
          ts = datetime.fromisoformat(str(r["ts"]).replace("Z", "+00:00"))
      except Exception:
          bad += 1
          continue
      if ts <= since:
          continue
      for e in r.get("retry_exemptions") or []:
          if e.get("failingTestFiles"):
              att += 1
          elif e.get("verdict") == "insufficient-data-fallback":
              unatt += 1
  print(f"窗口 >{since.isoformat()}：已归因(failingTestFiles 非空)={att} 归因不出={unatt}
  坏行={bad}")

  if att >= 1:
      sys.exit(0)
  if att + unatt == 0:
      sys.stderr.write("NOT-EVALUATED: 落地后该第三方项目尚无 suite 红的重试判定，窗口内无样本\n"); sys.exit(3)
  sys.stderr.write(f"CAUSE=落地后 {unatt} 次 suite 红仍一次都没归因到文件（第三方日志形态仍解析为空）\n");
  sys.exit(1)

  P
expect: exit 0（实现提交落地 develop 之后，第三方 worker-round.jsonl 的 retry_exemptions 中至少 1
  条 failingTestFiles 非空）；窗口无样本或载体不存在 ⇒ exit 3
origin: 立条依据：2026-09-23 对第三方项目
  /data/home/yale/work/claudecodeui（CloudCLI，2026-09-20→09-23，worker-driven
  inner，142 条任务）的驱动过程复盘。人 2026-09-23 裁定：「本仓库形态靠文件是否存在来判断」立为 goal，第 1/2/6 项作为其实例
  task，其余缺陷立独立 task（「按你的意见执行」）。 对应 GOAL-027 范围②；复盘第 1 项。
activatedAt: 2026-10-01T18:06:18.656Z
statusLog:
  - at: 2026-10-01T18:06:18.656Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:06:18.655Z
---
**判据（能取假）**：读第三方生产载体 `$QUAY_THIRD_PARTY_ROOT/.quay/worker-round.jsonl`，只计 `gap-suite-failure-attribution-third-party-layout` 落地 develop 之后的记录，要求至少 1 条 `retry_exemptions[].failingTestFiles` 非空。

**取假**：落地前基线：claudecodeui 3 天 51 次重试判定、已归因 0 次（伪造落地时刻重放：已归因=0、归因不出=51 ⇒ exit 1）。合成的已归因记录 ⇒ exit 0；空窗口 ⇒ exit 3。

**为什么读生产载体**：修复的 fixture 测试只能证明「能产出」。本 AC 要证明第三方 driver 在真实 suite 红上「已产出」（硬规则 4 推论三）。