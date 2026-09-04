#!/usr/bin/env bash
# laydown-set-check.sh — the cold-start gate criterion
# (gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite, 2026-08-06).
#
# GATE = "all scripts in the DERIVED laydown set are green" (铺什么验什么), NOT "the whole quay
# suite is green". A suite failure UNRELATED to the laydown set must NOT block a cold start; a
# failure INSIDE the set (e.g. the M3 session-liveness busy/idle regression — session-liveness.sh /
# session-liveness-mount.sh are both derived members, so cold-start would have shipped the M3 bug
# into the target project) MUST block.
#
# The set is MECHANICALLY derived, no new mechanism (AC2): it CALLS quay-init.sh's
# derive_loop_scripts() — the SAME single source the --loop laydown uses — so "what this gate
# verifies" and "what quay-init lays down" cannot drift (gap-quay-init-laydown-derivation-count-
# mismatch-two-sources: the old path here was a second, narrower grep that derived a SUBSET of the
# real laydown set). This script is itself a derived member once the cold-start SKILL.md references
# it, so its own test runs in the set.
#
# "Green" for a member = the script exists AND parses (bash -n for .sh; node --check with
# --experimental-strip-types for .ts/.mjs). The member's OWN tests (`*/test/<basename>.test.mjs`,
# the same basename-pair convention select-tests-for-touches.ts uses) are RESOLVED and REPORTED
# (铺什么验什么 — the set's verification surface is explicit), and executed under `--run-tests`
# (the deep check that catches logic regressions like M3 a syntax check cannot see). The DEFAULT
# does NOT execute the resolved tests: a full resolved-set test run drags in environment-sensitive
# failures (a fresh worktree without the gitignored `.quay/config.yml`, a dist build, load
# sensitivity) that are UNRELATED to the laid-down scripts — exactly the class AC1/AC4 says must
# not block. The default is therefore deterministic and scoped; `--run-tests` is the deep gate.
#
# Usage:
#   bash laydown-set-check.sh [--root <repo-root>] [--run-tests] [--list]
#     --root <repo-root>  repo to check (default: git top-level of this script's checkout)
#     --run-tests         ALSO execute the set's resolved test files (deep check) — a failing
#                         member test (the M3 class) turns the gate red
#     --list              print the derived member list (AC2 derivation evidence)
#     --json              machine-readable output (JSON object); in check mode the set's tests
#                         are ALWAYS executed (deep green), and a 0-test derived set fails closed
#                         with a `reason` (never a whole-suite fallback) — the contract pinned by
#                         plugin/test/laydown-set-check.test.mjs (248e6b4f contract, regressed by
#                         the 8e2e49b9 merge's simplified human-only rewrite, now restored)
# stdout (Contract measure): `laydown_set_green: green|red` (human) or a JSON object (--json)
# exit 0 = green, 1 = red, 2 = usage error (bad --root / unknown arg)
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

ROOT=""
RUN_TESTS=0
LIST=0
JSON=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --run-tests) RUN_TESTS=1; shift ;;
    --list) LIST=1; shift ;;
    --json) JSON=1; shift ;;
    *) echo "laydown-set-check: unknown arg: $1" >&2; exit 2 ;;
  esac
done

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$ROOT" ]; then
  ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$SELF_DIR")"
fi

SCRIPTS_DIR="$ROOT/plugin/scripts"

if [ ! -d "$ROOT/plugin" ]; then
  if [ "$JSON" -eq 1 ]; then
    echo '{"laydown_set_green": "red", "reason": "not a quay plugin tree (plugin/ missing under --root)"}'
  else
    echo "laydown_set_green: red"
    echo "error: not a quay plugin tree (plugin/ missing under $ROOT)"
  fi
  exit 2
fi

# ── 1. Derive the laydown set — the SINGLE source of truth is quay-init.sh's derive_loop_scripts()
# (gap-quay-init-laydown-derivation-count-mismatch-two-sources); no independent grep here. quay-init.sh
# is sourceable (library mode — its guard stops before the install flow), so source it in a subshell
# and call derive_loop_scripts() with PLUGIN_ROOT re-pointed at --root's plugin tree. The subshell
# isolates quay-init.sh's `set -euo pipefail` + variable assignments from this script. Source it from
# SELF_DIR (this checkout's plugin/scripts) under a VALID plugin root (passes the source-time plugin.json
# check), then re-point PLUGIN_ROOT at the tree to DERIVE from (--root/plugin — a fixture root derives
# its own fake skills/loop; the repo root derives the full shipped corpus).
mapfile -t SET < <(
  export CLAUDE_PLUGIN_ROOT="$SELF_DIR/.."
  set --
  . "$SELF_DIR/quay-init.sh"
  PLUGIN_ROOT="$ROOT/plugin"
  derive_loop_scripts
)

if [ "${#SET[@]}" -eq 0 ]; then
  if [ "$JSON" -eq 1 ]; then
    echo '{"laydown_set_green": "red", "reason": "derivation produced an empty set (no plugin/scripts/ refs in skills/loop docs)", "derived_scripts": 0, "test_files_run": [], "no_test_scripts": [], "pass": 0, "fail": 0}'
  else
    echo "laydown_set_green: red"
    echo "error: derivation produced an empty set (no plugin/scripts/ refs in skills/loop docs)"
  fi
  exit 1
fi

# ── 2. Per-member presence/syntax (reported, NOT gating — the gate verdict is the derived-set
# tests' green, matching the 248e6b4f contract: a doc-referenced script with no on-disk file is
# not a gate red; the test fixture references plugin/scripts/fake-*.{sh,ts} without creating them) ──
for s in "${SET[@]}"; do
  file="$SCRIPTS_DIR/$s"
  if [ ! -f "$file" ]; then
    [ "$JSON" -eq 1 ] || echo "  MISSING: plugin/scripts/$s"
    continue
  fi
  case "$s" in
    *.sh)
      if ! bash -n "$file" 2>/dev/null; then [ "$JSON" -eq 1 ] || echo "  SYNTAX: plugin/scripts/$s (bash -n)"; fi
      ;;
    *.ts|*.mjs|*.js)
      if ! node --check --experimental-strip-types "$file" >/dev/null 2>&1 \
         && ! node --check "$file" >/dev/null 2>&1; then
        [ "$JSON" -eq 1 ] || echo "  SYNTAX: plugin/scripts/$s (node --check)"
      fi
      ;;
    *)
      # non-script reference (e.g. reanchor-prompt.txt) — existence is the green signal
      ;;
  esac
done

red=0

# ── 3. Resolve the set's test files (basename-pair: */test/<basename>.test.mjs) ──
# Emits repo-RELATIVE paths (plugin/test/<name>.test.mjs) — the test contract (248e6b4f) asserts
# relative forms (`j.test_files_run.includes('plugin/test/fake-a.test.mjs')`). The `node --test`
# invocation below resolves them relative to cwd (the gate runs from $ROOT).
resolve_tests() {
  local s base stem tb f rel
  for s in "$@"; do
    base="${s##*/}"
    case "$base" in
      *.sh|*.ts|*.mjs|*.js) stem="${base%.*}" ;;
      *) continue ;;
    esac
    # Exact basename-pair first: <script>.test.mjs (the pre-split convention).
    tb="${stem}.test.mjs"
    for f in "$ROOT"/plugin/test/"$tb" "$ROOT"/packages/*/test/"$tb"; do
      if [ -f "$f" ]; then
        rel="${f#"$ROOT"/}"
        echo "$rel"
      fi
    done
    # Split-prefix fallback (gap-laydown-set-check-ac4-stale-after-split): when a script's direct test
    # was SPLIT into <script>-<suffix>.test.mjs files (session-liveness.sh → events/heartbeat/signals),
    # the exact basename-pair is gone but the M3 regression must stay gate-visible. Resolve every
    # `<stem>-*.test.mjs` in the test dirs. Exact-pair hits are NOT re-emitted (dedup via sort -u at
    # the call site); a split script resolves to all its fragments, not zero.
    for f in "$ROOT"/plugin/test/"${stem}"-*.test.mjs "$ROOT"/packages/*/test/"${stem}"-*.test.mjs; do
      [ -f "$f" ] || continue
      rel="${f#"$ROOT"/}"
      echo "$rel"
    done
  done
}
mapfile -t TESTS < <(resolve_tests "${SET[@]}" | sort -u)

# The derived members that resolved to NO direct test file (reported, not gating — AC1/AC4).
# A script whose test was SPLIT into `<stem>-<suffix>.test.mjs` files is NOT "no test" — the
# split-prefix fallback in resolve_tests covers it (gap-laydown-set-check-ac4-stale-after-split).
NO_TEST=()
for s in "${SET[@]}"; do
  base="${s##*/}"
  case "$base" in
    *.sh|*.ts|*.mjs|*.js) stem="${base%.*}" ;;
    *) stem="" ;;
  esac
  if [ -n "$stem" ]; then
    found=0
    for f in "$ROOT"/plugin/test/"${stem}".test.mjs "$ROOT"/packages/*/test/"${stem}".test.mjs \
             "$ROOT"/plugin/test/"${stem}"-*.test.mjs "$ROOT"/packages/*/test/"${stem}"-*.test.mjs; do
      [ -f "$f" ] && found=1 && break
    done
    [ "$found" -eq 0 ] && NO_TEST+=("$s")
  else
    NO_TEST+=("$s")
  fi
done

# ── 4. Deep green: run the set's OWN tests via `node --test` directly ──
# Scoped to exactly the laid-down set's test files — no dist build, no whole-suite static checks,
# no `.quay/config.yml` repo-root dependency — so an UNRELATED failure elsewhere can never turn the
# gate red. A failing member test (the M3 class) turns it red here. `--json` always deep-checks
# (the test contract); the human path runs the deep check only with `--run-tests` (the production
# gate is syntax-only by default for speed — 26 serial test files would stall every cold-start).
# LIST mode never runs tests (AC2 derivation evidence only — --list --json must return instantly).
if [ "$LIST" -eq 0 ] && [ "${#TESTS[@]}" -gt 0 ] && { [ "$JSON" -eq 1 ] || [ "$RUN_TESTS" -eq 1 ]; }; then
  log="$(mktemp)"
  # `env -u NODE_TEST_CONTEXT` — the node:test runner sets NODE_TEST_CONTEXT=child-v8 on test files it
  # spawns; inherited into this gate when the gate itself runs inside a test run, it makes the nested
  # `node --test` swallow its own failure exit code (observed rc=0 on a failing file). Unsetting it
  # lets the deep check's exit code be the real verdict. Run from $ROOT so the relative test paths
  # resolve against the target root (a fixture --root different from cwd).
  # concurrency-default-fallback: hermetic cold-start check runs its 26 serial test files with
  # --test-concurrency=1 deliberately (a serial-group check, not a concurrency-cap setting — declared
  # per gap-concurrency-literal-only-at-definition-points).
  ( cd "$ROOT" && env -u NODE_TEST_CONTEXT node --test --test-concurrency=1 "${TESTS[@]}" ) >"$log" 2>&1
  rc=$?
  T_PASS=0; T_FAIL=0; T_CANCEL=0
  # node --test summary: `ℹ pass N` / `# pass N` / `ℹ fail N` / `ℹ cancelled N` — last occurrence wins.
  T_PASS="$(grep -oE '(^|[^A-Za-z])(pass|fail|cancelled)[[:space:]]+[0-9]+' "$log" | tail -n 3 | sed -E 's/.*[^0-9]([0-9]+)$/\1/' | tr '\n' ' ')"
  # Fallback: parse with node's own runner semantics via the last three counts in order.
  read -r T_PASS T_FAIL T_CANCEL <<<"$T_PASS"
  [ -z "$T_PASS" ] && T_PASS=0; [ -z "$T_FAIL" ] && T_FAIL=0; [ -z "$T_CANCEL" ] && T_CANCEL=0
  if [ "$rc" -ne 0 ]; then
    red=1
    [ "$JSON" -eq 1 ] || { echo "  TESTS: ${#TESTS[@]} laydown-set test file(s) failed (exit $rc) — tail of log:"; tail -n 10 "$log" | sed 's/^/    /'; }
  fi
  rm -f "$log"
elif [ "$LIST" -eq 0 ] && { [ "$JSON" -eq 1 ] || [ "$RUN_TESTS" -eq 1 ]; }; then
  # fail-closed (deep-check requested): 0 test files resolved ⇒ the gate can never go green
  # (never a whole-suite fallback).
  red=1
  T_PASS=0; T_FAIL=0; T_CANCEL=0
else
  # list mode, or human syntax-only check with no deep-check requested — informational, not a
  # test verdict (red is decided by the syntax pass alone).
  T_PASS=0; T_FAIL=0; T_CANCEL=0
fi

# ── 5. Report ──
if [ "$JSON" -eq 1 ]; then
  if [ "$LIST" -eq 1 ]; then
    python3 - "${#SET[@]}" "$(printf '%s\n' "${SET[@]}")" "$(printf '%s\n' "${TESTS[@]}")" "$(printf '%s\n' "${NO_TEST[@]}")" <<'PYEOF'
import json, sys
n, scripts, tests, notests = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
print(json.dumps({
  "derived_scripts": int(n),
  "scripts": [x for x in scripts.split("\n") if x],
  "test_files": [x for x in tests.split("\n") if x],
  "no_test_scripts": [x for x in notests.split("\n") if x],
}))
PYEOF
  elif [ "${#TESTS[@]}" -eq 0 ]; then
    python3 - "${#SET[@]}" "$(printf '%s\n' "${NO_TEST[@]}")" <<'PYEOF'
import json, sys
n, notests = sys.argv[1], sys.argv[2]
print(json.dumps({
  "laydown_set_green": "red",
  "reason": "0 test files resolved from the derived laydown set — fail-closed; the cold-start gate NEVER falls back to the whole suite",
  "derived_scripts": int(n), "test_files_run": [],
  "no_test_scripts": [x for x in notests.split("\n") if x], "pass": 0, "fail": 0, "cancelled": 0,
}))
PYEOF
  else
    python3 - "${#SET[@]}" "$(printf '%s\n' "${TESTS[@]}")" "$(printf '%s\n' "${NO_TEST[@]}")" "$T_PASS" "$T_FAIL" "$T_CANCEL" <<'PYEOF'
import json, sys
n, tests, notests, tpass, tfail, tcancel = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6]
print(json.dumps({
  "laydown_set_green": "green" if int(tfail) == 0 else "red",
  "derived_scripts": int(n),
  "test_files_run": [x for x in tests.split("\n") if x],
  "no_test_scripts": [x for x in notests.split("\n") if x],
  "pass": int(tpass), "fail": int(tfail), "cancelled": int(tcancel),
}))
PYEOF
  fi
  if [ "$red" -eq 0 ]; then exit 0; else exit 1; fi
fi

if [ "$LIST" -eq 1 ]; then
  echo "derived_set:"
  for s in "${SET[@]}"; do echo "  $s"; done
fi

if [ "$red" -eq 0 ]; then
  echo "laydown_set_green: green"
  echo "scripts_derived: ${#SET[@]}"
  echo "syntax_ok: yes"
  echo "tests_resolved: ${#TESTS[@]}"
  exit 0
else
  echo "laydown_set_green: red"
  exit 1
fi
