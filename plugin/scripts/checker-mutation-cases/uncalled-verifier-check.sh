#!/usr/bin/env bash
# Mutation case for uncalled-verifier-check (gap-shipped-verifiers-have-no-callers-and-mentions-
# defeat-the-check, the shipped-but-uncalled verifier census).
# Fixture: a temp workspace with one verifier (ok.sh) that HAS an execution call site.
# Inject: a NEW verifier (uncalled.sh) with ZERO execution call sites → the checker MUST exit 1
# (RED — the class this mechanism exists to catch: shipped and nothing invokes it).
# Restore: remove uncalled.sh → the checker MUST exit 0 (GREEN).
set -u
name="uncalled-verifier-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/scripts"
# The wired verifier: ok.sh is executed by scripts/test.sh (the canonical gate surface).
printf '#!/usr/bin/env bash\n# ok verifier\necho ok\n' > "${workdir}/plugin/scripts/ok.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'bash "${REPO_ROOT}/plugin/scripts/ok.sh"' > "${workdir}/scripts/test.sh"
# A shrink-only ratchet file with ceiling 0 (no exemptions).
printf '# baseline-count: 0\n' > "${workdir}/plugin/uncalled-verifier-exemptions.txt"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/uncalled-verifier-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: every verifier has a call site → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fully-wired fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: an uncalled verifier — shipped, correct, and nothing invokes it (the defect class).
printf '#!/usr/bin/env bash\n# shipped-but-uncalled\necho dead\n' > "${workdir}/plugin/scripts/uncalled.sh"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — the injected uncalled verifier did not redden the checker (mentions defeat it?)" >&2
  exit 3
fi

# RESTORE: remove the uncalled verifier → back to green.
rm -f "${workdir}/plugin/scripts/uncalled.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored fixture still reddens the checker" >&2
  exit 4
fi

exit 0
