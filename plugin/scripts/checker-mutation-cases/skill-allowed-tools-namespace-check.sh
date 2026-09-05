#!/usr/bin/env bash
# Mutation case for skill-allowed-tools-namespace-check
# (tasks/gap-skill-allowed-tools-plugin-namespace, AC3/DoD negative control). Fixture: a temp workspace
# carrying two shipped skills whose allowed-tools are plugin-prefixed (mcp__plugin_quay_quay__*) → GREEN.
# Inject: write a bare `mcp__quay__*` name back into one skill's allowed-tools — the exact "作者写回裸名"
# shape AC3 requires the checker to go RED on → MUST go RED. Restore: put the plugin prefix back → GREEN.
set -u
name="skill-allowed-tools-namespace-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/skills/a" "${workdir}/plugin/skills/b"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/skill-allowed-tools-namespace-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: both skills plugin-prefixed → exit 0.
cat > plugin/skills/a/SKILL.md <<'EOF'
---
allowed-tools: Bash, Read, mcp__plugin_quay_quay__task_list, mcp__plugin_quay_quay__task_get
---
EOF
cat > plugin/skills/b/SKILL.md <<'EOF'
---
allowed-tools: Bash, Write, mcp__plugin_quay_quay__task_write
---
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fully plugin-prefixed repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: write a bare mcp__quay__ name back into skill b — MUST go RED.
cat > plugin/skills/b/SKILL.md <<'EOF'
---
allowed-tools: Bash, Write, mcp__quay__task_write
---
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a bare mcp__quay__ name in allowed-tools did not redden the checker" >&2
  exit 3
fi

# RESTORE: plugin prefix back → GREEN.
cat > plugin/skills/b/SKILL.md <<'EOF'
---
allowed-tools: Bash, Write, mcp__plugin_quay_quay__task_write
---
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored plugin-prefixed repo still reddens the checker" >&2
  exit 4
fi

exit 0
