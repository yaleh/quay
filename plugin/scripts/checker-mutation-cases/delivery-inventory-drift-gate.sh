#!/usr/bin/env bash
# Mutation case for delivery-inventory-drift-gate (gap-drift-gate-covers-only-plugin-scripts-not-workflows).
# Fixture: a temp GIT repo whose .claude/workflows/ + plugin/workflows/ carry one committed mirrored
# workflow (existing-wf.js) → GREEN baseline. The OUTLINE-snapshot trigger (INJECT-A/B/C phases) is
# RETIRED (gap-delivery-inventory-check-time-computation): the inventory is computed at check time, so
# a plugin/scripts A/D no longer reddens the gate.
#   INJECT-D (invariant new_workflow_requires_mirror): ADD .claude/workflows/foo-new.js WITHOUT
#     touching plugin/workflows/ → the gate MUST go RED (exit 1).
#   RESTORE-D: rm foo-new.js → GREEN.
#   INJECT-E (workflow content_only_change_skipped): edit an EXISTING workflow's content (no A/D) →
#     the gate must stay GREEN (content edits do not trigger).
#   RESTORE-E: git checkout the edited workflow → GREEN.
#   INJECT-F (workflow_mirror_alongside): ADD a workflow AND mirror it into plugin/workflows/ →
#     GREEN.
set -u
name="delivery-inventory-drift-gate"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/.claude/workflows" "${workdir}/plugin/workflows"
cat > "${workdir}/.claude/workflows/existing-wf.js" <<'EOF'
export const meta = { name: "existing-wf" };
EOF
cat > "${workdir}/plugin/workflows/existing-wf.js" <<'EOF'
export const meta = { name: "existing-wf" };
EOF
git -C "${workdir}" init -q
git -C "${workdir}" config user.email mutation@test
git -C "${workdir}" config user.name mutation
git -C "${workdir}" add -A
git -C "${workdir}" commit -q -m baseline

# --base HEAD keeps the committed range empty: every phase below mutates the WORKING TREE only,
# which is exactly the pre-commit scoped-test surface the gate must bite on.
checker_cmd() {
  bash "${checker_dir}/delivery-inventory-drift-gate.sh" --root "$1" --base HEAD >/dev/null 2>&1
}

# GREEN baseline: clean tree, no .claude/workflows A/D → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean tree (checker always-red?)" >&2
  exit 4
fi

# INJECT-D: add a NEW .claude/workflows file WITHOUT touching plugin/workflows/ → the gate MUST go RED
# (invariant new_workflow_requires_mirror, gap-drift-gate-covers-only-plugin-scripts-not-workflows).
cat > "${workdir}/.claude/workflows/foo-new.js" <<'EOF'
export const meta = { name: "foo-new" };
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — .claude/workflows addition without plugin/workflows mirror did not redden the gate (new_workflow_requires_mirror broken)" >&2
  exit 3
fi

# RESTORE-D: remove the injected workflow → back to green.
rm -f "${workdir}/.claude/workflows/foo-new.js"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean tree (post-workflow-inject) still reddens the gate" >&2
  exit 4
fi

# INJECT-E: modify an EXISTING workflow's content (no A/D) → the gate must stay GREEN (content-only).
printf '\n// changed\n' >> "${workdir}/.claude/workflows/existing-wf.js"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — content-only edit to an existing workflow triggered the gate (workflow content_only_change_skipped broken)" >&2
  exit 4
fi

# RESTORE-E: revert the content edit → green (clean slate for the final phase).
git -C "${workdir}" checkout -- .claude/workflows/existing-wf.js
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — tree after workflow content-edit revert still reddens the gate" >&2
  exit 4
fi

# INJECT-F: add a new workflow AND mirror it into plugin/workflows/ → GREEN.
cat > "${workdir}/.claude/workflows/bar-new.js" <<'EOF'
export const meta = { name: "bar-new" };
EOF
cp "${workdir}/.claude/workflows/bar-new.js" "${workdir}/plugin/workflows/bar-new.js"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — workflow addition WITH plugin/workflows mirror still reddens the gate" >&2
  exit 4
fi

exit 0
