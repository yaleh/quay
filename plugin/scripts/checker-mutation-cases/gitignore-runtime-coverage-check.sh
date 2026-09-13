#!/usr/bin/env bash
# Mutation case for gitignore-runtime-coverage-check
# (tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay, Plan item 3).
#
# Fixture: a root carrying the TWO representations the checker binds — `.gitignore` (with the marker
# comment `@quay-runtime-artifact` directly above each runtime pattern) and the manifest
# plugin/scripts/quay-runtime-artifacts.txt. ⛔ The fixture is written from a heredoc here, never by
# copying the real files, so this case tests the checker's JUDGMENT, not the current contents of the
# real list (the real binding is exercised by the checker's own unit test + the production carrier).
#
# GREEN:  marked set == manifest set (one pattern each) → exit 0.
# INJECT ①: drop the pattern line from the MANIFEST ⇒ "marked in .gitignore but ABSENT from the
#            manifest" ⇒ the checker MUST go RED (exit 1) — this is the drift that shipped: an entry
#            quay's own .gitignore declares as a runtime artifact that quay-init would not ignore.
# INJECT ② (the other direction, after restoring ①): add a manifest entry with NO marker ⇒
#            "present in the manifest but NOT marked" ⇒ RED. Both directions must bite, or the check
#            would be half a binding.
# RESTORE → GREEN again.
set -u
name="gitignore-runtime-coverage-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

# The pattern used throughout (a placeholder, deliberately NOT a real manifest entry — the case must
# not depend on which patterns the real list happens to hold).
P="fixture-runtime-state.jsonl"
MARKER="# @quay-runtime-artifact — fixture marker"

write_gitignore() {
  printf '%s\n' "${MARKER}" "${P}" > .gitignore
}
write_manifest() {
  printf '# fixture manifest\n%s\n' "$1" > plugin/scripts/quay-runtime-artifacts.txt
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/gitignore-runtime-coverage-check.ts" --root "$workdir" >/dev/null 2>&1
}

# GREEN baseline: both representations carry the one pattern → exit 0.
write_gitignore
write_manifest "${P}"
if checker_cmd; then :; else
  echo "baseline RED on a consistent fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT ① — the manifest LOSES the marked pattern ⇒ RED (quay-init would not ignore it).
printf '# fixture manifest\n' > plugin/scripts/quay-runtime-artifacts.txt
if checker_cmd; then
  echo "STAYED-GREEN — a marked runtime artifact missing from the manifest did not redden the check (the quay-fleet drift would ship)" >&2
  exit 3
fi

# INJECT ② — restore ① and add an UNMARKED manifest entry ⇒ RED (an unreferenced rule).
write_manifest "${P}
another-runtime-state.jsonl"
if checker_cmd; then
  echo "STAYED-GREEN — a manifest entry with no marker in .gitignore did not redden the check (half a binding)" >&2
  exit 3
fi

# RESTORE → GREEN.
write_manifest "${P}"
if checker_cmd; then :; else
  echo "ALWAYS-RED — the restored consistent fixture still reddens the checker" >&2
  exit 4
fi

exit 0
