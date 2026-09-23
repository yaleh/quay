#!/usr/bin/env bash
# Mutation case for registry-path-literal-check (AC5 of
# gap-registry-path-second-copy-five-checker-sites).
#
# The defect: the checker REGISTRY's path regrows as a SECOND COPY — a site that spells the location
# as three adjacent string literals instead of deriving it from the ONE declaration
# (REGISTRY_BASENAME / REGISTRY_REL_CANDIDATES in
# plugin/scripts/select-static-checks-for-touches.ts, whose own header claims "the ONE path literal in
# the repo … a second copy can never drift from it"). Measured 2026-09-22: FIVE such copies existed,
# all byte-identical at the time — i.e. the claim had ZERO enforcement power and nothing distinguished
# "obeyed" from "ignored" (硬规则 3b/9).
#
# Fixture: a hermetic temp root carrying plugin/scripts/ + packages/quay/src/ — no git dependency.
#
# ⚠️ THIS FILE DERIVES THE FILE NAME FROM THE REAL DECLARATION instead of spelling the joined literal.
# plugin/scripts/ is itself one of the checker's scan roots (recursively — it reaches
# checker-mutation-cases/ too), so a joined literal written here would be found by the very check it
# exercises: the case would then build a fixture that is green for the wrong reason, and the real repo
# would red. The segments are passed as separate printf ARGUMENTS for the same reason — an adjacent
# <DQUOTE>plugin<DQUOTE>, <DQUOTE>scripts<DQUOTE>, <DQUOTE>name<DQUOTE> sequence never appears in this
# file's text (this comment spells the quotes as <DQUOTE> so that even the prose form is not a
# near-miss for a scanner that grew a whitespace-tolerant predicate).
#
# Phases:
#   baseline            empty fixture                                → GREEN (0)
#   inject (plugin)     2nd copy under plugin/scripts/               → RED (1)
#   restore             clean                                        → GREEN (0)
#   inject (pkg)        2nd copy under packages/quay/src/            → RED (1, both roots scanned)
#   restore             clean                                        → GREEN (0)
#   inject (count)      two 2nd copies on two lines                  → RED (2, the count is exact)
#   restore             clean                                        → GREEN (0)
#   negative control    the DERIVED form + data/prose mentions only  → GREEN (0) — never a false red
#   restore             clean                                        → GREEN (0, final)
set -u
name="registry-path-literal-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
repo_root="$(cd "${checker_dir}/../.." && pwd -P)"
declaration="${repo_root}/plugin/scripts/select-static-checks-for-touches.ts"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/packages/quay/src"
cd "${workdir}" || exit 2

# The file name under test, read from the ONE declaration allowed to hold it (never spelled here).
basename_of_registry="$(sed -n 's/.*REGISTRY_BASENAME[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "${declaration}" | head -n 1)"
if [ -z "${basename_of_registry}" ]; then
  echo "INFRASTRUCTURE — could not read REGISTRY_BASENAME from ${declaration} (the case cannot build a meaningful fixture)" >&2
  exit 2
fi

# The defect's exact shape: the three path segments as adjacent string literals.
write_second_copy() {
  printf 'const staticGate = path.join(root, "%s", "%s", "%s");\n' "plugin" "scripts" "${basename_of_registry}" > "$1"
}

# Removes ONLY this case's own fixture files (never a recursive wipe of ${workdir}) so a mis-invoked
# run cannot delete anything but the files this case just wrote.
FIXTURE_FILES=(
  plugin/scripts/some-checker.ts
  packages/quay/src/some-reader.ts
  plugin/scripts/derived-form.ts
  plugin/scripts/some-manifest.json
  plugin/scripts/find-uses.sh
)
write_clean() {
  mkdir -p plugin/scripts packages/quay/src
  rm -f "${FIXTURE_FILES[@]}"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/registry-path-literal-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: nothing to find.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on the clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (plugin root): a second copy in a checker → MUST go RED.
write_clean
write_second_copy plugin/scripts/some-checker.ts
if checker_cmd; then
  echo "STAYED-GREEN — a 2nd copy under plugin/scripts/ did not redden the checker" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the plugin-root inject still reddens the checker" >&2
  exit 4
fi

# INJECT (product root): the same shape in the OTHER scan root → MUST go RED too (both roots covered).
write_clean
write_second_copy packages/quay/src/some-reader.ts
if checker_cmd; then
  echo "STAYED-GREEN — a 2nd copy under packages/quay/src/ did not redden the checker (the second scan root is not covered)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the product-root inject still reddens the checker" >&2
  exit 4
fi

# INJECT (count): two copies on two lines → the report names TWO, not just "some".
write_clean
write_second_copy plugin/scripts/some-checker.ts
# Two copies, on two different lines of the second file (the second line is what the line number must name).
write_second_copy packages/quay/src/some-reader.ts.part
{ printf 'const x = 1;\n'; cat packages/quay/src/some-reader.ts.part; } > packages/quay/src/some-reader.ts
rm -f packages/quay/src/some-reader.ts.part
if checker_cmd; then
  echo "STAYED-GREEN — two 2nd copies did not redden the checker" >&2
  exit 3
fi
# The count is read from the checker's own --json report (never by re-parsing its human output).
# ⛔ The parser is a SEPARATE node process with NO argv[1]: importing the checker from a `node -e`
# whose argv[1] happens to BE the checker path makes isDirectEntry() fire and print the CLI report
# into the captured value (observed while writing this case).
count="$(node --no-warnings --experimental-strip-types "${checker_dir}/registry-path-literal-check.ts" \
  --root "${workdir}" --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{process.stdout.write(String(JSON.parse(s).hits.length));});')"
if [ "${count}" != "2" ]; then
  echo "WRONG-COUNT — expected 2 hits, the report carries ${count} (the count is not exact)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the count inject still reddens the checker" >&2
  exit 4
fi

# NEGATIVE CONTROL: the FIX shape (reading the declaration's own constant) plus data/prose mentions
# (a manifest key, a find(1) -name glob) MUST NOT red — they are advisory only. A checker that reds on
# the fix is worse than none.
write_clean
printf 'const staticGate = path.join(root, REGISTRY_REL_CANDIDATES[0]);\n' > plugin/scripts/derived-form.ts
printf '{"%s": "a description, not a path"}\n' "${basename_of_registry}" > plugin/scripts/some-manifest.json
printf "find \"\${WORK}\" -name '%s' -delete\n" "${basename_of_registry}" > plugin/scripts/find-uses.sh
if checker_cmd; then :; else
  echo "FALSE-RED — the derived form / data mentions reddened the checker (负控制未生效: they are advisory only)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the negative control still reddens the checker" >&2
  exit 4
fi

exit 0
