#!/usr/bin/env bash
# Mutation case for registry-bare-filename-scan (tasks/gap-dead-set-registry-bare-filename-scan,
# SPEC-plugin-lifecycle-single-bundle-2026-09-02 §12f). Fixture: a workspace whose carrier
# (quay-deliver.ts) references the known sample by bare filename, plus a dead-set result file whose
# after.dead does NOT contain it → GREEN. Inject: put the bare-referenced script into after.dead —
# the exact "裸文件名引用的脚本仍在死集里" shape AC156's --check gate must go RED on → MUST RED.
# Restore: remove it → back to GREEN.
set -u
name="registry-bare-filename-scan"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/docs/analysis"
cd "${workdir}"

# Carrier: quay-deliver.ts references the known sample by a bare filename `file:` field.
cat > plugin/scripts/quay-deliver.ts <<'EOF'
export const MEMBERS = [
  { name: "supervisor-bus-identity", file: "supervisor-bus-identity.sh", kind: "bash" },
];
EOF
# The script itself (must be in the plugin/scripts universe for the scan to see it).
: > plugin/scripts/supervisor-bus-identity.sh

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/registry-bare-filename-scan.ts" \
    --check --root "$1" >/dev/null 2>&1
}

# GREEN baseline: dead-set after.dead does NOT contain the bare-referenced script → exit 0.
cat > docs/analysis/dead-set-recomputed.json <<'EOF'
{"after": {"deadCount": 0, "dead": []}}
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a consistent fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: the bare-referenced script appears in after.dead → MUST go RED.
cat > docs/analysis/dead-set-recomputed.json <<'EOF'
{"after": {"deadCount": 1, "dead": ["supervisor-bus-identity.sh"]}}
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a bare-filename-referenced script in the dead set did not redden the checker" >&2
  exit 3
fi

# RESTORE: back to a consistent dead set → GREEN.
cat > docs/analysis/dead-set-recomputed.json <<'EOF'
{"after": {"deadCount": 0, "dead": []}}
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consistent fixture still reddens the checker" >&2
  exit 4
fi

exit 0
