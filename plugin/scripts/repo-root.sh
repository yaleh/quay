#!/usr/bin/env bash
# repo-root.sh — single bash counterpart of repo-root.ts (SPEC §2.4 B2: repo-root unified,
# bash+TS pair). Sources a `repoRoot` function that resolves the quay repo/workspace root by
# walking upward from a start dir, mirroring repo-root.ts's marker set exactly:
#
#   - BUNDLE root   (quay's own repo or a task worktree): package.json + plugin/ + scripts/test.sh
#   - CONSUMER root (a quay-init --loop target):          package.json + .quay/config.yml
#   - plain git root (any repo without quay's layout):    .git (directory OR worktree file)
# Fallbacks (in order): `git rev-parse --show-toplevel`, then `pwd -P`.
#
# Usage (source, then call):
#   . "$(dirname "${BASH_SOURCE[0]}")/repo-root.sh"
#   ROOT="$(repoRoot)"                # from repo-root.sh's own directory
#   ROOT="$(repoRoot "$some_dir")"    # from an arbitrary start dir
#
# It is also directly executable (`bash repo-root.sh [dir]` prints the root), but the intended
# use is sourcing — so this file deliberately sets NO `set -e/-u` of its own (it is a library).

_REPO_ROOT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || dirname "${BASH_SOURCE[0]}")"

repoRoot() {
  local dir="${1:-$_REPO_ROOT_SCRIPT_DIR}"
  # Canonicalize (absolute) without changing the caller's cwd; keep the raw value on failure.
  local canon
  canon="$(cd "$dir" 2>/dev/null && pwd -P)" && dir="$canon" || dir="$(cd "$(dirname "$dir")" 2>/dev/null && pwd -P)/$(basename "$dir")"

  local i
  for ((i = 0; i < 16; i++)); do
    if [ -f "$dir/package.json" ] && [ -d "$dir/plugin" ] && [ -f "$dir/scripts/test.sh" ]; then
      printf '%s\n' "$dir"; return 0
    fi
    if [ -f "$dir/package.json" ] && [ -f "$dir/.quay/config.yml" ]; then
      printf '%s\n' "$dir"; return 0
    fi
    if [ -e "$dir/.git" ]; then
      printf '%s\n' "$dir"; return 0
    fi
    [ "$dir" = "/" ] && break
    dir="$(dirname "$dir")"
  done

  local toplevel
  if toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$toplevel" ]; then
    printf '%s\n' "$toplevel"; return 0
  fi
  pwd -P
}

# Direct-execution convenience: print the root for `bash repo-root.sh [dir]`.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  repoRoot "${1:-}"
fi
