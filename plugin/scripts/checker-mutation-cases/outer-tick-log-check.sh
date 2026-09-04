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
#
# 2026-08-15 (gap-a23-ticklog-verify-and-cron-normalization): A23 融合防漏 — A23（AC81 四判据核实）
# 是写 B13 行的前置（orchestrator-tick-core.md:47）。legal fixture 现在必须带 A23 输出行（含 A23 +
# 状态词），否则本属合法的 all-five-false no-action 也会因 b13-without-a23-output 恒红。新增第二个
# mutation：移除 A23 行（B13 保留）⇒ 必须 RED（A23 缺失）；恢复 ⇒ GREEN。
set -u
name="outer-tick-log-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="$(date -u +%H:%M)Z"
A23_LINE="A23 ① code=0 OK（四判据全真）+ ② code=0 OK"

# 合法 no-action 行：五条全假 + B13 + A23 输出（a23=no 则省略 A23 行——测 A23 融合防漏）。
legal_fixture() {
  local a23="${1:-yes}"
  {
    printf -- "- \`%s\` \`tick\` — fixture（2026-08-14 动态标签 date -u）\n" "$LABEL"
    printf -- "- 类型: no-action（五条全假）\n"
    printf -- "- 五条不等式: ①in_flight<cap且recommended非空→派发到cap [当前假:in_flight==cap]; ②pool<floor→晋级补池 [当前假:pool≥floor]; ③nyf>0且work落地→翻done [当前假:nyf=0]; ④integration领先develop且suite绿→批量合 [当前假:develop==integration]; ⑤suite red→分诊 [当前假:green]\n"
    if [ "$a23" = "yes" ]; then
      printf -- "- %s\n" "$A23_LINE"
    fi
    printf -- "- 动作分类: no-action\n"
  } > "${workdir}/tick-log.md"
}

mkdir -p "${workdir}"
legal_fixture yes

checker_cmd() {
  bash "${checker_dir}/outer-tick-log-check.sh" --log "$1/tick-log.md" --truth 00000 --root "$1" >/dev/null 2>&1
}

# GREEN baseline: all-five-false no-action + A23 output → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a legal all-five-false no-action (checker always-red?)" >&2
  exit 4
fi

# INJECT 1: a no-action row with inequality ① TRUE → MUST go RED (B13 证据要求 no-action 全假).
cat > "${workdir}/tick-log.md" <<EOF
- \`${LABEL}\` \`tick\` — fixture（2026-08-14 动态标签 date -u）
- 类型: no-action（但 ① 为真）
- 五条不等式: ①in_flight<cap且recommended非空→派发到cap [当前真:recommended=[gap-x]]; ②pool<floor→晋级补池 [当前假]; ③nyf>0且work落地→翻done [当前假]; ④integration领先develop且suite绿→批量合 [当前假]; ⑤suite red→分诊 [当前假]
- ${A23_LINE}
- 动作分类: no-action
EOF
if checker_cmd "${workdir}"; then
  echo "mutation NOT caught: a no-action row with inequality ① true stayed GREEN" >&2
  exit 1
fi

# RESTORE 1: back to the legal all-five-false no-action → GREEN again.
legal_fixture yes
if checker_cmd "${workdir}"; then :; else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi

# INJECT 2 (A23 融合防漏): remove the A23 output line, keep B13 → MUST go RED
# (B13 存在而无 A23 四判据输出 ⇒ tick-log 行不合法)。
legal_fixture no
if checker_cmd "${workdir}"; then
  echo "mutation NOT caught: B13 without A23 output stayed GREEN (A23 融合防漏 missing)" >&2
  exit 1
fi

# RESTORE 2: back to legal all-five-false no-action + A23 → GREEN again.
legal_fixture yes
if checker_cmd "${workdir}"; then
  echo "outer-tick-log-check mutation case: PASS (illegal ①true no-action caught, A23-absent caught, both restored)" >&2
else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi
exit 0
