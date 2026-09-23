#!/usr/bin/env bash
# Mutation case for test-coverage-check (DIR-108/DIR-110 orphan-detection gate).
# Its --selftest proves both directions: an orphaned real test file sitting outside the
# canonical glob is asserted RED, the compliant store GREEN (10 fixture assertions).
set -u
name="test-coverage-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
scripts_dir="$(cd "${checker_dir}/../.." && pwd -P)/scripts"

node --experimental-strip-types "${scripts_dir}/test-coverage-check.ts" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi
