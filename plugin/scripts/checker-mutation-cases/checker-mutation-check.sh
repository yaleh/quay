#!/usr/bin/env bash
# Mutation case for checker-mutation-check ITSELF (AC1c/AC4 — the mechanism must be
# mutation-covered too, or it is exactly the thing it exists to catch).
#
# Because checker-mutation-check is now a registered checker (it is wired into
# run_static_checks), its own mutation case is the meta-selfcheck: break the mechanism's
# core behaviors (parser returns no checkers / case loop skipped / RED inverted) and assert
# the gate FAILS. A mutation-testing harness that cannot fail when broken is a checker that
# stays green under the very defect it exists to catch — the exact #6 shape, applied to itself.
set -u
name="checker-mutation-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
repo_root="$(cd "${checker_dir}/../.." && pwd -P)"

bash "${checker_dir}/checker-mutation-check.sh" --repo-root "${repo_root}" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: mechanism --selftest exited $code (the mechanism could not catch its own breakage)" >&2
  exit 2
fi
