#!/usr/bin/env bash
# Mutation case for test-framework-policy-check (node:test policy + shrink-only ratchet).
# Its --selftest runs 22 fixture assertions covering BOTH directions: files that violate the
# policy (hand-rolled harness off the exemption list, a list that GREW, a ceiling that was
# RAISED, a new file with no @test-group) are asserted RED; compliant sets are asserted GREEN.
set -u
name="test-framework-policy-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "${checker_dir}/test-framework-policy-check.sh" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi
