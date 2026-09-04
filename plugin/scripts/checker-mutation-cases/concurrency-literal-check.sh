#!/usr/bin/env bash
# Mutation case for concurrency-literal-check (gap-concurrency-literal-only-at-definition-points,
# AC1/AC2/AC3). Fixture: a temp workspace with plugin/scripts/fixture.ts carrying a declared
# concurrency default → GREEN. Inject: drop the `concurrency-default-fallback` marker (the value
# becomes an UNDECLARED concurrency literal — the exact "悄悄写死" shape) → the checker MUST go RED.
# Restore: put the marker back (the value becomes a declared fallback again) → back to GREEN.
set -u
name="concurrency-literal-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/concurrency-literal-check.ts" --gate --root "$1" >/dev/null 2>&1
}

# GREEN baseline: a concurrency constant WITH the declared-fallback marker → exit 0.
cat > plugin/scripts/fixture.ts <<'EOF'
/**
 * FIXED dispatch cap.
 * concurrency-default-fallback: human-ruled fixed cap.
 */
export const FIXED_DISPATCH_CAP = 5;
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a declared-fallback repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: remove the marker — the literal becomes UNDECLARED → MUST go RED.
cat > plugin/scripts/fixture.ts <<'EOF'
/** FIXED dispatch cap. */
export const FIXED_DISPATCH_CAP = 5;
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — an undeclared concurrency literal did not redden the checker" >&2
  exit 3
fi

# RESTORE: put the marker back → back to GREEN.
cat > plugin/scripts/fixture.ts <<'EOF'
/**
 * FIXED dispatch cap.
 * concurrency-default-fallback: human-ruled fixed cap.
 */
export const FIXED_DISPATCH_CAP = 5;
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored declared-fallback repo still reddens the checker" >&2
  exit 4
fi

exit 0
