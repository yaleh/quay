# M-DIR119-C-CANARY — iteration-0 (Build)

**Charter:** `experiments/quay-perpetual-stream/charters/M-DIR119-C-CANARY.md`
**Absorb entry:** `/tmp/m-dir119-c-canary-absorb-entry.md`
**Composite manifest:** `/tmp/m-dir119-c-canary-manifest.json`
**Composite id:** `composite:DIR-070+DIR-110+DIR-111+exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN+gap-config-wiring-check-symlink-noop+gap-orphaned-check-scripts-not-wired+gap-workflow-name-dispatch-stale-script-cache`
**Build lead:** single agent, serial (parallel dispatch unavailable this run — per the charter's own
Build-lead note in DIR-119-B/composite-build.ts's `planPhaseExecution` shape, one agent executed
all 7 phases below in sequence instead of 7 independent single-task builds).
**Pre-flight:** `extra.acceptance` set on `DIR-070` via `task_write` to
`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070 experiments/quay-perpetual-stream/charters/M-DIR119-C-CANARY.md /tmp/m-dir119-c-canary-absorb-entry.md`.
**Backlog-row surface tags:** all 7 rows in the absorb entry already carried an accurate `surface:`
token (method-infra ×5, docs ×2) — no action needed per gap-absorb-entry-clause-disposition-sequencing.

**AC/DoD ticking discipline:** per the charter's own Done-when #1 ("ticked with real evidence by
the Audit shards, per DIR-020 — not self-ticked by Build"), this Build iteration does NOT tick the
member tasks' own AC/DoD checkboxes (that is the downstream `shard-*` audit's job) — evidence for
every clause is recorded below instead, mapped to task + phase, for the audit shards to verify and
tick. The ONE exception: `gap-workflow-name-dispatch-stale-script-cache`'s DoD item 1, which the
charter's own Scope section explicitly instructed Build to "tick with citation" (a reconciliation
of an already-true prose statement against a lagging checkbox, not new self-certified work) —
recorded in Phase 7 below.

---

## Phase → task → evidence map (composite-build.ts `mapEvidenceToTasks` shape)

| Phase (manifest) | Task(s) | Audit shard | Files touched | Tests run |
|---|---|---|---|---|
| `phase-dir070` | DIR-070 | `shard-epic-closure` | `tasks/DIR-070.md` (extra.acceptance only) | `plugin/test/plugin-packaging.test.mjs`, `plugin/test/probe-spec-wiring.test.mjs`, `plugin/scripts/sync-vendor.sh --check` (manual drift injection), `quay gate` ×3 |
| `phase-dir110` | DIR-110 | `shard-ci-hygiene` | `scripts/test-coverage-check.ts` (new), `.github/workflows/ci.yml`, `adr/ADR-019-...md` | `scripts/test-coverage-check.ts --selftest`, real run |
| `phase-dir111` | DIR-111 | `shard-ci-hygiene` | `.github/workflows/ci.yml`, `CLAUDE.md` | `grep -n "ADR-010" CLAUDE.md` |
| `phase-adr-toolsearch` | exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN | `shard-adr` | `CLAUDE.md` | `grep -n "ToolSearch" CLAUDE.md` |
| `phase-gap-config-wiring` | gap-config-wiring-check-symlink-noop | `shard-gap-fixes` | `plugin/scripts/config-wiring-check.ts`, `plugin/scripts/concurrent-batch-scheduler.ts`, `experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs` (new) | `experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs` (RED confirmed, then GREEN) |
| `phase-gap-orphaned-checks` | gap-orphaned-check-scripts-not-wired | `shard-gap-fixes` | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`, `experiments/quay-perpetual-stream/.quay/loop.yml`, `.quay/gates.yml`, `CLAUDE.md` | `scripts/delivery-manifest-check.ts`, `restart-readiness-check.sh`, YAML parse checks |
| `phase-gap-halt-cache` | gap-workflow-name-dispatch-stale-script-cache | `shard-gap-fixes` | `tasks/gap-workflow-name-dispatch-stale-script-cache.md` | n/a (documentation reconciliation) |

Full-suite regression evidence (`scripts/test.sh`, all 7 phases combined) is at the bottom.

---

## Phase 1 — DIR-070 (re-verification, not new implementation)

Per the charter's own framing: DIR-070's 6 children (A–F) are already `status: done`; this phase
re-verified DIR-070's own 8 AC items against CURRENT repo state (not asserted from history).

1. **`sync-vendor.sh --check` exits non-zero when drift is detected.**
   Verified REAL, not just "flag exists": ran clean (`exit=0`, "CLEAN: all files verified"), then
   deliberately appended a line to `plugin/vendor/quay/dist/quay.js` (a non-symlinked comparison
   pair) and re-ran — `exit=1`, `DRIFT: vendor/task-schema.ts differs between source and
   destination` printed with both real paths. Restored the file; re-ran clean again (`exit=0`).
2. **Group 1 files (7) are symlinks.** Confirmed via `ls -la`: all 7
   (`anti-drift-touches-check`, `concurrent-batch-scheduler`, `read-probe-spec`,
   `routine-file-gate`, `routine-scheduler`, `serial-fanin-absorb`,
   `touches-orthogonality-check`) `.ts` files under `experiments/quay-perpetual-stream/scripts/`
   are real symlinks to `../../../plugin/scripts/<name>.ts`. (Their sibling `.sh` wrapper files are
   real, non-duplicated small wrapper shims — not part of the original identical-copy problem —
   and correctly remain real files.)
3. **`plugin-packaging.test.mjs` passes.** `node --test plugin/test/plugin-packaging.test.mjs` →
   **34/34 pass**, 0 fail (re-run after all this iteration's edits too — see full-suite section).
4/5/6. **`quay gate --gate {loadbearing-test,anti-gaming,audit-independence}` work with
   `plugin/scripts/` paths.** Confirmed the CLI resolves and genuinely EXECUTES the real
   `plugin/scripts/*.sh` file (not the experiments/ mirror, not a `MODULE_NOT_FOUND`/silent no-op)
   for all 3 — matching the exact bar the pre-existing `plugin-packaging.test.mjs` test
   `'DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)'` already
   established for this AC's wording. Direct evidence:
   - `node packages/quay/bin/quay.ts gate DIR-070 --gate anti-gaming` → real script runs, reports
     `FAIL — acceptance failed (exit 2)` (the "fixed" zero-arg wiring supplies none of
     `anti-gaming-guard.sh`'s required `--cov-source`/... flags — a SEPARATE, pre-existing, wider
     design note about the "fixed" gate type, not a path-resolution defect). Direct invocation
     `bash plugin/scripts/anti-gaming-guard.sh --cov-source machine --cov-capped true
     --cov-inflatable false --adjudication pursue` → `Verdict: PASS`, `exit=0` — the plugin/scripts/
     copy is functionally correct.
   - `loadbearing-test`: same resolution pattern; direct invocation `bash
     plugin/scripts/loadbearing-test-gate.sh --scripts plugin/scripts --tests plugin/test` → real
     verdict (`FAIL: 8 load-bearing script(s) lack a sibling *.test.mjs`) — a genuine, separate,
     already-known finding about test coverage, not a wiring defect; confirms the plugin/scripts/
     copy runs for real.
   - `audit-independence`: real script executes, reports its own real
     `no audit-independence arguments defined` message (again, args-supply is a separate concern
     from path-resolution, which is what this AC actually asserts).
7. **`/run-routines` continues to work with symlinked scripts.** `node --test
   plugin/test/probe-spec-wiring.test.mjs` → **8/8 pass** (exercises `read-probe-spec.ts`, one of
   the 7 symlinked files, via its real `plugin/scripts/` path).
8. **DIR-069 (browser-explorer probe) dispatch path verified end-to-end.** Found a REAL, previously
   uncaught gap while verifying this: `probe-spec-wiring.test.mjs`'s "all shipped probe specs
   parse" test hard-listed only 3 probe names (`self-validation`, `architecture-analysis`,
   `history-mining`), silently excluding `browser-explorer` (DIR-069/M138) ever since it shipped —
   the 4th probe file existed on disk but was never actually exercised by the "all shipped probes"
   wiring test. Fixed: the test now globs `plugin/probes/*.md` dynamically (so a future 5th probe
   can't repeat this) and asserts `browser-explorer` is discovered. Re-ran: **8/8 pass**, now
   genuinely covering all 4 probes end-to-end.

**Verdict for shard-epic-closure to confirm:** all 8 AC items hold against current repo state, with
one adjacent, real, uncaught test-coverage gap found and closed as part of the verification (item 8).

---

## Phase 2 — DIR-110 (mechanical test-coverage self-check, ADR-019 decision #4)

Wrote `scripts/test-coverage-check.ts` (new, ~230 lines):
- Parses the canonical glob patterns straight out of `scripts/test.sh`'s own `files=(...)` line
  (single-source, ADR-004 — never re-typed).
- Walks the repo for any `test/*.test.mjs` file, excluding `node_modules`, `.git`, `.claude`,
  `.archguard`, `experiments` (deliberate — that dir has its OWN separate, already-established
  test-invocation convention via named `testPass` gate entries, not silently a bug; documented in
  the script's own header, ADR-019 Decision #4's literal scope is "any package's `test/` directory
  (or `plugin/test/`)"), and `fixtures` (selfcheck/gate fixture dirs, deliberately non-canonical).
- `findOrphans()` = discovered set minus canonical set.
- `--selftest`: (a) asserts the real repo tree has **zero orphans right now** (AC4), (b) plants a
  genuine orphan (`newpkg/test/orphan.test.mjs` — a brand-new top-level test dir, simulating
  exactly ADR-019's "future test/ directory" scenario) in a scratch temp dir with its own
  `scripts/test.sh` fixture, proves RED (orphan named in output), removes it, proves GREEN again —
  the ADR-018 selfcheck-fixture pattern, both states demonstrated.

Evidence:
```
$ node --experimental-strip-types scripts/test-coverage-check.ts --selftest
test-coverage-check --selftest: 6 passed, 0 failed

$ node --experimental-strip-types scripts/test-coverage-check.ts
test-coverage-check — canonical=84 discovered=84
PASS: 0 orphan(s) — every discovered product/plugin-tier test file is reachable by scripts/test.sh
```

Wired as an early, fail-fast CI step in `.github/workflows/ci.yml`'s `test` job (before "Run
tests"), running `--selftest` first then the real check. `adr/ADR-019-...md`'s `enforcement:`
frontmatter field updated to `"bash scripts/test.sh; node --experimental-strip-types
scripts/test-coverage-check.ts"`.

---

## Phase 3 — DIR-111 (ADR-019 decision #5 — name what's NOT covered)

1. `.github/workflows/ci.yml`'s `dist-verify-node-floor` job got an explicit comment naming it as
   this repo's "packaging e2e" category (builds the real tarball, installs it, runs it on the
   declared Node floor — no `*.test.mjs` involved).
2. `CLAUDE.md`'s Commands section (immediately after the Tests bullet list, not folded silently
   into it) got a new bullet: "NOT covered by `scripts/test.sh`" naming both packaging e2e and
   browser/agent-driven e2e, pointing at `adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md`.

Evidence: `grep -n "ADR-010" CLAUDE.md` → 2 hits (the new Commands-section bullet + the pre-existing
Process-section mention) — mechanical confirmation the pointer exists near the test documentation,
not just buried elsewhere.

---

## Phase 4 — exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN

Per the task's own later "Scope narrowed (2026-07-26)" revision (supersedes the original AC's
"file an ADR" ask), documented the ToolSearch-before-deferred-tool dependency as one paragraph in
`CLAUDE.md`'s Commands section, M148-precedent style (matching the existing "Glob tool unavailable
in subagent sessions" section's shape): what ToolSearch is for, when it's mandatory, and the
zero-results failure mode.

Evidence: `grep -n "ToolSearch" CLAUDE.md` → hit in the new Commands-section paragraph.

---

## Phase 5 — gap-config-wiring-check-symlink-noop

**Root cause** (already correctly diagnosed in the task's own Finding, confirmed not assumed):
`fileURLToPath(import.meta.url)` is always resolved through symlinks by Node's ESM loader;
`process.argv[1]` never is. Raw string equality between the two can never hold when a script is
invoked via the `experiments/quay-perpetual-stream/scripts/` mirror symlink, so `main()` silently
never runs — a clean `exit 0`, indistinguishable from "ran and found zero issues."

**Reproduced before fixing:**
```
$ node experiments/quay-perpetual-stream/scripts/config-wiring-check.ts --driver both; echo $?
0                                                          # mirror: SILENT, no output
$ node plugin/scripts/config-wiring-check.ts --driver both; echo $?
config-wiring-check — workspace=... FAIL: 7 issue(s) across 8 field(s)
1                                                          # real path: genuine FAIL
```

**Fix** (both `plugin/scripts/config-wiring-check.ts` and, per the task's own instruction to check,
`plugin/scripts/concurrent-batch-scheduler.ts` — confirmed the identical shape via direct
reproduction, fixed identically): replaced the raw string-equality entrypoint guard with
`fs.realpathSync`-resolving BOTH sides before comparing, so the mirror path now resolves to the
exact same real absolute path as the direct path.

**Verified after fixing** — both invocation paths now produce byte-identical output/exit codes:
```
$ node experiments/quay-perpetual-stream/scripts/config-wiring-check.ts --driver both  # exit=1
$ node plugin/scripts/config-wiring-check.ts --driver both                             # exit=1
$ diff <(mirror stdout) <(real stdout)   # IDENTICAL OUTPUT

$ node experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts   # exit=2, Usage: ...
$ node plugin/scripts/concurrent-batch-scheduler.ts                             # exit=2, Usage: ...
```

**Regression test** (new): `experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs` —
spawns REAL subprocesses via both invocation paths for both scripts and asserts identical exit
code + stdout/stderr (warning-banner PID lines normalized out). Demonstrated a genuine RED→GREEN
transition: reverted the fix locally, re-ran — **RED**, `mirror exit=0 real exit=2 — invocation
paths disagree`; restored the fix, re-ran — **GREEN**, 2/2 pass.

---

## Phase 6 — gap-orphaned-check-scripts-not-wired

1. **`delivery-manifest-check.ts`** — real, correct, previously wired nowhere. Wired into
   `.github/workflows/ci.yml`'s `version-consistency` job (static mode, no network — validates
   manifest well-formedness against `release.yml`'s own declared artifacts, runs on every
   push/PR). Its `--ci` mode (needs a real published Release tag + `GITHUB_TOKEN` to cross-check
   against actually-published assets) is wired as a new `delivery-manifest-verify` job in
   `.github/workflows/release.yml`, depending on `release`+`sea-release` — the genuine end-to-end
   verification the static mode cannot do. Verified locally: `node --experimental-strip-types
   scripts/delivery-manifest-check.ts` → `DELIVERY-MANIFEST-CHECK: OK`.
2. **`restart-readiness-check.sh`** — jointly tracked with `gap-halt-sentinel-path-mismatch`; that
   task's M187 fix already corrected its `.halt` path logic, but it remained unwired and
   undocumented as such. Resolved as "explicitly manual-only" (the Requested action's second
   option): added a loud `MANUAL-ONLY, NOT CI/LOOP-WIRED` header note to the script itself, and a
   pointer + explanation in `CLAUDE.md`'s `.halt sentinel` bullet (a fresh reader now finds it
   there). Re-ran the script after editing — still functions correctly (`[FAIL] working tree NOT
   clean` — accurate, since this session's own edits are uncommitted at that point; `[ok]` on the
   other 4 checks).
3. **`experiments/quay-perpetual-stream/.quay/loop.yml`'s stale `routines:` comment** — corrected:
   the old text said routines were "DECLARATIVE INTENT... INERT until OUTER-LOOP consumes it",
   which went stale once `run-routines.js` actually started reading `routines:` and dispatching
   `routine-scheduler.ts` at the checkpoint step. Replaced with an accurate status note, and
   flagged that this legacy per-experiment file is superseded by the root `.quay/config.yml`'s own
   `loop.routines` (which has since grown a 4th probe, `browser-explorer`, not mirrored here).
   `concurrency`/`stop`/`gates`/`policy` comments were already accurate — left unchanged.
4. **`gates.yml`/`config.yml` `it0.*` path divergence** — confirmed genuinely dead
   (`readGatesConfig()` in `packages/quay/src/gate/config/loader.ts` always prefers the unified
   `.quay/config.yml`'s `gates:` section when present, which it is here, so `.quay/gates.yml` is
   NEVER actually read for this workspace) but real: `impl-row`/`vmeta-lag`/`audit-independence`/
   `drivable-workspace`/`split-or-commit`/`enforcement-with-design` pointed at
   `experiments/quay-perpetual-stream/scripts/` in `gates.yml` vs `plugin/scripts/` in
   `config.yml`. Resolved by synchronizing `gates.yml`'s paths to match `config.yml` exactly
   (verified via grep diff — now identical) and adding a prominent header note explaining the file
   is dead-for-this-workspace and why, so a future editor doesn't reintroduce drift blind.

---

## Phase 7 — gap-workflow-name-dispatch-stale-script-cache

Per the charter's own Scope note ("2 of 3 DoD items already done... real remaining scope is just
item 1 — already effectively complete, tick with citation"): DoD item 1
("Root cause characterized as far as externally possible") was prose-complete (the task's own
"Root-cause research (2026-07-26)" section already documents 2 independent research passes) but
the checkbox lagged. Ticked with a citation note pointing back at that section — the ONE
explicitly-authorized self-tick in this Build iteration (see the discipline note at the top).
Item 3 (escalation to Claude Code support) remains open, a human decision, not closed here.

---

## Full-suite regression evidence

`bash scripts/test.sh` (canonical entrypoint, `--test-concurrency=8`), run twice for a clean
signal:

```
tests 537
pass 532
fail 2   (both confirmed pre-existing FLAKINESS under full-suite resource contention, unrelated
          to this iteration's changes — re-run in isolation, both pass:
            - packages/quay/test/build-dist-smoke.test.mjs "(b) serve --port + HTTP GET
              returns 200" → 4/4 pass isolated
            - packages/quay/test/delivery-standalone-smoke-gate.test.mjs "M52 D1" → 7/7 pass
              isolated, same file, same test, twice
          Neither file nor its subject script was touched by this iteration.)
cancelled 0
skipped 3   (the 3 live-GitHub/conformance files, expected per ADR-019 decision #1 — no
             QUAY_TEST_LIVE_GITHUB set)
```

Additionally, targeted re-runs after every edit in this iteration (all green, exact counts in the
phase sections above): `plugin/test/plugin-packaging.test.mjs` (34/34), `plugin/test/probe-spec-
wiring.test.mjs` (8/8), `experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs`
(2/2, RED→GREEN demonstrated), `scripts/test-coverage-check.ts --selftest` (6/6),
`packages/quay/test/loop-params.test.mjs` (38/38), `packages/quay/test/dod-gate-set.test.mjs`
(20/20). YAML validity confirmed for `.github/workflows/{ci,release}.yml`, `.quay/gates.yml`,
`experiments/quay-perpetual-stream/.quay/loop.yml`.

## Concurrent-activity note

A commit unrelated to this composite's 7 tasks (`d48f615`, touching `tasks/DIR-121.md` and
`tasks/gap-build-phase-iteration-evidence-path-not-single-sourced.md`) landed on `master` from a
different process during this Build session. File sets are fully disjoint from everything this
iteration touched; no conflict. Flagged per DIR-027 steering-hygiene discipline, not because it
affected this iteration's work.

## Files changed (git-tracked, this iteration)

```
 .github/workflows/ci.yml
 .github/workflows/release.yml
 .quay/gates.yml
 CLAUDE.md
 adr/ADR-019-test-taxonomy-is-structural-in-file-skip-one-canonical-runne.md
 experiments/quay-perpetual-stream/.quay/loop.yml
 experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
 plugin/scripts/concurrent-batch-scheduler.ts
 plugin/scripts/config-wiring-check.ts
 plugin/test/probe-spec-wiring.test.mjs
 tasks/DIR-070.md
 tasks/gap-workflow-name-dispatch-stale-script-cache.md
 experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs   (new)
 scripts/test-coverage-check.ts                                        (new)
 milestones/M-DIR119-C-CANARY/iterations/iteration-0.md                (new, this file)
```

## Outcome

Build phase complete for all 7 phases / all 7 member tasks. Status transitions and AC/DoD
checkbox-ticking are left to the downstream Audit shards (`shard-epic-closure`,
`shard-ci-hygiene`, `shard-adr`, `shard-gap-fixes`) and Reconcile/Land steps per the charter's own
Done-when clauses 1–4, not self-certified here.
