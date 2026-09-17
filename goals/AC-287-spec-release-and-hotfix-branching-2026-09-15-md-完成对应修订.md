---
id: AC-287
title: SPEC-release-and-hotfix-branching-2026-09-15.md 完成对应修订
status: active
kind: criterion
goal: GOAL-023
criterion: |-
  bash <<'CRIT'
  set -euo pipefail
  SPEC="orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md"
  if [ ! -f "$SPEC" ]; then
    echo "CAUSE=spec-absent — $SPEC does not exist" >&2; exit 1
  fi
  MISSING=""
  grep -q "2026-09-17" "$SPEC" || MISSING="${MISSING} no-2026-09-17-addendum"
  grep -q "AC-273" "$SPEC" || MISSING="${MISSING} no-AC-273-reference"
  grep -qi "author" "$SPEC" || MISSING="${MISSING} no-author-line-mention"
  if [ -n "$MISSING" ]; then
    echo "CAUSE=spec-not-amended — $SPEC is missing:${MISSING}" >&2; exit 1
  fi
  echo "OK — $SPEC references a 2026-09-17 addendum, AC-273, and author"
  exit 0
  CRIT
expect: criterion exits 0 once the SPEC contains a 2026-09-17 addendum,
  references AC-273, and mentions author
origin: 该 SPEC §3.2.1 裁定默认分支=develop，AC-273 硬编码同一期望，author 未被提及——三处都需要更新
activatedAt: 2026-09-17T04:12:29.065Z
statusLog:
  - at: 2026-09-17T04:12:29.065Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-023 激活，补齐AC-287
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T04:12:29.064Z
---
