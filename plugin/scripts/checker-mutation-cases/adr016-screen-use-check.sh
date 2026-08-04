#!/usr/bin/env bash
# Mutation case for adr016-screen-use-check (ADR-016 Amendment whole-screen-hash gate).
# Fixture: a temp tree with the ONE tolerated legacy observer (session-liveness-shaped) → GREEN.
# Inject: a SECOND, NEW .sh with `tmux capture-pane | md5sum` → active violations exceed the band
# (0..1) → the checker MUST go RED. Restore: remove the injected file → back to GREEN.
set -u
name="adr016-screen-use-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The ONE tolerated active observer (band 0..1) — the session-liveness.sh capture→mask→hash shape.
mkdir -p "${workdir}"
cat > "${workdir}/legacy.sh" <<'EOF'
raw=$(tmux capture-pane -p -t "$target" 2>/dev/null)
masked=$(printf '%s\n' "$raw" | mask_pane)
h=$(printf '%s' "$masked" | md5sum | cut -c1-16)
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/adr016-screen-use-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: one active violation is within the band → exit 0.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on one tolerated legacy observer (checker always-red?)" >&2
  exit 4
fi

# INJECT: a second, NEW whole-screen hash → active count 2 > band 1 → MUST go RED.
cat > "${workdir}/evil.sh" <<'EOF'
hash_before=$(tmux capture-pane -p -t "$TARGET" 2>/dev/null | md5sum | cut -c1-16)
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — injected second whole-screen hash did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the injected file → back to one tolerated violation → GREEN.
rm -f "${workdir}/evil.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored one-observer tree still reddens the checker" >&2
  exit 4
fi

exit 0
