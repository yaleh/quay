#!/usr/bin/env bash
# worktree-include.sh — copy gitignored files declared in .worktreeinclude into
# a worktree, right after `git worktree add`.
#
# Usage:   bash scripts/worktree-include.sh <worktree-path>
#          bash scripts/worktree-include.sh --verify <worktree-path>
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
#   - No .worktreeinclude => nothing to copy (exit 0). A missing/unresolvable
#     worktree argument or primary checkout => exit 2.
#   - The copy path POST-CONDITIONS ITSELF FROM DISK: after copying, it reads
#     back that every declared ∩ gitignored file is present in the worktree
#     (exit 1 + the offending paths otherwise). So "exit 0" is a claim about
#     the worktree's contents, never about the cp commands having been issued.
#   - --verify: copy NOTHING; perform exactly that same read-back and report.
#     Names each absent file on stderr, exits 1 (0 = all present). This is the
#     enumerator a caller uses after a failed copy to say WHICH files are
#     missing — the difference between a real failure report and a bare "failed"
#     that is indistinguishable from half-success (hard rule 3b). Same matcher
#     as the copy path — one source of truth for "what is declared", never a
#     second hand-rolled glob engine.
#
# Pattern matching uses git's OWN gitignore matcher: the declaration is copied
# into a throwaway git repo whose ONLY .gitignore is .worktreeinclude, and the
# primary checkout's untracked files are checked against it via `git
# check-ignore --stdin`. No hand-rolled glob engine.

set -euo pipefail

usage() {
  echo "usage: bash scripts/worktree-include.sh [--verify] <worktree-path>" >&2
  exit 2
}

VERIFY=0
if [ "${1:-}" = "--verify" ]; then
  VERIFY=1
  shift
fi

[ $# -ge 1 ] || usage
WORKTREE=$(realpath "$1")
[ -d "$WORKTREE" ] || { echo "worktree-include: error: $WORKTREE is not a directory" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_SH="${SCRIPT_DIR}/../plugin/scripts/repo-root.sh"
if [ ! -f "${REPO_ROOT_SH}" ]; then
  echo "worktree-include: error: ${REPO_ROOT_SH} not found — this script must sit at <checkout>/scripts/ alongside <checkout>/plugin/scripts/repo-root.sh, which provides the order-independent primary-checkout derivation" >&2
  exit 2
fi
# shellcheck source=../plugin/scripts/repo-root.sh
. "${REPO_ROOT_SH}"

# Primary checkout = the main worktree of the same git repo, derived ORDER-INDEPENDENTLY from the
# repo's shared .git dir (repo-root.sh's mainCheckoutRoot — the bash half of the repo-root
# bash+TS single source of truth, which already exists for exactly this question).
#
# ⛔ NOT a `git worktree list --porcelain` read piped into an early-exiting `awk` that prints the
# first worktree path and exits at once (the previous implementation here): such a consumer closes
# the read end while git still has output to write, git takes EPIPE and dies 141, and under
# `set -euo pipefail` the assignment kills this whole script before a single byte is printed or
# copied. Measured 2026-09-14 on the 45-worktree primary: 141 on 4 of 5 runs, 0 bytes of output; a
# FRESH task worktree then ended up with node_modules linked but no .quay/config.yml ("Cannot find
# repo root: no .quay/config.yml found upward"), while dispatch-worktree-setup.sh reported only a
# bare one-line "failed" — mechanism claiming to have provisioned, having copied nothing.
PRIMARY="$(mainCheckoutRoot "$WORKTREE" || true)"
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

if [ "$VERIFY" -eq 1 ]; then
  # Post-condition mode: copy nothing, report any declared file the worktree lacks.
  missing=0
  total=0
  while IFS= read -r -d '' rel; do
    case "$rel" in
      node_modules/*|*/node_modules/*) continue ;;
    esac
    total=$((total + 1))
    if [ -e "$WORKTREE/$rel" ] || [ -L "$WORKTREE/$rel" ]; then
      echo "worktree-include: present $rel"
    else
      echo "worktree-include: MISSING $rel (should be at $WORKTREE/$rel)" >&2
      missing=$((missing + 1))
    fi
  done < <(comm -z -12 "$SCRATCH/gitignored" "$SCRATCH/declared")

  if [ "$missing" -gt 0 ]; then
    echo "worktree-include: verify FAILED — $missing of $total declared file(s) absent from $WORKTREE" >&2
    exit 1
  fi
  echo "worktree-include: verify OK — all $total declared file(s) present in $WORKTREE"
  exit 0
fi

copied=0
failed=0
while IFS= read -r -d '' rel; do
  case "$rel" in
    node_modules/*|*/node_modules/*) continue ;;
  esac
  src="$PRIMARY/$rel"
  if [ ! -e "$src" ] && [ ! -L "$src" ]; then
    echo "worktree-include: skip missing (declared but not on disk): $rel" >&2
    continue
  fi
  # Per-file failure handling rather than letting `set -e` kill the loop on the FIRST bad file:
  # one failure must not hide the others, and the caller needs the complete list (hard rule 3:
  # 枚举，不布尔).
  if ! mkdir -p "$WORKTREE/$(dirname "$rel")"; then
    echo "worktree-include: FAILED to create $WORKTREE/$(dirname "$rel") (needed for $rel)" >&2
    failed=$((failed + 1))
    continue
  fi
  if ! cp -p "$src" "$WORKTREE/$rel"; then
    echo "worktree-include: FAILED to copy $rel -> $WORKTREE/$rel" >&2
    failed=$((failed + 1))
    continue
  fi
  echo "worktree-include: copied $rel -> $WORKTREE/$rel"
  copied=$((copied + 1))
done < <(comm -z -12 "$SCRATCH/gitignored" "$SCRATCH/declared")

# Post-condition, read BACK FROM DISK — not the copy's exit status, not a re-read of our own
# progress lines. Every file the declaration expects must now be present in the worktree. This is
# what lets `dispatch-worktree-setup.sh` treat "exit 0" as provisioning: a copy that reported
# success (or a copy loop that never ran) cannot pass this. It reuses the SAME already-computed
# sets, so it costs one extra cheap iteration, not a second full matcher pass.
absent=0
while IFS= read -r -d '' rel; do
  case "$rel" in
    node_modules/*|*/node_modules/*) continue ;;
  esac
  if [ ! -e "$WORKTREE/$rel" ] && [ ! -L "$WORKTREE/$rel" ]; then
    echo "worktree-include: FAILED to land $rel (expected at $WORKTREE/$rel)" >&2
    absent=$((absent + 1))
  fi
done < <(comm -z -12 "$SCRATCH/gitignored" "$SCRATCH/declared")

if [ "$failed" -gt 0 ] || [ "$absent" -gt 0 ]; then
  echo "worktree-include: error: $failed copy failure(s), $absent expected file(s) absent from $WORKTREE" >&2
  exit 1
fi

if [ "$copied" -eq 0 ]; then
  echo "worktree-include: nothing to copy (0 files declared AND gitignored)"
fi
echo "worktree-include: done — $copied file(s) copied into $WORKTREE"
