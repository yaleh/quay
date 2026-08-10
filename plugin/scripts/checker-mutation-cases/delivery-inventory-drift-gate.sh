#!/usr/bin/env bash
# Mutation case for delivery-inventory-drift-gate (gap-delivery-inventory-drift-needs-file-add-gate).
# Fixture: a temp GIT repo whose docs/proposals/quay-product-outline.md carries a DELIVERY-INVENTORY
# snapshot block and whose plugin/scripts/ has one committed existing.sh → GREEN baseline.
#   INJECT-A (invariant new_script_requires_outline): ADD plugin/scripts/foo-new.sh WITHOUT touching
#     the outline → the gate MUST go RED (exit 1).
#   RESTORE-A: rm foo-new.sh → GREEN.
#   INJECT-B (invariant content_only_change_skipped): edit an EXISTING script's content (no A/D) →
#     the gate must stay GREEN (candidate B: content edits do not trigger).
#   RESTORE-B: git checkout the edited script → GREEN.
#   INJECT-C (outline_updated_alongside): ADD another script AND update the outline snapshot → GREEN.
set -u
name="delivery-inventory-drift-gate"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/docs/proposals" "${workdir}/plugin/scripts"
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

# GREEN baseline: clean tree, no plugin/scripts A/D → exit 0.
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

exit 0
