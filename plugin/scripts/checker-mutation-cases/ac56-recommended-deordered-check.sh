#!/usr/bin/env bash
# Mutation case for ac56-recommended-deordered-check (tasks/gap-ac56-recommended-deordered,
# AC56 判据1/判据2/判据3). Fixture: a real slot-refill-style --json output with a LEXICOGRAPHIC
# (de-ordered) recommended + the explicit "order meaningless" annotation → GREEN. Inject:
# RE-ORDER recommended to a 1/cost priority order (DC task first — the pre-fix shape AC56 removes)
# → MUST go RED (判据2). Restore → GREEN. Then DELETE the annotation field → MUST go RED (判据1
# 明确标注 missing). Restore → GREEN.
set -u
name="ac56-recommended-deordered-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${workdir}"
cat > sample.json <<'EOF'
{"recommended":["ac56-aaa","ac56-e2e"],"recommended_order":"lexicographic-by-id (order meaningless — 字典序，不代表优先级)"}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/ac56-recommended-deordered-check.ts" --input "${workdir}/sample.json" >/dev/null 2>&1
}

# Baseline: lexicographic recommended + annotation → checker GREEN.
if ! checker_cmd; then
  echo "baseline RED on a de-ordered+annotated sample (checker always-red?)" >&2
  exit 4
fi

# INJECT: re-order recommended to a 1/cost (priority) order — DC task first, the exact pre-fix shape
# AC56 判据2 requires the checker to go RED on. Keep the (now lying) annotation.
cat > sample.json <<'EOF'
{"recommended":["ac56-e2e","ac56-aaa"],"recommended_order":"lexicographic-by-id (order meaningless — 字典序，不代表优先级)"}
EOF
if checker_cmd; then
  echo "mutation-1 stayed GREEN: a priority-ordered recommended must go RED (判据2 falsifiable)" >&2
  exit 1
fi

# Restore → GREEN.
cat > sample.json <<'EOF'
{"recommended":["ac56-aaa","ac56-e2e"],"recommended_order":"lexicographic-by-id (order meaningless — 字典序，不代表优先级)"}
EOF
if ! checker_cmd; then
  echo "restore-1 RED after restoring the de-ordered sample (checker flaky?)" >&2
  exit 4
fi

# INJECT: delete the annotation field — a lexicographic array with NO explicit "order meaningless"
# mark must go RED (判据1 明确标注 required for the dictionary-order option).
cat > sample.json <<'EOF'
{"recommended":["ac56-aaa","ac56-e2e"]}
EOF
if checker_cmd; then
  echo "mutation-2 stayed GREEN: a missing order-meaningless annotation must go RED (判据1)" >&2
  exit 1
fi

# Restore → GREEN (final state for the mutation harness's restore check).
cat > sample.json <<'EOF'
{"recommended":["ac56-aaa","ac56-e2e"],"recommended_order":"lexicographic-by-id (order meaningless — 字典序，不代表优先级)"}
EOF
if ! checker_cmd; then
  echo "restore-2 RED after restoring the annotated sample (checker flaky?)" >&2
  exit 4
fi

echo "ac56-recommended-deordered-check mutation: baseline GREEN, priority-order RED, missing-annotation RED, restore GREEN"
