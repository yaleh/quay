#!/usr/bin/env bash
# git-lens-selfcheck.sh — regression acceptance test for the dark-axis instruments
# (L_D code:doc, L_G structural-drift, L_S behavior-variance). EXTERNAL acceptance predicate: it
# does NOT trust each instrument's self-report — it runs each against a fixed set of fixtures and
# asserts the EXPECTED exit code.
#
# THREE-VALUED (tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked, 硬规则 3b):
#   PASS           the instrument RAN on the fixture and returned the expected exit code
#   FAIL           the instrument ran and returned a different code
#   NOT-EVALUATED  the instrument could not be loaded / could not read its input / the axis has no
#                  living instrument. ⛔ THIS IS NOT A PASS. The old version of this script called
#                  `node scripts/git-lens-l-*.ts` (three probes archived on 2026-09-07); the
#                  resulting MODULE_NOT_FOUND is also exit 1, which HAPPENED TO EQUAL the expected
#                  code of the three "expected to detect something" fixtures — so it printed PASS
#                  for l-d/prose-heavy, l-g/cycle-repo and l-s/weak-module while the instrument was
#                  not even loaded. A fixture that cannot distinguish "the instrument detected it"
#                  from "the instrument did not load" is not a measurement.
#
# EXIT CODES (the ADR-007 `enforcement:` contract):
#   0 = every fixture PASS
#   1 = at least one FAIL (an instrument ran and disagreed with its expected reading)
#   2 = no FAIL, but at least one NOT-EVALUATED (an axis could not be judged — INCLUDING the
#       explicitly retired L_S axis). ⛔ Never folded into 0: "could not evaluate" ≠ "all good".
#
# INSTRUMENTS (living, not archived):
#   L_D  plugin/scripts/phase-declare.ts --ld-reading --numstat-file <f>   (read-only; the same
#        parseNumstat/computeRatio the ADR-008 declaration takes)
#   L_G  plugin/scripts/archguard-runner.ts readDirectoryCycleReading()    (read-only; the SAME
#        reader the arch-cycle-report routine consumes — directory-level moduleGraph cycles)
#   L_S  none. The archived behavior-variance probe is not revived, and no mutation/property test
#        of PRODUCT behaviour is wired. The only "L_S" instrument that runs (checker-mutation-check)
#        mutates the CHECKERS, not product code ⇒ recorded as NOT-EVALUATED(axis-retired…), and the
#        fixture cases are KEPT (⛔ not deleted to make the script green).
#
# Usage:  git-lens-selfcheck.sh
# Exit:   0 = all fixtures PASS; 1 = ≥1 FAIL; 2 = no FAIL but ≥1 NOT-EVALUATED.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

REPO_ROOT=$(cd ../.. && pwd -P)
LD_PROBE="$REPO_ROOT/plugin/scripts/phase-declare.ts"
LG_PROBE="$REPO_ROOT/plugin/scripts/archguard-runner.ts"

fail=0
not_evaluated=0

# Can the probe ENTRY be loaded at all? (Loaded ≠ correct: this only separates "the file is not
# there / does not parse" from "it ran and disagreed".) The path travels via env, never argv[1] —
# gate-script-base.ts's `isDirectEntry` is NAME-BASED, so passing a probe path as argv[1] would
# make the imported module believe it is the running entry and execute its own main().
probe_loaded() {
  GIT_LENS_PROBE="$1" node --no-warnings --experimental-strip-types \
    -e 'import(process.env.GIT_LENS_PROBE).then(()=>{},()=>{process.exitCode=1})' >/dev/null 2>&1
}

note_not_evaluated() {
  echo "NOT-EVALUATED($1) $2"
  not_evaluated=1
}

echo "== L_D code:doc ratio =="
LD_CASES=(
  "prose-heavy|fixtures/git-lens/l-d/prose-heavy.numstat|1"
  "code-heavy|fixtures/git-lens/l-d/code-heavy.numstat|0"
  "empty|fixtures/git-lens/l-d/empty.numstat|0"
)
if ! probe_loaded "$LD_PROBE"; then
  # ⛔ NO per-case PASS may be printed for an axis whose instrument did not load.
  for c in "${LD_CASES[@]}"; do
    IFS='|' read -r id _file _want <<< "$c"
    note_not_evaluated "probe-not-loaded: $LD_PROBE" "l-d/$id"
  done
else
  for c in "${LD_CASES[@]}"; do
    IFS='|' read -r id file want <<< "$c"
    out=$(node --no-warnings --experimental-strip-types "$LD_PROBE" \
      --ld-reading --numstat-file "$file" --json 2>&1)
    got=$?
    if [ "$got" = "3" ]; then
      note_not_evaluated "reading-unavailable: ${out//$'\n'/ }" "l-d/$id"
    elif [ "$got" = "$want" ]; then
      echo "PASS: l-d/$id — exit $got (expected $want)"
    else
      echo "FAIL: l-d/$id — exit $got but EXPECTED $want. Output: $out"
      fail=1
    fi
  done
fi

echo
echo "== L_G structural-drift (directory-level moduleGraph cycles) =="
# The reading is taken from the SAME query-artifact reader the arch-cycle-report routine consumes
# (archguard-runner.ts `readDirectoryCycleReading`). Each fixture is a `<workDir>/query/manifest.json`
# + `<workDir>/query/<key>/arch.json` pair; the manifest's relative source resolves against the
# fixture dir, which is also the cwd and the `root` argument (so the scope match is exact).
# ⛔ The fixture must make the SOURCE scope readable: the six-SCOPE aggregate is `evaluated:false`
# whenever any sibling scope is absent (correctly — "could not read" is not "0 cycles"), so the
# selfcheck reads the per-scope entry, not `totalCycleCount`.
LG_CASES=(
  "cycle-repo|fixtures/git-lens/l-g-archguard/cycle|1"
  "clean-repo|fixtures/git-lens/l-g-archguard/clean|0"
)
if ! probe_loaded "$LG_PROBE"; then
  for c in "${LG_CASES[@]}"; do
    IFS='|' read -r id _dir _want <<< "$c"
    note_not_evaluated "probe-not-loaded: $LG_PROBE" "l-g/$id"
  done
else
  for c in "${LG_CASES[@]}"; do
    IFS='|' read -r id dir want <<< "$c"
    out=$( cd "$dir" && GIT_LENS_PROBE="$LG_PROBE" node --no-warnings --experimental-strip-types -e '
      import(process.env.GIT_LENS_PROBE).then((m) => {
        const r = m.readDirectoryCycleReading(process.cwd(), process.cwd());
        const s = r.scopes.find((x) => x.scope === "src");
        if (!s || !s.evaluated) {
          process.stdout.write("NOT-EVALUATED " + (s ? s.reason : "no src scope in fixture manifest") + "\n");
          process.exitCode = 3;
          return;
        }
        const members = (s.cycles || []).map((c) => c.modules.join(" -> "));
        process.stdout.write("reading " + JSON.stringify({ count: s.cycleCount, members }) + "\n");
        process.exitCode = s.cycleCount > 0 ? 1 : 0;
      }, (e) => {
        process.stdout.write("NOT-EVALUATED probe-load-failed: " + (e && e.message) + "\n");
        process.exitCode = 3;
      });
    ' 2>&1 )
    got=$?
    if [ "$got" = "3" ]; then
      note_not_evaluated "reading-unavailable: ${out//$'\n'/ }" "l-g/$id"
    elif [ "$got" = "$want" ]; then
      echo "PASS: l-g/$id — exit $got (expected $want) — $out"
    else
      echo "FAIL: l-g/$id — exit $got but EXPECTED $want. Output: $out"
      fail=1
    fi
  done
fi

echo
echo "== L_S behavior-variance =="
# ⛔ KEPT, not deleted: the two fixtures still pin WHAT was once asked of L_S. The axis has no
# living instrument for PRODUCT code (see the header), so both cases are NOT-EVALUATED — never PASS
# (the old script printed PASS for weak-module because MODULE_NOT_FOUND is also exit 1).
LS_CASES=(
  "strong-module|fixtures/git-lens/l-s-fixtures/strong-module.mjs|fixtures/git-lens/l-s-fixtures/strong-module.test.mjs|0"
  "weak-module|fixtures/git-lens/l-s-fixtures/weak-module.mjs|fixtures/git-lens/l-s-fixtures/weak-module.test.mjs|1"
)
for c in "${LS_CASES[@]}"; do
  IFS='|' read -r id _mod _testf _want <<< "$c"
  note_not_evaluated "axis-retired: no living product-code L_S instrument (the archived behavior-variance probe is not revived)" "l-s/$id"
done

echo
if [ "$fail" != 0 ]; then
  echo "FAIL: at least one git-lens fixture did not behave as asserted (see above)."
  echo "      The fix belongs in the relevant instrument, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
if [ "$not_evaluated" != 0 ]; then
  echo "NOT-EVALUATED: at least one axis could not be judged (see the NOT-EVALUATED lines above)."
  echo "      This is NOT 'all fixtures passed' — exit 2 is the ADR-007 enforcement contract for it."
  exit 2
fi
echo "PASS: all git-lens (L_D/L_G/L_S) fixtures behaved as asserted."
exit 0
