#!/usr/bin/env bash
# Mutation case for dead-code-after-return-check (gap-concurrency-derivation-reverted-but-doc-ac-
# and-tests-all-still-report-derived, AC6). Fixture: a clean function with a top-level return as
# the LAST statement → GREEN. Inject: a statement AFTER the top-level return (the 2026-08-03 pin
# shape) → the checker MUST go RED. Restore: remove the injected statement → back to GREEN.
set -u
name="dead-code-after-return-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}"
cat > "${workdir}/clean.sh" <<'EOF'
f() {
  echo "a"
  return 0
}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/dead-code-after-return-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: a clean function (return as last statement) → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean function (checker always-red?)" >&2
  exit 4
fi

# INJECT: a statement after the top-level return (the exact 2026-08-03 pin shape) → MUST go RED.
cat > "${workdir}/evil.sh" <<'EOF'
default_test_concurrency() {
  echo "8"
  return 0
  default_concurrency_formula
}
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected dead-code-after-return did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the injected file → back to GREEN.
rm -f "${workdir}/evil.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean tree still reddens the checker" >&2
  exit 4
fi

exit 0
