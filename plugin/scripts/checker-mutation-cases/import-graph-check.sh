#!/usr/bin/env bash
# Mutation case for import-graph-check (tasks/gap-arch-import-graph-check).
#
# The defect class: the module dependency graph REGROWS a structural quantity the ratchet pins — a
# value-level import cycle, a cycle that only closes once the type edges are counted, or a
# packages/** file reaching back into plugin/**|experiments/**. A checker that cannot be made to
# report those is indistinguishable from one that always prints PASS (hard rule 3b: an always-green
# check is more expensive than no check, because the record makes it look executed).
#
# Fixture: a hermetic git repo under <workdir>/tree carrying plugin/import-graph-baseline.json at
# {0,0,0}. The fixture is COMMITTED at the clean state and every injection is `git add`ed (not
# committed): the checker's data source is `git ls-files`, which reads the INDEX — an untracked
# injection would be invisible and every mutation below would "stay green" for the wrong reason.
#
# Phases (each mutation → RED(1), each restore → GREEN(0)):
#   baseline            clean tree, baseline {0,0,0}                     → GREEN (0)
#   inject value-cycle  a ⇄ b, both VALUE imports                        → RED  (valueSccs 1 > 0)
#   restore             clean                                            → GREEN (0)
#   inject type-cycle   a → b value, b `import type` back                → RED  (typeSccs 1 > 0)
#   restore             clean                                            → GREEN (0)
#   inject reverse-edge packages/x.ts → plugin/scripts/y.ts              → RED  (reverseEdges 1 > 0)
#   restore             clean                                            → GREEN (0)
#   inject kernel-breach packages/quay/src/kernel/k.ts → ../outside.ts   → RED  (kernelChecked ∧ violation)
#   restore             clean                                            → GREEN (0)
#   raise-baseline      working-tree baseline valueSccs 1, HEAD's is 0   → RED  (baseline may only shrink)
#   restore             clean                                            → GREEN (0, final)
set -u
name="import-graph-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tree="${workdir}/tree"
baseline_rel="plugin/import-graph-baseline.json"

# Fixture git identity travels in the CHILD ENV, never in the fixture's own repo config — a fixture
# that writes user.name into its repo would be mutating a config the real workflow owns.
export GIT_AUTHOR_NAME="igc-mutation" GIT_AUTHOR_EMAIL="igc@example.invalid"
export GIT_COMMITTER_NAME="igc-mutation" GIT_COMMITTER_EMAIL="igc@example.invalid"
export GIT_CONFIG_GLOBAL="/dev/null" GIT_CONFIG_SYSTEM="/dev/null"

rm -rf "${tree}"
mkdir -p "${tree}/src" "${tree}/plugin/scripts"
git -C "${tree}" -c init.defaultBranch=main -c core.hooksPath=/dev/null init -q

write_baseline() { # $1 = valueSccs
  mkdir -p "${tree}/plugin"
  printf '{\n  "valueSccs": %s,\n  "typeSccs": 0,\n  "reverseEdges": 0\n}\n' "$1" > "${tree}/${baseline_rel}"
}
# The clean tree: no cycles, no reverse edges, no kernel dir. Only the fixture's OWN files are
# removed by write_clean (never a recursive wipe of $tree) so a mis-invoked run cannot delete
# anything but what this case wrote.
FIXTURE_FILES=(
  src/a.ts src/b.ts src/clean.ts
  packages/quay/src/x.ts
  packages/quay/src/kernel/k.ts packages/quay/src/outside.ts
)
write_clean() {
  mkdir -p "${tree}/src" "${tree}/plugin/scripts"
  rm -rf "${tree}/packages"
  rm -f "${tree}/plugin/scripts/y.ts"
  for f in "${FIXTURE_FILES[@]}"; do rm -f "${tree}/$f"; done
  printf 'export const base = 1;\n' > "${tree}/src/clean.ts"
  printf 'export const y = 1;\n' > "${tree}/plugin/scripts/y.ts"
  write_baseline 0
  git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
  git -C "${tree}" -c core.hooksPath=/dev/null commit -q -m "fixture clean" >/dev/null 2>&1 || true
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/import-graph-check.ts" --root "${tree}" >/dev/null 2>&1
}
expect_green() { # $1 = phase label
  if checker_cmd; then return 0; fi
  echo "ALWAYS-RED — ${1}: the checker reports RED on a tree it must accept" >&2
  node --no-warnings --experimental-strip-types "${checker_dir}/import-graph-check.ts" --root "${tree}" 2>&1 | tail -12 >&2
  exit 4
}
expect_red() { # $1 = phase label
  if checker_cmd; then
    echo "STAYED-GREEN — ${1}: the injected defect did not redden the checker" >&2
    exit 3
  fi
}

write_clean
expect_green "baseline"

# ── mutation 1: a VALUE cycle ──
write_clean
printf 'import { b } from "./b.ts";\nexport const a = 1;\n' > "${tree}/src/a.ts"
printf 'import { a } from "./a.ts";\nexport const b = 2;\n' > "${tree}/src/b.ts"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_red "inject value-cycle"
write_clean
expect_green "restore after value-cycle"

# ── mutation 2: a cycle that only closes once TYPE edges are counted ──
write_clean
printf 'import { b } from "./b.ts";\nexport const a = b;\n' > "${tree}/src/a.ts"
printf 'import type { A } from "./a.ts";\nexport const b = null as A | null;\n' > "${tree}/src/b.ts"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_red "inject type-only-cycle"
write_clean
expect_green "restore after type-only-cycle"

# ── mutation 3: a packages/ → plugin/ reverse edge ──
write_clean
mkdir -p "${tree}/packages/quay/src"
printf 'import { y } from "../../../plugin/scripts/y.ts";\nexport const x = y;\n' > "${tree}/packages/quay/src/x.ts"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_red "inject reverse-edge"
write_clean
expect_green "restore after reverse-edge"

# ── mutation 4: the conditional kernel boundary ──
write_clean
mkdir -p "${tree}/packages/quay/src/kernel"
printf 'import { outside } from "../outside.ts";\nexport const k = outside;\n' > "${tree}/packages/quay/src/kernel/k.ts"
printf 'export const outside = 1;\n' > "${tree}/packages/quay/src/outside.ts"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_red "inject kernel-breach"
write_clean
expect_green "restore after kernel-breach"

# ── mutation 5: the baseline itself is RAISED above the git-HEAD value ──
# The clean tree's COMMITTED baseline is {0,0,0}; the working tree is set to valueSccs 1 while the
# reading is still 0. Reading ≤ baseline holds, so ONLY the shrink-only rule can catch this — it is
# the mutation that proves 「调高基线」 cannot buy a pass.
write_clean
write_baseline 1
expect_red "raise-baseline"
write_clean
expect_green "restore after raise-baseline"

exit 0
