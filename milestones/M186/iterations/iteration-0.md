# M186 iteration-0 — DIR-120 Phase 0/1: config-surface wiring invariant + decided real values

**Task:** `DIR-120`
**Charter:** `experiments/quay-perpetual-stream/charters/M186-dir120-config-crystallization-phase0-1.md`
**Class:** development (instrument-correction — config-surface hygiene; same fail-open failure
shape that already caused `gap-halt-sentinel-path-mismatch`).

## What was done

### Phase 0 — `config-wiring-check` (the mechanically-checked invariant)

1. `plugin/scripts/config-wiring-check.ts` (new) — for each of the 8 `.quay/config.yml` `loop:`
   schema fields (`board`, `gates`, `stop`, `policy`, `execution`, `audit`, `concurrency`,
   `routines`), classifies into three DISTINCT, independently-computed issue codes rather than a
   single has-a-reader boolean:
   - `NO_READER` — no reader for the field exists anywhere (checked by scanning every `return {...}`
     block in `packages/quay/src/loop-params.ts`'s `readLoopParams()` for the field as a key).
   - `NOT_CONSUMED_BY_DRIVER` — a real reader exists, but the SPECIFIC driver being checked
     (`generic` = `plugin/skills/loop-driver/SKILL.md`, or `bespoke` = THIS workspace's own
     `OUTER-LOOP.md` + the `.claude/workflows/*.js` / `experiments/quay-perpetual-stream/scripts/*.ts`
     files it actually invokes) never calls it. For `bespoke`, checked by grepping the real driver
     fileset for an actual `readLoopParams(` call — found zero, confirming the Finding. `routines`
     gets its own dedicated check (`.claude/workflows/run-routines.js` genuinely instructs reading
     `routines:` from `.quay/loop.yml` and dispatching `routine-scheduler.ts` — a real path distinct
     from `readLoopParams`).
   - `UNRESOLVABLE_VALUE` (checked only for `gates`) — reader + driver are real, but the CONFIGURED
     VALUE doesn't resolve. Ground truth is `packages/quay/src/gate/registry.ts`'s own `listGates()`
     (imported directly, not re-implemented — keeps this a single source of truth).
   A field can carry multiple simultaneous issues (e.g. `gates` legitimately had BOTH
   `NOT_CONSUMED_BY_DRIVER` and `UNRESOLVABLE_VALUE` before Phase 1 landed).
2. `experiments/quay-perpetual-stream/scripts/config-wiring-check.ts` (new) — a symlink to the
   `plugin/scripts/` copy (DIR-070 convention, same shape as `concurrent-batch-scheduler.ts` /
   `touches-orthogonality-check.ts`), so other exp5 scripts can `import` it by relative path.
   Node resolves `import.meta.url` through symlinks to the real file (verified empirically), so
   `REPO_ROOT` computation is robust regardless of which path loads the module — but the module's
   OWN `isDirect` CLI-entrypoint check compares `process.argv[1]` (as invoked) against that resolved
   real path, so a **direct CLI invocation through the symlink silently no-ops**. Mirrors the
   existing repo convention (`OUTER-LOOP.md` always invokes `concurrent-batch-scheduler.ts` via its
   `plugin/scripts/` path, never the mirror) — `config-wiring-selfcheck.sh` follows the same rule
   and invokes the real file explicitly (documented in its own header comment).
3. `experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh` (new) — thin wrapper
   `exec`'ing `plugin/scripts/config-wiring-check.ts --selftest`.
4. Embedded `--selftest` in `config-wiring-check.ts`: 15 assertions covering all three issue codes,
   the generic-vs-bespoke driver split, the multi-issue-per-field case, and an end-to-end CLI smoke
   run against a temp GREEN workspace. `node plugin/scripts/config-wiring-check.ts --selftest` →
   **15 passed, 0 failed** (verified; see Evidence below).

### Phase 1 — landed the 4 already-decided real values

5. `.quay/config.yml`'s `loop:` section:
   - `gates: [it0-set]` → `gates: [acceptance]` (the one value that resolves against the real gate
     registry AND matches this project's own fired-gate history).
   - Added `execution: dispatched` / `audit: adversarial` explicitly (previously only implicit via
     `readLoopParams`'s defaults, and only explicit in the soon-to-be-deleted root `.quay/loop.yml`).
   - Added `concurrency: 4` (up from the implicit default of 1), with a substantial inline comment
     preserving the DIR-049 SELECT←ABSORB-learning-dependency tension verbatim (this value change
     does NOT claim that tension is resolved — DIR-113's touches-preflight only proves file-level
     disjointness, a different risk class).
   - `routines:` trigger unchanged (`every(N)` in this file — still dead for exp5's own driver,
     which reads its OWN `.quay/loop.yml`'s `on(checkpoint)` routines directly; no code change
     needed, confirmed by Phase 0 finding #2).
   Real before/after diff pasted below (Evidence).

### The cross-cutting invariant — `checkHalt()` fail-closed

6. `experiments/quay-perpetual-stream/scripts/select-preflight.ts`'s `checkHalt()`: the catch block
   now distinguishes `ENOENT` (no `.halt` file at all — the expected, common non-halted state, kept
   as `{halt:false}`) from every OTHER read failure (permission denied, path is a directory, I/O
   error, etc.), which now fails CLOSED (`{halt:true, reason:"FAIL-CLOSED: ..."}`) instead of
   silently falling through to `{halt:false}`. Edit is confined to the catch-block body only, per
   the charter's concurrency-with-M187 constraint — no other line in `select-preflight.ts` touched,
   and no new fixture added to `select-preflight.test.mjs` (that file is M187's territory this
   round; verification is a LIVE probe instead, see Evidence).

## Evidence

### Phase 0 RED (before Phase 1, real output — `config-wiring-check.ts --workspace . --driver bespoke`)

```
config-wiring-check — workspace=/home/yale/work/quay drivers=[bespoke]

[FAIL] board = "native"
    - NOT_CONSUMED_BY_DRIVER(bespoke): no bespoke driver file (...) calls readLoopParams( — 'board' is declared but never read by THIS workspace's actual driver (...)

[FAIL] gates = ["it0-set"]
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... 'gates' is declared but never read by THIS workspace's actual driver (...)
    - UNRESOLVABLE_VALUE: configured gate name(s) [it0-set] do NOT appear in listGates() — dangling reference(s), unresolvable by any real gate loader (known gates: acceptance, adr-001, adr-007, anti-gaming, audit-independence, delivery-standalone-smoke, doc-quay-directive-skill, dod, dogfood-evidence, drivable-workspace, enforcement-with-design, impl-row, it0-dod-check-tests, line-budget, loadbearing-test, split-or-commit, tree-hygiene, ts-typecheck, vmeta-lag, worktree-branch-hygiene)

[FAIL] stop = "until(.halt)"
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... 'stop' is declared but never read by THIS workspace's actual driver (...)

[FAIL] policy = "value-typed-ledger"
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... 'policy' is declared but never read by THIS workspace's actual driver (...)

[FAIL] execution = "dispatched"
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... 'execution' is declared but never read by THIS workspace's actual driver (...)

[FAIL] audit = "adversarial"
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... 'audit' is declared but never read by THIS workspace's actual driver (...)

[FAIL] concurrency = 1
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... 'concurrency' is declared but never read by THIS workspace's actual driver (...)

[OK] routines = [{...self-validation...}, {...architecture-analysis...}, {...history-mining...}, {...browser-explorer...}]

FAIL: 8 issue(s) across 8 field(s)
```

Exactly matches the required RED evidence: `concurrency`/`stop`/`gates`/`policy` unwired-for-exp5,
and `gates: [it0-set]` unresolvable — pasted BEFORE any Phase 1 field change (real run, full raw
output saved at the time of the run; excerpt above; full text in this iteration's git history via
`/tmp/m186-evidence/red-before-clean.txt` at build time).

### Phase 1 real diff (`.quay/config.yml`)

```diff
 loop:
   board: native
-  gates: [it0-set]
+  # DIR-120 Phase 1 (2026-07-27, evidence-backed human decision): `it0-set`/`vitest` were both
+  # confirmed dangling references for THIS project (...)
+  gates: [acceptance]
   stop: until(.halt)
   policy: value-typed-ledger
+  # DIR-120 Phase 1 (2026-07-27): execution/audit were real, SKILL.md-consumed fields already set
+  # explicitly in both sibling projects (...)
+  execution: dispatched
+  audit: adversarial
+  # DIR-120 Phase 1 (2026-07-27, explicit human decision): raised from the DIR-049-era default (2)
+  # to 4. HONEST TENSION, not silently resolved: DIR-049 set exp5's concurrency to 2 specifically
+  # because exp5's OWN methodology milestones carry a SELECT<-ABSORB LEARNING dependency (...)
+  # NOTE (Phase 0 finding, still true after this edit): this field remains INERT for exp5's own
+  # bespoke driver (...)
+  concurrency: 4
   routines:
```
(full comment text — including the complete DIR-049 tension rationale — is in the committed
`.quay/config.yml`; excerpted here for length.)

### Post-Phase-1 re-run (same command) — `gates`'s `UNRESOLVABLE_VALUE` issue is now gone

```
[FAIL] gates = ["acceptance"]
    - NOT_CONSUMED_BY_DRIVER(bespoke): ... (still correctly flagged — Phase 2/3 territory, deferred)
```
No `UNRESOLVABLE_VALUE` line for `gates` anymore — the ONE axis Phase 1 was responsible for fixing.
The `NOT_CONSUMED_BY_DRIVER` finding correctly persists for all 7 non-`routines` fields (wiring
exp5's own bespoke driver to `readLoopParams` is explicitly Phase 2/3, out of scope this milestone).

### `checkHalt()` fail-closed — live probe (real command output, no new test fixture)

```
scenario: .halt is a directory (EISDIR) -> {"halt":true,"reason":"FAIL-CLOSED: could not read .halt sentinel at /tmp/checkhalt-fail-closed-probe-hxdqsu/.halt: EISDIR: illegal operation on a directory, read"}
scenario: no .halt file at all       -> {"halt":false,"reason":""}
scenario: .halt present with content -> {"halt":true,"reason":"manual stop"}
```
Genuine read failure (EISDIR, not ENOENT) now fails closed; the two pre-existing behaviors (absent
file, present file) are byte-for-byte unchanged.

### `config-wiring-check.ts --selftest`

```
config-wiring-check --selftest: 15 passed, 0 failed
```

### `config-wiring-selfcheck.sh`

Delegates to the same `--selftest` via the real `plugin/scripts/` path (never the experiments/
mirror symlink — documented in the wrapper's own header, see "What was done" #2 above). Exit 0.

### Existing test suite

`node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs` → **31/31 pass**
(real, uncontended run; includes M187's already-landed wrong-path regression guard test,
confirming this milestone's `checkHalt()` edit did not disturb M187's concurrent work, which
ABSORBed independently as commit `15dcba8` during this same build).
`node --test packages/quay/test/loop-params.test.mjs` → **38/38 pass** (unrelated to this
milestone's `.ts` edits, confirms no regression to the schema reader itself).

Full `scripts/test.sh` (537 tests) — TWO earlier attempts during this build were truncated by an
outer `timeout N` wrapper too tight for this machine's momentary load (DIR-090 timeout-discipline
lesson confirmed live: raising the wrapper timeout, or dropping it entirely and letting
`run_in_background` bound the wait instead, was the fix). A THIRD, clean, un-wrapped run allowed to
finish naturally gives the authoritative result:

```
ℹ tests 537
ℹ pass 533
ℹ fail 1
ℹ skipped 3
```

The single remaining failure — `plugin/test/plugin-packaging.test.mjs`'s "shipped schema-check
modules are byte-identical..." assertion — is a genuine, deterministic (non-flaky) FAIL, but
confirmed PRE-EXISTING and unrelated to this milestone:
`git diff experiments/quay-perpetual-stream/scripts/task-schema.ts plugin/scripts/task-schema.ts`
shows real drift (a `checkTouches(task, kind)` signature change + new DIR-113 logic) introduced by
commit `3f28b4e` ("M178/DIR-113: pre-screen task-level Touches orthogonality..."), already on
`master` before this milestone started. This milestone never reads, writes, or imports
`task-schema.ts` in either location — out of scope, pre-existing, not a regression this milestone
introduced. (The `delivery-standalone-smoke-gate.test.mjs` timeout seen in the two truncated
attempts does NOT reproduce in this clean run — confirming it was pure system-load-under-truncation
artifact, not a real defect; also independently confirmed via an isolated 7/7-pass re-run earlier
in this build.)

No file this milestone touched (`config-wiring-check.ts`, `.quay/config.yml`, `select-preflight.ts`)
is referenced by the one remaining failing test. `checkHalt`'s only test consumer is
`select-preflight.test.mjs` (31/31 green); `config.yml`'s `loop:` section's only direct test
consumer is `loop-params.test.mjs` (38/38 green, reads a synthetic fixture workspace, not this
repo's own `.quay/config.yml`).

## Explicitly NOT attempted this milestone (Phase 2/3, per charter)

- Root `.quay/gates.yml` / `.quay/loop.yml` deletion, and the corresponding `loader.ts` /
  `loop-params.ts` fallback-branch removal.
- exp5's loop-config profile-fragment schema restriction (`providers:`/`gates:` ban).
- `drivable-workspaces.yml` layering fix.
- `restart-readiness-check.sh` and any new fixture in `select-preflight.test.mjs` — both M187's
  territory this round (concurrent, touches-disjoint milestone).

These remain DIR-120's own AC items 4/5/8 (partial), left open on the task for a follow-on
milestone — this milestone's charter explicitly scopes to Phase 0/1 only.

## Files touched

- `plugin/scripts/config-wiring-check.ts` (new)
- `experiments/quay-perpetual-stream/scripts/config-wiring-check.ts` (new, symlink)
- `experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh` (new)
- `.quay/config.yml` (Phase 1 values + rationale comments)
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` (`checkHalt()` catch-block only)
