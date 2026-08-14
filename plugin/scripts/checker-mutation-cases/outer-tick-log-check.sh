#!/usr/bin/env bash
# Mutation case for outer-tick-log-check (gap-no-action-requires-evidence-mechanical-check).
# Fixture: a temp tick-log whose last row is no-action with all-five-false 五条不等式 readings
# → GREEN (legal no-action). Inject: a no-action row with inequality ① `[当前真` → the checker
# MUST go RED (no-action illegal, 欠动作). Restore: remove the injected row → back to GREEN.
# The --truth seam (00000) makes the re-measure deterministic regardless of live repo state.
#
# 2026-08-14: label is now DYNAMIC (`date -u +%H:%M`) — the timestamp clauses (label ≤ mtime,
# ec38543b) made a fixed historical label (15:21) "future" after its hour passed, breaking the
# restore (always-red). A checker-mutation fixture must be time-robust: label from the clock at
# fixture creation, so label ≤ mtime always holds.
set -u
name="outer-tick-log-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="$(date -u +%H:%M)Z"

mkdir -p "${workdir}"
cat > "${workdir}/tick-log.md" <<EOF
- \`${LABEL}\` \`tick\` — fixture（2026-08-14 动态标签 date -u）
- 类型: no-action（五条全假）
- 五条不等式: ①in_flight<cap且recommended非空→派发到cap [当前假:in_flight==cap]; ②pool<floor→晋级补池 [当前假:pool≥floor]; ③nyf>0且work落地→翻done [当前假:nyf=0]; ④integration领先develop且suite绿→批量合 [当前假:develop==integration]; ⑤suite red→分诊 [当前假:green]
- 动作分类: no-action
EOF

checker_cmd() {
  bash "${checker_dir}/outer-tick-log-check.sh" --log "$1/tick-log.md" --truth 00000 --root "$1" >/dev/null 2>&1
}

# GREEN baseline: all-five-false no-action → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a legal all-five-false no-action (checker always-red?)" >&2
  exit 4
fi

# INJECT: a no-action row with inequality ① TRUE → MUST go RED.
cat > "${workdir}/tick-log.md" <<EOF
- \`${LABEL}\` \`tick\` — fixture（2026-08-14 动态标签 date -u）
- 类型: no-action（但 ① 为真）
- 五条不等式: ①in_flight<cap且recommended非空→派发到cap [当前真:recommended=[gap-x]]; ②pool<floor→晋级补池 [当前假]; ③nyf>0且work落地→翻done [当前假]; ④integration领先develop且suite绿→批量合 [当前假]; ⑤suite red→分诊 [当前假]
- 动作分类: no-action
EOF
if checker_cmd "${workdir}"; then
  echo "mutation NOT caught: a no-action row with inequality ① true stayed GREEN" >&2
  exit 1
fi

# RESTORE: back to the legal all-five-false no-action → GREEN again.
cat > "${workdir}/tick-log.md" <<EOF
- \`${LABEL}\` \`tick\` — fixture（2026-08-14 动态标签 date -u）
- 类型: no-action（五条全假）
- 五条不等式: ①in_flight<cap且recommended非空→派发到cap [当前假:in_flight==cap]; ②pool<floor→晋级补池 [当前假:pool≥floor]; ③nyf>0且work落地→翻done [当前假:nyf=0]; ④integration领先develop且suite绿→批量合 [当前假:develop==integration]; ⑤suite red→分诊 [当前假:green]
- 动作分类: no-action
EOF
if checker_cmd "${workdir}"; then
  echo "outer-tick-log-check mutation case: PASS (illegal ①true no-action caught, legal all-five-false restored)" >&2
else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi
exit 0
