#!/usr/bin/env bash
# Validates the structure of this extracted Skill directory.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

req_files=(
  "SKILL.md"
  "reference/patterns.md"
  "reference/v-meta-stall-analysis.md"
  "reference/gate-mechanics.md"
  "reference/directive-lifecycle.md"
  "reference/g3-audit-discipline.md"
  "examples/quay-author-SKILL.md"
  "examples/quay-execute-SKILL.md"
  "templates/directive-template.md"
)

for f in "${req_files[@]}"; do
  if [[ ! -f "$SKILL_DIR/$f" ]]; then
    echo "MISSING: $f"
    FAIL=1
  fi
done

# patterns.md line-count constraint (<=400)
lines=$(wc -l < "$SKILL_DIR/reference/patterns.md")
if (( lines > 400 )); then
  echo "FAIL: reference/patterns.md is $lines lines (> 400)"
  FAIL=1
fi

# SKILL.md must not claim convergence
if grep -qiE "converged|convergence achieved" "$SKILL_DIR/SKILL.md" | grep -v "NOT CONVERGED\|not converged"; then
  : # grep above intentionally structured to avoid false positive; see explicit check below
fi
if grep -Ei "\bconverged\b" "$SKILL_DIR/SKILL.md" | grep -viE "not converged|halted"; then
  echo "WARN: SKILL.md contains 'converged' language not qualified by 'not converged'/'halted' — review manually"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "validate-skill.sh: PASS (structure present, patterns.md within line limit)"
else
  echo "validate-skill.sh: FAIL"
  exit 1
fi
