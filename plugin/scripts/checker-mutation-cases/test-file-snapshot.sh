#!/usr/bin/env bash
# Mutation case for test-file-snapshot-check (gap-test-file-snapshot-no-production-caller): the
# defect is a DELETED test file that the relative-baseline criterion fails to catch. The wired
# production call is `test-file-snapshot.sh --repo-relative check <committed-baseline>` from
# run_static_checks (scripts/test.sh); this case proves the WIRED direction end-to-end on a
# hermetic repo whose `scripts/test.sh --list-files` returns a fixture set:
#   GREEN baseline  — fixture {a,b,c} == baseline {a,b,c} → exit 0
#   INJECT          — fixture {a,c} (b.test.mjs removed)  → exit 1 (RED, removal named)
#   RESTORE         — fixture {a,b,c} → exit 0 again
# A masking fix (or a checker that never reads the set) stays green forever and fails exit 3.
set -u
name="test-file-snapshot"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── hermetic repo: a fake scripts/test.sh whose --list-files is the fixture ─────────────────────────
repo="${workdir}/repo"
mkdir -p "${repo}/scripts" "${repo}/docs/analysis"

# write_fake_test_sh <newline-joined repo-relative set> — writes a fake scripts/test.sh whose
# --list-files prints exactly that set (the mutation-case's single source of truth for the glob).
write_fake_test_sh() {
  local list="$1"
  cat > "${repo}/scripts/test.sh" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "--list-files" ]; then
  cat <<'SET'
$list
SET
fi
EOF
  chmod +x "${repo}/scripts/test.sh"
}

# The committed baseline — repo-relative, mirrors docs/analysis/test-file-baseline.txt.
baseline="${repo}/docs/analysis/test-file-baseline.txt"
printf '%s\n' \
  "packages/quay/test/a.test.mjs" \
  "packages/quay/test/b.test.mjs" \
  "packages/quay/test/c.test.mjs" > "${baseline}"

# checker — the EXACT wired production invocation (run_static_checks calls the same command shape).
checker() {
  bash "${checker_dir}/test-file-snapshot.sh" --root "${repo}" --repo-relative check "${baseline}"
}

SET_FULL="packages/quay/test/a.test.mjs
packages/quay/test/b.test.mjs
packages/quay/test/c.test.mjs"
SET_SHRUNK="packages/quay/test/a.test.mjs
packages/quay/test/c.test.mjs"

# GREEN baseline: fixture == baseline → exit 0.
write_fake_test_sh "$SET_FULL"
if checker >/dev/null 2>&1; then :; else
  echo "ALWAYS-RED — an intact set reddened the checker (always-red?)" >&2
  exit 4
fi

# INJECT: b.test.mjs is deleted from the fixture → MUST go red (exit 1) AND name the removed file.
write_fake_test_sh "$SET_SHRUNK"
if checker >/dev/null 2>&1; then
  echo "STAYED-GREEN — a deleted test file did not redden the checker" >&2
  exit 3
fi
if ! checker 2>&1 | grep -q "b.test.mjs"; then
  echo "STAYED-GREEN — the RED output did not name the removed file" >&2
  exit 3
fi

# RESTORE: full set → GREEN again.
write_fake_test_sh "$SET_FULL"
if checker >/dev/null 2>&1; then :; else
  echo "ALWAYS-RED — the restored set still reddens the checker" >&2
  exit 4
fi

exit 0
