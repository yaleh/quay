#!/usr/bin/env bash
# Mutation case for tmux-test-isolation-check (gap-tmux-isolated-guard-has-zero-consumers-fifth-
# machine-wipe, AC3/AC4). Fixture: a temp tree with ONLY isolated tmux-using test files → GREEN.
# Inject: a test file with a bare `spawnSync("tmux", ["new-session"...])` (no mechanism, no
# isolation) → the checker MUST go RED. Restore: remove the injected file → back to GREEN.
set -u
name="tmux-test-isolation-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Fixture: a tmux-using test file that is ISOLATED (uses the tmux-session library — mechanism ref).
mkdir -p "${workdir}/plugin/test" "${workdir}/plugin/scripts"
cat > "${workdir}/plugin/scripts/tmux-session.ts" <<'EOF'
export function tmux(args, opts = {}) { return opts.exec?.("tmux", ["-S", "sock", ...args], {}); }
EOF
cat > "${workdir}/plugin/test/isolated.test.mjs" <<'EOF'
import { tmux } from "../scripts/tmux-session.ts";
const r = spawnSync("tmux", ["-V"], { encoding: "utf8" });
tmux(["new-session", "-d", "-s", "x"]);
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/tmux-test-isolation-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: the only tmux-using file references the mechanism → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on an isolated tmux-using file (checker always-red?)" >&2
  exit 4
fi

# INJECT: a second test file with a BARE `tmux new-session` (no mechanism, no isolation) → RED.
cat > "${workdir}/plugin/test/evil.test.mjs" <<'EOF'
const r = spawnSync("tmux", ["new-session", "-d", "-s", "leaky"], { encoding: "utf8" });
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected bare tmux new-session did not redden the checker (AC4 negative control failed)" >&2
  exit 3
fi

# RESTORE: remove the injected file → back to GREEN.
rm -f "${workdir}/plugin/test/evil.test.mjs"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored isolated tree still reddens the checker" >&2
  exit 4
fi

exit 0
