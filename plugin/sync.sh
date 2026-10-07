#!/usr/bin/env bash
# plugin/sync.sh — sync canonical assets into the plugin distribution directory.
# Run from repo root. Idempotent (overwrites on each run).
#
# This keeps plugin/ assets in sync with their canonical sources:
#   .claude/workflows/                      → plugin/workflows/
#   (agents vendoring handled separately — see Phase 3)
#
# NOTE (2026-08-05 retirement): plugin/gate-scripts/ is NO LONGER synced. Those classic-pipeline
# era gates were laid into target projects but nothing called them — dead weight (layered
# retirement; the files stay in the plugin tree as a historical artifact, not in the distribution).
# The live fast-mode gate scripts live under plugin/scripts/ and are laid down by quay-init --loop.
#
# CI: sync.sh && git diff --exit-code plugin/  — fails if plugin is stale.
#
# USER-SCOPE INSTALL SECTION (gap-user-scope-install-reinstall-criterion-and-version, AC1-AC3):
# The DEFAULT (no-flag) mode above is the canonical→plugin/ ASSET sync. The plugin→user-scope
# INSTALL half (the missing back half this task fills) is a set of opt-in modes:
#
#   --install-user-scope <dest>
#       Copy the plugin tree into a user-scope install location (e.g.
#       ~/.local/share/quay-plugin/ — where Claude Code's own /plugin install puts it) and stamp
#       <dest>/VERSION. This is the "plugin→user-scope 安装段" — the thing that previously only
#       existed as the canonical→plugin/ direction (AC1: the installed copy is now version-marked).
#
#   --check-user-scope <dest>
#       Compare <dest>/VERSION against this plugin's own plugin/VERSION. If the installed copy is
#       BEHIND — or carries NO VERSION marker (a pre-fix install, the exact 06:01 stale-install
#       negative control) — print a STALE warning ("你装的这份落后了", "your installed copy is
#       stale") and exit 1. When current, print fresh and exit 0 (AC2: negative control is that
#       BEFORE this check nothing reported the stale install at all).
#
#   --reinstall-criterion <desc>...
#       Classify change descriptions by capability boundary (AC3). capability-add / security-fix /
#       inherited-defect trigger REINSTALL-IMMEDIATE; anything else is BATCHABLE (can accumulate
#       until an immediate class arrives).
#
# VERSION single-source note: plugin/VERSION marks the plugin version and MUST be bumped whenever
# the plugin version bumps (packages/quay/package.json, plugin/vendor/quay/package.json,
# plugin/.mcp.json). The user-scope-reinstall test asserts plugin/VERSION == the vendored
# package.json version, so a drift fails loudly in the suite.

set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"
VERSION_FILE="$PLUGIN_DIR/VERSION"

# ---------------------------------------------------------------------------
# Version helpers (AC1 — the comparison primitive)
# ---------------------------------------------------------------------------

# version_components <ver> -> whitespace-separated numeric components ("0.4.0" -> "0 4 0").
# Pre-release suffixes ("0.4.0-beta") collapse to their numeric prefix; fine for the
# behind/ahead decision the user-scope check needs.
version_components() {
  echo "$1" | tr -c '0-9' ' ' | sed 's/  */ /g; s/^ //; s/ $//'
}

# version_lt <a> <b> — true (exit 0) when semver-ish <a> is strictly older than <b>.
version_lt() {
  local -a a b
  read -r -a a <<< "$(version_components "$1")"
  read -r -a b <<< "$(version_components "$2")"
  local i
  for ((i = 0; i < ${#a[@]} && i < ${#b[@]}; i++)); do
    if [ "${a[$i]}" -lt "${b[$i]}" ]; then return 0; fi
    if [ "${a[$i]}" -gt "${b[$i]}" ]; then return 1; fi
  done
  [ "${#a[@]}" -lt "${#b[@]}" ]
}

# current_plugin_version — the version stamp of THIS plugin tree (plugin/VERSION, first line).
current_plugin_version() {
  local v
  v="$(head -n1 "$VERSION_FILE" 2>/dev/null | tr -d '[:space:]' || true)"
  echo "$v"
}

# ---------------------------------------------------------------------------
# User-scope install (AC1) + staleness check (AC2)
# ---------------------------------------------------------------------------

# install_user_scope <dest> — copy the plugin tree into a user-scope location and stamp VERSION.
install_user_scope() {
  local dest="${1:-}"
  if [ -z "$dest" ]; then
    echo "ERROR: --install-user-scope <dest> requires a destination directory" >&2
    return 2
  fi
  local dest_real plugin_real
  dest_real="$(cd "$dest" 2>/dev/null && pwd || echo "$dest")"
  plugin_real="$(cd "$PLUGIN_DIR" && pwd)"
  case "$dest_real" in
    "$plugin_real"|"$plugin_real"/*)
      echo "ERROR: destination must not be inside the plugin directory (recursion guard): $dest" >&2
      return 2 ;;
  esac
  mkdir -p "$dest"
  # Copy the distribution-relevant plugin subtree (skills/scripts/workflows/agents/vendor/VERSION),
  # excluding tests and fixtures — those are development artifacts, not distributed.
  if tar -C "$PLUGIN_DIR" --exclude='./test' --exclude='./fixtures' --exclude='./.git' \
      -cf - . 2>/dev/null | tar -C "$dest" -xf - 2>/dev/null; then
    :
  else
    # tar unavailable/failed → plain cp fallback.
    # `bin` is in this list for the same reason the tar branch above carries it implicitly:
    # plugin/bin/quay is the plugin form's CLI entry point (gap-ac261-plugin-bin-shim-missing-
    # so-cli-needs-npm-global), and an enumeration that omits it installs a plugin whose CLI
    # silently disappears. Keep this list in sync with the tar branch, which copies the whole tree.
    for d in bin skills scripts workflows agents vendor probes loop; do
      [ -d "$PLUGIN_DIR/$d" ] && cp -r "$PLUGIN_DIR/$d" "$dest/"
    done
    cp "$PLUGIN_DIR/README.md" "$dest/" 2>/dev/null || true
    cp -r "$PLUGIN_DIR/.claude-plugin" "$dest/" 2>/dev/null || true
    cp "$PLUGIN_DIR/.mcp.json" "$dest/" 2>/dev/null || true
  fi
  cp "$VERSION_FILE" "$dest/VERSION"
  echo "  installed user-scope plugin -> $dest (VERSION $(current_plugin_version))"
  return 0
}

# check_user_scope <dest> — is the installed user-scope copy current? Exit 1 + STALE warning when
# behind (or unverifiable: no VERSION marker). Exit 0 when fresh. The STALE message carries BOTH
# the lowercase "stale" token and "落后" so the Contract measure grep ('落后\|stale') counts it.
check_user_scope() {
  local dest="${1:-}"
  if [ -z "$dest" ]; then
    dest="${HOME:-}/.local/share/quay-plugin"
  fi
  if [ ! -d "$dest" ]; then
    echo "  NOT-INSTALLED (user-scope plugin install): $dest does not exist. Nothing to compare — install the plugin first." >&2
    return 0
  fi
  local installed current
  current="$(current_plugin_version)"
  if [ ! -f "$dest/VERSION" ]; then
    echo "  STALE (user-scope plugin install): $dest has no VERSION marker (a pre-${current} install). 你装的这份落后了——your installed copy is stale — reinstall the plugin (see --reinstall-criterion)." >&2
    return 1
  fi
  installed="$(head -n1 "$dest/VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -z "$installed" ]; then
    echo "  STALE (user-scope plugin install): $dest/VERSION is empty — cannot verify the copy is current. 你装的这份落后了——your installed copy is stale — reinstall the plugin." >&2
    return 1
  fi
  if version_lt "$installed" "$current"; then
    echo "  STALE (user-scope plugin install): installed VERSION ${installed} < current plugin VERSION ${current}. 你装的这份落后了——your installed copy is stale — reinstall the plugin (see --reinstall-criterion)." >&2
    return 1
  fi
  if [ "$installed" != "$current" ]; then
    echo "  NOTE (user-scope plugin install): installed VERSION ${installed} != current ${current} (ahead or pre-release). Not stale." >&2
    return 0
  fi
  echo "  fresh (user-scope plugin install): installed VERSION ${installed} == current ${current}."
  return 0
}

# ---------------------------------------------------------------------------
# Reinstall criterion (AC3) — keyed by capability boundary, not time
# ---------------------------------------------------------------------------
# Three classes trigger REINSTALL-IMMEDIATE; everything else BATCHABLE (can accumulate):
#   ① capability-add (能力新增)   — a new capability the installed copy silently lacks:
#                                   new skill / new loop doc / new quay-init laydown item.
#   ② security-fix (安全修复)     — a crash cause or resource-safety fix.
#   ③ inherited-defect (遗传缺陷) — a reproduction-fidelity fix (dist / mcp_entry / version
#                                   marker): not reinstalling passes the bad gene to the next adopter.
# Descriptors may carry an explicit tag ([capability-add] / [security-fix] / [inherited-defect]) or
# be detected by keyword. The keyword matcher is CONSERVATIVE (false positives lean toward an
# immediate reinstall, which is the safe direction — AC3's "三类立即, 其余可攒").
reinstall_criterion() {
  local immediate=0 desc
  for desc in "$@"; do
    case "$desc" in
      *capability-add*|*新能力*|*新增*skill*|*new\ skill*|*新\ skill*|*新\ loop*|*铺设项*)
        echo "  IMMEDIATE: capability-add — $desc"
        immediate=1 ;;
      *security-fix*|*安全修复*|*崩溃*|*crash*|*资源安全*|*resource-safety*|*security*)
        echo "  IMMEDIATE: security-fix — $desc"
        immediate=1 ;;
      *inherited-defect*|*遗传*|*繁殖保真*|*dist*|*mcp_entry*|*版本标记*|*VERSION*)
        echo "  IMMEDIATE: inherited-defect — $desc"
        immediate=1 ;;
      *)
        echo "  batchable: $desc" ;;
    esac
  done
  if [ "$immediate" = 1 ]; then
    echo "REINSTALL-IMMEDIATE"
  else
    echo "BATCHABLE"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Arg parsing: opt-in modes are mutually exclusive; the default (no flags) is the
# canonical→plugin/ asset sync below (CI: sync.sh && git diff --exit-code plugin/).
# ---------------------------------------------------------------------------
INSTALL_USER_SCOPE=false
CHECK_USER_SCOPE=false
REINSTALL_CRITERION=false
MODE_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --install-user-scope) INSTALL_USER_SCOPE=true ;;
    --check-user-scope)   CHECK_USER_SCOPE=true ;;
    --reinstall-criterion) REINSTALL_CRITERION=true ;;
    *) MODE_ARGS+=("$arg") ;;
  esac
done

if [ "$INSTALL_USER_SCOPE" = true ]; then
  install_user_scope "${MODE_ARGS[0]:-}"
  exit $?
fi
if [ "$CHECK_USER_SCOPE" = true ]; then
  check_user_scope "${MODE_ARGS[0]:-}" || exit $?
  exit 0
fi
if [ "$REINSTALL_CRITERION" = true ]; then
  reinstall_criterion "${MODE_ARGS[@]}"
  exit 0
fi

echo "=== Syncing workflows ==="
# AC91 (gap-ac91-delivery-core-refs-undelivered-files): the distribution mirror must carry EVERY
# workflow the delivered execution cores reference — drain-directives / run-routines (the routine
# track) plus fan-in-execute / pool-quality-judge (named by the shipped orchestrator-tick-core.md /
# fast-mode-tick-core.md). A workflow in .claude/workflows/ that is NOT mirrored here ships to no
# target (quay-init --workflows copies plugin/workflows/ verbatim).
cp "$REPO_ROOT/.claude/workflows/drain-directives.js"   "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/run-routines.js"       "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/fan-in-execute.js"     "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/pool-quality-judge.js" "$PLUGIN_DIR/workflows/"
# NOTE (gap-retire-the-prepare-execute-pipeline-cluster): execute-milestone.js and
# prepare-milestone.js were retired with the classic milestone loop (ADR-022).
# NOTE (2026-10-07): the standalone A15 ④ suite-fix workflow was DELETED (zero production callers;
# its fix-scope gate + relaunch-snapshot semantics live in fan-in-execute.js' inline suite-fix
# prompt) — it is no longer mirrored here.
echo "  workflows: 4 synced"

echo "Sync complete."
