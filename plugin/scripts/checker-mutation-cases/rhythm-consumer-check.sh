#!/usr/bin/env bash
# Mutation case for rhythm-consumer-check (AC73 判据1 — a non-按需 mechanism must have a call site in
# scripts/test.sh or an execution core; a mechanism with NO call site anywhere and not baselined ⇒ RED).
# Fixture: a temp repo with the real capability-catalog.sh (copied) + a minimal scripts/test.sh that
# wires capability-catalog.sh (its declared cadence is 每轮, non-按需) → GREEN.
# Inject: rewrite test.sh WITHOUT the capability-catalog reference → the non-按需 mechanism loses its
# only call site → 判据1 MUST go RED. Restore → back to GREEN.
set -u
name="rhythm-consumer-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/scripts"

# The catalog is the ONE shipped non-按需 mechanism in this fixture; it self-locates via readlink -f.
cp "${checker_dir}/capability-catalog.sh" "${workdir}/plugin/scripts/capability-catalog.sh"

write_test_sh() { # <body...>
  printf '%s\n' "$@" > "${workdir}/scripts/test.sh"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/rhythm-consumer-check.ts" --check --root "$1" >/dev/null 2>&1
}

# GREEN baseline: test.sh references capability-catalog.sh at a command position → 判据1 wired-strict;
# the fixture has no 按需 shipped mechanisms (判据2 vacuous) and no --no-block checkers (判据3 vacuous)
# → exit 0.
write_test_sh \
  '#!/usr/bin/env bash' \
  'run_static_checks() {' \
  '  bash plugin/scripts/capability-catalog.sh --json >/dev/null' \
  '}'
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a wired capability-catalog.sh (checker always-red?)" >&2
  exit 4
fi

# INJECT: remove the reference — capability-catalog.sh (cadence 每轮) has NO call site and is not in
# KNOWN_UNWIRED → 判据1 MUST go RED (the exact AC73 disease: a mechanism declared to run every tick
# with nothing that runs it).
write_test_sh \
  '#!/usr/bin/env bash' \
  'run_static_checks() {' \
  '  echo "nothing wires capability-catalog"' \
  '}'
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — an unwired non-按需 mechanism did not redden the checker" >&2
  exit 3
fi

# RESTORE: wire capability-catalog.sh again → back to GREEN.
write_test_sh \
  '#!/usr/bin/env bash' \
  'run_static_checks() {' \
  '  bash plugin/scripts/capability-catalog.sh --json >/dev/null' \
  '}'
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored wired capability-catalog.sh still reddens the checker" >&2
  exit 4
fi

exit 0
