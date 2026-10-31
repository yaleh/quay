#!/usr/bin/env bash
# codex-mcp-sync.sh — the 方案 A sync mechanism for the Codex plugin's MCP server
# (gap-codex-plugin-mcp-json-nested-in-wrong-level). The human ruling (2026-10-31) is that the
# Codex plugin's `.mcp.json` `args[0]` is a STABLE, VERSION-INDEPENDENT absolute path
# `~/.local/share/quay/<dist>`, and the dist is installed SEPARATELY to that stable location
# (never embedded inside the plugin package), with an upgrade flow calling this script to keep it
# in sync with the current version.
#
# Two jobs, split so the publish flow can run only the install half (a publisher must NOT rewrite
# the committed, portable `.mcp.json` against its own `$HOME`):
#   1. INSTALL the current dist + the native provider + the kernel anchor to `~/.local/share/quay/`.
#   2. REWRITE the `~` prefix in a `.mcp.json`'s quay `args[0]` to the EXPANDED `$HOME` — codex
#      (and node, which codex spawns directly, not via a shell) does NOT expand `~` in args, so the
#      literal `~/.local/share/quay/…` committed in `.mcp.json` would ENOENT at spawn time. This is
#      the per-machine post-install step that turns the portable template into a runnable path.
#
# Usage: bash plugin/scripts/codex-mcp-sync.sh [--mcp-json <path>] [--install-only] [--dist-root <dir>]
#   --mcp-json <path>  the `.mcp.json` to rewrite `~` -> `$HOME` in (default: the codex package
#                      root's `.mcp.json`, found by walking up to `.codex-plugin/plugin.json`)
#   --install-only     install the dist but do NOT rewrite any `.mcp.json` (the publish flow's mode)
#   --dist-root <dir>  install the dist from THIS tree (vendor/quay/dist/quay.js + native + kernel
#                      anchor live under <dir>) instead of walking up from this script's own location —
#                      the publish flow passes the assembled artifact root so the freshly-published
#                      dist is installed, never a possibly-stale source checkout

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [--mcp-json <path>] [--install-only] [--dist-root <dir>]"; fi
  exit 0
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

MCP_JSON=""
INSTALL_ONLY=false
DIST_ROOT_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mcp-json) MCP_JSON="$2"; shift 2 ;;
    --install-only) INSTALL_ONLY=true; shift ;;
    --dist-root) DIST_ROOT_OVERRIDE="$2"; shift 2 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── Resolve the DIST root (contains vendor/quay/dist/quay.js) and the CODEX package root (contains
#    .codex-plugin/plugin.json) by walking up from this script. The SOURCE repo nests them
#    (repo/plugin and repo/), while the ASSEMBLED artifact flattens them (both at the artifact root);
#    the walk-up handles both without hardcoding a level count. An explicit --dist-root OVERRIDES the
#    walk-up (gap-codex-mcp-sync-installs-stale-main-checkout-dist): the publish flow must install the
#    freshly-assembled artifact's dist, ⛔ never a possibly-stale source checkout's walk-up result. ──
DIST_ROOT=""
CODEX_ROOT=""
if [ -n "$DIST_ROOT_OVERRIDE" ]; then
  if [ ! -d "$DIST_ROOT_OVERRIDE" ]; then
    echo "ERROR: --dist-root is not a directory: ${DIST_ROOT_OVERRIDE}" >&2
    exit 2
  fi
  DIST_ROOT="$DIST_ROOT_OVERRIDE"
fi
_dir="$SCRIPT_DIR"
while [ "$_dir" != "/" ] && [ "$_dir" != "." ]; do
  if [ -z "$DIST_ROOT" ] && [ -s "$_dir/vendor/quay/dist/quay.js" ]; then DIST_ROOT="$_dir"; fi
  if [ -z "$CODEX_ROOT" ] && [ -s "$_dir/.codex-plugin/plugin.json" ]; then CODEX_ROOT="$_dir"; fi
  if [ -n "$DIST_ROOT" ] && [ -n "$CODEX_ROOT" ]; then break; fi
  _dir="$(dirname "$_dir")"
done

# ── Fail-closed: refuse to sync from a tree that has no built dist (硬规则 3b — "no dist to copy"
#    must never be indistinguishable from "copied"). ─────────────────────────────────────────────
CORE_DIST="${DIST_ROOT}/vendor/quay/dist/quay.js"
NATIVE_DIST="${DIST_ROOT}/vendor/quay-native/dist/quay-native.js"
for _src in "$CORE_DIST" "$NATIVE_DIST"; do
  if [ ! -s "$_src" ]; then
    echo "ERROR: ${_src} missing or empty — build the plugin first (bash plugin/scripts/sync-vendor.sh)." >&2
    exit 1
  fi
done

DEST="${HOME}/.local/share/quay"
mkdir -p "${DEST}/vendor/quay-native/dist" "${DEST}/scripts/dist"

cp "$CORE_DIST" "${DEST}/quay.js"
cp "$NATIVE_DIST" "${DEST}/vendor/quay-native/dist/quay-native.js"

# The kernel anchor that lets Core's resolvePluginRoot() recognize the stable location as a plugin
# root (so the native provider's default entry resolves from there). The bundled form ships in the
# published artifact (raw .ts is stripped); the raw form is the dev-tree fallback. Either satisfies
# the anchor probe (plugin-root.ts KERNEL_RELS).
KERNEL_BUNDLED="${DIST_ROOT}/scripts/dist/driver-runtime.js"
KERNEL_RAW="${DIST_ROOT}/scripts/driver-runtime.ts"
if [ -s "$KERNEL_BUNDLED" ]; then
  cp "$KERNEL_BUNDLED" "${DEST}/scripts/dist/driver-runtime.js"
elif [ -s "$KERNEL_RAW" ]; then
  cp "$KERNEL_RAW" "${DEST}/scripts/driver-runtime.ts"
else
  echo "ERROR: no kernel anchor found (${KERNEL_BUNDLED} or ${KERNEL_RAW}) — refusing to sync a plugin root Core cannot recognize." >&2
  exit 1
fi

echo "[codex-mcp-sync] installed dist to ${DEST}:"
ls -la "${DEST}" "${DEST}/vendor/quay-native/dist" "${DEST}/scripts/dist" 2>/dev/null

# ── The per-machine rewrite: expand `~` -> $HOME in args[0] so codex's direct node spawn resolves
#    the dist. Only the exact stable-prefix is touched; anything else is left byte-identical. ─────
if $INSTALL_ONLY; then
  echo "[codex-mcp-sync] --install-only: dist installed, no .mcp.json rewritten."
  exit 0
fi

if [ -z "$MCP_JSON" ]; then
  MCP_JSON="${CODEX_ROOT:-$DIST_ROOT}/.mcp.json"
fi
if [ ! -f "$MCP_JSON" ]; then
  echo "ERROR: ${MCP_JSON} not found — nothing to rewrite (pass --mcp-json <path> for an installed copy)." >&2
  exit 1
fi
# POSIX-safe in-place substitution that only rewrites the leading `~` of the stable path, using `#`
# as the delimiter because the pattern contains `/`.
sed -i "s#\"~/.local/share/quay/#\"${HOME}/.local/share/quay/#g" "$MCP_JSON"
echo "[codex-mcp-sync] rewrote ~ -> ${HOME} in ${MCP_JSON}:"
cat "$MCP_JSON"
