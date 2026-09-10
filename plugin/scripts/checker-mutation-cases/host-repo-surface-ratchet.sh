#!/usr/bin/env bash
# Mutation case for host-repo-surface-ratchet (gap-host-repo-surface-ratchet, GOAL-015 退出条件④ / AC-236).
# Fixture: a root whose three enumerated surfaces are CONTROLLED FAKES —
#   packages/quay/bin/quay.ts              prints a fixed --help (2 verbs: init, task)
#   packages/quay/src/serve-handlers.ts    + serve.ts carry fixed url.pathname === "…" routes (4 total)
#   plugin/scripts/config-key-consumer-check.ts prints a fixed --json (2 has-consumer keys)
# The checker enumerates the REAL entry/sources under --root (never a fixture of the checker itself),
# so the fakes stand in for the real surface — the mutation tests the checker's JUDGMENT, not the real
# quay entry.
# GREEN: baseline == current (captured by --capture) → exit 0.
# Inject: remove one route (/tasks) → the surface SHRANK ⇒ the checker MUST go RED (exit 1).
# Restore → GREEN.
set -u
name="host-repo-surface-ratchet"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/packages/quay/bin" "${workdir}/packages/quay/src" "${workdir}/plugin/scripts"

# Fake CLI entry: prints a fixed --help surface (2 verbs).
cat > "${workdir}/packages/quay/bin/quay.ts" <<'EOF'
if (process.argv.includes("--help")) {
  process.stdout.write("Usage:\n  quay --version | -V\n  quay init [--force]\n  quay task list\n");
}
EOF

# Fake web-route sources: 3 routes in serve-handlers.ts + 1 in serve.ts.
write_routes() { # $1 = "yes" (with /tasks) | "no" (without /tasks)
  {
    echo 'if (url.pathname === "/") {}'
    if [ "$1" = "yes" ]; then echo 'if (url.pathname === "/tasks") {}'; fi
    echo 'if (url.pathname === "/dashboard") {}'
  } > "${workdir}/packages/quay/src/serve-handlers.ts"
  echo 'if (url.pathname === "/health") {}' > "${workdir}/packages/quay/src/serve.ts"
}

# Fake config-key consumer check: prints a fixed --json with 2 has-consumer keys.
cat > "${workdir}/plugin/scripts/config-key-consumer-check.ts" <<'EOF'
process.stdout.write(JSON.stringify({ entries: [
  { key: "k1", state: "has-consumer" },
  { key: "k2", state: "has-consumer" },
] }) + "\n");
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/host-repo-surface-ratchet.ts" --root "$workdir" "$@" >/dev/null 2>&1
}

# Capture the baseline from the green fixture (the checker's own --capture, not a hand-written file).
write_routes "yes"
if checker_cmd --capture; then :; else
  echo "capture failed on a green fixture (checker cannot enumerate the surface?)" >&2
  exit 4
fi

# GREEN baseline → exit 0.
if checker_cmd; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT the defect: remove one route → the surface shrank ⇒ MUST go RED (exit 1).
write_routes "no"
if checker_cmd; then
  echo "STAYED-GREEN — a removed web route (/tasks) did not redden the checker" >&2
  exit 3
fi

# RESTORE the route → back to GREEN.
write_routes "yes"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored route still reddens the checker" >&2
  exit 4
fi

exit 0
