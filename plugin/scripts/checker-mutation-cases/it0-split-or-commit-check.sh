#!/usr/bin/env bash
# Mutation case for it0-split-or-commit-check (DIR-026 split-or-commit gate).
# The checker's own --selftest (ADR-018 selfcheck-fixture pattern) IS the mutation case:
# it builds fixture task sets that violate DIR-026 and asserts the checker reports them,
# then builds compliant sets and asserts a clean pass — both directions (RED + GREEN) in one
# self-contained run. Breaking the object the checker guards (a parent done with children
# not done, a child without a parent backlink, ...) is exactly what its fixture cases do.
set -u
name="it0-split-or-commit-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "${checker_dir}/it0-split-or-commit-check.sh" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi
