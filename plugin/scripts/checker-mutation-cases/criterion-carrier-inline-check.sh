#!/usr/bin/env bash
# Mutation case for criterion-carrier-inline-check (AC7 of
# gap-criterion-live-web-address-derivation-17-copies-to-one).
#
# The defect: a goal criterion INLINES the live-host carrier read instead of calling the single
# definition point (plugin/scripts/live-web-address.ts). The step used to be inlined in 17 criteria and
# had split into three disagreeing variants, so the check exists to make an 18th copy impossible.
#
# Fixture: a hermetic temp root carrying only goals/ — no git, no network.
#
# Phases:
#   baseline          a criterion that calls the helper                  → GREEN (0)
#   inject            the same criterion names the carrier itself         → RED (1)
#   restore           clean again                                        → GREEN (0)
#   prose-only        the carrier named in `origin:` (⛔ NOT the criterion) → GREEN (0) — 负控制: the
#                     predicate is POSITIONAL (硬规则 2), a document ABOUT the carrier is not a step
#   restore           clean again                                        → GREEN (0)
#   no-goals-dir      the goals/ directory is absent                     → NOT-EVALUATED (2), ⛔ never 0
set -u
name="criterion-carrier-inline-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

FIXTURE_FILES=(
  goals/AC-900-fixture.md
  goals/AC-901-prose.md
)

# The literal under test is read from the CHECKER's own declaration instead of being spelled here, so a
# rename in one place cannot silently make this case test nothing.
literal="$(sed -n 's/.*CARRIER_LITERAL[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "${checker_dir}/criterion-carrier-inline-check.ts" | head -n 1)"
if [ -z "${literal}" ]; then
  echo "INFRASTRUCTURE — could not read CARRIER_LITERAL from ${checker_dir}/criterion-carrier-inline-check.ts" >&2
  exit 2
fi

write_clean() {
  cd "${workdir}" || exit 2
  mkdir -p goals
  rm -f "${FIXTURE_FILES[@]}"
  printf -- '---\nid: AC-900\ntitle: fixture\nstatus: active\nkind: criterion\ncriterion: >-\n  addr=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$p")\n---\n' \
    > goals/AC-900-fixture.md
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/criterion-carrier-inline-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: a criterion that CALLS the single definition point → exit 0.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on the clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: the criterion names the carrier itself → MUST go RED (that is the recurrence).
write_clean
printf -- '---\nid: AC-900\ntitle: fixture\nstatus: active\nkind: criterion\ncriterion: >-\n  addr=$(node -e "read %s by hand")\n---\n' "${literal}" \
  > goals/AC-900-fixture.md
if checker_cmd; then
  echo "STAYED-GREEN — a criterion naming the carrier did not redden the checker" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the inject still reddens the checker" >&2
  exit 4
fi

# NEGATIVE CONTROL (positional predicate): the carrier named in `origin:` prose only — the criterion
# itself stays clean → GREEN under the criterion. This case does not need the file to be under goals/
# (origin prose is the same shape whether it names the carrier or not); it pins that the checker does
# not widen to prose, which is what makes the RED arm above attributable to the CRITERION position.
write_clean
printf -- '---\nid: AC-901\ntitle: fixture\nstatus: active\nkind: criterion\ncriterion: >-\n  addr=helper\norigin: the old step read the %s by hand\n---\n' "${literal}" \
  > goals/AC-901-prose.md
if checker_cmd; then :; else
  echo "FALSE-RED — a carrier mention in origin prose reddened the check (predicate is not positional)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the prose-only inject still reddens the checker" >&2
  exit 4
fi

# NOT-EVALUATED arm: an absent goals/ dir is exit 2, ⛔ never a 0 that reads as "every criterion clean".
mkdir -p goals
rm -f "${FIXTURE_FILES[@]}"
rmdir goals
checker_cmd
rc=$?
if [ "${rc}" -eq 2 ]; then :; else
  echo "NOT-EVALUATED arm wrong: an absent goals/ dir exited ${rc} (expected 2) — 「cannot evaluate」 must not wear the shape of a pass" >&2
  exit 4
fi

exit 0
