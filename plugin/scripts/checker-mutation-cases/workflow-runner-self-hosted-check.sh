#!/usr/bin/env bash
# Mutation case for workflow-runner-self-hosted-check (gap-metered-hosted-runner-jobs-to-self-hosted,
# AC3 判据能取假). Fixture: a temp root whose .github/workflows/ holds an all-self-hosted workflow set
# → GREEN. Inject: ONE job's `runs-on` back to `ubuntu-latest` → the checker MUST go RED **and name
# that job** (AC2 — a red that does not name the job cannot be acted on). Restore → GREEN.
#
# Then the two arms that keep "could not read the input" out of the pass value (硬规则 3b):
#   • expression `runs-on` (${{ … }}) ⇒ RED — the runner is decided at run time, so the job is not
#     STATICALLY self-hosted;
#   • a job with NO `runs-on` at all ⇒ RED — a reusable-workflow call's runner lives in another file;
#   • no workflow directory at all ⇒ exit 3 NOT-EVALUATED (an empty population is not a pass).
set -u
name="workflow-runner-self-hosted-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"
wf="${root}/.github/workflows"

checker() {
  node --no-warnings --experimental-strip-types "${checker_dir}/workflow-runner-self-hosted-check.ts" --root "${root}"
}

mkdir -p "${wf}"

# ── baseline: two files, every job self-hosted → GREEN ────────────────────────────────────────────
write_baseline() {
  cat > "${wf}/ci.yml" <<'YML'
name: ci
on: [push]
jobs:
  test:
    runs-on: [self-hosted, tokyo-alpha]
    steps:
      - uses: actions/checkout@v4
  lint:
    runs-on: [self-hosted, tokyo-alpha]
    steps:
      - run: echo hi
YML
  cat > "${wf}/release.yml" <<'YML'
name: release
on: [workflow_dispatch]
jobs:
  verify:
    runs-on: [self-hosted, tokyo-alpha]
    steps:
      - run: echo ok
YML
}
write_baseline
if checker >/dev/null 2>&1; then :; else
  echo "baseline RED on an all-self-hosted fixture (checker always-red?)" >&2
  exit 4
fi

# ── INJECT: one job back on the metered runner → RED, AND the output names that job ───────────────
python3 - "${wf}/ci.yml" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
mutated = s.replace("""  lint:
    runs-on: [self-hosted, tokyo-alpha]""", """  lint:
    runs-on: ubuntu-latest""", 1)
assert mutated != s, "the injection did not apply — the fixture shape changed"
open(p, "w", encoding="utf-8").write(mutated)
PY
out="$(checker 2>&1)"
rc=$?
if [ "${rc}" -eq 0 ]; then
  echo "STAYED-GREEN — a job moved back to ubuntu-latest did not redden the checker (判据能取假 violated)" >&2
  exit 3
fi
# AC2: the red must POINT AT the offending job — a bare non-zero exit is not the claim.
case "${out}" in
  *"ci.yml:lint"*) : ;;
  *) echo "RED-DID-NOT-NAME-THE-JOB — exit ${rc} but the output never mentions 'ci.yml:lint': ${out}" >&2; exit 5 ;;
esac
# …and it must NOT name a job that is still self-hosted (a red that names everything is noise).
case "${out}" in
  *"ci.yml:test"*) echo "RED-OVER-REPORTED — 'ci.yml:test' is self-hosted yet appears in the output: ${out}" >&2; exit 5 ;;
esac

# ── RESTORE → GREEN again ────────────────────────────────────────────────────────────────────────
write_baseline
if checker >/dev/null 2>&1; then :; else
  echo "ALWAYS-RED — the restored (all-self-hosted) fixture still reddens the checker" >&2
  exit 4
fi

# ── expression runs-on ⇒ RED (run-time-decided runner is not statically self-hosted) ──────────────
python3 - "${wf}/release.yml" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
mutated = s.replace("runs-on: [self-hosted, tokyo-alpha]", "runs-on: ${{ vars.RUNNER }}", 1)
assert mutated != s, "the expression injection did not apply"
open(p, "w", encoding="utf-8").write(mutated)
PY
if checker >/dev/null 2>&1; then
  echo "STAYED-GREEN — a \$\{\{ expression \}\} runs-on did not redden the checker" >&2
  exit 3
fi

# ── no runs-on at all ⇒ RED (reusable-workflow call; its runner is decided in another file) ───────
python3 - "${wf}/release.yml" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
mutated = s.replace("    runs-on: ${{ vars.RUNNER }}\n", "    uses: org/repo/.github/workflows/x.yml@v1\n", 1)
assert mutated != s, "the no-runs-on injection did not apply"
open(p, "w", encoding="utf-8").write(mutated)
PY
if checker >/dev/null 2>&1; then
  echo "STAYED-GREEN — a job with no runs-on did not redden the checker" >&2
  exit 3
fi

# ── no workflow directory ⇒ exit 3 NOT-EVALUATED (never conflated with the pass value) ────────────
rm -rf "${root}/.github"
checker >/dev/null 2>&1
rc=$?
if [ "${rc}" -ne 3 ]; then
  echo "NOT-EVALUATED-MISREPORTED — an absent .github/workflows/ exited ${rc}, expected 3 (a missing population must never read as a pass)" >&2
  exit 5
fi

echo "${name} mutation case: PASS (metered job named, expression + no-runs-on caught, absent workflows = exit 3)" >&2
exit 0
