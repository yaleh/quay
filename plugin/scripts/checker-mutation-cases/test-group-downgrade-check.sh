#!/usr/bin/env bash
# Mutation case for test-group-downgrade-check (gap-test-group-downgrade-no-guard, AC2/AC3).
# Fixture: a temp git repo whose scripts/test.sh declares a one-file glob, with a test file at HEAD
# declaring `// @test-group engine`. The enforcement baseline = the commit that adds the engine test.
# Demonstrates BOTH the RED and GREEN states with REAL git operations:
#   GREEN — no downgrade (clean) → the checker exits 0.
#   INJECT (uncommitted) — working-tree engine→serial, not committed → the checker MUST go RED
#     (no commit message can carry the reason yet).
#   INJECT (committed) — commit the same downgrade WITHOUT the marker → the checker MUST go RED.
#   LEGIT (fresh fixture) — commit the downgrade WITH the `@test-group-downgrade` marker → GREEN.
#   NEW-FILE (fresh fixture) — a NEW file created directly with a target group is NOT a downgrade.
# The LEGIT/NEW-FILE cases run on a FRESH fixture: a prior unmarked downgrade in the same history
# legitimately stays red (each unmarked default-set escape is a violation) and would mask a later
# GREEN, so the sanctioned case must not share history with a deliberate RED case.
set -u
name="test-group-downgrade-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

baseline=""
fixture_dir=""

# make_fixture — build a fresh temp repo (scripts/test.sh one-file glob + engine test at HEAD),
# record its baseline SHA. Subsequent checker runs use `$baseline`.
make_fixture() {
  fixture_dir="$(mktemp -d)"
  mkdir -p "${fixture_dir}/plugin/test" "${fixture_dir}/scripts"
  cd "${fixture_dir}"
  echo 'glob=(plugin/test/*.test.mjs)' > scripts/test.sh
  echo a > seed.txt
  git init -q
  git config user.email t@t
  git config user.name t
  git add seed.txt
  git commit -qm c1
  src engine > plugin/test/fixture.test.mjs
  git add plugin/test/fixture.test.mjs
  git commit -qm "add engine test"
  baseline="$(git rev-parse HEAD)"
}

src() { # $1 = group
  printf '// @test-group %s\nimport { test } from "node:test";\ntest("x", () => {});\n' "$1"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/test-group-downgrade-check.ts" --root "$1" --baseline "${baseline}" >/dev/null 2>&1
}

# ── Phase 1: the uncommitted + committed-without-marker REDs and the GREEN restores ─────────────────
make_fixture

# GREEN baseline: no downgrade.
if checker_cmd "${fixture_dir}"; then :; else
  echo "baseline RED on a clean repo (checker always-red?)" >&2
  exit 4
fi

# INJECT 1 (uncommitted): working-tree engine→serial → MUST go RED.
src serial > plugin/test/fixture.test.mjs
if checker_cmd "${fixture_dir}"; then
  echo "STAYED-GREEN — an uncommitted engine→serial downgrade did not redden the checker" >&2
  exit 3
fi

# RESTORE: back to engine (uncommitted) → back to GREEN.
src engine > plugin/test/fixture.test.mjs
if checker_cmd "${fixture_dir}"; then :; else
  echo "ALWAYS-RED — restored engine still reddens the checker" >&2
  exit 4
fi

# INJECT 2 (committed, no marker): commit the downgrade without the reason marker → MUST go RED.
src serial > plugin/test/fixture.test.mjs
git add plugin/test/fixture.test.mjs
git commit -qm "move to serial"
if checker_cmd "${fixture_dir}"; then
  echo "STAYED-GREEN — a committed engine→serial downgrade without the marker did not redden the checker" >&2
  exit 3
fi
rm -rf "${fixture_dir}"

# ── Phase 2 (fresh fixture): the sanctioned cases must be GREEN ──────────────────────────────────────
make_fixture

# LEGIT (committed, with marker): downgrade WITH the `@test-group-downgrade` marker → GREEN.
src serial > plugin/test/fixture.test.mjs
git add plugin/test/fixture.test.mjs
git commit -qm "test: @test-group-downgrade move flaky fixture to serial"
if checker_cmd "${fixture_dir}"; then :; else
  echo "LEGIT-RED — a marked (sanctioned) downgrade still reddens the checker" >&2
  exit 4
fi

# NEW-FILE: a file CREATED with a target group is not a downgrade → GREEN.
src serial > plugin/test/new-serial.test.mjs
git add plugin/test/new-serial.test.mjs
git commit -qm "add new serial test"
if checker_cmd "${fixture_dir}"; then :; else
  echo "NEW-FILE-RED — a new file declared directly in a target group reddens the checker (false positive)" >&2
  exit 4
fi
rm -rf "${fixture_dir}"

exit 0
