#!/usr/bin/env bash
# Mutation case for capability-catalog (gap-retired-script-still-callable, AC5 — the
# superseded-capability check).
# Fixture: a temp tree (with a COPIED capability-catalog.sh under plugin/scripts/ so its SELF_DIR
# resolves to <tmp>/plugin/scripts and REPO_ROOT = the temp tree) holding NO superseded
# implementation in the executable layer → GREEN.
# Inject: a plugin/scripts/send-keys-verified.sh file — a superseded implementation that per the
# SUPERSEDED table must NOT exist → --superseded-check MUST go RED.
# Restore: remove the injected file → back to GREEN.
set -u
name="capability-catalog"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cp "${checker_dir}/capability-catalog.sh" "${workdir}/plugin/scripts/capability-catalog.sh"

checker_cmd() {
  bash "${workdir}/plugin/scripts/capability-catalog.sh" --superseded-check >/dev/null 2>&1
}

# GREEN baseline: no superseded implementation in the executable layer → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a clean tree with no superseded implementation (checker always-red?)" >&2
  exit 4
fi

# INJECT: a superseded implementation file (send-keys-verified.sh — must NOT exist per the
# SUPERSEDED table) → MUST go RED.
cat > "${workdir}/plugin/scripts/send-keys-verified.sh" <<'EOF'
#!/usr/bin/env bash
# a superseded implementation that must not exist in the executable layer
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected superseded implementation did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the injected superseded file → back to green.
rm -f "${workdir}/plugin/scripts/send-keys-verified.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored clean tree still reddens the checker" >&2
  exit 4
fi

exit 0
