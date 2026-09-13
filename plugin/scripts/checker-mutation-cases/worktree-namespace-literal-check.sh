#!/usr/bin/env bash
# Mutation case for worktree-namespace-literal-check (AC3 of
# gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root).
#
# The defect: the worktree-namespace directory literal regrows OUTSIDE the ONE file allowed to spell
# it — the single resolver's fallback declaration (packages/quay/src/worktree-namespace.ts,
# DEFAULT_WORKTREE_NAMESPACE_NAME). A second spelling is a reader answering "where are this
# workspace's worktrees" from a hardcoded name instead of the workspace's own
# `loop.worktree_root` — which is how a third-party project came to read ANOTHER project's namespace
# (measured 2026-09-13: /home/yale/work/quay-fleet → /home/yale/work/quay-worktrees).
#
# Fixture: a hermetic temp root carrying packages/quay/src/ + plugin/scripts/ — no git dependency.
#
# ⚠️ THIS FILE DERIVES THE NAMESPACE NAME FROM THE REAL RESOLVER DECLARATION instead of spelling the
# double-quoted literal. plugin/scripts/ is itself one of the checker's scan roots, so a
# double-quoted literal written here would be found by the very check it exercises: the check would
# red on the real repo (2 hits) and this case would then pass for the wrong reason. Reading the name
# from the declaration also means the case keeps working if the fallback name is ever changed.
#
# Phases:
#   baseline            resolver declaration only           → GREEN (0)
#   inject (src)        a 2nd double-quoted literal under packages/quay/src/  → RED (1)
#   restore             clean                                → GREEN (0)
#   inject (plugin)     a 2nd double-quoted literal under plugin/scripts/     → RED (1, both roots scanned)
#   restore             clean                                → GREEN (0)
#   inject (misplaced)  the ONLY literal, but not the resolver declaration    → RED (1, 「≤1」 alone is not the invariant)
#   restore             clean                                → GREEN (0)
#   inject (unquoted)   path-regex / prose occurrences only  → GREEN (0) — advisory, 负控制 (never a false red)
#   restore             clean                                → GREEN (0, final)
set -u
name="worktree-namespace-literal-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${checker_dir}/../.." && pwd)"

mkdir -p "${workdir}/packages/quay/src" "${workdir}/plugin/scripts"
cd "${workdir}"

# The name under test, read from the ONE declaration that is allowed to hold it (never spelled here).
ns="$(sed -n 's/.*DEFAULT_WORKTREE_NAMESPACE_NAME[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "${repo_root}/packages/quay/src/worktree-namespace.ts" | head -n 1)"
if [ -z "${ns}" ]; then
  echo "INFRASTRUCTURE — could not read DEFAULT_WORKTREE_NAMESPACE_NAME from ${repo_root}/packages/quay/src/worktree-namespace.ts (the case cannot build a meaningful fixture)" >&2
  exit 2
fi

# The clean baseline: the declaration, at the resolver path, carrying the marker on its line.
# Removes ONLY this case's own fixture files (never a recursive wipe of ${workdir}) so a mis-invoked
# run cannot delete anything but the files this case just wrote.
FIXTURE_FILES=(
  packages/quay/src/worktree-namespace.ts
  packages/quay/src/some-reader.ts
  packages/quay/src/elsewhere.ts
  plugin/scripts/some-driver.ts
  plugin/scripts/unquoted-uses.ts
)
write_clean() {
  mkdir -p packages/quay/src plugin/scripts
  rm -f "${FIXTURE_FILES[@]}"
  printf 'export const DEFAULT_WORKTREE_NAMESPACE_NAME = "%s";\n' "${ns}" > packages/quay/src/worktree-namespace.ts
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/worktree-namespace-literal-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: only the resolver declaration → exit 0.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on the clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (src root): a second double-quoted literal in a product source reader → MUST go RED.
write_clean
printf 'const ns = path.join(root, "%s");\n' "${ns}" > packages/quay/src/some-reader.ts
if checker_cmd; then
  echo "STAYED-GREEN — a 2nd double-quoted literal under packages/quay/src/ did not redden the checker" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the src-root inject still reddens the checker" >&2
  exit 4
fi

# INJECT (plugin root): the same literal in the OTHER scan root → MUST go RED too (both roots covered).
write_clean
printf 'const dir = path.join(path.dirname(mainRoot), "%s");\n' "${ns}" > plugin/scripts/some-driver.ts
if checker_cmd; then
  echo "STAYED-GREEN — a 2nd double-quoted literal under plugin/scripts/ did not redden the checker (the second scan root is not covered)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the plugin-root inject still reddens the checker" >&2
  exit 4
fi

# INJECT (misplaced): the ONLY literal sits OUTSIDE the resolver declaration → MUST go RED — the
# invariant is not "≤1 hit" alone, it is "the hit IS the single resolver's declaration".
write_clean
rm -f packages/quay/src/worktree-namespace.ts
printf 'export const X = "%s";\n' "${ns}" > packages/quay/src/elsewhere.ts
if checker_cmd; then
  echo "STAYED-GREEN — a lone literal in a non-resolver file did not redden the checker (「≤1 hit」 was accepted without the declaration check)" >&2
  exit 3
fi

# RESTORE: clean again → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the misplaced inject still reddens the checker" >&2
  exit 4
fi

# NEGATIVE CONTROL: unquoted occurrences (a path regex + a prose mention) are ADVISORY, never a red.
write_clean
printf 'const re = /^.*\\/%s\\/[^/]+\\/(.+)$/;\n// prose mentions %s without quoting it\n' "${ns}" "${ns}" \
  > plugin/scripts/unquoted-uses.ts
if checker_cmd; then :; else
  echo "FALSE-RED — unquoted occurrences (path regex / comment prose) reddened the checker (负控制未生效: they are advisory only)" >&2
  exit 4
fi

# RESTORE: clean again → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the unquoted inject still reddens the checker" >&2
  exit 4
fi

exit 0
