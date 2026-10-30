#!/usr/bin/env bash
# codex-stage1-spawn-verify.sh — "did the configured quay MCP server ACTUALLY start?"
#
# The mechanical complement to codex-stage1-selfcheck.sh (which only reads config via
# `codex mcp get/list` and therefore cannot tell "enabled" from "running"). This script
# spawns the `.codex/config.toml` `[mcp_servers.quay]` server exactly the way codex-cli
# 0.156.1 does — command + args, with the server cwd resolved from the configured `cwd`
# field (absolute as-is; relative against the invocation directory; absent = invocation
# directory, i.e. the session working root codex would use) — and completes a real MCP
# `initialize` handshake over stdio. It only exits 0 when the server both spawns AND
# answers the initialize request (a result containing serverInfo); a spawn that merely
# opens a pipe without answering, a missing/ENOENT command, or a configured cwd that does
# not exist all exit non-zero — the silent "enabled but not running" case this gap exists
# to make loud (硬规则 3b).
#
# `--codex-exec` (opt-in) additionally runs the REAL codex CLI (codex exec) against a freshly
# `quay init`-laid consumer workspace whose generated `.codex/config.toml` carries
# `default_tools_approval_mode = "approve"`, and requires `task_list` to COMPLETE (not merely
# initialize) — the end-to-end proof that the quay MCP tools actually run under codex
# (gap-codex-host-config-approval-policy-blocks-mcp). It uses
# `--dangerously-bypass-approvals-and-sandbox` because that is the only non-interactive path:
# codex refuses to load an UNTRUSTED temp dir's project-scoped `.codex/config.toml` without it
# (verified: `codex exec -C <tmp>` alone yields `unknown MCP server 'quay'`), and a trust prompt
# cannot be answered non-interactively. It is opt-in because it needs a live codex + LLM round
# trip; the default path stays codex-independent.
#
# Exit: 0 = server spawned + initialize handshake succeeded (+ task_list via codex exec if asked);
#       non-zero = config missing / server did not spawn / no initialize result / codex exec failed.

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
# The session working root a codex launch would hand the server as its default cwd.
INVOCATION_CWD="$(pwd -P)"

fail=0
note() { printf '%s\n' "$*"; }
pass() { note "PASS: $*"; }
bad()  { note "FAIL: $*"; fail=1; }

note "=== codex-stage1-spawn-verify (repo root: $REPO_ROOT, invocation cwd: $INVOCATION_CWD) ==="

# --- 1. read the [mcp_servers.quay] section -------------------------------------------
if [[ ! -f "$CONFIG" ]]; then
  bad ".codex/config.toml is missing"
  note "=== RESULT: FAIL ==="
  exit 1
fi

# Extract only the lines of the [mcp_servers.quay] section (up to the next [section]).
SECTION="$(awk '/^\[mcp_servers\.quay\][[:space:]]*$/{f=1;next} /^\[[^]]+\]/{if(f)exit} f' "$CONFIG")"
if [[ -z "$SECTION" ]]; then
  bad "no [mcp_servers.quay] section in .codex/config.toml"
  note "=== RESULT: FAIL ==="
  exit 1
fi

COMMAND="$(printf '%s\n' "$SECTION" | sed -n 's/^[[:space:]]*command[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' | head -1)"
CWD_VAL="$(printf '%s\n' "$SECTION" | sed -n 's/^[[:space:]]*cwd[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' | head -1)"
ARGS_LINE="$(printf '%s\n' "$SECTION" | sed -n 's/^[[:space:]]*args[[:space:]]*=[[:space:]]*//p' | head -1)"

if [[ -z "$COMMAND" ]]; then
  bad "[mcp_servers.quay] has no command= value"
  note "=== RESULT: FAIL ==="
  exit 1
fi

# Parse the TOML string array `args = ["a", "b"]` into a bash array. Fail closed if the
# line does not parse (a half-read config must not be reported as "server spawns").
ARGS=()
ARGS_REST="$ARGS_LINE"
while [[ "$ARGS_REST" =~ \"([^\"]*)\" ]]; do
  ARGS+=("${BASH_REMATCH[1]}")
  ARGS_REST="${ARGS_REST#*\"${BASH_REMATCH[1]}\"}"
done
if [[ ${#ARGS[@]} -eq 0 ]]; then
  bad "[mcp_servers.quay] args= did not parse to a non-empty string array (line: ${ARGS_LINE:-<missing>})"
  note "=== RESULT: FAIL ==="
  exit 1
fi

# --- 2. resolve the server cwd the way codex-cli 0.156.1 resolves it ------------------
EFF_CWD="$INVOCATION_CWD"
if [[ -n "$CWD_VAL" ]]; then
  case "$CWD_VAL" in
    /*) EFF_CWD="$CWD_VAL" ;;
    *)  EFF_CWD="$INVOCATION_CWD/$CWD_VAL" ;;
  esac
fi
if [[ ! -d "$EFF_CWD" ]]; then
  bad "configured cwd does not exist or is not a directory: ${CWD_VAL:-<unset>} (resolved: $EFF_CWD)"
  note "=== RESULT: FAIL ==="
  exit 1
fi

note "server command: $COMMAND ${ARGS[*]}"
note "server cwd: $EFF_CWD"

# --- 3. spawn + complete an MCP initialize handshake (real spawn, not just a pipe) -----
INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"codex-stage1-spawn-verify","version":"0.0.1"}}}'
INIT_NOTIF='{"jsonrpc":"2.0","method":"notifications/initialized"}'

RESP="$({ printf '%s\n%s\n' "$INIT_REQ" "$INIT_NOTIF"; sleep 2; } \
  | (cd "$EFF_CWD" 2>/dev/null && exec "$COMMAND" "${ARGS[@]}") 2>/dev/null \
  | head -1)"

if printf '%s\n' "$RESP" | grep -q '"jsonrpc"[[:space:]]*:[[:space:]]*"2\.0"' \
   && printf '%s\n' "$RESP" | grep -q '"result"' \
   && printf '%s\n' "$RESP" | grep -q '"serverInfo"'; then
  pass "server spawned and completed MCP initialize handshake (result + serverInfo)"
else
  bad "server did NOT complete the initialize handshake (no jsonrpc/result/serverInfo response)"
  note "       first response line: ${RESP:-<empty — spawn produced no stdout>}"
fi

# --- 4. (opt-in) real codex exec: the configured quay MCP server completes task_list -----
# `--codex-exec` proves the quay MCP tools actually RUN under codex (not merely spawn + initialize):
# codex exec against a freshly `quay init`-laid consumer workspace (generated config carries
# `default_tools_approval_mode = "approve"`) must COMPLETE a quay MCP `task_list` call. The bypass
# flag is the only non-interactive path — codex refuses to load an UNTRUSTED temp dir's
# project-scoped `.codex/config.toml` without it, and a trust prompt cannot be answered here.
# Opt-in because it needs a live codex + LLM round trip; the default path stays codex-independent.
if [[ "${1:-}" = "--codex-exec" ]]; then
  if ! command -v codex >/dev/null 2>&1; then
    bad "--codex-exec requested but 'codex' is not on PATH"
  else
    CODEX_TMP="$(mktemp -d)"
    PROBE_ID="codex-probe-$$"
    if node --no-warnings --experimental-strip-types "$REPO_ROOT/packages/quay/bin/quay.ts" init \
        --root "$CODEX_TMP" --plugin-root "$REPO_ROOT/plugin" --test-command true >/dev/null 2>&1; then
      mkdir -p "$CODEX_TMP/tasks"
      cat > "$CODEX_TMP/tasks/$PROBE_ID.md" <<EOF
---
id: $PROBE_ID
title: codex probe task
status: todo
labels: []
---
## Proposal
probe task for spawn-verify
## Plan
probe
## Acceptance Criteria
- [ ] probe
## Definition of Done
probe
EOF
      CODEX_OUT="$(timeout 180 codex exec --dangerously-bypass-approvals-and-sandbox -C "$CODEX_TMP" \
        -o "$CODEX_TMP/last-msg.txt" \
        "Call the quay MCP tool task_list with no arguments, then reply with ONLY the id of the first task." \
        </dev/null 2>&1)"
      codex_status=$?
      LAST_MSG="$(cat "$CODEX_TMP/last-msg.txt" 2>/dev/null)"
      if [[ "$codex_status" -eq 0 ]] && printf '%s\n%s\n' "$CODEX_OUT" "$LAST_MSG" | grep -q "$PROBE_ID"; then
        pass "codex exec completed quay MCP task_list and returned the probe task id ($PROBE_ID)"
      else
        bad "codex exec did NOT complete quay MCP task_list (exit $codex_status, probe id $PROBE_ID missing). Output:"
        printf '%s\n' "$CODEX_OUT" | sed 's/^/       /'
      fi
    else
      bad "quay init could not lay down the consumer workspace for --codex-exec"
    fi
    rm -rf "$CODEX_TMP"
  fi
elif [[ -n "${1:-}" ]] && [[ "${1:-}" != "--codex-exec" ]]; then
  bad "unknown argument: ${1:-}"
fi

note ""
if [[ "$fail" -ne 0 ]]; then
  note "=== RESULT: FAIL ==="
  exit 1
fi
note "=== RESULT: PASS ==="
exit 0
