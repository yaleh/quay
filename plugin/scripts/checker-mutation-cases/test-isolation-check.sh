#!/usr/bin/env bash
# Mutation case for test-isolation-check (test-isolation contract + shrink-only ratchet).
# Its --selftest runs 49 fixture assertions: tests that touch a shared path (fixed __dirname,
# dist/ artifacts, the runner itself) are asserted RED, compliant tests GREEN.
set -u
name="test-isolation-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "${checker_dir}/test-isolation-check.sh" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi
