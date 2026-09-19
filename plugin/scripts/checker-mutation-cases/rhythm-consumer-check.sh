#!/usr/bin/env bash
# Mutation case for rhythm-consumer-check (AC73 判据1 — a non-按需 mechanism must have a call site in
# scripts/test.sh or an execution core; a mechanism with NO call site anywhere and not baselined ⇒ RED).
#
# Fixture: a temp repo with the real capability-catalog (entry + renderer + declaration data) + a
# minimal scripts/test.sh that wires capability-catalog.sh (its declared cadence is 每轮, non-按需)
# → GREEN.
# Inject: add a NEW plugin/scripts mechanism, DECLARED non-按需 in the fixture's declaration data,
# that nothing calls → 判据1 MUST go RED (the exact AC73 disease: a mechanism declared to run every
# tick with nothing that runs it). Restore → back to GREEN.
#
# ⛔ Why the inject is a new probe and not "unwire capability-catalog.sh" (the pre-2026-09-19 form):
# 判据1 accepts a STRICT hit (scripts/test.sh / execution cores) OR a BROAD hit (any other surface
# file naming the basename). Unwiring the catalog from test.sh no longer reddens it, because the
# renderer capability-catalog.ts legitimately names the entry basename in its own header — a broad
# hit. That is not a checker bug to paper over: the checker's rule is "somebody names it", and the
# entry really is what runs the renderer. So the control now injects a mechanism that satisfies
# NEITHER surface, which is what 判据1 actually forbids.
set -u
name="rhythm-consumer-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
decls="${workdir}/plugin/scripts/capability-catalog-declarations.json"

mkdir -p "${workdir}/plugin/scripts" "${workdir}/scripts"

# The catalog is the ONE shipped non-按需 mechanism in this fixture; it self-locates via readlink -f.
# capability-catalog.sh sources repo-root.sh (SPEC §2.4 B2 pair) — copy the dependency too, or the
# catalog's --json run dies at the source line (set -e) and loadCatalogDecls parses zero rows, making
# 判据1 vacuously green (the STAYED-GREEN failure this mutation is designed to catch).
cp "${checker_dir}/capability-catalog.sh" "${workdir}/plugin/scripts/capability-catalog.sh"
cp "${checker_dir}/repo-root.sh" "${workdir}/plugin/scripts/repo-root.sh"
cp "${checker_dir}/repo-root.ts" "${workdir}/plugin/scripts/repo-root.ts"
# The declaration tables are DATA now (gap-arch-catalog-declarations-leave-bash): the .sh is a thin
# exec wrapper around capability-catalog.ts, which reads capability-catalog-declarations.json.
# Copying only the entry leaves the renderer/data absent ⇒ the entry exits 3 (CAUSE=..., not a
# reddening data change) and this mutation case reads as "baseline RED — checker always-red?".
cp "${checker_dir}/capability-catalog.ts" "${workdir}/plugin/scripts/capability-catalog.ts"
cp "${checker_dir}/capability-catalog-declarations.json" "${decls}"

write_test_sh() { # <body...>
  printf '%s\n' "$@" > "${workdir}/scripts/test.sh"
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/rhythm-consumer-check.ts" --check --root "$1" >/dev/null 2>&1
}

# GREEN baseline: test.sh references capability-catalog.sh at a command position → 判据1 wired-strict;
# the fixture has no 按需 shipped mechanisms (判据2 vacuous) and no --no-block checkers (判据3 vacuous)
# → exit 0.
write_test_sh \
  '#!/usr/bin/env bash' \
  'run_static_checks() {' \
  '  bash plugin/scripts/capability-catalog.sh --json >/dev/null' \
  '}'
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a wired capability-catalog.sh (checker always-red?)" >&2
  exit 4
fi

# INJECT: a declared non-按需 mechanism that NOTHING calls. Declaring it in the fixture's own
# declaration data is what puts it in 判据1's judged set; having no call site anywhere is what must
# redden the checker.
: > "${workdir}/plugin/scripts/zz-unwired-probe.sh"
node -e '
const fs = require("fs");
const p = process.argv[1];
const d = JSON.parse(fs.readFileSync(p, "utf8"));
const rows = [["QUESTION", "Is anything actually running this mechanism?"], ["CADENCE", "每轮"],
              ["INVALIDATION", "失效前提：n/a（mutation fixture）"], ["LAST_REAFFIRMED", "2026-09-19"],
              ["MATCHING", "n/a"]];
for (const [t, v] of rows) d[t]["zz-unwired-probe.sh"] = v;
fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
' "${decls}"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — an unwired non-按需 mechanism did not redden the checker" >&2
  exit 3
fi

# RESTORE: drop the probe (the declaration alone is not enough — an absent script is not enumerated,
# so 判据1 has nothing to judge) → back to GREEN.
rm -f "${workdir}/plugin/scripts/zz-unwired-probe.sh"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restoring the clean fixture still reddens the checker" >&2
  exit 4
fi

exit 0
