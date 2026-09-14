#!/usr/bin/env bash
# Mutation case for freshness-producer-coverage-check (AC7 of
# tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger).
#
# The defect: the freshness refresh mechanism loses COMPLETENESS without anyone noticing — a subject
# whose evidence AC-214 tracks has no producer registered for it, so nothing refreshes it and it ages
# past K exactly once per producer-less subject class. Measured cost of the un-mechanised version:
# 4 crossings in 5 days (2026-09-13 x2, 2026-09-14 x2). The 2026-09-13 shape is the sharpest: TWO
# producer faces existed and only ONE was re-run, because "which subjects does the OTHER one own" was
# prose in a task body, not a checked declaration.
#
# Fixture: a hermetic temp root carrying the mapping + the two carrier files — no git, no runtime,
# no cross-machine anything.
#
# Phases (each RED phase is paired with a RESTORE that must go GREEN again — a check that is simply
# always-red passes the inject half and is caught by the restore half):
#   baseline            complete mapping + carrier             → GREEN (0)
#   inject (unreg)      carrier gains a subject nobody produces → RED  (1, named)
#   restore             clean                                   → GREEN (0)
#   inject (orphan)     mapping drops a producer's subject      → RED  (1, named: margin_unregistered)
#   restore             clean                                   → GREEN (0)
#   inject (no-evidence) mapping registers a never-produced one → RED  (1, named: no_carrier_evidence)
#   restore             clean                                   → GREEN (0)
#   inject (corrupt)    mapping becomes unparseable             → exit 2, NOT a green
#   restore             clean                                   → GREEN (0, final)
set -u
name="freshness-producer-coverage-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/.quay"
cd "${workdir}"

MAPPING="mapping.json"
CARRIER=".quay/productization-verification.jsonl"
MARGIN=".quay/goal-freshness-margin.json"

SHA_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SHA_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

# Two subjects produced by one face, one by another. ⛔ Subject ids are spelled ONLY here; both the
# mapping and the carrier are generated from the same arrays so they cannot drift apart silently.
FACE1_SUBJECTS=("GOAL-009-AC-201" "GOAL-009-AC-203")
FACE2_SUBJECTS=("GOAL-009-AC-238")
ALL_SUBJECTS=("${FACE1_SUBJECTS[@]}" "${FACE2_SUBJECTS[@]}")

write_mapping() { # $1 = extra subject to register with no carrier evidence ("" = none)
  local extra="${1:-}"
  local reg2=("${FACE2_SUBJECTS[@]}")
  [ -n "${extra}" ] && reg2+=("${extra}")
  {
    printf '{\n'
    printf '  "carrier": "%s",\n' "${CARRIER}"
    printf '  "margin_snapshot": "%s",\n' "${MARGIN}"
    printf '  "subject_id_pattern": "^GOAL-009-AC-\\\\d+$",\n'
    printf '  "subject_requires_build_sha": true,\n'
    printf '  "producers": [\n'
    printf '    {"id":"face-1","command":"bash producer-1.sh","wallclock_hours":0.5,"subjects":[%s]},\n' \
      "$(printf '"%s",' "${FACE1_SUBJECTS[@]}" | sed 's/,$//')"
    printf '    {"id":"face-2","command":"bash producer-2.sh","wallclock_hours":2,"subjects":[%s]}\n' \
      "$(printf '"%s",' "${reg2[@]}" | sed 's/,$//')"
    printf '  ]\n}\n'
  } > "${MAPPING}"
}

write_carrier() { # $1 = extra subject to add to the carrier ("" = none)
  local extra="${1:-}"
  local subs=("${ALL_SUBJECTS[@]}")
  [ -n "${extra}" ] && subs+=("${extra}")
  : > "${CARRIER}"
  local s
  for s in "${subs[@]}"; do
    printf '{"ac":"%s","build_sha":"%s","ts":"2026-09-14T00:00:00Z"}\n' "${s}" "${SHA_A}" >> "${CARRIER}"
  done
}

write_margin() { # the criterion-side snapshot: exactly the produced subjects
  local body="" s
  for s in "${ALL_SUBJECTS[@]}"; do
    body+="\"${s}\":{\"K\":200,\"d\":10,\"margin\":190},"
  done
  printf '{"at":"2026-09-14T00:00:00Z","k":200,"subjects":{%s}}\n' "${body%,}" > "${MARGIN}"
}

write_clean() {
  write_mapping ""
  write_carrier ""
  write_margin
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/freshness-producer-coverage-check.ts" \
    --root "${workdir}" --mapping "${MAPPING}" >/dev/null 2>&1
}

checker_exit() {
  node --no-warnings --experimental-strip-types "${checker_dir}/freshness-producer-coverage-check.ts" \
    --root "${workdir}" --mapping "${MAPPING}" >/dev/null 2>&1
  echo $?
}

# GREEN baseline: every tracked subject registered, every registered subject produced.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on the clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (unregistered): the carrier grows a subject NO producer declares — the AC's own wording
# ("载体里出现过、却没在映射里登记产出者的主体"). → MUST go RED.
write_mapping ""
write_carrier "GOAL-009-AC-999"
write_margin
if checker_cmd; then
  echo "STAYED-GREEN — a carrier subject with no registered producer did not redden the checker" >&2
  exit 3
fi

# RESTORE → GREEN (proves the red was caused by the injected subject, not by the fixture).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the unregistered inject still reddens the checker" >&2
  exit 4
fi

# INJECT (orphan): a producer drops one of its subjects while the criterion still tracks it. The
# carrier still carries a record for it, so carrier-inspection ALONE cannot see this hole — only the
# margin-snapshot side can. This is the 2026-09-13 shape. → MUST go RED.
write_mapping ""
# drop GOAL-009-AC-203 from face-1 by rewriting the mapping with only the first subject
{
  printf '{\n  "carrier": "%s",\n  "margin_snapshot": "%s",\n' "${CARRIER}" "${MARGIN}"
  printf '  "subject_id_pattern": "^GOAL-009-AC-\\\\d+$",\n  "subject_requires_build_sha": true,\n'
  printf '  "producers": [\n'
  printf '    {"id":"face-1","command":"bash producer-1.sh","wallclock_hours":0.5,"subjects":["GOAL-009-AC-201"]},\n'
  printf '    {"id":"face-2","command":"bash producer-2.sh","wallclock_hours":2,"subjects":["GOAL-009-AC-238"]}\n'
  printf '  ]\n}\n'
} > "${MAPPING}"
if checker_cmd; then
  echo "STAYED-GREEN — a subject the criterion tracks but no producer declares did not redden the checker (the 2026-09-13 shape is invisible)" >&2
  exit 3
fi

# RESTORE → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the orphan inject still reddens the checker" >&2
  exit 4
fi

# INJECT (no evidence): a producer is registered for a subject that has never produced a carrier
# record — the registry claims coverage the artifact does not show. → MUST go RED.
write_mapping "GOAL-009-AC-232"
if checker_cmd; then
  echo "STAYED-GREEN — a registered subject with no carrier record did not redden the checker" >&2
  exit 3
fi

# RESTORE → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the no-evidence inject still reddens the checker" >&2
  exit 4
fi

# INJECT (corrupt mapping): the check's OWN declaration surface becomes unreadable. This must be a
# distinguishable usage/env error (exit 2), NOT exit 0 — a broken registry must never read as
# "nothing to check" (硬规则 3b).
printf '{ this is not json' > "${MAPPING}"
rc="$(checker_exit)"
if [ "${rc}" = "0" ]; then
  echo "FALSE-GREEN — a corrupt mapping exited 0 (a broken declaration surface read as 'nothing to check')" >&2
  exit 3
fi
if [ "${rc}" != "2" ]; then
  echo "exit ${rc} for a corrupt mapping — expected 2 (usage/env error, fail-closed), so the failure is not distinguishable" >&2
  exit 3
fi

# RESTORE → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the corrupt-mapping inject still reddens the checker" >&2
  exit 4
fi

exit 0
