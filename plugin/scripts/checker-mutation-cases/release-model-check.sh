#!/usr/bin/env bash
# Mutation case for release-model-check.ts
# (tasks/gap-release-model-check-mutation-case-and-manifest-enrollment).
#
# Fixture: a self-contained git repo + `.quay/config.yml` + `.github/workflows/release.yml` under
# <workdir>. The case drives the REAL checker through its REAL CLI (`--root <workdir> [--json]`,
# never an import), so the shipping argument parser, config resolver, git reader and the delegated
# `release-master-advance-needs-check.ts` sibling are all exercised as shipped.
#
# WHY EACH PHASE EXISTS (a phase a plausible-but-wrong implementation would survive is not worth
# running — the case must be able to FAIL, or it is an echo of "the file exists"):
#
#   A   baseline: a readable declared line, its tip held by a `v*` tag, and an advancing job whose
#       `needs:` covers every other job                      → exit 0, ALL THREE invariants `pass`
#   B   `line-parked-on-tag` INJECTION: one commit after the tag (the "somebody committed straight
#       to the release line" rot)                            → exit 1, that invariant's state = `fail`
#                                                                 → restore ⇒ exit 0 (ALWAYS-RED detector)
#   C   `line-readable` INJECTION: the declared line's branch no longer exists (renamed away)
#                                                            → exit 1, `line-readable` state = `fail`
#       (a checker that only reads the tag would stay green here: the tag still points somewhere)
#                                                                 → restore ⇒ exit 0
#   D   `advance-ci-needs` INJECTION: one job dropped from the advancing job's `needs:` list
#       (the exact 7th-job omission release-master-advance-needs-check exists for)
#                                                            → exit 1, that invariant's state = `fail`
#                                                                 → restore ⇒ exit 0
#   E   FOUR-STATE SEPARATION (hard rule 3b) — both non-verdict readings must be DISTINGUISHABLE
#       from 0 and 1, and from each other:
#         E1  no `release:` section at all                     → exit 4 / status `not-configured`
#         E2  `release:` present but unreadable (empty mapping)→ exit 3 / status `not-evaluated`
#       A checker that folded either into `pass` (or that returned one shared "not ok" value for
#       both) survives A–D and dies here.
#
# Each injection is asserted BOTH on the exit code AND on the `--json` invariant id/state: an exit 1
# caused by an unrelated invariant going red would not prove the named judgment is load-bearing.
set -u
name="release-model-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker="${checker_dir}/${name}.ts"
[ -f "$checker" ] || { echo "infrastructure: checker not found at $checker" >&2; exit 2; }

rm -rf "${workdir}"
mkdir -p "${workdir}"
cd "${workdir}" || exit 2

cfg="${workdir}/.quay/config.yml"
wf="${workdir}/.github/workflows/release.yml"

# Git identity is supplied per-command (never relying on the host's global config) so the fixture is
# reproducible on any machine, including CI where no user.name/user.email is set.
GIT_ID=(-c user.name=fixture -c user.email=fixture@example.com)

git init -q -b main . || { echo "infrastructure: git init failed" >&2; exit 2; }

# ── the three fixture artefacts ──────────────────────────────────────────────────────────────────
write_config() {
  mkdir -p "${workdir}/.quay"
  cat > "${cfg}" <<'YAML'
release:
  line: main
  baseline: develop
  globs:
    - "release/*"
  tag_prefix: v
  advance: ci
YAML
}

# `needs:` covers every OTHER job (A). The baseline deliberately has TWO other jobs so the
# `advance-ci-needs` injection (D) can drop exactly one and still leave a non-empty list — that is
# the shape that discriminates "needs ⊇ others" from "needs is non-empty".
write_workflow_covered() {
  mkdir -p "${workdir}/.github/workflows"
  cat > "${wf}" <<'YAML'
name: Release
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: self-hosted
    steps:
      - run: echo build
  verify:
    runs-on: self-hosted
    steps:
      - run: echo verify
  advance-master:
    needs: [build, verify]
    runs-on: self-hosted
    steps:
      - run: echo advance
YAML
}

# `needs:` covers only ONE of the two other jobs — the omitted `verify` is the 7th-job rot (D).
write_workflow_needs_incomplete() {
  cat > "${wf}" <<'YAML'
name: Release
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: self-hosted
    steps:
      - run: echo build
  verify:
    runs-on: self-hosted
    steps:
      - run: echo verify
  advance-master:
    needs: [build]
    runs-on: self-hosted
    steps:
      - run: echo advance
YAML
}

# ── judges ───────────────────────────────────────────────────────────────────────────────────────
# The checker's own four-state reading, verbatim. `_rc` is the checker's exit code; stdout is its
# `--json` document.
read_checker() {
  _out="$(node --no-warnings --experimental-strip-types "${checker}" --root "${workdir}" --json 2>/dev/null)"
  _rc=$?
}

# `status` of the meter document (pass|fail|not-evaluated|not-configured).
status_of() {
  printf '%s' "${_out}" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.stdout.write(String(JSON.parse(s).status ?? "MISSING")); }
      catch { process.stdout.write("UNPARSEABLE"); }
    });'
}

# state of one invariant id (pass|fail|not-evaluated|skipped|MISSING).
invariant_state() {
  printf '%s' "${_out}" | node -e '
    const id = process.argv[1];
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const hit = (JSON.parse(s).invariants || []).find((i) => i.id === id);
        process.stdout.write(hit ? String(hit.state) : "MISSING");
      } catch { process.stdout.write("UNPARSEABLE"); }
    });' "$1"
}

fail_phase() { echo "$1" >&2; exit 3; }

# ── A: baseline GREEN, all three invariants PASS ────────────────────────────────────────────────
write_config
write_workflow_covered
(
  cd "${workdir}" || exit 2
  git "${GIT_ID[@]}" commit -q --allow-empty -m "fixture: release commit"
  git tag v1.0.0
) || { echo "infrastructure: fixture commit/tag failed" >&2; exit 2; }

read_checker
if [ "${_rc}" != "0" ]; then
  echo "baseline RED on a green fixture (checker always-red? got exit ${_rc}; status=$(status_of)) — ${_out}" >&2
  exit 4
fi
for inv in line-readable line-parked-on-tag advance-ci-needs; do
  st="$(invariant_state "${inv}")"
  [ "${st}" = "pass" ] || fail_phase "baseline: invariant '${inv}' is '${st}', expected 'pass' — a baseline that does not exercise all three judges cannot prove the injections are the thing going red"
done
echo "phase A (baseline): exit 0, all three invariants pass"

# ── B: line-parked-on-tag INJECTION — a commit on the line AFTER its tag ────────────────────────
(
  cd "${workdir}" || exit 2
  git "${GIT_ID[@]}" commit -q --allow-empty -m "fixture: direct commit PAST the release tag"
) || exit 2
read_checker
[ "${_rc}" = "1" ] || fail_phase "line-parked-on-tag injection: expected exit 1 (fail), got ${_rc} (status=$(status_of)) — a commit after the tag leaves the line unparked"
st="$(invariant_state "line-parked-on-tag")"
[ "${st}" = "fail" ] || fail_phase "line-parked-on-tag injection: invariant state is '${st}', expected 'fail' — the named judgment did not move, so the exit 1 came from somewhere else"
# restore: the line goes back to standing on its tag
(
  cd "${workdir}" || exit 2
  git reset -q --hard v1.0.0
) || exit 2
read_checker
[ "${_rc}" = "0" ] || fail_phase "ALWAYS-RED after restoring the parked line: exit ${_rc}, not 0 (status=$(status_of))"
echo "phase B (line-parked-on-tag): 1/fail on injection, 0 after restore"

# ── C: line-readable INJECTION — the declared line's branch is gone ─────────────────────────────
(
  cd "${workdir}" || exit 2
  git branch -m main parked-line
) || exit 2
read_checker
[ "${_rc}" = "1" ] || fail_phase "line-readable injection: expected exit 1 (fail), got ${_rc} (status=$(status_of)) — the declared line no longer resolves and the checker did not say so"
st="$(invariant_state "line-readable")"
[ "${st}" = "fail" ] || fail_phase "line-readable injection: invariant state is '${st}', expected 'fail' — an unresolvable declared line must be a FAIL, never a shared not-evaluated/pass value"
(
  cd "${workdir}" || exit 2
  git branch -m parked-line main
) || exit 2
read_checker
[ "${_rc}" = "0" ] || fail_phase "ALWAYS-RED after restoring the declared line: exit ${_rc}, not 0 (status=$(status_of))"
echo "phase C (line-readable): 1/fail on injection, 0 after restore"

# ── D: advance-ci-needs INJECTION — one job dropped from the advancing job's needs ──────────────
write_workflow_needs_incomplete
read_checker
[ "${_rc}" = "1" ] || fail_phase "advance-ci-needs injection: expected exit 1 (fail), got ${_rc} (status=$(status_of)) — a job is no longer in advance-master.needs and the checker stayed ${_rc}"
st="$(invariant_state "advance-ci-needs")"
[ "${st}" = "fail" ] || fail_phase "advance-ci-needs injection: invariant state is '${st}', expected 'fail'"
write_workflow_covered
read_checker
[ "${_rc}" = "0" ] || fail_phase "ALWAYS-RED after restoring the covered workflow: exit ${_rc}, not 0 (status=$(status_of))"
echo "phase D (advance-ci-needs): 1/fail on injection, 0 after restore"

# ── E1: no `release:` section ⇒ exit 4 / not-configured (⛔ not a pass) ─────────────────────────
cat > "${cfg}" <<'YAML'
providers:
  native:
    enabled: true
YAML
read_checker
[ "${_rc}" = "4" ] || fail_phase "four-state: a config with NO release: section exited ${_rc}, expected 4 (not-configured) — 'declared nothing' must not share a value with pass (0) or fail (1)"
[ "$(status_of)" = "not-configured" ] || fail_phase "four-state: no release: section reported status '$(status_of)', expected 'not-configured'"

# ── E2: `release:` present but UNREADABLE ⇒ exit 3 / not-evaluated (⛔ not pass, ⛔ not 4) ──────
printf 'release: []\n' > "${cfg}"
read_checker
[ "${_rc}" = "3" ] || fail_phase "four-state: a present-but-unreadable release: section exited ${_rc}, expected 3 (not-evaluated) — 'could not read' must be distinguishable from both 'nothing declared' (4) and 'judged and failed' (1)"
[ "$(status_of)" = "not-evaluated" ] || fail_phase "four-state: unreadable release: section reported status '$(status_of)', expected 'not-evaluated'"
echo "phase E (four-state): no section ⇒ 4/not-configured, unreadable section ⇒ 3/not-evaluated"

exit 0
