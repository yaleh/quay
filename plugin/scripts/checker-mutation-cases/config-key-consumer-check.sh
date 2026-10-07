#!/usr/bin/env bash
# Mutation case for config-key-consumer-check (gap-config-key-consumer-check-mechanical-enumeration,
# GOAL-015 退出条件③ / AC-235). The checker's own negative control: a delivered config key with NO
# consumer must go RED; deleting (or wiring) it returns GREEN.
#
# Fixture: a temp workspace with `packages/quay/src/init.ts` — the WRITER FACE. ⛔ It moved from
# `plugin/scripts/quay-init.sh` when that entry became a ≤40-line shim over the CLI
# (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch): the engine is the writer
# now, and the checker derives the delivered key set from it MECHANICALLY, from `--root` — the
# `LOOP_VERSION_DEFAULTS` table plus the fresh-install template's interpolated `loop:` entries. The
# fixture stands in for both: a table key and a template key.
# Plus the CONSUMER FACE — a `.ts` file that references the wired key.
# Inject:   add an orphan key (`orphan_key`) to the template with no consumer reference → the
#           checker MUST go RED (no-consumer-to-wire count > 0).
# Restore:  remove the orphan key → back to GREEN.
set -u
name="config-key-consumer-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/packages/quay/src" "${workdir}/plugin/scripts"

write_init_ts() { # $1 = "yes" (with orphan key) | "no" (without)
  local orphan="$1"
  {
    echo 'export const LOOP_VERSION_DEFAULTS = { consumer_key: "present" };'
    echo 'export function generateConfigContent() {'
    echo '  return ['
    echo '    `  consumer_key: ${1}`,'
    if [ "$orphan" = "yes" ]; then
      echo '    `  orphan_key: ${2}`,'
    fi
    echo '  ].join("\n");'
    echo '}'
  } > "${workdir}/packages/quay/src/init.ts"
}

# Consumer face: a .ts file that references consumer_key (has-consumer); nothing references orphan_key.
printf 'export const value = "consumer_key";\n' > "${workdir}/plugin/scripts/consumer.ts"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/config-key-consumer-check.ts" --root "${workdir}" --json >/dev/null 2>&1
}

# GREEN baseline: only consumer_key (has a consumer) → exit 0.
write_init_ts "no"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a wired key (checker always-red?)" >&2
  exit 4
fi

# INJECT the defect: an orphan key written with no consumer → MUST go RED.
write_init_ts "yes"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — an orphan config key with no consumer did not redden the checker" >&2
  exit 3
fi

# RESTORE the consumer → back to GREEN.
write_init_ts "no"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored consumer still reddens the checker" >&2
  exit 4
fi

exit 0
