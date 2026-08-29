#!/usr/bin/env bash
# Mutation case for checker-mechanical-spine-check (tasks/gap-b1-mechanical-spine-doc-checker, AC3).
# Fixture: a temp scripts dir with ONE compliant checker → GREEN. Inject: add a checker whose source
# carries `process.exit(4)` — the exact "exit 码超出 {0,1,2,3}" shape AC3 requires the checker to go
# RED on → MUST go RED. Restore: remove it → back to GREEN.
set -u
name="checker-mechanical-spine-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/scripts"
cd "${workdir}"

# Hermetic exemptions (empty list is also the baseline — no git needed).
cat > "${workdir}/exemptions.json" <<'EOF'
{"exit":[],"json":[]}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/checker-mechanical-spine-check.ts" \
    --scripts-dir "${workdir}/scripts" \
    --exemptions "${workdir}/exemptions.json" \
    --baseline-exemptions "${workdir}/exemptions.json" >/dev/null 2>&1
}

# GREEN baseline: one compliant checker → exit 0.
printf 'console.log(JSON.stringify({ ok: true }));\n' > "${workdir}/scripts/ok-check.ts"
if checker_cmd; then :; else
  echo "baseline RED on a compliant checker (checker always-red?)" >&2
  exit 4
fi

# INJECT: a checker whose source carries exit code 4 → MUST go RED.
printf 'process.exit(4);\n' > "${workdir}/scripts/bad-check.ts"
if checker_cmd; then
  echo "STAYED-GREEN — a checker with exit code 4 did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the violating checker → back to GREEN.
rm -f "${workdir}/scripts/bad-check.ts"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored compliant corpus still reddens the checker" >&2
  exit 4
fi

exit 0
