#!/usr/bin/env bash
# Mutation case for checker-count-drift-check (tasks/gap-checker-claim-vs-actual-cadence-and-count-drift,
# AC3 判据能取假). The checker's own negative control: a registry whose declared `# @checker-count`
# disagrees with its function body's run_checker entries MUST go RED — in BOTH directions (a stale
# over-count is the historical defect: 35 declared vs 58 measured; an under-count is the same class)
# — and a carrier that is absent/unreadable MUST report NOT-EVALUATED (exit 3), never PASS.
#
# Fixture: a temp root with the two carrier shapes the checker owns —
#   plugin/scripts/runner-static-gate.ts (run_static_checks: 2 entries; run_operational_checks: 1)
#   scripts/test.sh                      (run_doc_checks: 1 entry)
# The declared annotations are written to MATCH first (GREEN), then perturbed one carrier at a time.
#
# Exit contract (checker-mutation-check.sh lines 41-44): 0 = behaved, 3 = STAYED-GREEN,
# 4 = ALWAYS-RED; 5 = a deviation outside those two (e.g. NOT-EVALUATED not honoured).
set -u
name="checker-count-drift-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/scripts"

# write_gate <declared-for-run_static_checks>|none
write_gate() {
  local decl="$1"
  {
    echo '# fixture carrier (mutation-case only — not the real registry)'
    if [ "$decl" != "none" ]; then
      echo "# @checker-count ${decl}"
    fi
    echo 'run_static_checks() {'
    echo '  run_checker "checker-a" node "${repo_root}/plugin/scripts/a.ts"'
    echo '  run_checker "checker-b" node "${repo_root}/plugin/scripts/b.ts"'
    echo '}'
    echo ''
    echo '# @checker-count 1'
    echo 'run_operational_checks() {'
    echo '  run_checker "op-a" node "${repo_root}/plugin/scripts/op-a.ts"'
    echo '}'
  } > "${workdir}/plugin/scripts/runner-static-gate.ts"
}

# write_test_sh <declared-for-run_doc_checks>
write_test_sh() {
  {
    echo '# fixture carrier (mutation-case only)'
    echo "# @checker-count $1"
    echo 'run_doc_checks() {'
    echo '  run_checker "doc-a" node "${repo_root}/plugin/scripts/doc-a.ts"'
    echo '}'
  } > "${workdir}/scripts/test.sh"
}

checker_exit() {
  node --no-warnings --experimental-strip-types "${checker_dir}/checker-count-drift-check.ts" \
    --root "${workdir}" >/dev/null 2>&1
  echo $?
}

# ── GREEN baseline: every declared count equals the body (2 / 1 / 1) → exit 0 ────────────────────
write_gate 2
write_test_sh 1
rc="$(checker_exit)"
if [ "$rc" != "0" ]; then
  echo "baseline RED on agreeing counts (checker always-red?): exit ${rc}" >&2
  exit 4
fi

# ── INJECT 1 (the historical defect shape): the declared count is STALE (2 → 3) → MUST go RED ────
write_gate 3
rc="$(checker_exit)"
if [ "$rc" != "1" ]; then
  echo "STAYED-GREEN — a stale over-count (declared 3, measured 2) did not redden the checker (exit ${rc})" >&2
  exit 3
fi

# ── INJECT 2 (opposite direction): declared 1 < measured 2 → MUST go RED ─────────────────────────
write_gate 1
rc="$(checker_exit)"
if [ "$rc" != "1" ]; then
  echo "STAYED-GREEN — an under-count (declared 1, measured 2) did not redden the checker (exit ${rc})" >&2
  exit 3
fi

# ── INJECT 3 (a SECOND carrier, independent of the first): the doc-class count drifts → RED ──────
write_gate 2
write_test_sh 2
rc="$(checker_exit)"
if [ "$rc" != "1" ]; then
  echo "STAYED-GREEN — a drifted doc-class count (declared 2, measured 1) did not redden the checker (exit ${rc})" >&2
  exit 3
fi

# ── RESTORE → GREEN (proves the two REDs above were caused by the injections, not by always-red) ─
write_test_sh 1
rc="$(checker_exit)"
if [ "$rc" != "0" ]; then
  echo "ALWAYS-RED — restored agreeing counts still redden the checker (exit ${rc})" >&2
  exit 4
fi

# ── CARRIER ABSENT: the checker must report NOT-EVALUATED (3), NOT PASS (硬规则 3b) ───────────────
rm -f "${workdir}/scripts/test.sh"
rc="$(checker_exit)"
if [ "$rc" != "3" ]; then
  echo "NOT-EVALUATED not honoured — an absent carrier produced exit ${rc} (expected 3; 0 would be the 硬规则 3b defect: unreadable reading as PASS)" >&2
  exit 5
fi

# ── ANNOTATION ABSENT: a registry with no declaration is unreadable, not clean → exit 3 ──────────
write_test_sh 1
write_gate none
rc="$(checker_exit)"
if [ "$rc" != "3" ]; then
  echo "NOT-EVALUATED not honoured — a missing @checker-count annotation produced exit ${rc} (expected 3)" >&2
  exit 5
fi

exit 0
