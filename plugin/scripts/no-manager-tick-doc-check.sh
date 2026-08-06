#!/usr/bin/env bash
# no-manager-tick-doc-check.sh — C3 mechanical check: the OUTER tick docs must contain NO
# create/drive/check manager STEP (SPEC-manager-productization §3; charter
# gap-manager-productization-five-constraints AC4).
#
# SPEC §3 (建造归属 ≠ 运行归属): the plugin may CONTAIN the manager implementation, but
# `orchestrator-loop-tick.md` must not contain any step that CREATES / DRIVES / CHECKS the
# manager. The rule must be a mechanical check, not discipline ("今天已经踩过一次……这条要成为
# 机械检查，不是纪律"). The checker is wired into scripts/test.sh run_static_checks() (the
# change-relevant tier via @static-tier change + @static-object).
#
# WHAT COUNTS AS A STEP (the actionable shapes C3 forbids in an OUTER tick doc):
#   * command invocations: `quay manager start|adopt`, `manager-start.sh`, `manager-adopt.sh`,
#     `manager-watchdog.sh`, `quay-launch.sh manager`
#   * a manager window/session reference: `:manager`, `manager 窗口/window/会话/session`
#   * an imperative to start/drive/check/restart the manager:
#     `启动|拉起|驱动|检查|重启|新建|创建|建 <manager> [会话/窗口]`
#
# What is NOT a step (boundary prose describing why the outer does NOT manage the manager —
# lines like "manager 跨项目，不属于项目拓扑，不建" or "已存在的 inner 可能是 manager 建的"): the
# pattern set below requires the VERB (create/drive/check/restart) to precede a manager mention,
# so descriptive statements ("manager 建的", "manager 跨项目") do not match.
#
# Performance: ONE grep -nE per file (the patterns are joined into a single alternation) — a
# per-line/per-pattern process spawn would be ~19k greps on the three tick docs (~46s), which is
# unacceptable for a static check.
#
# Usage:
#   no-manager-tick-doc-check.sh [<root>]   (default: repo root; root = the git checkout root)
# Exit: 0 = CLEAN (no create/drive/check manager steps) · 1 = violation found · 2 = usage error.
set -uo pipefail

ROOT="${1:-}"
if [ -z "$ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "no-manager-tick-doc-check: bad root: $ROOT" >&2; exit 2; }

# The OUTER tick docs — the C3 object. The manager's OWN operating doc
# (plugin/loop/manager-loop-tick.md) is NOT scanned: the manager talking about itself is not the
# outer creating/driving/checking it.
FILES=(
  "${ROOT}/orchestration/orchestrator-loop-tick.md"
  "${ROOT}/plugin/loop/orchestrator-loop-tick.md"
  "${ROOT}/plugin/loop/fast-mode-loop-tick.md"
)

# Actionable create/drive/check manager STEP patterns (POSITIONAL, not keyword — descriptive
# prose like "manager 跨项目" / "manager 建的" must NOT self-hit). Each is an ERE; the array is
# joined with `|` into a single alternation for one grep per file.
STEP_PATTERNS=(
  'quay[[:space:]]+manager[[:space:]]+(start|adopt)'
  'manager-(start|adopt|watchdog)[[:space:]]*\.sh'
  'quay-launch\.sh[[:space:]]+manager'
  ':manager\b'
  'manager[[:space:]]+(窗口|window|会话|session)'
  '(启动|拉起|驱动|检查|重启|新建|创建|建)[[:space:]]+manager([[:space:]]+(窗口|window|会话|session))?'
  '(启动|拉起|驱动|检查|重启|新建|创建|建)[[:space:]]+管理者'
)

# Join the patterns into one alternation (single grep process per file).
COMBINED=""
for i in "${!STEP_PATTERNS[@]}"; do
  if [ "$i" -gt 0 ]; then COMBINED="${COMBINED}|"; fi
  COMBINED="${COMBINED}${STEP_PATTERNS[$i]}"
done

violations=0
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "no-manager-tick-doc-check: missing (skipped): $f" >&2
    continue
  fi
  # grep -nE '<alternation>' → "lineno:content" per matching line. `|| true` under set -u.
  local_hits="$(grep -nE -- "$COMBINED" "$f" 2>/dev/null || true)"
  if [ -n "$local_hits" ]; then
    while IFS= read -r hit || [ -n "$hit" ]; do
      echo "VIOLATION ${f#${ROOT}/}: $hit"
    done <<< "$local_hits"
    violations=$((violations + 1))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "no-manager-tick-doc-check: FAIL — create/drive/check manager step(s) in the outer tick docs (C3/AC4)" >&2
  exit 1
fi

echo "no-manager-tick-doc-check: CLEAN — no create/drive/check manager steps in the outer tick docs (C3)"
exit 0
