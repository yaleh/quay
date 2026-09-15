#!/usr/bin/env bash
# Mutation case for release-master-advance-needs-check
# (tasks/gap-first-green-release-and-master-ff, GOAL-020 AC-274; SPEC §6.1 invariant 3).
#
# Fixture: a self-contained workspace under <workdir> carrying ONLY
#   .github/workflows/release.yml
# The case drives the REAL checker with `--root <workdir>`, so it never mutates the repo's own tree.
#
# WHAT IS BEING MUTATED (and why each phase exists — a phase that a plausible-but-wrong
# implementation would survive is not worth running):
#   A   baseline: advance-master needs the other two jobs          → exit 0
#   B   a THIRD job is added and NOT put in needs                  → MUST go non-zero
#       (this is the exact rot SPEC §6.1 invariant 3 exists for: the 7th-job omission)
#   B2  a job is added and needs is left covering only the old set  → MUST go non-zero
#       (B with the pre-existing entries still present — proves the check is a SET comparison
#        against the file's own job keys, not "needs is non-empty" / "needs mentions ≥1 job")
#   B3  `needs:` deleted from advance-master entirely               → MUST go non-zero
#       (a job with no dependencies moves master on ANY release run; an implementation that treats
#        an absent `needs:` as "nothing to compare" — i.e. as NOT-EVALUATED or PASS — stays green
#        here, which is the 硬规则 3b shape this phase is for)
#   C   restore                                                     → exit 0 (ALWAYS-RED detector)
#   D   tri-state: workflow file absent                             → exit 3, distinct from 0 and 1
#   D2  tri-state: no top-level `jobs:` mapping                     → exit 3
#   D3  tri-state: no `advance-master` job in the file              → exit 3
#       (D/D2/D3 are the three unreadable shapes the task names; all three must be distinguishable
#        from BOTH "pass" and "fail", and each carries its own reason slug)
#   E   the REAL repo workflow, copied in verbatim                   → exit 0; then the same file with
#       a 7th job injected and NOT added to needs                    → non-zero.
#       This phase is what makes the case bite on the SHIPPING artifact rather than only on
#       hand-written fixtures: a checker that happened to fit the fixtures but not release.yml's real
#       layout (multi-line flow `needs:`, long comment blocks, matrix jobs) is caught here.
set -u
name="release-master-advance-needs-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker="${checker_dir}/${name}.ts"
[ -f "$checker" ] || { echo "infrastructure: checker not found at $checker" >&2; exit 2; }

rm -rf "${workdir}"
mkdir -p "${workdir}/.github/workflows"
cd "${workdir}" || exit 2

wf="${workdir}/.github/workflows/release.yml"

rc_of() {
  node --no-warnings --experimental-strip-types "$checker" --root "$1" >/dev/null 2>&1
  echo $?
}

# ── A: the shape the invariant asks for — a three-job file whose advance-master needs both others ──
write_covered() {
  cat > "${wf}" <<'YAML'
name: Release
on:
  workflow_dispatch:
    inputs:
      tag:
        description: tag
        required: true
        type: string
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  delivery-manifest-verify:
    needs: [release]
    runs-on: ubuntu-latest
    steps:
      - run: echo manifest
  advance-master:
    needs: [release, delivery-manifest-verify]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: git push origin "${TAG}:master"
YAML
}

# ── B: a third job exists that advance-master's needs does NOT name (the 7th-job omission) ────────
write_extra_job_uncovered() {
  write_covered
  cat >> "${wf}" <<'YAML'
  sea-release:
    runs-on: ubuntu-latest
    steps:
      - run: echo sea
YAML
}

# ── B3: advance-master declares NO dependencies at all ───────────────────────────────────────────
write_needs_deleted() {
  cat > "${wf}" <<'YAML'
name: Release
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  delivery-manifest-verify:
    needs: [release]
    runs-on: ubuntu-latest
    steps:
      - run: echo manifest
  advance-master:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: git push origin "${TAG}:master"
YAML
}

# ── D2: a workflow with no top-level `jobs:` mapping at all ──────────────────────────────────────
write_no_jobs_block() {
  cat > "${wf}" <<'YAML'
name: Release
on:
  workflow_dispatch:
    inputs:
      tag:
        description: tag
        required: true
        type: string
YAML
}

# ── D3: a readable jobs mapping that simply has no advance-master job ────────────────────────────
write_no_target_job() {
  cat > "${wf}" <<'YAML'
name: Release
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo release
  delivery-manifest-verify:
    needs: [release]
    runs-on: ubuntu-latest
    steps:
      - run: echo manifest
YAML
}

# ── A: baseline GREEN ────────────────────────────────────────────────────────────────────────────
write_covered
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "0" ]; then
  echo "baseline RED on a fixture where advance-master needs every other job (checker always-red? got ${rc})" >&2
  exit 4
fi

# ── B: a job the needs: list does not name ⇒ MUST bite ───────────────────────────────────────────
write_extra_job_uncovered
if rc_of "${workdir}" | grep -qx 0; then
  echo "STAYED-GREEN: a job ('sea-release') exists in the workflow and is NOT in advance-master.needs, yet exit was 0 — the checker cannot see the exact 7th-job omission SPEC §6.1 invariant 3 exists for" >&2
  exit 3
fi

# ── B2: same defect, with the OLD entries still present ⇒ MUST still bite ────────────────────────
# (proves the predicate is a set difference against the file's own job keys, not "needs is non-empty")
write_extra_job_uncovered
if rc_of "${workdir}" | grep -qx 0; then
  echo "STAYED-GREEN: needs names every OLD job but misses the newly added one — a 'needs is non-empty' predicate would pass here" >&2
  exit 3
fi

# ── B3: no needs: at all ⇒ MUST bite (a job with no dependencies moves master on ANY run) ────────
write_needs_deleted
rc="$(rc_of "${workdir}")"
if [ "${rc}" = "0" ]; then
  echo "STAYED-GREEN: advance-master declares no needs: at all (it would run on every release run regardless of the other jobs) and the checker exited 0" >&2
  exit 3
fi
if [ "${rc}" = "3" ]; then
  echo "WRONG-STATE: an ABSENT needs: was reported NOT-EVALUATED (3); it is a readable empty set and must be a FAIL (1) — 'nothing to compare' rendered as 'could not judge' is the 硬规则 3b shape" >&2
  exit 3
fi

# ── C: restore ⇒ GREEN again (ALWAYS-RED detector) ──────────────────────────────────────────────
write_covered
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "0" ]; then
  echo "ALWAYS-RED: restored fixture (advance-master needs every other job) exits ${rc}, not 0" >&2
  exit 4
fi

# ── D: the workflow file is absent ⇒ NOT-EVALUATED (3), distinct from 0 and 1 ───────────────────
mv "${wf}" "${wf}.off"
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "3" ]; then
  echo "tri-state FAIL: workflow absent ⇒ expected exit 3 NOT-EVALUATED, got ${rc}" >&2
  exit 3
fi

# ── D2: no top-level jobs: mapping ⇒ NOT-EVALUATED (3) ──────────────────────────────────────────
write_no_jobs_block
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "3" ]; then
  echo "tri-state FAIL: no readable jobs: mapping ⇒ expected exit 3 NOT-EVALUATED, got ${rc}" >&2
  exit 3
fi

# ── D3: no advance-master job ⇒ NOT-EVALUATED (3) ───────────────────────────────────────────────
write_no_target_job
rc="$(rc_of "${workdir}")"
if [ "${rc}" != "3" ]; then
  echo "tri-state FAIL: no advance-master job ⇒ expected exit 3 NOT-EVALUATED, got ${rc}" >&2
  exit 3
fi

# ── E: the REAL shipping workflow, verbatim, then with a 7th job injected ────────────────────────
real_wf="${checker_dir}/../../.github/workflows/release.yml"
if [ -f "${real_wf}" ]; then
  cp "${real_wf}" "${wf}"
  rc="$(rc_of "${workdir}")"
  if [ "${rc}" != "0" ]; then
    echo "REAL-ARTIFACT RED: ${real_wf} — the shipping release.yml exits ${rc}, not 0; either advance-master.needs really is incomplete (then release.yml is the defect) or the checker mis-reads the real layout (multi-line flow needs:, comment blocks, matrix jobs)" >&2
    exit 4
  fi
  cat >> "${wf}" <<'YAML'
  newly-added-seventh-job:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
YAML
  rc="$(rc_of "${workdir}")"
  if [ "${rc}" = "0" ]; then
    echo "STAYED-GREEN on the REAL artifact: a 7th job was appended to a verbatim copy of release.yml and the checker still exited 0" >&2
    exit 3
  fi
else
  echo "phase E NOT RUN: no real workflow at ${real_wf} — the fixture phases above still ran, but the shipping layout was not exercised" >&2
fi

exit 0
