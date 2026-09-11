#!/usr/bin/env bash
# Mutation case for criterion-failure-attribution-check (tasks/gap-goal-criteria-bare-failing-exit-unattributable,
# GOAL-009 AC-241).
#
# Fixture: a self-contained workspace under <workdir> —
#   goals/AC-900-fixture.md                     one in-domain criterion carrying a BARE `sys.exit(1)`
#   goals/AC-901-fixture.md                     the INJECTED twin (a bare shell `exit 1`)
#   docs/analysis/criterion-failure-attribution.baseline.json   count=1 (the shrink-only anchor)
# The case drives the REAL checker with `--root <workdir>`, so it never touches the committed baseline.
#
# Phases (checker-mutation-check.sh contract: 0 = behaved, 3 = STAYED-GREEN, 4 = ALWAYS-RED, 2 = infra):
#   A baseline: 1 bare AC == baseline 1        → exit 0
#   B inject:   2 bare ACs >  baseline 1       → MUST go non-zero (the ratchet must be able to bite)
#   C restore:  1 bare AC == baseline 1        → exit 0 again (ALWAYS-RED detector)
#   D tri-state: goals/ removed → MUST be exit 3 NOT-EVALUATED, distinct from BOTH 0 and 1
#     (hard rule 3b: a checker that cannot read its input must not render as "no bare failure exits")
set -u
name="criterion-failure-attribution-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker="${checker_dir}/${name}.ts"
[ -f "$checker" ] || { echo "infrastructure: checker not found at $checker" >&2; exit 2; }

mkdir -p "${workdir}/goals" "${workdir}/docs/analysis"
cd "${workdir}" || exit 2

checker_cmd() {
  node --no-warnings --experimental-strip-types "$checker" --root "$1" >/dev/null 2>&1
}

write_fixture() { # $1 = AC id, $2 = criterion body (literal block)
  cat > "${workdir}/goals/$1-fixture.md" <<EOF
---
id: $1
title: mutation fixture $1
status: active
kind: criterion
criterion: |
$2
---
EOF
}

write_baseline() { # $1 = count
  cat > "${workdir}/docs/analysis/criterion-failure-attribution.baseline.json" <<EOF
{
  "count": $1,
  "inDomain": $1,
  "entries": [{ "id": "AC-900", "file": "AC-900-fixture.md", "bareLines": [4] }],
  "generatedAt": "2026-09-11T00:00:00.000Z"
}
EOF
}

bare_criterion() {
  printf '  python3 - <<'"'"'P'"'"'\n  import sys\n  sys.exit(1)\n  P\n'
}

injected_criterion() {
  printf '  test -f /nonexistent-quay-fixture || exit 1\n'
}

# ── A: baseline GREEN ────────────────────────────────────────────────────────────────────────────
write_fixture AC-900 "$(bare_criterion)"
write_baseline 1
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a 1-bare-AC fixture against baseline 1 (checker always-red?)" >&2
  exit 4
fi

# ── B: INJECT a second bare-AC criterion ⇒ the ratchet MUST bite ─────────────────────────────────
write_fixture AC-901 "$(injected_criterion)"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN: checker exited 0 with bareAcs=2 > baseline 1 (the ratchet cannot bite)" >&2
  exit 3
fi

# ── C: RESTORE ⇒ GREEN again ─────────────────────────────────────────────────────────────────────
rm -f "${workdir}/goals/AC-901-fixture.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED: checker still non-zero after restoring bareAcs=1 <= baseline 1" >&2
  exit 4
fi

# ── D: TRI-STATE — an unreadable goals/ must be exit 3, distinct from BOTH pass (0) and red (1) ──
rm -rf "${workdir}/goals"
checker_cmd "${workdir}"
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "STAYED-GREEN: checker exited 0 with goals/ REMOVED (unreadable input masquerading as 'no bare failure exits', 硬规则 3b)" >&2
  exit 3
fi
if [ "$rc" -eq 1 ]; then
  echo "NOT-EVALUATED conflated with RED: goals/ removed exited 1 — the three states must be pairwise distinct (硬规则 3b)" >&2
  exit 4
fi
if [ "$rc" -ne 3 ]; then
  echo "unexpected exit code $rc for an unreadable goals/ (want 3 = NOT-EVALUATED)" >&2
  exit 4
fi

exit 0
