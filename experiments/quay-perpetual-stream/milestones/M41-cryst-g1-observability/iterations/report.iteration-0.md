# M41-cryst-g1-observability — iteration-0 report

**Worktree:** `milestones/M41-cryst-g1-observability/worktrees/iteration-0` (branch `exp5-m41-iteration-0`, base `ba1edb8`).

## §0 Preconditions
- `ls -1 experiments/quay-perpetual-stream/directives/pending/` — N/A: directives are TASK-CANONICAL
  (DIR-028), there is no `directives/pending/` directory any more; DRAIN read `task_list --label
  directive` instead (done at the outer SELECT step, see charter's SELECT reasoning). Disposition:
  DIR-030 actioned this pass (see `tasks/DIR-030.md` `## Resolution`).
- manda healthz / port-4173 reachability: **N/A this milestone** (no Web UI surface touched, per
  charter's HARD GATES note).

## §1 Build (AC 1-3)

### AC1 — L_D (code:doc)
Built `scripts/git-lens-l-d-code-doc-ratio.mjs`: pure `computeRatio(rows)` over parsed
`git diff --numstat` rows, classifying `.md`/`.txt` as doc, everything else as code. FLAGs when
`docLines > 20 && ratio > 3.0`. Ran against a REAL git range (the two prior commits,
`5c7ac2f..ba1edb8`, spanning the pre-restart schema-clean + DIR-030 commits):
```
$ node scripts/git-lens-l-d-code-doc-ratio.mjs 5c7ac2f ba1edb8 --repo-root /home/yale/work/quay
L_D code:doc — docLines=11679 codeLines=4234 ratio=2.758 verdict=PASS
```
(exit 0 — this particular range is doc-heavy in absolute terms but under the 3.0x FLAG ratio, so
PASS — a real, non-fixture reading, not asserted.) Fixture pair (`fixtures/git-lens/l-d/{prose-
heavy,code-heavy}.numstat` + an `empty.numstat` N/A case) pins RED (ratio 200/7=28.6 > 3.0, exit 1)
and GREEN (ratio 6/230=0.026, exit 0) and the N/A empty-diff case (exit 0, verdict "N/A").

### AC2 — L_G (structural-drift)
Built `scripts/git-lens-l-g-structural-drift.mjs`. **Tool-availability finding (recorded in the
charter, re-confirmed here):** `archguard_analyze` was probed live (MCP) against this repo with
`lang: "typescript"`, both with explicit `sources` and without, with/without `noCache` — every
variant returned `"Analysis failed: No query scopes were persisted."` archguard cannot currently
scope quay's plain-JS/ESM packages (no tsconfig, no `.ts` files). Built the documented FALLBACK:
a plain import-graph cycle detector (DFS grey/black) + a god-module heuristic (line-count AND
fan-in threshold). Ran against the LIVE repo:
```
$ node scripts/git-lens-l-g-structural-drift.mjs /home/yale/work/quay/packages
L_G structural-drift (fallback proxy) — scanned 82 files under /home/yale/work/quay/packages
  cycles found: 0
  god-modules found: 3
    GOD-MODULE: packages/quay-github/src/github-client.js (lines=851, fanin=8)
    GOD-MODULE: packages/quay-native/src/store.js (lines=729, fanin=14)
    GOD-MODULE: packages/quay/src/serve.js (lines=1079, fanin=8)
  verdict: FLAGGED
```
A REAL, non-fixture finding on the live repo (3 genuine god-modules, exit 1). Fixture pair
(`fixtures/git-lens/l-g-fixtures/{cycle-repo,clean-repo}/`) pins a genuine 2-file import cycle
(RED, exit 1) and a clean 2-file linear dependency (GREEN, exit 0, at fixture-appropriate
`--min-lines 100 --min-fanin 5` thresholds — the 2-line fixture files are far below real-repo
scale, so the selfcheck passes explicit thresholds for the fixture harness; the script's own
default constants (400 lines / fanin 5) are unchanged and are what the real-repo smoke run above
used).

### AC3 — L_S (behavior-variance)
Built `scripts/git-lens-l-s-behavior-variance.mjs`: a small mechanical-mutation kernel (6 operators:
`===`/`!==`/`&&`/`||`/`<`/`>` flips) + orchestration that mutates a module file IN PLACE, re-runs a
test command, restores via `try/finally` (backed up first), and reports killed/survived/
mutationScore. FLAGs when `mutationScore < 0.5`. Ran against a REAL touched module from this repo
(`packages/quay/src/gate/registry.js`, tested by `packages/quay/test/gate.test.mjs`, which imports
it directly):
```
$ node scripts/git-lens-l-s-behavior-variance.mjs packages/quay/src/gate/registry.js packages/quay/test/gate.test.mjs
L_S behavior-variance — module=packages/quay/src/gate/registry.js totalMutants=31 killed=3 survived=28 mutationScore=0.097 verdict=FLAGGED (low mutation score / high variance)
  surviving mutants: flip-strict-equal#0, flip-strict-equal#1, flip-strict-equal#3, ... (28 total)
EXIT=1
```
A REAL, non-fixture finding: `registry.js`'s test suite only pins 3/31 mechanical mutants (a
genuine, surprising stability gap worth a future milestone's attention — the tests check gate
NAMES are registered but do not exercise the comparison/boolean logic paths deeply). File
correctly restored (`git status --porcelain packages/quay/src/gate/registry.js` clean
before-and-after, verified directly, not asserted). Fixture pair
(`fixtures/git-lens/l-s-fixtures/{strong,weak}-module.{mjs,test.mjs}`) pins a fully-pinned module
(GREEN, mutationScore≈1.0 or above threshold, exit 0) and a deliberately under-tested one (RED,
mutationScore well under 0.5, exit 1).

## §2 Selfcheck
```
$ bash scripts/git-lens-selfcheck.sh
== L_D code:doc ratio ==
PASS: l-d/prose-heavy — exit 1 (expected 1)
PASS: l-d/code-heavy — exit 0 (expected 0)
PASS: l-d/empty — exit 0 (expected 0)

== L_G structural-drift ==
PASS: l-g/cycle-repo — exit 1 (expected 1)
PASS: l-g/clean-repo — exit 0 (expected 0)

== L_S behavior-variance ==
PASS: l-s/strong-module — exit 0 (expected 0)
PASS: l-s/weak-module — exit 1 (expected 1)

PASS: all git-lens (L_D/L_G/L_S) fixtures behaved as asserted.
```
All 7 assertion cases PASS (plus a non-asserted real-repo smoke line for L_G).

## §3 Dashboard recording
This iteration's dashboard L_D/L_G/L_S row (recorded at ABSORB, computed by these scripts, not
hand-typed):
- L_D (code:doc, base `5c7ac2f`..HEAD `ba1edb8`): docLines=11679 codeLines=4234 ratio=2.758 PASS
- L_G (structural-drift, `packages/`): 0 cycles, 3 god-modules FLAGGED
  (`github-client.js` 851L/fanin8, `store.js` 729L/fanin14, `serve.js` 1079L/fanin8)
- L_S (behavior-variance, `packages/quay/src/gate/registry.js`): mutationScore=0.097 FLAGGED
  (28/31 mutants survived)

## §4 Done-when self-assessment
1. Three new proxy scripts exist under `experiments/quay-perpetual-stream/scripts/`, each with a
   RED/GREEN fixture pair, wired into `git-lens-selfcheck.sh` — YES.
2. `dashboard.md` will record this real reading at ABSORB (not hand-typed) — pending ABSORB step.
3. The L_G proxy's archguard-vs-fallback decision + the tool-availability finding are stated
   explicitly above (not silently a no-op) — YES.

No Web UI surface touched (N/A per HARD GATES note). No mid-milestone re-scope needed — all 3 ACs
landed in this one pass.
