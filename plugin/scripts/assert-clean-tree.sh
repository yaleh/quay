#!/usr/bin/env bash
# assert-clean-tree.sh — the suite-AFTER assertion, DELTA form: after a FULL-SUITE run, only items
# NEWLY ADDED to the working tree DURING the run count as this run's test products.
#
# Premise fix (gap-assert-clean-tree-premise-void-under-concurrent-writers, 2026-08-07): the old
# absolute form assumed the coordinator runs on a clean tree — a premise VOID under concurrent
# writers (the manager's tick-log append, the outer's worktree scaffolding, an inner agent's
# uncommitted change). The absolute form kept false-redding a green suite, and the 0e4eff84 /
# be0cca93 exclusion-table patches degraded the assertion's ONLY advantage: once it lists names it
# degrades into a static rule that only knows known spellings — the exact form R1/R7 failed with.
#
# DELTA mechanism (the task's ① direction; ② = runtime `git worktree lock` is the noted root cure
# for a future run-in-a-linked-worktree model — `git worktree lock` cannot lock the primary
# checkout, so it is not applicable to today's full suite which runs in the shared checkout):
#   --snapshot records `git status --porcelain` BEFORE the run (into a gitignored location);
#   --check compares AFTER — only items ABSENT from the snapshot count as new (test products).
# Preexisting dirt (a concurrent writer's legitimate before-the-run change) does NOT trigger.
# A genuinely new write (a test leaking an artifact into the shared checkout) still triggers — the
# negative control holds. No exclusion table is needed: the before-run snapshot replaces the list.
#
# Usage:
#   assert-clean-tree.sh --snapshot <workspace-root>   # record the before-run porcelain snapshot
#   assert-clean-tree.sh --check <workspace-root>      # delta: only items NOT in the snapshot count
#   assert-clean-tree.sh <workspace-root>              # absolute (historical): clean tree or fail
#
# Exit: 0 = pass; 1 = fail (new dirt / dirty tree / git unavailable / not a git repo — fail closed);
# 2 = usage error.

set -u

mode="absolute"
case "${1:-}" in
  --snapshot) mode="snapshot"; shift ;;
  --check)    mode="check";    shift ;;
esac

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--snapshot|--check] <workspace-root>" >&2
  exit 2
fi
root="$1"

if ! cd "$root" 2>/dev/null; then
  echo "FAIL: cannot cd to workspace root '$root'" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "FAIL: '$root' is not a git work tree — cannot assert a clean tree (fail closed)" >&2
  exit 1
fi

snapshot=".quay/assert-clean-tree.snapshot"

# normalize porcelain: sorted, non-empty lines (so `comm` compares deterministically)
porcelain_sorted() {
  git status --porcelain | grep -v '^$' | sort
}

if [ "$mode" = "snapshot" ]; then
  mkdir -p .quay
  porcelain_sorted > "$snapshot"
  echo "assert-clean-tree: before-run porcelain snapshot recorded ($(wc -l < "$snapshot") line(s) of pre-existing dirt in $snapshot)"
  exit 0
fi

if [ "$mode" = "check" ]; then
  if [ ! -f "$snapshot" ]; then
    echo "FAIL: no before-run snapshot found at $snapshot — cannot assert a DELTA clean tree." >&2
    echo "Run '$0 --snapshot <workspace-root>' before the suite (fail closed)." >&2
    exit 1
  fi
  before="$(cat "$snapshot")"
  after="$(git status --porcelain)"
  # new_items = entries in AFTER that were NOT in the before-run snapshot.
  new_items="$(comm -13 <(printf '%s\n' "$before" | grep -v '^$' | sort) <(printf '%s\n' "$after" | grep -v '^$' | sort))"
  rm -f "$snapshot"
  if [ -n "$new_items" ]; then
    echo "FAIL: the working tree is DIRTY after the full suite — a test added NEW artifact(s) to the shared checkout (delta vs the before-run snapshot):" >&2
    printf '%s\n' "$new_items" >&2
    echo "This is the suite-after DELTA assertion (gap-assert-clean-tree-premise-void-under-concurrent-writers):" >&2
    echo "only items not present in the before-run snapshot count as this run's test products; pre-existing dirt is excluded." >&2
    echo "Fix the test (mkdtemp under os.tmpdir()), not the snapshot." >&2
    exit 1
  fi
  echo "PASS: git status --porcelain gained no NEW items after the full suite (clean-tree DELTA assertion)"
  exit 0
fi

# absolute (historical) mode — the pre-delta form, kept for standalone use and the capability catalog.
dirty="$(git status --porcelain)"
if [ -n "$dirty" ]; then
  echo "FAIL: the working tree is DIRTY after the full suite — a test left an artifact in the shared checkout:" >&2
  printf '%s\n' "$dirty" >&2
  echo "This is the suite-after assertion (gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree):" >&2
  echo "a test must never write into the shared checkout. Fix the test (mkdtemp under os.tmpdir())." >&2
  exit 1
fi

echo "PASS: git status --porcelain is empty after the full suite (clean-tree assertion)"
exit 0
