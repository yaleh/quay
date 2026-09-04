#!/usr/bin/env bash
# Mutation case for direct-to-develop-bypass-check (gap-direct-to-develop-bypasses-fan-in-gates,
# 11b/C17 写所有权/越权直改面). Fixture: a temp git repo where develop has ONLY design-internal
# direct commits (.gitignore) → GREEN. Inject: a direct commit touching a CODE/ASSERTION-surface
# file (plugin/test/x.test.mjs) → the checker MUST go RED (直接提交 develop 绕过 fan-in 机件).
# Restore: reset away the code-surface commit → GREEN. The missing lock-events file is the
# vacuous "no lock holds" state (the checker's own documented semantics — the reflog `commit:`
# action is the primary signal).
set -u
name="direct-to-develop-bypass-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="${workdir}/repo"

rm -rf "${repo}"
mkdir -p "${repo}"

git() { command git -C "${repo}" "$@"; }

# ── seed the repo: develop with a design-internal direct commit (.gitignore) ────────────────────────
git init -q
git config user.name "mutation-test"
git config user.email "mt@example.com"
git branch -M develop
printf '.quay/\n' > "${repo}/.gitignore"
git add -A
GIT_AUTHOR_DATE="2026-08-01T00:00:00Z" GIT_COMMITTER_DATE="2026-08-01T00:00:00Z" \
  git commit -q -m "chore: gitignore"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/direct-to-develop-bypass-check.ts" \
    --root "${repo}" >/dev/null 2>&1
}

# GREEN baseline: only a design-internal direct commit → exit 0.
if checker_cmd; then :; else
  echo "baseline RED on design-internal-only direct commit (checker always-red?)" >&2
  exit 4
fi

# INJECT: a direct commit touching a code/assertion-surface file → MUST go RED.
mkdir -p "${repo}/plugin/test"
printf 'export const x = 1;\n' > "${repo}/plugin/test/x.test.mjs"
git add -A
GIT_AUTHOR_DATE="2026-08-02T00:00:00Z" GIT_COMMITTER_DATE="2026-08-02T00:00:00Z" \
  git commit -q -m "test: direct code commit"
if checker_cmd; then
  echo "mutation NOT caught: a direct commit to plugin/test/x.test.mjs stayed GREEN (直接提交绕过 fan-in 机件未报)" >&2
  exit 1
fi

# RESTORE: reset away the code-surface commit → GREEN again.
git reset -q --hard HEAD~1
if checker_cmd; then
  echo "direct-to-develop-bypass-check mutation case: PASS (code-surface direct commit caught, design-internal restored)" >&2
else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi
exit 0
