#!/usr/bin/env bash
# Mutation case for config-key-consumer-check (gap-config-key-consumer-check-mechanical-enumeration,
# GOAL-015 退出条件③ / AC-235). The checker's own negative control: a delivered config key with NO
# consumer must go RED; deleting (or wiring) it returns GREEN.
# Fixture: a temp workspace with plugin/scripts/quay-init.sh (the writer face — the checker DERIVES
# its key list from this file) + plugin/scripts/consumer.ts (the consumer face — a .ts file that
# references the wired key). The checker enumerates the loop: keys and greps the consumer face.
# Inject:   add an orphan key (orphan_key) to the loop: heredoc with no consumer reference → the
#           checker MUST go RED (no-consumer-to-wire count > 0).
# Restore:  remove the orphan key → back to GREEN.
set -u
name="config-key-consumer-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/packages/quay/src"

write_quay_init() { # $1 = "yes" (with orphan key) | "no" (without)
  local orphan="$1"
  {
    echo "loop:"
    echo "  consumer_key: present"
    if [ "$orphan" = "yes" ]; then
      echo "  orphan_key: orphan"
    fi
    echo "EOF"
  } > "${workdir}/plugin/scripts/quay-init.sh"
}

# Consumer face: a .ts file that references consumer_key (has-consumer); nothing references orphan_key.
printf 'export const value = "consumer_key";\n' > "${workdir}/plugin/scripts/consumer.ts"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/config-key-consumer-check.ts" --root "${workdir}" --json >/dev/null 2>&1
}

# GREEN baseline: only consumer_key (has a consumer) → exit 0.
write_quay_init "no"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a wired key (checker always-red?)" >&2
  exit 4
fi

# INJECT the defect: an orphan key written with no consumer → MUST go RED.
write_quay_init "yes"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — an orphan config key with no consumer did not redden the checker" >&2
  exit 3
fi

# RESTORE the consumer → back to GREEN.
write_quay_init "no"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consumer still reddens the checker" >&2
  exit 4
fi

exit 0
