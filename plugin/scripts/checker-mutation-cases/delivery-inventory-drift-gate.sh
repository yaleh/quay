#!/usr/bin/env bash
# Mutation case for delivery-inventory-drift-gate (gap-delivery-inventory-drift-needs-file-add-gate +
# gap-drift-gate-covers-only-plugin-scripts-not-workflows).
# Fixture: a temp GIT repo whose docs/proposals/quay-product-outline.md carries a DELIVERY-INVENTORY
# snapshot block, whose plugin/scripts/ has one committed existing.sh, and whose .claude/workflows/
# + plugin/workflows/ carry one committed mirrored workflow (existing-wf.js) → GREEN baseline.
#   INJECT-A (invariant new_script_requires_outline): ADD plugin/scripts/foo-new.sh WITHOUT touching
#     the outline → the gate MUST go RED (exit 1).
#   RESTORE-A: rm foo-new.sh → GREEN.
#   INJECT-B (invariant content_only_change_skipped): edit an EXISTING script's content (no A/D) →
#     the gate must stay GREEN (candidate B: content edits do not trigger).
#   RESTORE-B: git checkout the edited script → GREEN.
#   INJECT-C (outline_updated_alongside): ADD another script AND update the outline snapshot → GREEN.
#   RESTORE-C: rm bar-new.sh + revert the outline → GREEN (clean slate for the workflow phases).
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

mkdir -p "${workdir}/docs/proposals" "${workdir}/plugin/scripts" "${workdir}/.claude/workflows" "${workdir}/plugin/workflows"
cat > "${workdir}/docs/proposals/quay-product-outline.md" <<'EOF'
# outline

<!-- DELIVERY-INVENTORY-BEGIN -->
scripts=1
<!-- DELIVERY-INVENTORY-END -->
EOF
cat > "${workdir}/plugin/scripts/existing.sh" <<'EOF'
#!/usr/bin/env bash
echo existing
EOF
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

# GREEN baseline: clean tree, no plugin/scripts or .claude/workflows A/D → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean tree (checker always-red?)" >&2
  exit 4
fi

# INJECT-A: add a NEW plugin/scripts file without touching the outline → the gate MUST go RED.
cat > "${workdir}/plugin/scripts/foo-new.sh" <<'EOF'
#!/usr/bin/env bash
echo new
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — plugin/scripts addition without outline update did not redden the gate (new_script_requires_outline broken)" >&2
  exit 3
fi

# RESTORE-A: remove the injected file → back to green.
rm -f "${workdir}/plugin/scripts/foo-new.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean tree still reddens the gate" >&2
  exit 4
fi

# INJECT-B: modify an EXISTING script's content (no A/D) → the gate must stay GREEN (candidate B).
printf '\necho changed\n' >> "${workdir}/plugin/scripts/existing.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — content-only edit to an existing script triggered the gate (content_only_change_skipped broken)" >&2
  exit 4
fi

# RESTORE-B: revert the content edit → green (clean slate for the next phase).
git -C "${workdir}" checkout -- plugin/scripts/existing.sh
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — tree after content-edit revert still reddens the gate" >&2
  exit 4
fi

# INJECT-C: add a new script AND update the outline snapshot → GREEN.
cat > "${workdir}/plugin/scripts/bar-new.sh" <<'EOF'
#!/usr/bin/env bash
echo bar
EOF
sed -i 's/scripts=1/scripts=2/' "${workdir}/docs/proposals/quay-product-outline.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — script addition WITH outline update still reddens the gate" >&2
  exit 4
fi

# RESTORE-C: remove bar-new.sh + revert the outline → green (clean slate for the workflow phases).
rm -f "${workdir}/plugin/scripts/bar-new.sh"
sed -i 's/scripts=2/scripts=1/' "${workdir}/docs/proposals/quay-product-outline.md"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — tree after INJECT-C revert still reddens the gate" >&2
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
