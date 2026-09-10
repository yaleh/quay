#!/usr/bin/env bash
# Mutation case for check-set-after-change-check (A0b③ judged-object intersection selector).
#
# The object being mutated is the DECLARED-JUDGED-OBJECT set (the mechanism's input): for the
# 12a6b18b cp error chain, the checker's regression gate asserts that a change to
# plugin/loop/manager-tick-core.md (the shipped copy) MUST select the test that judges the copy
# (quay-init-loop-consumer-doc-refs — which declares `@judges plugin/loop/*`) and MUST NOT select
# tick-core-static-check (which judges the orchestration source). The mutation case deliberately
# breaks that declared set in two ways and asserts the checker goes RED:
#   INJECT #1 — the judging test's `@judges` declaration is REMOVED (the constraint on the copy is
#               silently lost) → the mechanically computed set no longer includes it → RED (the
#               defect that left 12a6b18b un-caught by the author's "run the covering check").
#   INJECT #2 — the source checker's `@judges` is WRONGLY pointed at the copy (plugin/loop/*) →
#               the plugin/loop change now wrongly selects tick-core-static-check → RED (declared
#               the wrong judged object).
# Each inject is followed by a restore → GREEN, proving the checker is not always-red.
set -u
name="check-set-after-change-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"

mkdir -p "${root}/plugin/test" "${root}/plugin/scripts" "${root}/plugin/loop" "${root}/orchestration"

write() { # <rel> <content...>
  local rel="$1"; shift
  mkdir -p "$(dirname "${root}/${rel}")"
  printf '%s\n' "$@" > "${root}/${rel}"
}

# ── Baseline fixture ────────────────────────────────────────────────────────────────────────────────
# A minimal repo carrying the two self-declared judged-object sets the regression gate needs:
#   - the copy-judging test declares `plugin/loop/*` (the quay-init-loop-consumer-doc-refs shape);
#   - the source-judging checker declares `orchestration/*-tick-core.md` (tick-core-static-check).
write plugin/loop/manager-tick-core.md \
  '# manager tick — 执行核（shipped copy）' \
  'placeholder'
write orchestration/manager-tick-core.md \
  '# manager tick — 执行核（source）' \
  'placeholder'
write plugin/scripts/laydown-set-check.sh \
  '#!/usr/bin/env bash' \
  '# @judges plugin/loop/*' \
  'echo "fixture"'
write plugin/scripts/tick-core-static-check.ts \
  '#!/usr/bin/env node' \
  '// tick-core-static-check.ts — fixture' \
  '// @judges orchestration/*-tick-core.md' \
  'export const placeholder = 1;'

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/check-set-after-change-check.ts" --root "${root}" >/dev/null 2>&1
}

# ── GREEN baseline ──────────────────────────────────────────────────────────────────────────────────
if checker_cmd; then :; else
  echo "baseline RED on a clean declared-judged-object set (checker always-red?)" >&2
  exit 4
fi

# ── INJECT #1 (AC2/AC3 — the 12a6b18b defect): drop the copy-judging checker's declaration ──────────
# Without `@judges plugin/loop/*`, a change to plugin/loop/manager-tick-core.md computes to an EMPTY
# set — the constraint that judges the copy is silently invisible, exactly the pre-12a6b18b state.
write plugin/scripts/laydown-set-check.sh \
  '#!/usr/bin/env bash' \
  'echo "fixture"'
if checker_cmd; then
  echo "STAYED-GREEN — removing the copy-judging checker's @judges declaration did not redden the checker" >&2
  exit 3
fi
# RESTORE #1 → GREEN again.
write plugin/scripts/laydown-set-check.sh \
  '#!/usr/bin/env bash' \
  '# @judges plugin/loop/*' \
  'echo "fixture"'
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (declared) copy-judging checker still reddens the checker" >&2
  exit 4
fi

# ── INJECT #2 (declared the WRONG judged object): the source checker now declares the copy ─────────
# If tick-core-static-check declared `plugin/loop/*`, the plugin/loop copy change would WRONGLY
# select it — the checker's "must NOT select tick-core-static-check" assertion must bite.
write plugin/scripts/tick-core-static-check.ts \
  '#!/usr/bin/env node' \
  '// tick-core-static-check.ts — fixture' \
  '// @judges plugin/loop/*' \
  'export const placeholder = 1;'
if checker_cmd; then
  echo "STAYED-GREEN — a wrong judged-object declaration (source checker → copy) did not redden the checker" >&2
  exit 3
fi
# RESTORE #2 → GREEN again.
write plugin/scripts/tick-core-static-check.ts \
  '#!/usr/bin/env node' \
  '// tick-core-static-check.ts — fixture' \
  '// @judges orchestration/*-tick-core.md' \
  'export const placeholder = 1;'
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (correct) source checker declaration still reddens the checker" >&2
  exit 4
fi

exit 0
