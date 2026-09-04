#!/usr/bin/env bash
# Mutation case for worktree-node-modules-check (gap-worktree-node-modules-inconsistent-self-verify
# AC4): the defect is a dispatched task worktree whose node_modules is ABSENT — its scripts/test.sh
# build phase fails closed (Cannot find package esbuild) and verification silently falls back to the
# shared checkout where mutations land. This checker makes that state observable (report-only prints
# MISSING) and blockable (--fail exits 1). The case proves BOTH directions on a hermetic temp git
# repo with one registered task/* worktree:
#   GREEN baseline  — task worktree WITH node_modules → --fail exits 0 (nothing missing)
#   INJECT          — node_modules removed → --fail exits 1 AND report-only prints MISSING
#   RESTORE         — node_modules back → --fail exits 0 again
# A masking fix (or a checker that never reads node_modules) stays green forever and fails exit 3.
set -u
name="worktree-node-modules-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── hermetic temp git repo with ONE registered task worktree (branch task/fixture) ───────────────
repo="${workdir}/repo"
wt="${workdir}/wt"
git() { command git -C "$repo" "$@"; }
mkdir -p "$repo"
git init -q
git config user.email t@test
git config user.name t
printf '# repo\n' > "$repo/README.md"
git add -A
git commit -q -m baseline
git worktree add -q -b task/fixture "$wt" HEAD
mkdir -p "$wt/node_modules"

checker_fail() {
  bash "${checker_dir}/worktree-node-modules-check.sh" --root "$repo" --fail >/dev/null 2>&1
}
checker_report() {
  bash "${checker_dir}/worktree-node-modules-check.sh" --root "$repo"
}

# GREEN baseline: healthy task worktree → --fail exits 0.
if checker_fail; then :; else
  echo "baseline RED on a healthy task worktree (checker always-red?)" >&2
  exit 4
fi

# INJECT: remove node_modules → --fail MUST go red AND report-only MUST print MISSING.
rm -rf "$wt/node_modules"
if checker_fail; then
  echo "STAYED-GREEN — task worktree without node_modules did not redden --fail" >&2
  exit 3
fi
if ! checker_report | grep -q "MISSING"; then
  echo "STAYED-GREEN — report-only did not print MISSING for the absent node_modules" >&2
  exit 3
fi

# RESTORE: node_modules back → --fail GREEN again.
mkdir -p "$wt/node_modules"
if checker_fail; then :; else
  echo "ALWAYS-RED — restored healthy worktree still reddens the checker" >&2
  exit 4
fi

exit 0
