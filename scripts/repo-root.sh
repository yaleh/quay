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

# mainCheckoutRoot — the order-independent main-checkout derivation (bash mirror of repo-root.ts's
# mainCheckoutRoot; gap-refresh-worktree-quay-main-derive + gap-main-checkout-root-derivation-
# recurs-three-sites). The main checkout is the PARENT of the repo's shared .git dir
# (`git rev-parse --git-common-dir`), NOT the first `git worktree list --porcelain` entry — that
# list's order does NOT guarantee the main working tree first. Prints the absolute main-checkout
# path; returns 1 (prints nothing) when the dir is not a git repo / unresolvable (callers apply
# their own fallback).
mainCheckoutRoot() {
  local dir="${1:-$_REPO_ROOT_SCRIPT_DIR}"
  local common_dir=""
  common_dir="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  if [ -z "$common_dir" ]; then
    # git < 2.31 has no --path-format: --git-common-dir may return a path RELATIVE to $dir.
    common_dir="$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null)"
    case "$common_dir" in
      /*) ;;
      *) [ -n "$common_dir" ] && common_dir="$dir/$common_dir" ;;
    esac
  fi
  [ -n "$common_dir" ] || return 1
  local main=""
  main="$(cd "$(dirname "$common_dir")" 2>/dev/null && pwd -P)"
  [ -n "$main" ] || return 1
  printf '%s\n' "$main"
}

# Direct-execution convenience: print the root for `bash repo-root.sh [dir]`.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  repoRoot "${1:-}"
fi
