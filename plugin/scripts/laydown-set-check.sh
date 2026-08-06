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
# The set is MECHANICALLY derived, no new mechanism (AC2): the SAME grep quay-init.sh's
# derive_loop_scripts() step (a) uses — path-prefixed `plugin/scripts/` references in the shipped
# skill docs (`plugin/skills/*/SKILL.md`) + loop tick docs (`plugin/loop/*.md`). This script is
# itself a derived member once the cold-start SKILL.md references it, so its own test runs in the
# set.
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
# stdout (Contract measure): `laydown_set_green: green|red`
# exit 0 = green, 1 = red
set -u

ROOT=""
RUN_TESTS=0
LIST=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --run-tests) RUN_TESTS=1; shift ;;
    --list) LIST=1; shift ;;
    *) shift ;;
  esac
done

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$ROOT" ]; then
  ROOT="$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$SELF_DIR")"
fi

SKILLS_DIR="$ROOT/plugin/skills"
LOOP_DIR="$ROOT/plugin/loop"
SCRIPTS_DIR="$ROOT/plugin/scripts"

if [ ! -d "$SKILLS_DIR" ] || [ ! -d "$LOOP_DIR" ] || [ ! -d "$SCRIPTS_DIR" ]; then
  echo "laydown_set_green: red"
  echo "error: not a quay plugin tree (need plugin/skills, plugin/loop, plugin/scripts under $ROOT)"
  exit 1
fi

# ── 1. Derive the laydown set (AC2 — the same grep quay-init.sh derive_loop_scripts step (a) uses) ──
mapfile -t SET < <(grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' "$SKILLS_DIR"/*/SKILL.md "$LOOP_DIR"/*.md 2>/dev/null \
  | sed 's#^plugin/scripts/##' | sort -u)

if [ "${#SET[@]}" -eq 0 ]; then
  echo "laydown_set_green: red"
  echo "error: derivation produced an empty set (no plugin/scripts/ refs in skills/loop docs)"
  exit 1
fi

# ── 2. Per-member green: exists + parses ──
red=0
for s in "${SET[@]}"; do
  file="$SCRIPTS_DIR/$s"
  if [ ! -f "$file" ]; then
    echo "  MISSING: plugin/scripts/$s"
    red=1
    continue
  fi
  case "$s" in
    *.sh)
      if ! bash -n "$file" 2>/dev/null; then echo "  SYNTAX: plugin/scripts/$s (bash -n)"; red=1; fi
      ;;
    *.ts|*.mjs|*.js)
      if ! node --check --experimental-strip-types "$file" >/dev/null 2>&1 \
         && ! node --check "$file" >/dev/null 2>&1; then
        echo "  SYNTAX: plugin/scripts/$s (node --check)"
        red=1
      fi
      ;;
    *)
      # non-script reference (e.g. reanchor-prompt.txt) — existence is the green signal
      ;;
  esac
done

# ── 3. Resolve the set's test files (basename-pair: */test/<basename>.test.mjs) ──
resolve_tests() {
  local s base tb f
  for s in "$@"; do
    base="${s##*/}"
    case "$base" in
      *.sh|*.ts|*.mjs|*.js) tb="${base%.*}.test.mjs" ;;
      *) continue ;;
    esac
    for f in "$ROOT"/plugin/test/"$tb" "$ROOT"/packages/*/test/"$tb"; do
      [ -f "$f" ] && echo "$f"
    done
  done
}
mapfile -t TESTS < <(resolve_tests "${SET[@]}" | sort -u)

# ── 4. Deep green (opt-in): run the set's OWN tests via `node --test` directly ──
# Scoped to exactly the laid-down set's test files — no dist build, no whole-suite static checks,
# no `.quay/config.yml` repo-root dependency — so an UNRELATED failure elsewhere can never turn the
# default gate red. A failing member test (the M3 class) turns it red here.
if [ "$RUN_TESTS" -eq 1 ] && [ "${#TESTS[@]}" -gt 0 ]; then
  log="$(mktemp)"
  # `env -u NODE_TEST_CONTEXT` — the node:test runner sets NODE_TEST_CONTEXT=child-v8 on test files it
  # spawns; inherited into this gate when the gate itself runs inside a test run, it makes the nested
  # `node --test` swallow its own failure exit code (observed rc=0 on a failing file). Unsetting it
  # lets the deep check's exit code be the real verdict.
  env -u NODE_TEST_CONTEXT node --test "${TESTS[@]}" >"$log" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ]; then
    red=1
    echo "  TESTS: ${#TESTS[@]} laydown-set test file(s) failed (exit $rc) — tail of log:"
    tail -n 10 "$log" | sed 's/^/    /'
  fi
  rm -f "$log"
fi

# ── 5. Report ──
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
