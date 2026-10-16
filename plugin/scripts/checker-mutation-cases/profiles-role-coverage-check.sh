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
# ⛔ The checker's children do NOT inherit the ambient $TMPDIR: they get a scratch root on the same
# REAL DISK as the checkout (see `scratch_root` below). `quay init` refuses a tmpfs worktree root, and
# the CI runner mounts /tmp tmpfs, so an inherited $TMPDIR turns this case ALWAYS-RED for a reason that
# is about the runner's /tmp, not about the checker.
#
# ⛔ The role-name needle is assembled at runtime: this case lives under plugin/scripts/, and the
# checker scans that tree — spelling the literal here would make the checker match a fixture.
set -u
name="profiles-role-coverage-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"   # <repo>/plugin/scripts
repo_root="$(cd "${checker_dir}/../.." && pwd -P)"                  # <repo>
CHECKER="${checker_dir}/profiles-role-coverage-check.ts"
SHIPPED="${checker_dir}/../.quay/profiles.yml"
CALL="launchArgv("

if [ ! -f "$CHECKER" ]; then echo "checker not found: $CHECKER" >&2; exit 2; fi
if [ ! -f "$SHIPPED" ]; then echo "shipped carrier not found: $SHIPPED" >&2; exit 2; fi
if [ ! -f "${repo_root}/packages/quay/bin/quay.ts" ]; then
  echo "infrastructure: Core CLI source absent at ${repo_root}/packages/quay/bin/quay.ts" >&2; exit 2
fi

# ── the checker's scratch root: REAL DISK (the checkout's own filesystem), never the ambient $TMPDIR ─
# `profiles-role-coverage-check.ts` asserts on a REAL `quay init`, and init lays its workspace down
# under $TMPDIR — whose DEFAULT worktree root is a SIBLING of that workspace (`<repoRoot>/../<base>-worktrees`),
# so it inherits the workspace's filesystem. `quay init` fails CLOSED when the worktree root lands on
# tmpfs (packages/quay/src/init.ts `validateWorktreeRoot`; the 2026-08-04 machine-wide OOM defence — ⛔
# deliberately NOT relaxed for this case). The CI runner mounts /tmp tmpfs (`--tmpfs /tmp`, gh-runner-quay
# on tokyo-alpha), so under the inherited $TMPDIR EVERY init here is refused, the checker can only answer
# NOT-EVALUATED (exit 3), and the baseline below reads that as ALWAYS-RED — a verdict about the runner's
# /tmp, not about the checker. Measured 2026-10-15, ONE tree, only /tmp's filesystem type differing:
# `--tmpfs /tmp` ⇒ this case exits 4 (`checker exited 3, expected 0`); disk /tmp ⇒ exits 0.
# ⇒ The checker's children are handed a scratch root on the same filesystem as the checkout itself — a
# sibling of the repo root, the convention quay's own worktrees already use (`<repo>-worktrees`). The
# checkout-on-real-disk premise is quay's own structural one (init writes worktrees as repo-root
# siblings; a tmpfs checkout would refuse everywhere), not an assumption about some other mount.
scratch_root="$(mktemp -d "${repo_root}-mutation-scratch.XXXXXX")" || {
  echo "infrastructure: cannot create a disk-backed scratch root beside ${repo_root}" >&2; exit 2
}
trap 'rm -rf "$scratch_root"' EXIT

rc() { # <fixture-root> → the checker's exit code
  TMPDIR="$scratch_root" node --no-warnings --experimental-strip-types "$CHECKER" --check --root "$1" >/dev/null 2>&1
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
