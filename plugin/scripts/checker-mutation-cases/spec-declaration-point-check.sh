#!/usr/bin/env bash
# Mutation case for spec-declaration-point-check (tasks/gap-spec-declaration-point-mechanical-check,
# AC1/AC2). Fixture: a temp workspace carrying orchestration/SPEC-*.md (two SPECs) + two declaration
# points (plugin/skills/{a,b}/SKILL.md), each declaring both SPECs → GREEN. Inject: DELETE one SPEC's
# declaration from ONE declaration point — the exact "新增 SPEC 漏任一声明点" shape AC1 requires the
# checker to go RED on → MUST go RED. Restore: put the declaration back → back to GREEN.
set -u
name="spec-declaration-point-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration" "${workdir}/plugin/skills/a" "${workdir}/plugin/skills/b"
cd "${workdir}"

printf '# SPEC alpha\n' > orchestration/SPEC-alpha-2026-08-24.md
printf '# SPEC beta\n' > orchestration/SPEC-beta-2026-08-24.md

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/spec-declaration-point-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: both declaration points declare both SPECs → exit 0.
cat > plugin/skills/a/SKILL.md <<'EOF'
- `orchestration/SPEC-alpha-2026-08-24.md` — alpha
- `orchestration/SPEC-beta-2026-08-24.md` — beta
EOF
cat > plugin/skills/b/SKILL.md <<'EOF'
<!-- reference-doc: orchestration/SPEC-alpha-2026-08-24.md -->
<!-- reference-doc: orchestration/SPEC-beta-2026-08-24.md -->
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fully-declared repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: delete SPEC-beta's declaration from point b — now beta is missing from one point → MUST go RED.
cat > plugin/skills/b/SKILL.md <<'EOF'
<!-- reference-doc: orchestration/SPEC-alpha-2026-08-24.md -->
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a SPEC missing from one declaration point did not redden the checker" >&2
  exit 3
fi

# RESTORE: put SPEC-beta's declaration back → back to GREEN.
cat > plugin/skills/b/SKILL.md <<'EOF'
<!-- reference-doc: orchestration/SPEC-alpha-2026-08-24.md -->
<!-- reference-doc: orchestration/SPEC-beta-2026-08-24.md -->
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored fully-declared repo still reddens the checker" >&2
  exit 4
fi

exit 0
