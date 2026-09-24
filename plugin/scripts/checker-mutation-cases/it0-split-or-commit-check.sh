#!/usr/bin/env bash
# Mutation case for it0-split-or-commit-check (DIR-026 split-or-commit gate).
#
# The defect class: a split-or-commit relation that regrows undetected — a done parent over a non-done
# child, a compound task SELECTed before it was split, a one-way parent/child link, a done task over a
# still-BLOCKING prerequisite, a dangling prerequisite edge. A checker that cannot be made to report
# those is indistinguishable from one that always prints PASS (hard rule 3b: an always-green check is
# more expensive than no check, because the record makes it look executed).
#
# Fixture: a hermetic task store `<workdir>/store/tasks/*.md`, driven through the REAL CLI (the `.sh`
# entry's own `.ts`), never through an internal function — that is what makes this a mutation case for
# the shipped instrument rather than for its test seam. Each injection is a rewrite of the fixture's
# task files; the restore puts the clean store back.
#
# Phases (each injection → RED(1), each restore → GREEN(0)):
#   baseline GREEN              clean store, all prerequisites done                     → GREEN (0)
#   inject blocking dep         done task with a `todo` prerequisite                     → RED   (1, names it)
#   restore                     clean                                                    → GREEN (0)
#   inject RETIRED dep          done task with a `superseded` prerequisite               → GREEN (0)
#                               **and** a RETIRED-DEP advisory readout naming it, and that id NOT in a
#                               violation line — the three-valued CHECK 4 (gap-it0-dep-done-iff-deps-
#                               blind-to-superseded). This phase is TWO-SIDED on purpose: a checker that
#                               keeps treating retired as blocking reddens it (exit 4 side), and one that
#                               silently merges retired into `done` loses the readout (exit 3 side).
#   restore                     clean                                                    → GREEN (0)
#   inject mixed deps           done task with a `superseded` AND a `todo` prerequisite  → RED   (1)
#                               the violation names ONLY the todo one, the advisory ONLY the retired
#                               one — both states visible at once, neither merged into the other.
#   restore                     clean                                                    → GREEN (0)
#   inject missing dep          done task whose prerequisite does not exist at all       → RED   (1)
#                               fail-closed: "read nothing" is NOT "read retired".
#   restore                     clean (final)                                            → GREEN (0)
#
# Exit codes (the case-script contract):
#   0 = every phase behaved;  3 = STAYED-GREEN (a defect the checker must report was not reported);
#   4 = ALWAYS-RED / OVER-REPORTED (the checker rejected a store it must accept);  2 = could not run.
set -u
name="it0-split-or-commit-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker="${checker_dir}/it0-split-or-commit-check.ts"

store="${workdir}/store"
tasks="${store}/tasks"
rm -rf "${store}"
mkdir -p "${tasks}"

# write_task <id> <status> [dep id ...] — one task file into the fixture store.
write_task() {
  local id="$1" status="$2"; shift 2
  {
    printf -- '---\nid: %s\nstatus: %s\nrole: primitive\nparent: null\nchildren: []\n' "${id}" "${status}"
    if [ "$#" -gt 0 ]; then
      printf -- 'depends_on:\n'
      local d
      for d in "$@"; do printf -- '  - %s\n' "${d}"; done
    else
      printf -- 'depends_on: []\n'
    fi
    printf -- '---\n'
  } > "${tasks}/${id}.md"
}

# write_clean — the store the checker MUST accept: a done prerequisite chain, nothing retired.
write_clean() {
  rm -rf "${tasks}"
  mkdir -p "${tasks}"
  write_task "pre-req" "done"
  write_task "dependent-done" "done" "pre-req"
}

out=""
run_raw() { node --no-warnings --experimental-strip-types "${checker}" "${store}"; }

# The FAIL lines only (the advisory block is excluded) — the "is it reported as blocking?" surface.
violation_lines() { printf '%s\n' "$out" | grep '^  - ' | grep -v '^  - RETIRED-DEP:'; }

expect_green() { # $1 = phase label
  if out="$(run_raw 2>&1)"; then
    if printf '%s\n' "$out" | grep -q '^ADVISORY —'; then
      echo "OVER-REPORTED — ${1}: a clean store must not carry a RETIRED advisory" >&2
      printf '%s\n' "$out" >&2
      exit 4
    fi
    return 0
  fi
  echo "ALWAYS-RED — ${1}: the checker reports RED on a store it must accept" >&2
  printf '%s\n' "$out" >&2
  exit 4
}

expect_red() { # $1 = phase label, $2 = prerequisite id the DEP-DONE-IFF-DEPS violation must name
  local code=0
  out="$(run_raw 2>&1)" || code=$?
  if [ "${code}" -eq 0 ]; then
    echo "STAYED-GREEN — ${1}: the injected defect did not redden the checker" >&2
    printf '%s\n' "$out" >&2
    exit 3
  fi
  if [ "${code}" -ne 1 ]; then
    echo "UNEXPECTED-EXIT ${code} — ${1}: expected the FAIL vocabulary (exit 1); a non-1 exit is not a violation verdict" >&2
    printf '%s\n' "$out" >&2
    exit 2
  fi
  if ! printf '%s\n' "$out" | grep -q '^  - DEP-DONE-IFF-DEPS:'; then
    echo "MISATTRIBUTED — ${1}: RED, but not for the dependency rule" >&2
    printf '%s\n' "$out" >&2
    exit 3
  fi
  if ! violation_lines | grep -q "${2} (status:"; then
    echo "MISATTRIBUTED — ${1}: the violation does not name the blocking prerequisite \"${2}\"" >&2
    printf '%s\n' "$out" >&2
    exit 3
  fi
}

# ── phase: baseline ──
write_clean
expect_green "baseline"

# ── mutation 1: the prerequisite is still OPEN (`todo`) → must stay a violation ──
write_clean
write_task "pre-req" "todo"
expect_red "inject blocking dep" "pre-req"
write_clean
expect_green "restore after blocking dep"

# ── mutation 2: the prerequisite was RETIRED (`superseded`) → non-blocking, but DISTINGUISHABLE ──
write_clean
write_task "pre-req" "superseded"
if out="$(run_raw 2>&1)"; then :; else
  echo "ALWAYS-RED — inject retired dep: a RETIRED (superseded) prerequisite is still reported as blocking" >&2
  printf '%s\n' "$out" >&2
  exit 4
fi
if ! printf '%s\n' "$out" | grep -q '^  - RETIRED-DEP:.*pre-req (status: superseded)'; then
  echo "STAYED-GREEN — inject retired dep: the retired prerequisite produced NO distinct RETIRED-DEP readout (it was silently merged into 'done')" >&2
  printf '%s\n' "$out" >&2
  exit 3
fi
if violation_lines | grep -q "pre-req (status:"; then
  echo "OVER-REPORTED — inject retired dep: the retired prerequisite is also named by a violation (the two states are not separable)" >&2
  printf '%s\n' "$out" >&2
  exit 4
fi
write_clean
expect_green "restore after retired dep"

# ── mutation 3: BOTH states on one done task → each reported in its own channel, neither merged ──
write_clean
write_task "pre-req" "todo"
write_task "retired-dep" "superseded"
write_task "dependent-done" "done" "retired-dep" "pre-req"
expect_red "inject mixed retired+blocking" "pre-req"
if violation_lines | grep -q "retired-dep (status:"; then
  echo "OVER-REPORTED — inject mixed retired+blocking: the RETIRED prerequisite leaked into the violation list" >&2
  printf '%s\n' "$out" >&2
  exit 4
fi
if ! printf '%s\n' "$out" | grep -q '^  - RETIRED-DEP:.*retired-dep (status: superseded)'; then
  echo "STAYED-GREEN — inject mixed retired+blocking: the RETIRED prerequisite produced no readout while a blocking one was reported" >&2
  printf '%s\n' "$out" >&2
  exit 3
fi
write_clean
expect_green "restore after mixed retired+blocking"

# ── mutation 4: the prerequisite does not EXIST → fail-closed, never "retired" ──
write_clean
write_task "dependent-done" "done" "ghost-dep"
expect_red "inject missing dep" "ghost-dep"
write_clean
expect_green "restore after missing dep (final)"

exit 0
