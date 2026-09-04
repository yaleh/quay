#!/usr/bin/env bash
# worktree-include.sh — copy gitignored files declared in .worktreeinclude into
# a worktree, right after `git worktree add`.
#
# Usage:   bash scripts/worktree-include.sh <worktree-path>
# Example: bash scripts/worktree-include.sh /tmp/quay-wt-<task>
#
# WHY THIS SCRIPT EXISTS:
#   `git worktree add` places only TRACKED files in the new worktree. Any
#   gitignored-but-required file (e.g. .quay/config.yml, plugin/vendor dist
#   bundles) is absent, so a gate/test then fails on an environmental gap
#   ("Error: Cannot find repo root: no .quay/config.yml found upward" — round-5's
#   72 file crashes) rather than on a real defect. .worktreeinclude DECLARES which
#   gitignored files every worktree needs (gitignore syntax); this script performs
#   the mechanical copy. Declarative does not miss; hand-copying does.
#
# SEMANTICS (each is mechanically enforced):
#   - A file is copied ONLY if it is BOTH declared in the worktree's (or the
#     primary's) .worktreeinclude AND actually gitignored in the primary
#     checkout AND present on disk. A tracked file (already in the worktree via
#     git) is never copied even if declared. A gitignored file not declared is
#     never copied.
#   - node_modules/** is always excluded (the build step symlinks/installs it).
#   - No .worktreeinclude => nothing to copy (exit 0). A missing/invalid
#     worktree argument => exit 2.
#
# Pattern matching uses git's OWN gitignore matcher: the declaration is copied
# into a throwaway git repo whose ONLY .gitignore is .worktreeinclude, and the
# primary checkout's untracked files are checked against it via `git
# check-ignore --stdin`. No hand-rolled glob engine.

set -euo pipefail

usage() {
  echo "usage: bash scripts/worktree-include.sh <worktree-path>" >&2
  exit 2
}

[ $# -ge 1 ] || usage
WORKTREE=$(realpath "$1")
[ -d "$WORKTREE" ] || { echo "worktree-include: error: $WORKTREE is not a directory" >&2; exit 2; }

# Primary checkout = the main worktree of the same git repo. `git worktree
# list --porcelain` lists the main working tree FIRST (guaranteed by git) — the
# `main true` marker is absent on git >= 2.53, so take the first worktree line.
PRIMARY=$(git -C "$WORKTREE" worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{print $2; exit}')
if [ -z "$PRIMARY" ]; then
  echo "worktree-include: error: cannot resolve primary checkout for $WORKTREE" >&2
  exit 2
fi

# Declaration = the target worktree's OWN .worktreeinclude (it is a TRACKED
# file, so it is identical in the primary at the same commit — reading the
# worktree's copy makes the script work from any cwd and governs exactly what
# THAT worktree needs), falling back to the primary's copy for worktrees whose
# branch predates the declaration.
DECLARATION="$WORKTREE/.worktreeinclude"
[ -f "$DECLARATION" ] || DECLARATION="$PRIMARY/.worktreeinclude"
if [ ! -f "$DECLARATION" ]; then
  echo "worktree-include: no .worktreeinclude in $WORKTREE or $PRIMARY — nothing to copy"
  exit 0
fi

# Throwaway repo whose ONLY .gitignore is the declaration, so git itself decides
# which of the primary's untracked paths the declaration names.
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
git init -q "$SCRATCH"
cp "$DECLARATION" "$SCRATCH/.gitignore"

# declared   = primary untracked files that the declaration's patterns match.
# gitignored = primary untracked files that are actually gitignored (present on
#              disk, excluded by .gitignore — the "whitelist" gate).
# Copy = declared ∩ gitignored.
git -C "$PRIMARY" ls-files --others -z \
  | git -C "$SCRATCH" check-ignore --stdin -z --no-index \
  | sort -z > "$SCRATCH/declared"
git -C "$PRIMARY" ls-files --others --ignored --exclude-standard -z \
  | sort -z > "$SCRATCH/gitignored"

copied=0
while IFS= read -r -d '' rel; do
  case "$rel" in
    node_modules/*|*/node_modules/*) continue ;;
  esac
  src="$PRIMARY/$rel"
  if [ ! -e "$src" ] && [ ! -L "$src" ]; then
    echo "worktree-include: skip missing (declared but not on disk): $rel" >&2
    continue
  fi
  mkdir -p "$WORKTREE/$(dirname "$rel")"
  cp -p "$src" "$WORKTREE/$rel"
  echo "worktree-include: copied $rel -> $WORKTREE/$rel"
  copied=$((copied + 1))
done < <(comm -z -12 "$SCRATCH/gitignored" "$SCRATCH/declared")

if [ "$copied" -eq 0 ]; then
  echo "worktree-include: nothing to copy (0 files declared AND gitignored)"
fi
echo "worktree-include: done — $copied file(s) copied into $WORKTREE"
