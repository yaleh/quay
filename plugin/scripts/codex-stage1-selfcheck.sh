#!/usr/bin/env bash
# codex-stage1-selfcheck.sh — DIR-121 (Codex adoption Stage 1) mechanical self-check.
#
# Validates the trusted-project `.codex/config.toml` using the IMPLEMENTING Codex
# version, and confirms `codex mcp list` includes an enabled project `quay` server —
# WITHOUT the repository having gained any model, reasoning, sandbox, approval, hook,
# automation, telemetry, or meta-cc configuration (those belong to later stages).
# It ALSO runs codex-stage1-spawn-verify.sh from a packages/quay subdirectory, so the
# check measures "the server actually spawns + initializes" and not merely "the config
# parses" — `codex mcp get/list` alone cannot tell an enabled server from a silent ENOENT.
#
# Exit: 0 = config valid + server spawns/initializes + (codex present) project quay server enabled;
#       1 = config invalid / forbidden key present / server did not spawn / (codex present) quay not enabled.
# If `codex` is not on PATH, the LIVE codex confirmation is reported as SKIP (not a failure)
# and the static + spawn-verify checks still run — a credential-/tool-less environment must
# not be silently treated as proven.
# If `codex` IS present but predates project-scoped MCP config support (no `quay` row
# surfaces in `codex mcp list`), the LIVE codex confirmation is likewise SKIPPED with an
# explicit present-but-incompatible note — never a raw failure on an environment/codex
# mismatch (this project's .codex/config.toml is validated against codex-cli >=0.146.0);
# the spawn-verify check is codex-independent and still runs.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
CONFIG="$REPO_ROOT/.codex/config.toml"

fail=0
note() { printf '%s\n' "$*"; }
pass() { note "PASS: $*"; }
bad()  { note "FAIL: $*"; fail=1; }

note "=== codex-stage1-selfcheck (repo root: $REPO_ROOT) ==="

# --- 1. static validation: file exists, registers quay, nothing forbidden --------
if [[ ! -f "$CONFIG" ]]; then
  bad ".codex/config.toml is missing"
  note "=== RESULT: FAIL (static) ==="
  exit 1
fi
pass ".codex/config.toml exists"

if grep -Eq '^\[mcp_servers\.quay\]' "$CONFIG"; then
  pass "registers [mcp_servers.quay]"
else
  bad "no [mcp_servers.quay] section"
fi

# The quay server must be the existing stdio command (same as .mcp.json), not a reinvention.
if grep -Eq 'quay\.ts' "$CONFIG" && grep -Eq '"mcp"|^args.*mcp' "$CONFIG"; then
  pass "quay server invokes the existing packages/quay/bin/quay.ts mcp stdio command"
else
  bad "quay server does not invoke the expected quay.ts mcp stdio command"
fi

# codex-cli 0.156.1 resolves the server's relative `args` against the SESSION working
# directory (not the trusted project root), so without an explicit repo-root `cwd` the
# relative args ENOENT silently from a subdirectory. The field must be present; the
# spawn-verify step below is what makes a WRONG value loud.
if grep -Eq '^[[:space:]]*cwd[[:space:]]*=[[:space:]]*"' "$CONFIG"; then
  pass "registers an explicit cwd for [mcp_servers.quay] (server spawnable from any working root)"
else
  bad "no cwd= value for [mcp_servers.quay] — relative args would ENOENT from a subdirectory"
fi

# Stage 1 scope guard: NONE of these may appear as an ACTUAL setting. These are the
# surfaces a bounded human-authorized operator must NOT configure repo-wide (later
# stages / Host Adapter). Comment lines (# ...) are prose and are stripped first, so a
# comment documenting what is deliberately absent does not trip the guard.
CONFIG_BODY="$(grep -v '^[[:space:]]*#' "$CONFIG")"
FORBIDDEN_REGEX='(^|[^_a-z])(model[[:space:]]*=|model_reasoning|reasoning[[:space:]]*=|\[sandbox|sandbox_|approval_policy|\[hooks|automation|telemetry|otel|model_providers|meta-cc|meta_cc)'
if printf '%s\n' "$CONFIG_BODY" | grep -Eiq "$FORBIDDEN_REGEX"; then
  bad ".codex/config.toml sets a forbidden Stage-1 key (model/reasoning/sandbox/approval/hook/automation/telemetry/meta-cc):"
  printf '%s\n' "$CONFIG_BODY" | grep -Ein "$FORBIDDEN_REGEX" | sed 's/^/       /'
else
  pass "no forbidden Stage-1 keys (model/reasoning/sandbox/approval/hook/automation/telemetry/meta-cc)"
fi

# --- 1b. spawn-verify: the server must ACTUALLY spawn + initialize from a subdirectory ---
# Codex-independent (spawns the configured `node packages/quay/bin/quay.ts mcp` directly),
# so it also runs in codex-less environments and measures the thing `codex mcp get/list`
# cannot: "enabled" vs "running". A wrong cwd or reverted relative args fails LOUD here.
SPAWN_OUT="$( (cd "$REPO_ROOT/packages/quay" && bash "$SCRIPT_DIR/codex-stage1-spawn-verify.sh") 2>&1 )"
spawn_status=$?
if [[ "$spawn_status" -eq 0 ]]; then
  pass "spawn-verify: quay MCP server spawned + initialized from a packages/quay subdirectory"
else
  bad "spawn-verify FAILED: quay MCP server did NOT spawn + initialize from a packages/quay subdirectory:"
  printf '%s\n' "$SPAWN_OUT" | sed 's/^/       /'
fi

# --- 2. live validation with the implementing Codex version ----------------------
if ! command -v codex >/dev/null 2>&1; then
  note "SKIP: 'codex' not on PATH — live 'codex mcp list' confirmation not possible in this environment."
  note "      Static + spawn-verify checks above are necessary-but-not-sufficient; run this selfcheck where codex is installed for the live codex proof."
  if [[ "$fail" -ne 0 ]]; then
    note "=== RESULT: FAIL (static/spawn) ==="
    exit 1
  fi
  note "=== RESULT: PASS (static + spawn-verify; live codex confirmation SKIPPED — codex absent) ==="
  exit 0
fi

CODEX_VERSION="$(codex --version 2>/dev/null | head -1)"
note "implementing Codex version: $CODEX_VERSION"

# Parse-check: codex must accept the config and resolve the quay server. Run from the
# repo root so the project-scoped .codex/config.toml is the one under test.
if ! (cd "$REPO_ROOT" && codex mcp get quay >/dev/null 2>&1); then
  # Present-but-INCOMPATIBLE vs a REAL config defect, distinguished by whether the
  # installed codex loads project-scoped MCP config AT ALL: a version that reads
  # .codex/config.toml surfaces a `quay` row in `codex mcp list` even when the server
  # is misconfigured; an older version (e.g. codex-cli 0.125.0, predating project-scoped
  # MCP config) shows NO `quay` row because it never loads the file. Only the latter may
  # DEGRADE (an explicit SKIP of the live proof, never a raw failure); the former FAILs.
  LIST_OUT="$(cd "$REPO_ROOT" && codex mcp list 2>&1)"
  if printf '%s\n' "$LIST_OUT" | grep -Eq '^quay[[:space:]]'; then
    bad "codex mcp get quay FAILED — the project .codex/config.toml is loaded but not accepted by $CODEX_VERSION:"
    printf '%s\n' "$LIST_OUT" | sed 's/^/       /'
  else
    note "SKIP (present-but-incompatible): $CODEX_VERSION does not load project-scoped"
    note "      .codex/config.toml MCP servers — 'codex mcp list' surfaces no 'quay' row. The config"
    note "      was validated against codex-cli >=0.146.0; this installed version cannot provide the"
    note "      live codex proof. Static + spawn-verify checks above are necessary-but-not-sufficient;"
    note "      upgrade codex-cli (>=0.146.0) or run this selfcheck where a compatible codex is installed."
    if [[ "$fail" -ne 0 ]]; then
      note "=== RESULT: FAIL (static/spawn) ==="
      exit 1
    fi
    note "=== RESULT: PASS (static + spawn-verify; live codex confirmation SKIPPED — installed codex present-but-incompatible) ==="
    exit 0
  fi
fi
pass "codex mcp get quay parsed the project config (exit 0)"

# Enabled check: `codex mcp list` must show a project `quay` row that is enabled.
LIST_OUT="$(cd "$REPO_ROOT" && codex mcp list 2>&1)"
if printf '%s\n' "$LIST_OUT" | grep -Eq '^quay[[:space:]].*enabled'; then
  pass "codex mcp list reports project 'quay' server as enabled"
else
  bad "codex mcp list does NOT show an enabled project 'quay' server. Output was:"
  printf '%s\n' "$LIST_OUT" | sed 's/^/       /'
fi

# `codex mcp get quay` structured confirmation (transport stdio, enabled true).
GET_OUT="$(cd "$REPO_ROOT" && codex mcp get quay 2>&1)"
if printf '%s\n' "$GET_OUT" | grep -Eq 'enabled:[[:space:]]*true' && printf '%s\n' "$GET_OUT" | grep -Eq 'transport:[[:space:]]*stdio'; then
  pass "codex mcp get quay: enabled=true, transport=stdio"
else
  bad "codex mcp get quay did not confirm enabled=true + stdio transport"
fi

note ""
if [[ "$fail" -ne 0 ]]; then
  note "=== RESULT: FAIL ==="
  exit 1
fi
note "=== RESULT: PASS (validated with $CODEX_VERSION) ==="
exit 0
