#!/usr/bin/env bash
# Mutation case for tmp-leak-pairing-check (the mkdtemp-without-cleanup pairing gate).
# Its --selftest runs 4 fixture assertions: an UNPAIRED mkdtemp (negative control) is asserted RED,
# and the three pairing patterns (finally-rmSync / carrier+after / caller-cleans-return) are
# asserted GREEN — a checker that cannot fail on a leaky fixture is indistinguishable from one that
# always passes (the #6 rename-negative-control failure this task exists to prevent).
set -u
name="tmp-leak-pairing-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "${checker_dir}/tmp-leak-pairing-check.sh" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi
