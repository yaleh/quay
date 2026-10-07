#!/usr/bin/env bash
# quay-init.sh — RETIRED entry point, kept as a SHIM for one release (GOAL-029 / AC-332).
# The init ENGINE is `quay init` (packages/quay/src/init.ts). This script used to be a second,
# ~1300-line writer of the same closed set — a second writer is a second drift source (硬规则 5b).
# It now only translates the retired shell flags onto the CLI and execs it.
#   --all/--loop/--manager/--workflows/--agents  were no-ops (all converged on one closed set) ⇒
#       dropped with a notice.
#   --force / --reconcile  were removed with GOAL-029: the target's STATE decides (absent ⇒ write,
#       parseable ⇒ upgrade in place, unreadable ⇒ rebuild with the broken bytes preserved beside
#       it). Passing either is a hard error, never a silent reinterpretation (硬规则 3b).
set -euo pipefail

# <plugin-root> keeps the old precedence: $CLAUDE_PLUGIN_ROOT first (the host does not inject it for
# a Skill's Bash call), else this file's own dir/.. — following symlinks so a cache copy works.
plugin_root="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$plugin_root" ]; then
  self="${BASH_SOURCE[0]}"
  while [ -L "$self" ]; do
    dir="$(cd -P "$(dirname "$self")" && pwd)"; link="$(readlink "$self")"
    case "$link" in /*) self="$link" ;; *) self="${dir}/${link}" ;; esac
  done
  plugin_root="$(cd -P "$(dirname "$self")/.." && pwd)"
fi

argv=(); have_root=false
while [ $# -gt 0 ]; do
  case "$1" in
    --all|--loop|--manager|--workflows|--agents)
      printf 'quay-init.sh: %s is retired and ignored — `quay init` always lays the same closed set.\n' "$1" >&2; shift ;;
    --force|--reconcile)
      printf 'quay-init.sh: %s was removed (GOAL-029) — the target config STATE decides. Nothing was written.\n' "$1" >&2; exit 2 ;;
    --plugin-root) have_root=true; argv+=("$1" "$2"); shift 2 ;;
    *) argv+=("$1"); shift ;;
  esac
done
[ "$have_root" = true ] || argv+=(--plugin-root "$plugin_root")

exec "${plugin_root}/bin/quay" init "${argv[@]}"
