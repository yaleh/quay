#!/usr/bin/env bash
# Mutation case for sh-census-check (tasks/gap-arch-sh-census-check).
#
# The defect class: the shell layer REGROWS a quantity the ratchet pins — a new `.sh` that embeds a
# python/node/jq program, or a new byte-identical copy of a plugin/scripts file under
# experiments/**/scripts/. A checker that cannot be made to report those is indistinguishable from one
# that always prints PASS (CLAUDE.md 硬规则 3b: an always-green check is more expensive than no check,
# because the record makes it look executed).
#
# Fixture: a hermetic git repo under <workdir>/tree carrying plugin/sh-census-baseline.json (committed,
# {0,0}), plugin/sh-census-exceptions.txt (one entry, pointing at a real file that MUST be excluded
# from the ratchet), and pure-glue .sh files. The fixture is COMMITTED at the clean state and every
# injection is `git add`ed (not committed): the checker's data source is `git ls-files`, which reads
# the INDEX — an untracked injection would be invisible and every mutation below would "stay green"
# for the wrong reason.
#
# Phases (each mutation → RED(1), each restore → GREEN(0)):
#   baseline             clean tree                                    → GREEN (0)
#   inject embedded.sh   a .sh with a python3 heredoc                  → RED  (embeddedInterpreterLines > 0)
#   restore              clean                                         → GREEN (0)
#   inject duplicate     a byte-identical non-symlink copy pair        → RED  (duplicateCopies 1 > 0)
#   restore              clean                                         → GREEN (0)
#   inject symlink       the SAME pair, experiments side a symlink     → GREEN (0; counted as symlinkedCopies)
#   raise-baseline       working tree baseline raised above HEAD's      → RED  (a baseline may only shrink)
#   restore              clean                                         → GREEN (0, final)
#
# ⛔ The `inject symlink` phase asserts GREEN on purpose: a symlink must NOT be read as a duplicate
# (the two are different quantities — duplicates are the thing Phase 1 removes; links are the accepted
# transition form). A mutation case that only ever reddens would not catch the collapse of the two.
set -u
name="sh-census-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tree="${workdir}/tree"
baseline_rel="plugin/sh-census-baseline.json"
exceptions_rel="plugin/sh-census-exceptions.txt"

# Fixture git identity travels in the CHILD ENV, never in the fixture's own repo config — a fixture
# that writes user.name into its repo would be mutating a config the real workflow owns.
export GIT_AUTHOR_NAME="shc-mutation" GIT_AUTHOR_EMAIL="shc@example.invalid"
export GIT_COMMITTER_NAME="shc-mutation" GIT_COMMITTER_EMAIL="shc@example.invalid"
export GIT_CONFIG_GLOBAL="/dev/null" GIT_CONFIG_SYSTEM="/dev/null"

rm -rf "${tree}"
mkdir -p "${tree}/plugin/scripts"
git -C "${tree}" -c init.defaultBranch=main -c core.hooksPath=/dev/null init -q

write_baseline() { # $1 = embeddedInterpreterLines, $2 = duplicateCopies
  mkdir -p "${tree}/plugin"
  printf '{\n  "embeddedInterpreterLines": %s,\n  "duplicateCopies": %s\n}\n' "$1" "$2" > "${tree}/${baseline_rel}"
}
write_exceptions() {
  printf '# fixture exception list\nplugin/scripts/exc.sh  # fixture: listed, so its lines go to exceptionLines and NOT to the ratchet\n' > "${tree}/${exceptions_rel}"
}

# The clean tree. Only the fixture's OWN files are removed by write_clean (never a recursive wipe of
# $tree) so a mis-invoked run cannot delete anything but what this case wrote.
write_clean() {
  mkdir -p "${tree}/plugin/scripts"
  rm -rf "${tree}/experiments"
  rm -f "${tree}/plugin/scripts/prog.sh" "${tree}/plugin/scripts/dup.sh"
  printf '#!/usr/bin/env bash\nset -eu\ngit -C "$1" merge --ff-only develop\nkill -TERM "$pid"\n' > "${tree}/plugin/scripts/glue.sh"
  printf '#!/usr/bin/env bash\npython3 -c "print(1)"\n' > "${tree}/plugin/scripts/exc.sh"
  write_baseline 0 0
  write_exceptions
  git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
  git -C "${tree}" -c core.hooksPath=/dev/null commit -q -m "fixture clean" >/dev/null 2>&1 || true
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/sh-census-check.ts" --root "${tree}" >/dev/null 2>&1
}
expect_green() { # $1 = phase label
  if checker_cmd; then return 0; fi
  echo "ALWAYS-RED — ${1}: the checker reports RED on a tree it must accept" >&2
  node --no-warnings --experimental-strip-types "${checker_dir}/sh-census-check.ts" --root "${tree}" 2>&1 | tail -12 >&2
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

# ── mutation 1: a new .sh that EMBEDS an interpreter (the P2 "program, not glue" quantity) ──
write_clean
printf '#!/usr/bin/env bash\nset -eu\nout="$(python3 - "$1" <<%sPY%s\nprint(1)\nPY\n)"\necho "$out"\n' "'" "'" > "${tree}/plugin/scripts/prog.sh"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_red "inject embedded-interpreter sh"
write_clean
expect_green "restore after embedded-interpreter sh"

# ── mutation 2: a byte-identical non-symlink COPY (the P4 "single copy" quantity) ──
write_clean
mkdir -p "${tree}/experiments/quay-perpetual-stream/scripts"
cp "${tree}/plugin/scripts/glue.sh" "${tree}/experiments/quay-perpetual-stream/scripts/glue.sh"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_red "inject duplicate copy"
write_clean
expect_green "restore after duplicate copy"

# ── negative control: the SAME pair with a symlink on the experiments side must stay GREEN ──
write_clean
mkdir -p "${tree}/experiments/quay-perpetual-stream/scripts"
ln -s ../../../plugin/scripts/glue.sh "${tree}/experiments/quay-perpetual-stream/scripts/glue.sh"
git -C "${tree}" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
expect_green "symlink copy is NOT a duplicate"
write_clean
expect_green "restore after symlink copy"

# ── mutation 3: the baseline itself is RAISED above the git-HEAD value ──
# The reading is still 0, so 「读数 ≤ 基线」 holds; ONLY the shrink-only rule can catch this — it is the
# mutation that proves 「调高基线」 cannot buy a pass.
write_clean
write_baseline 999 0
expect_red "raise-baseline"
write_clean
expect_green "restore after raise-baseline"

exit 0
