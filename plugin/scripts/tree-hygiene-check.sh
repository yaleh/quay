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
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
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

if [ -z "$scratch" ]; then
  echo "tree-hygiene: clean — no un-gitignored scratch left in the main tree."
  exit 0
else
  echo "tree-hygiene: FAIL — un-gitignored scratch left in the main tree (gitignore the pattern, or"
  echo "              generate it inside a worktree — never leave it untracked on master):"
  echo "$scratch" | sed 's/^/  /'
  exit 1
fi
