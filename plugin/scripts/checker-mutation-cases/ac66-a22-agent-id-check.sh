#!/usr/bin/env bash
# Mutation case for ac66-a22-agent-id-check (gap-ac66-ac-driven-behavior-change-verifiable).
# Fixture: a temp tick-log whose LATEST A22 reading line carries the subagent's agent id
# → GREEN (the A22 behavior is in effect). Inject: replace the latest A22 line with one that
# reports the ready-pool reading WITHOUT an agent id (the real pre-fix absence form) → the
# checker MUST go RED (无标识即视为未执行). Restore: put the compliant line back → GREEN.
# The --log seam keeps the fixture hermetic regardless of the live repo's tick-log.
set -u
name="ac66-a22-agent-id-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}"
compliant='- `08:0xZ` — 本轮 A22 由后台 subagent（agentId afb5faed96138c7c6）执行，读数 POOL=4 / FLOOR=20 / DEFICIT=16 / PROMOTIONS=NONE。'
absent='- `08:0xZ` — **A22 心跳**：promotions=AC76+AC77（todo→ready，fddb20b8）；pool 7/floor 20。'

cat > "${workdir}/tick-log.md" <<EOF
- \`02:10Z\` — ${compliant}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/ac66-a22-agent-id-check.ts" --log "$1/tick-log.md" >/dev/null 2>&1
}

# GREEN baseline: latest A22 reading line carries the agent id → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a compliant A22 reading line (checker always-red?)" >&2
  exit 4
fi

# INJECT: latest A22 reading line WITHOUT an agent id (the real absence form) → MUST go RED.
cat > "${workdir}/tick-log.md" <<EOF
- \`08:0xZ\` — ${absent}
EOF
if checker_cmd "${workdir}"; then
  echo "mutation NOT caught: an A22 reading line without an agent id stayed GREEN" >&2
  exit 1
fi

# RESTORE: back to the compliant line → GREEN again.
cat > "${workdir}/tick-log.md" <<EOF
- \`08:0xZ\` — ${compliant}
EOF
if checker_cmd "${workdir}"; then
  echo "ac66-a22-agent-id-check mutation case: PASS (agent-id-less A22 line caught, compliant restored)" >&2
else
  echo "RESTORE still RED after removing the mutation (checker stuck red?)" >&2
  exit 4
fi
exit 0
