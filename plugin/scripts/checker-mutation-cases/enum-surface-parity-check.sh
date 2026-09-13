#!/usr/bin/env bash
# Mutation case for enum-surface-parity-check (ADR-036 规范 4 / task
# gap-enum-surfaces-hand-copied-across-cli-web-docs). The checker's own negative control:
# **the authority grows a value and its hand-copied surfaces do not follow ⇒ the checker MUST go RED.**
# Sync them back ⇒ GREEN again.
#
# Fixture: a temp tree with one authority (`auth/enum.ts:COLORS`) and two surface copies of it —
# a ts-array literal (`surf/array.ts:COLORS`) and a help-text enumeration (`surf/help.txt`) — plus a
# registry JSON passed via --registry (the same judgment path the built-in registry uses).
# Inject:   add "yellow" to the AUTHORITY only → both surfaces are out of sync → RED (exit 1).
# Restore:  drop "yellow" from the authority → GREEN.
set -u
name="enum-surface-parity-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/auth" "${workdir}/surf"

write_authority() { # $1 = "yes" (authority carries an EXTRA value) | "no"
  if [ "$1" = "yes" ]; then
    printf 'export const COLORS = ["red", "green", "blue", "yellow"];\n' > "${workdir}/auth/enum.ts"
  else
    printf 'export const COLORS = ["red", "green", "blue"];\n' > "${workdir}/auth/enum.ts"
  fi
}

# The two surfaces are HAND-COPIED 3-value lists — they do not follow the authority on their own.
printf 'export const COLORS = ["red", "green", "blue"];\n' > "${workdir}/surf/array.ts"
printf 'usage: --kind <red|green|blue> [flags]\n' > "${workdir}/surf/help.txt"

cat > "${workdir}/registry.json" <<'JSON'
{
  "authorities": [{ "id": "color", "file": "auth/enum.ts", "symbol": "COLORS", "extract": "ts-array" }],
  "surfaces": [
    { "id": "array-surface", "authority": "color", "file": "surf/array.ts", "extract": "ts-array", "symbol": "COLORS", "policy": "exact" },
    { "id": "text-surface", "authority": "color", "file": "surf/help.txt", "extract": "text", "anchor": "--kind <([a-z-]+\\|[a-z|-]+)>", "policy": "exact" }
  ],
  "knownDrift": []
}
JSON

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/enum-surface-parity-check.ts" \
    --root "${workdir}" --registry "${workdir}/registry.json" >/dev/null 2>&1
}

# GREEN baseline: authority and both surfaces list the same three values → exit 0.
write_authority "no"
if checker_cmd; then :; else
  echo "baseline RED on a consistent fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT the defect: the authority gains a value, the hand-copied surfaces do not → MUST go RED.
write_authority "yes"
if checker_cmd; then
  echo "STAYED-GREEN — an authoritative value with unsynced surfaces did not redden the checker" >&2
  exit 3
fi

# RESTORE: the authority loses the value again → back to GREEN.
write_authority "no"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored authority still reddens the checker" >&2
  exit 4
fi

exit 0
