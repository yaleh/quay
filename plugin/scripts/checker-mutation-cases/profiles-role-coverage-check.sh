#!/usr/bin/env bash
# Mutation case for profiles-role-coverage-check.
#
# The checker's whole point is that its assertion object is a REAL init's OUTPUT, and that EITHER
# template losing a role — or the two of them drifting apart — goes RED. A mutation case that only
# proved "a missing role is caught" would leave the two cheapest ways to make this checker
# permanently green untested, so this case drives FOUR independent red controls plus the
# NOT-EVALUATED path, and re-proves GREEN after each restore:
#
#   baseline  fixture whose driver asks for a role the shipped carrier defines      → GREEN
#   RED-1     the shipped carrier loses a role a driver requests                    → RED
#   RED-2     a driver requests a role NO carrier defines                           → RED
#   RED-3     the two templates drift (carrier-only extra role, init has no such)   → RED
#   RED-4     a RETIRED role is shipped to every new project (inner)                → RED
#   N/E       no init artifact obtainable (Core CLI absent)                         → exit 3
#   restore   baseline fixture again                                                → GREEN
#
# Contract (plugin/scripts/checker-mutation-check.sh): exit 0 = behaved, 3 = STAYED-GREEN,
# 4 = ALWAYS-RED, 2 = infra error. Fixture is a temp root with `plugin/scripts/` (the driver corpus),
# `plugin/.quay/profiles.yml` (the OTHER template) and a symlink to the REAL `packages/` (what makes
# the Core CLI able to produce a genuine init artifact).
#
# ⛔ The role-name needle is assembled at runtime: this case lives under plugin/scripts/, and the
# checker scans that tree — spelling the literal here would make the checker match a fixture.
set -u
name="profiles-role-coverage-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # <repo>/plugin/scripts
repo_root="$(cd "${checker_dir}/../.." && pwd)"                  # <repo>
CHECKER="${checker_dir}/profiles-role-coverage-check.ts"
SHIPPED="${checker_dir}/../.quay/profiles.yml"
CALL="launchArgv("

if [ ! -f "$CHECKER" ]; then echo "checker not found: $CHECKER" >&2; exit 2; fi
if [ ! -f "$SHIPPED" ]; then echo "shipped carrier not found: $SHIPPED" >&2; exit 2; fi
if [ ! -f "${repo_root}/packages/quay/bin/quay.ts" ]; then
  echo "infrastructure: Core CLI source absent at ${repo_root}/packages/quay/bin/quay.ts" >&2; exit 2
fi

rc() { # <fixture-root> → the checker's exit code
  node --no-warnings --experimental-strip-types "$CHECKER" --check --root "$1" >/dev/null 2>&1
  echo $?
}

mk_fixture() { # <dir> — driver corpus + the OTHER template + a real Core CLI behind it
  local f="$1"
  rm -rf "$f"
  mkdir -p "$f/plugin/scripts" "$f/plugin/.quay"
  ln -s "${repo_root}/packages" "$f/packages"
  cp "$SHIPPED" "$f/plugin/.quay/profiles.yml"
}

write_driver() { # <fixture> <role...>
  local f="$1"; shift
  {
    echo 'export function probe(root: string): string[][] {'
    echo '  const out: string[][] = [];'
    local r
    for r in "$@"; do printf '  out.push(%s"%s", "p", root));\n' "$CALL" "$r"; done
    echo '  return out;'
    echo '}'
  } > "$f/plugin/scripts/probe-driver.ts"
}

drop_role() { # <fixture> <role-key>
  python3 - "$1/plugin/.quay/profiles.yml" "$2" <<'PY'
import sys
p, role = sys.argv[1], sys.argv[2]
out, skip = [], False
for line in open(p).read().split("\n"):
    if line == f"  {role}:":
        skip = True
        continue
    if skip:
        if line.startswith("  ") and line.endswith(":") and not line.startswith("    "):
            skip = False
        else:
            continue
    out.append(line)
open(p, "w").write("\n".join(out))
PY
}

expect() { # <fixture> <want-rc> <label>
  local got; got="$(rc "$1")"
  if [ "$got" != "$2" ]; then
    echo "MUTATION-FAIL [${3}]: checker exited ${got}, expected ${2}" >&2
    return 1
  fi
  echo "ok [${3}]: exit ${got}"
  return 0
}

F="${workdir}/fixture"
fail=0

# ── baseline: GREEN (a checker that is RED here is broken, not strict) ─────────────────────────────
mk_fixture "$F"
write_driver "$F" task-worker fix-worker
expect "$F" 0 "baseline GREEN (requested roles are all defined)" || { echo "baseline RED — checker always-red?" >&2; exit 4; }

# ── RED-1: the shipped carrier loses a requested role ──────────────────────────────────────────────
mk_fixture "$F"; write_driver "$F" task-worker fix-worker; drop_role "$F" task-worker
expect "$F" 1 "RED-1 shipped carrier missing a requested role" || fail=1

# ── RED-2: a driver requests a role NO carrier defines ─────────────────────────────────────────────
mk_fixture "$F"; write_driver "$F" task-worker brand-new-unshipped-role
expect "$F" 1 "RED-2 driver requests an undeclared role" || fail=1

# ── RED-3: the two templates drift apart (carrier-only role the init never produces) ──────────────
mk_fixture "$F"; write_driver "$F" task-worker
printf '\n  zz-drifted-role:\n    profile: worker-default\n    name: zz-drifted-role\n' >> "$F/plugin/.quay/profiles.yml"
expect "$F" 1 "RED-3 the two templates disagree" || fail=1

# ── RED-4: a RETIRED role ships to every new project (AC3 — a FAIL, not a remark) ─────────────────
mk_fixture "$F"; write_driver "$F" task-worker
printf '\n  inner:\n    profile: worker-default\n    name: quay-inner\n' >> "$F/plugin/.quay/profiles.yml"
expect "$F" 1 "RED-4 retired role (inner) present" || fail=1

# ── NOT-EVALUATED: no init artifact obtainable ⇒ exit 3, never a green it did not earn ────────────
mk_fixture "$F"; write_driver "$F" task-worker
rm -f "$F/packages"    # drop the symlink: the Core CLI source is not in this tree
expect "$F" 3 "NOT-EVALUATED when no init artifact is obtainable" || fail=1

# ── restore: GREEN again ───────────────────────────────────────────────────────────────────────────
mk_fixture "$F"; write_driver "$F" task-worker fix-worker
expect "$F" 0 "restored baseline GREEN" || fail=1

rm -rf "$F"
[ "$fail" -eq 0 ] || exit 4
exit 0
