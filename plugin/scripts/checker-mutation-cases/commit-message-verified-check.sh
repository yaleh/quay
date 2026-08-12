#!/usr/bin/env bash
# Mutation case for commit-message-verified-check (gap-commit-message-claims-verified-
# without-verification, AC1/AC2). Fixture: a temp git repo with a clean commit message →
# GREEN. Inject: a commit whose message makes a bare "all syntax verified" claim (the
# 8e2e49b9 shape, no verification command/reference) → the checker MUST go RED. Restore:
# rewrite the message to carry a verification command (scripts/test.sh) → back to GREEN.
set -u
name="commit-message-verified-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}"
cd "${workdir}"
git init -q
git config user.email "mut@example.com"
git config user.name "mutation"
echo "x" > f.txt
git add f.txt
git commit -q -m "chore: initial commit"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/commit-message-verified-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: a repo whose messages carry no bare verified-claim → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: a bare "all syntax verified" commit (the 8e2e49b9 shape) → MUST go RED.
git commit -q --allow-empty -m "merge: fix conflicts — all syntax verified"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected bare verified-claim did not redden the checker" >&2
  exit 3
fi

# RESTORE: rewrite the message to carry a verification command/reference → back to GREEN.
git commit -q --amend --allow-empty -m "merge: fix conflicts — all syntax verified (scripts/test.sh green)"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored repo (claim WITH verification command) still reddens the checker" >&2
  exit 4
fi

exit 0
