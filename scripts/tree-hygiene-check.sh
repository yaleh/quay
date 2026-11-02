#!/usr/bin/env bash
# tree-hygiene-check.sh — Tier-1 loop hygiene (DIR-031). Since DIR-027 runs the outer loop directly
# on `master` in the main working tree, that tree must stay CLEAN between the loop's atomic commits —
# otherwise out-of-band human work cannot slot in without racing (as happened twice landing ADR-012).
# This is the mechanical half (ADR-011: a rule ships with its enforcement): assert the main tree
# carries NO un-gitignored SCRATCH — backup / temp / tool-output files the loop's own steps generate
# (e.g. the L_S mutation proxy's `*.l-s-backup`). Operational script (not load-bearing method-infra
# imported by other code), so a .sh.
#
# Exit 0 = clean (no un-gitignored scratch). Exit 1 = scratch leaked into the tree (listed) —
# gitignore the pattern, or generate it inside a worktree, never leave it untracked on master.
# NOTE: this flags only KNOWN SCRATCH patterns, never ordinary new source/task files (those are the
# loop's real, to-be-committed work — a separate "clean between steps" discipline, DIR-031 item 2).
#
# Usage:  plugin/scripts/tree-hygiene-check.sh
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u
# ⛔ `dirname "$0"` alone is NOT enough once this file is mirrored by a symlink. A mirror call
# (a copy under a deeper `experiments/**/scripts/` tree, symlinked back to this file by the relative
# path `../../../plugin/scripts/<name>.sh`) would derive HERE = the MIRROR's directory and therefore
# ROOT = `<repo>/experiments` — a DIFFERENT, wrong tree that this gate would then silently inspect,
# reporting PASS in the same shape as a real pass. Resolve through the link FIRST so both call paths
# derive the SAME root: the real file lives at `<repo>/plugin/scripts/`, so `../..` is the repo root
# either way. Guarded — if resolution fails we fall back to the literal path rather than yielding an
# empty ROOT (the mirror dirs also contain dangling links, so a bare `readlink -f` is not safe to
# trust).
SELF="${BASH_SOURCE[0]}"
SELF_REAL="$(readlink -f "$SELF" 2>/dev/null || true)"
[ -n "$SELF_REAL" ] || SELF_REAL="$SELF"
HERE="$(cd "$(dirname "$SELF_REAL")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
cd "$ROOT" || { echo "ERROR: cannot cd to repo root ($ROOT)" >&2; exit 1; }

# Scratch patterns the loop's proxies/tools are known to leave; extend as new ones appear.
scratch=$(git status --porcelain 2>/dev/null \
  | awk '/^\?\?/ {print $2}' \
  | grep -iE '\.(bak|orig|tmp|swp|swo|rej)$|\.l-[a-z]-backup$|[-.]backup$|~$|(^|/)\.mutation-backup(/|$)' \
  || true)

# ── Non-blocking WARN (source repo gap: gap-absorb-charter-audit-not-committed / M176) ──────────
# The milestone-execution pipeline creates two kinds of evidence file (charters + audit reports)
# that no pipeline step used to stage — in the source repo this accumulated as untracked cruft for
# months (16 charters + 19 audit files backlogged, swept once by hand) before this check existed.
# WARN only, never blocks: a fresh milestone's OWN evidence is legitimately untracked until its own
# Land step commits it — the pipeline's Land phase is the mechanical backstop for this.
evidence_untracked=$(git status --porcelain 2>/dev/null \
  | awk '/^\?\?/ {print $2}' \
  | grep -E '(^|/)charters/M[0-9]+-[^/]+\.md$|(^|/)milestones/M[0-9]+/(audits|iterations)/[^/]+\.md$' \
  || true)

if [ -n "$evidence_untracked" ]; then
  echo "tree-hygiene: WARN — untracked ABSORB-pipeline evidence file(s) (charter/audit/iteration)."
  echo "              Stage these as part of their milestone's own commit sequence (OUTER-LOOP.md"
  echo "              charter step / execute-milestone.js Land-phase CAPTURE) — non-blocking, but"
  echo "              left unaddressed these accumulate silently:"
  echo "$evidence_untracked" | sed 's/^/  /'
fi

# ── gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree (2026-07-31) ──────────
# prepare-milestone-convergence.test.mjs / prepare-milestone-preparation-e2e.test.mjs drive the
# REAL prepare-milestone.js workflow and can leave docs/plans/M9xxxxx-*.md / milestones/M9xxxxx/
# (and the M997 fixed-ID variant) orphans behind if the test process is killed before its own
# `finally { cleanup(...) }` runs. These are GITIGNORED (see .gitignore's own two blocks for the
# same two shapes) specifically so they never pollute `git status --porcelain`'s `??` output —
# which means the `scratch` check above, being git-status-based, has ZERO visibility into this
# class. Scan the filesystem directly instead (belt-and-suspenders: .gitignore is the primary
# fix, this is defense-in-depth visibility + a periodic-sweep prompt — the sweep-fixture-orphans
# cleanup mechanism in the source repo's scripts/ handles actual removal).
fixture_orphans=$( { \
    find "$ROOT/docs/plans" -maxdepth 1 -type f \( -regex '.*/M9[0-9][0-9][0-9][0-9][0-9]-.*\.md' -o -regex '.*/M997-.*\.md' \) 2>/dev/null; \
    find "$ROOT/milestones" -maxdepth 1 -type d \( -regex '.*/M9[0-9][0-9][0-9][0-9][0-9]' -o -regex '.*/M997' \) 2>/dev/null; \
  } | sed "s#^$ROOT/##" || true)

if [ -n "$fixture_orphans" ]; then
  echo "tree-hygiene: WARN — gitignored prepare-milestone.js test-fixture orphan(s) found on local"
  echo "              disk (docs/plans/M9xxxxx-*.md / milestones/M9xxxxx/ / the M997 fixed-ID"
  echo "              variant) — debris from a prior prepare-milestone-convergence.test.mjs or"
  echo "              prepare-milestone-preparation-e2e.test.mjs run killed before its own"
  echo "              cleanup ran. Non-blocking (already gitignored, cannot pollute the tracked"
  echo "              tree), but consumes disk/inodes indefinitely if left. Clear with the source"
  echo "              repo's sweep-fixture-orphans cleanup script (experiments/.../scripts/)."
  echo "$fixture_orphans" | sed 's/^/  /'
fi

if [ -z "$scratch" ]; then
  echo "tree-hygiene: clean — no un-gitignored scratch left in the main tree."
  exit 0
else
  echo "tree-hygiene: FAIL — un-gitignored scratch left in the main tree (gitignore the pattern, or"
  echo "              generate it inside a worktree — never leave it untracked on master):"
  echo "$scratch" | sed 's/^/  /'
  exit 1
fi
