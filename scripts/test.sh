#!/usr/bin/env bash
# scripts/test.sh — the ONE canonical test-invocation entrypoint (ADR-019 / DIR-109, M173).
#
# Both CLAUDE.md's Commands section and .github/workflows/ci.yml call THIS script instead of
# each hand-writing their own copy of the test-file glob / concurrency flag / live-test
# exclusion list. That duplication (a `grep -vE 'serve-github|provider-abi-conformance|
# cli-edit-parity-conformance'` pattern written out independently in both places, with nothing
# keeping the two copies in sync) is the drift ADR-019 records and this script eliminates.
#
# Per ADR-019 decision #1, the live/conformance test files are NO LONGER excluded here by
# filename — each of the 3 declares its own in-file `node:test` skip condition (opt-in via
# QUAY_TEST_LIVE_GITHUB=1; see each file's own header comment), so this script's glob is safe
# to include them unconditionally: a credential-less run reports them `skipped`, not silently
# excluded, and setting the env var proves the opt-in path actually runs them live.
#
# Usage:
#   scripts/test.sh                          # full safe-by-default suite, --test-concurrency=8
#   scripts/test.sh <file...>                 # just the given file(s), same default concurrency
#   scripts/test.sh --test-name-pattern=X <file>   # any extra node --test flag passes through
#   scripts/test.sh --experimental-test-coverage   # flags-only form also passes through
#   QUAY_TEST_LIVE_GITHUB=1 scripts/test.sh   # opt IN to the 3 live/conformance files too
#
# --test-concurrency=8 is the default (ADR-019: measured 10.3% faster than the runtime default
# with zero correctness regression across repeated runs, 514/514 pass at concurrency 4/8/16).
# A later --test-concurrency=N on the command line overrides this (node --test is last-flag-wins).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ "$#" -eq 0 ]; then
  # Default glob: every *.test.mjs under any package's test/ dir, plus plugin/test/.
  # (ADR-019 decision #4 names a follow-up mechanical self-check, DIR-110, that fails closed if
  # a new test directory isn't reachable by this glob — out of scope for this script itself.)
  shopt -s nullglob
  files=(packages/*/test/*.test.mjs plugin/test/*.test.mjs)
  shopt -u nullglob
  if [ "${#files[@]}" -eq 0 ]; then
    echo "scripts/test.sh: no test files matched packages/*/test/*.test.mjs or plugin/test/*.test.mjs" >&2
    exit 1
  fi
  exec node --test --test-concurrency=8 "${files[@]}"
else
  exec node --test --test-concurrency=8 "$@"
fi
