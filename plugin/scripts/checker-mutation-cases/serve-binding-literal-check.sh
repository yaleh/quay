#!/usr/bin/env bash
# Mutation case for serve-binding-literal-check (AC1/AC7 of
# gap-serve-binding-defaults-three-copies-to-one-definition-point).
#
# The defect: the `quay serve` web binding's host default regrows OUTSIDE the ONE file allowed to
# spell it — the single resolver's fallback declaration (packages/quay/src/serve-binding.ts,
# SERVE_BINDING_FALLBACK). Before this task the same quantity had three definitions and the host
# halves DISAGREED (all-interfaces / loopback / all-interfaces), so "start the web server" listened
# on two different surfaces depending on which entry the operator used.
#
# Fixture: a hermetic temp root carrying packages/quay/src/ + plugin/scripts/ + the doc surface — no
# git dependency.
#
# ⚠️ THIS FILE DERIVES THE HOST FROM THE REAL DECLARATION instead of spelling the double-quoted
# literal. plugin/scripts/ is itself one of the checker's scan roots, so a double-quoted literal
# written here would be found by the very check it exercises: the check would red on the real repo and
# this case would then pass for the wrong reason. Deriving it also keeps the case working if the
# fallback host is ever changed.
#
# Phases:
#   baseline             declaration + doc surface only                      → GREEN
#   inject (src)         a 2nd quoted default under packages/quay/src/         → RED
#   restore              clean                                                 → GREEN
#   inject (plugin)      a 2nd quoted default under plugin/scripts/            → RED (both roots scanned)
#   restore              clean                                                 → GREEN
#   inject (misplaced)   the ONLY literal, but not the declaration             → RED (「≤1」 alone is not the invariant)
#   restore              clean                                                 → GREEN
#   allowlisted          a quoted default in an allowlisted file               → GREEN (advisory, 负控制: never a false red)
#   doc-drift            the doc surface stops carrying the fallback host      → RED (AC8)
#   restore              clean                                                 → GREEN (final)
set -u
name="serve-binding-literal-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
repo_root="$(cd "${checker_dir}/../.." && pwd -P)"

mkdir -p "${workdir}/packages/quay/src" "${workdir}/plugin/scripts" "${workdir}/plugin/skills/drivers"
cd "${workdir}"

# The host under test, read from the ONE declaration allowed to hold it (never spelled here).
host="$(sed -n 's/.*SERVE_BINDING_FALLBACK[^"]*"\([^"]*\)".*/\1/p' \
  "${repo_root}/packages/quay/src/serve-binding.ts" | head -n 1)"
if [ -z "${host}" ]; then
  echo "INFRASTRUCTURE — could not read SERVE_BINDING_FALLBACK.host from ${repo_root}/packages/quay/src/serve-binding.ts (the case cannot build a meaningful fixture)" >&2
  exit 2
fi

FIXTURE_FILES=(
  packages/quay/src/serve-binding.ts
  packages/quay/src/serve.ts
  packages/quay/src/server-state.ts
  packages/quay/src/elsewhere.ts
  plugin/scripts/some-spawner.ts
  plugin/skills/drivers/SKILL.md
)
write_clean() {
  mkdir -p packages/quay/src plugin/scripts plugin/skills/drivers
  rm -f "${FIXTURE_FILES[@]}"
  # The declaration (marker on its own line) + the doc surface that restates the value.
  printf 'export const SERVE_BINDING_FALLBACK = { host: "%s", port: 0 };\n' "${host}" \
    > packages/quay/src/serve-binding.ts
  printf '# drivers\n\nquay serve --host <ip> (default host %s)\n' "${host}" \
    > plugin/skills/drivers/SKILL.md
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/serve-binding-literal-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
}

# GREEN baseline: only the declaration + a current doc surface → exit 0.
write_clean
if checker_cmd; then :; else
  echo "baseline RED on the clean fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT (src root): a second quoted default in a product source entry → MUST go RED.
write_clean
printf 'const host = opts.host ?? "%s";\n' "${host}" > packages/quay/src/serve.ts
if checker_cmd; then
  echo "STAYED-GREEN — a 2nd quoted bind default under packages/quay/src/ did not redden the checker" >&2
  exit 3
fi

# RESTORE → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the src-root inject still reddens the checker" >&2
  exit 4
fi

# INJECT (plugin root): the same literal in the OTHER scan root → MUST go RED too (both roots covered).
write_clean
printf 'spawn(cli, ["serve", "--host", "%s"]);\n' "${host}" > plugin/scripts/some-spawner.ts
if checker_cmd; then
  echo "STAYED-GREEN — a 2nd quoted bind default under plugin/scripts/ did not redden the checker (the second scan root is not covered)" >&2
  exit 3
fi

# RESTORE → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the plugin-root inject still reddens the checker" >&2
  exit 4
fi

# INJECT (misplaced): the ONLY literal sits OUTSIDE the declaration → MUST go RED — the invariant is
# not "≤1 hit" alone, it is "the hit IS the SERVE_BINDING_FALLBACK declaration".
write_clean
rm -f packages/quay/src/serve-binding.ts
printf 'export const H = "%s";\n' "${host}" > packages/quay/src/elsewhere.ts
if checker_cmd; then
  echo "STAYED-GREEN — a lone literal in a non-declaration file did not redden the checker (「≤1 hit」 was accepted without the declaration check)" >&2
  exit 3
fi

# RESTORE → GREEN.
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the misplaced inject still reddens the checker" >&2
  exit 4
fi

# NEGATIVE CONTROL: an ALLOWLISTED file's quoted address (a wildcard→probeable normaliser) is
# ADVISORY — it must never be a false red.
write_clean
printf 'if (h === "%s") return "probe-addr";\n' "${host}" > packages/quay/src/server-state.ts
if checker_cmd; then :; else
  echo "FALSE-RED — an allowlisted file's quoted address reddened the checker (负控制未生效: it is a different 口径, advisory only)" >&2
  exit 4
fi

# AC8: a doc surface that has drifted from the fallback host → MUST go RED.
write_clean
printf '# drivers\n\nquay serve --host <ip> (default host 203.0.113.9)\n' > plugin/skills/drivers/SKILL.md
if checker_cmd; then
  echo "STAYED-GREEN — a doc surface that no longer carries the fallback host did not redden the checker (AC8 not enforced)" >&2
  exit 3
fi

# RESTORE → GREEN (final).
write_clean
if checker_cmd; then :; else
  echo "ALWAYS-RED — restoring the clean fixture after the doc-drift inject still reddens the checker" >&2
  exit 4
fi

exit 0
