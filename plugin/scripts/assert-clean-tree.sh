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
# Usage:
#   assert-clean-tree.sh <workspace-root>
#
# Exit: 0 = working tree clean; 1 = dirty (or git unavailable / not a git repo — fail closed).
#
# ════════════════════════════════════════════════════════════════════════════════
# DISABLED 2026-08-07 (human ruling 17:1x — gap-assert-clean-tree-premise-void-under-
# concurrent-writers; disable, NOT delete): the FULL-SUITE path in scripts/test.sh NO LONGER
# CALLS this script, so a dirty shared checkout can no longer flip a passing run red. The
# premise — the coordinator runs on a clean tree — is VOID under three concurrent writers
# (manager tick-log append / outer worktree scaffolding / inner uncommitted change) that
# produced three false reds (r4/r5/r6) and a mis-cleaning config cascade. The code is kept so
# it can be re-enabled; the delta form (--snapshot before / --check after, commit 174badc0 on
# integration) is retained as the correct shape for the restore path.
#
# RE-ENABLE CONDITION: 当验证 worktree 运行期单写入者达成（git worktree lock）时重新接回。
# Reconnect this suite-after assertion once the verification worktree achieves runtime
# SINGLE-WRITER via `git worktree lock` — i.e. the coordinator is the SOLE writer to the tree it
# asserts on, so a dirty tree after the suite is genuinely a test product, not a concurrent
# writer's uncommitted state. Until that condition is met, the negative-control leak-catch
# (catching a test that writes into the verification tree) is TEMPORARILY ABSENT — a known
# trade-off (AC4); tmux-leak-scan.sh still catches the tmux leak class.
#
# NOTE (gap-verifiedcommit-dirty-tree-false-certificate, 2026-08-13): the suite-AFTER assertion
# STAYS DISABLED, but this script now has a SECOND, live caller in a DIFFERENT role — the
# round-START dirty DETECTOR in plugin/scripts/full-suite-runner.ts's readTreeState(). It invokes
# the ABSOLUTE mode (`bash assert-clean-tree.sh <root>`: exit 0 = clean, exit 1 = dirty) at round
# start to feed the round record's `treeDirty` flag (incl. untracked) + `tree` hash — an
# ANNOTATION (fail-open: any status other than 1 degrades to no-detection), NEVER a green/red
# criterion. This re-enables the script's reference count (0 → live caller) WITHOUT reconnecting
# the suite-after gate that the 17:1x ruling disabled.
# ════════════════════════════════════════════════════════════════════════════════

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
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
