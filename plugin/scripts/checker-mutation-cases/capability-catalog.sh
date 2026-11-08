#!/usr/bin/env bash
# Mutation case for capability-catalog (gap-retired-script-still-callable, AC5 — the
# superseded-capability check).
# Fixture: a temp tree (with a COPIED capability-catalog.sh under plugin/scripts/ so its SELF_DIR
# resolves to <tmp>/plugin/scripts) holding NO superseded implementation in the executable layer
# → GREEN. capability-catalog.sh now sources repo-root.sh (SPEC §2.4 B2 pair), so the dependency
# is copied too; a `.git` marker makes repoRoot("${SELF_DIR}") resolve to the temp tree (it walks
# up bundle→consumer→git) — without it the walk would fall through to the CALLER's `git rev-parse`
# and check the real repo instead of this synthetic one.
# Inject: a plugin/scripts/send-keys-verified.sh file — a superseded implementation that per the
# SUPERSEDED table must NOT exist → --superseded-check MUST go RED.
# Restore: remove the injected file → back to GREEN.
set -u
name="capability-catalog"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/.git"
cp "${checker_dir}/capability-catalog.sh" "${workdir}/plugin/scripts/capability-catalog.sh"
cp "${checker_dir}/repo-root.sh" "${workdir}/plugin/scripts/repo-root.sh"
cp "${checker_dir}/repo-root.ts" "${workdir}/plugin/scripts/repo-root.ts"
# The declaration tables are DATA now (gap-arch-catalog-declarations-leave-bash): the .sh is a thin
# exec wrapper around capability-catalog.ts, which reads capability-catalog-declarations.json.
# Copying only the entry leaves the renderer/data absent ⇒ the entry exits 3 (CAUSE=..., not a
# reddening data change) and this mutation case reads as "baseline RED — checker always-red?".
cp "${checker_dir}/capability-catalog.ts" "${workdir}/plugin/scripts/capability-catalog.ts"
cp "${checker_dir}/capability-catalog-declarations.json" "${workdir}/plugin/scripts/capability-catalog-declarations.json"

# The entry's LOCAL `.ts` import graph is copied too — transitively, not as a hand-maintained list.
# A hardcoded list is the same defect one level down: every new `import … from "./x.ts"` in the
# checker turned this fixture's baseline phase ALWAYS-RED for a FIXTURE OMISSION, reported as
# "checker always-red?" (2026-11-08: capability-catalog.ts#deriveScripts was routed through
# fs-walk.ts#walkFiles and this case went red with nothing wrong with the checker). Recursing over
# the entry's own relative specifiers means the next import is copied automatically.
# ⛔ anchored at `^\s*import` so the doc-comment examples in repo-root.ts are NOT copied as deps.
copy_local_imports() {
  local dep
  while read -r dep; do
    [ -f "${checker_dir}/${dep}" ] || continue
    [ -f "${workdir}/plugin/scripts/${dep}" ] && continue
    cp "${checker_dir}/${dep}" "${workdir}/plugin/scripts/${dep}"
    copy_local_imports "${dep}"
  done < <(grep -E '^[[:space:]]*import .*"\./[^"]+"' "${checker_dir}/${1}" 2>/dev/null \
             | sed -E 's/^[^"]*"\.\/([^"]+)".*$/\1/')
}
copy_local_imports capability-catalog.ts

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
