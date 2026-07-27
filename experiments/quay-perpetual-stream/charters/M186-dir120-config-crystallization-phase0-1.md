# M186 — Crystallize the configuration surface: Phase 0 invariant + Phase 1 decided values (DIR-120)

**Task:** DIR-120 · **Counter:** 186 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~1.0 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). Three mutually contradictory loop declarations exist
across `.quay/config.yml`/root `.quay/loop.yml`/exp5 `.quay/loop.yml` with no documented tie-break
rule; `checkHalt()`'s fail-open default (`catch { halt: false }`) is the same failure shape that
already caused a real, safety-relevant miss (`gap-halt-sentinel-path-mismatch`). Full Finding/
Requested-action detail is in `tasks/DIR-120.md` — this charter scopes THIS milestone to Phase 0
(the wiring-check invariant) and Phase 1 (landing the already-decided real-usage values), which is
independently valuable and safely separable from Phase 2/3 (deleting legacy files).

## Scope
Per `tasks/DIR-120.md`'s Phase 0 + Phase 1 (already-decided, evidence-backed values — see task body
for the full real-usage evidence chain against this project's own `gate-events.jsonl` and the
`meta-cc`/`archguard` sibling-project comparison):

1. **Phase 0** — `config-wiring-check` (new, `plugin/scripts/` + `experiments/*/scripts/` mirrors +
   selfcheck): asserts each declared config field has a named, real reader; distinguishes "no reader
   anywhere" from "a reader exists but exp5's own bespoke driver doesn't consume it" from "value
   itself is unresolvable" (e.g. `it0-set`). RED evidence pasted BEFORE any field is changed.
2. **Phase 1, landed with decided values**:
   - `gates` in `config.yml`'s canonical `loop:` section → `[acceptance]` (real usage match;
     `it0-set`/`vitest` both proven wrong for this project).
   - `concurrency` → `4` (explicit human decision; the DIR-049 tension note in `tasks/DIR-120.md`
     must be preserved verbatim, not silently dropped, when this lands).
   - routines trigger stays `on(checkpoint)` (exp5's own real, live value) — no code change needed,
     `loop-params.ts` already supports both `every(N)` and `on(event)`.
   - `execution: dispatched` / `audit: adversarial` explicitly added to `config.yml`'s `loop:`
     section (confirmed real fields, both sibling projects set them, `SKILL.md` genuinely consumes
     them) — migrated from the soon-to-be-deleted root `loop.yml`, not just left there.
3. `select-preflight.ts`'s `checkHalt()` fail-open `catch { return { halt: false } }` → fail-closed
   (`catch { return { halt: true, reason: "..." } }`) — the cross-cutting invariant DIR-120 names
   explicitly, independent of the path question itself (already resolved separately).

**Out of scope for THIS milestone** (Phase 2/3, deliberately deferred to a follow-on): deleting root
`.quay/gates.yml`/`.quay/loop.yml` and their loader fallback code paths; exp5's loop config
profile-fragment schema restriction; `drivable-workspaces.yml`'s layering fix. Landing Phase 0/1
first, verified independently, de-risks Phase 2's deletions (nothing should break when the legacy
files are removed if Phase 0's wiring-check already confirms the canonical file covers everything).

**Concurrency note**: this milestone is dispatched concurrently with M187 (`gap-halt-sentinel-
path-mismatch`), which ALSO touches `experiments/quay-perpetual-stream/scripts/select-preflight.ts`
region and `experiments/quay-perpetual-stream/test/select-preflight.test.mjs`. To keep the two
milestones genuinely touches-disjoint (per the real orthogonality check both charters were planned
against), this milestone's edit is confined to `checkHalt()`'s own catch-block body only, and its
fail-closed verification is a LIVE probe (real command output pasted), NOT a new committed test
fixture in `select-preflight.test.mjs` — that file is M187's territory this round. Do not touch
`restart-readiness-check.sh` (M187's territory) or add any new test file under
`experiments/quay-perpetual-stream/test/`.

## Touches
- experiments/quay-perpetual-stream/scripts/config-wiring-check.ts (new)
- plugin/scripts/config-wiring-check.ts (new)
- experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh (new)
- .quay/config.yml
- experiments/quay-perpetual-stream/scripts/select-preflight.ts

## Done-when
1. `config-wiring-check` exists, runs, and its RED output (before Phase 1 lands) is pasted showing
   `concurrency`/`stop`/`gates`/`policy` as unwired-for-exp5 and `gates: [it0-set]` as unresolvable.
2. `config.yml`'s `loop:` section shows `gates: [acceptance]`, `concurrency: 4` (with the DIR-049
   tension note preserved in `tasks/DIR-120.md`, not silently dropped), `execution: dispatched`,
   `audit: adversarial` — real diff pasted, not asserted.
3. `checkHalt()` fail-closed: a real read-failure scenario (unreadable path) returns `halt: true`,
   pasted output.
4. Existing test suite green; no regression to `select-preflight.ts`'s existing behavior for the
   already-working halt-detection case.
5. Phase 2/3 explicitly NOT attempted this milestone — legacy files/fallback code untouched.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
