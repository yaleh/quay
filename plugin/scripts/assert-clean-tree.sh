#!/usr/bin/env bash
# assert-clean-tree.sh — the suite-AFTER assertion: after a FULL-SUITE run, `git status --porcelain`
# in the shared checkout must be empty.
#
# gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree (2026-08-03): a test mkdtemp'd at
# path.join(REPO_ROOT, ".quay-tmp-test-") every run, leaving a unique-named dir in the repo root —
# dirtying the working tree (restart-readiness-check.sh's clean-tree check false-failed mid-suite)
# and getting swept into `git add -A` commits. Neither R1 (`.quay-tmp` is not `.tmp`) nor R7 (the
# repo root is not a LIVE data dir) saw it; the static detector's new R8 (shared-root-mkdtemp)
# covers the mkdtemp-root-in-the-shared-checkout CLASS, but this assertion is HARDER than any
# static rule: it does not depend on the detector recognizing a particular spelling — a test that
# dirties the tree by ANY mechanism (a write to a fixed path, a leaked scratch dir, a stray file)
# fails here, so the tree can never go back to being dirty-after-suite while the rule only sees one
# specimen of the class.
#
# Wired into scripts/test.sh's FULL-SUITE DEFAULT path only (run_selected's token-held branch),
# after node --test completes. Scoped runs (explicit files / --for-task / --group subset) do NOT
# assert — they are the verification path that legitimately runs inside an uncommitted worktree,
# and the full suite (which the coordinator runs on a clean tree) is where the guarantee is owed.
# gitignored artifacts (dist/, .quay/gate-events.jsonl, .workflow-events/, tmp/) are invisible to
# `git status --porcelain` by default, so a normal suite's legitimate build output does not trip it.
#
# KNOWN CONCURRENT WRITERS (gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion,
# 2026-08-07): the assertion must distinguish TEST RESIDUE from LEGITIMATE out-of-band writers that
# can dirty the tree WHILE the suite runs. The manager's periodic tick-log append (~20min cadence)
# overlaps a ~39min suite every time, and the outer's capture-pane scratch
# (`tmux capture-pane -p > .quay/last-pane.txt`) is documented tick output — neither is a test
# artifact, and a green suite must not be flipped red for them (AC1). These are filtered OUT of the
# porcelain before deciding; what REMAINS is test residue and still fails (AC2 negative control).
# Workspaces with different known writers extend the filter via ASSERT_CLEAN_TREE_EXCLUDES (a
# `|`-joined egrep pattern, matched against porcelain lines).
#
# Usage:
#   assert-clean-tree.sh <workspace-root>
#
# Exit: 0 = working tree clean (no test residue); 1 = dirty with test residue
#       (or git unavailable / not a git repo — fail closed).

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <workspace-root>" >&2
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

dirty="$(git status --porcelain)"

# Filter OUT known concurrent writers — see the header comment. The filter matches porcelain lines
# (2 status chars + space + path), so it covers every status column for the known paths:
#   - `^.. \.quay/`                          any path under .quay/ (untracked scratch like
#                                            last-pane.txt, or tracked coordination state) — the
#                                            control-plane dir is never a test target
#   - `^.. orchestration/manager-tick-log\.md$`  the manager's tracked tick-log it legitimately
#                                            appends mid-suite
# What REMAINS after the filter is test residue and still FAILS (AC2 negative control: a root-level
# mkdtemp residue like `?? .quay-tmp-test-*` is NOT under .quay/ and is NOT the manager's file).
exclude_regex='^.. \.quay/|^.. orchestration/manager-tick-log\.md$'
if [ -n "${ASSERT_CLEAN_TREE_EXCLUDES:-}" ]; then
  exclude_regex="${exclude_regex}|${ASSERT_CLEAN_TREE_EXCLUDES}"
fi
residue="$(printf '%s\n' "$dirty" | grep -vE "${exclude_regex}" || true)"
excluded="$(printf '%s\n' "$dirty" | grep -E "${exclude_regex}" || true)"

if [ -n "$residue" ]; then
  echo "FAIL: the working tree is DIRTY after the full suite — a test left an artifact in the shared checkout:" >&2
  printf '%s\n' "$residue" >&2
  echo "This is the suite-after assertion (gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree):" >&2
  echo "a test must never write into the shared checkout. Fix the test (mkdtemp under os.tmpdir())." >&2
  exit 1
fi

if [ -n "$excluded" ]; then
  n="$(printf '%s\n' "$excluded" | grep -c . || true)"
  word="entries"; [ "${n}" = "1" ] && word="entry"
  echo "PASS: no test residue after the full suite (clean-tree assertion; excluded ${n} known concurrent-writer ${word}:"
  echo "      manager tick-log append / .quay control-plane scratch — gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion)"
  printf '%s\n' "$excluded" | sed 's/^/      /'
else
  echo "PASS: git status --porcelain is empty after the full suite (clean-tree assertion)"
fi
exit 0
