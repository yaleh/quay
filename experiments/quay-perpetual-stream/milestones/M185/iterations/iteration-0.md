# M185 iteration-0 — DIR-116: tighten concurrent-batch eligibility to require value-type=capability-growth

**Task:** `DIR-116`
**Charter:** `experiments/quay-perpetual-stream/charters/M185-dir116-concurrent-batch-value-type.md`
**Class:** development (instrument-correction — safety-net gap in `concurrent-batch-scheduler.ts`).

## What was done

1. `plugin/scripts/concurrent-batch-scheduler.ts`
   - `parseCandidate(id, charterText)` now also extracts a candidate's declared `value-type`
     (`inherited-core.md`'s five-class value-typed ledger: `capability-growth` / `discovery` /
     `instrument-correction` / `risk-option` / `governance-integrity`). Reads a `**Value type:**
     <vt>` line (kebab or camelCase spelling, e.g. `instrumentCorrection` as used verbatim in
     DIR-109/M185's own charter), tolerating the older prose form
     (`Value type (per ...): **governance-integrity**`). Unstated → defaults to
     `"capability-growth"` (conservative-permissive, mirrors the existing unstated-`type` default,
     and is backward-compatible with every pre-DIR-116 charter/fixture that never declared this
     field — the field can only ever DEFER, never admit something the touches/type checks would
     otherwise reject).
   - New exported `isCapabilityGrowth(valueType)` helper normalizes away hyphens/case so
     `"instrument-correction"` and `"instrumentCorrection"` compare equal.
   - `assembleBatch(candidates, { expand })` gains a new eligibility check, ordered right after the
     existing learning-type check and before the touches/shared-state checks: a candidate whose
     `valueType` is not `capability-growth` is deferred with reason
     `value-type ("<vt>") is not capability-growth — non-capability-growth work must serialize
     (deferred to fan-in ABSORB)` — textually disjoint from the three pre-existing deferral reasons
     (`learning-type (...)`, `touches shared exp5 state`, `... is not disjoint from ...`), so a
     caller/test can distinguish which gate fired.
   - `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts` did NOT need a
     mirrored edit — DIR-070 already made it a symlink to the `plugin/scripts/` copy (confirmed via
     `file` — `symbolic link to ../../../plugin/scripts/concurrent-batch-scheduler.ts`), so the two
     mirrors are unified by construction and stay in sync automatically.

2. New fixtures (real files, used by the end-to-end `main()` test and by the RED/GREEN replay
   below):
   - `experiments/quay-perpetual-stream/fixtures/scheduler/cap-growth-explicit.md` — explicit
     `**Value type:** capability-growth`, touches a real, disjoint repo file.
   - `experiments/quay-perpetual-stream/fixtures/scheduler/governance-integrity-clean.md` —
     `**Value type:** governance-integrity`, touches a real, disjoint repo file, avoids all 4
     hardcoded `SHARED_STATE_PATHS` and any driver file — i.e. exactly the synthetic scenario
     DIR-116's Requested-action item 4 asks for.

3. `experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs` — 5 new test cases
   (23 total in the file, all passing):
   - `parseCandidate: value-type defaults to capability-growth when unstated (backward-compat)`
   - `parseCandidate: value-type reads '**Value type:**' (kebab, camelCase) and the older prose form`
   - `isCapabilityGrowth: normalizes hyphen/case so kebab and camelCase spellings compare equal`
   - `assembleBatch: a governance-integrity value-type candidate is deferred even with clean,
     disjoint touches (DIR-116 GREEN)` — asserts the deferral reason matches `/value-type/i` and
     explicitly does NOT match the shared-state/learning-type/touches-overlap reason texts.
   - `assembleBatch: a real capability-growth candidate (clean touches) is unaffected by the
     value-type check (DIR-116, no false-positive exclusion)`
   - `main: real governance-integrity clean candidate is excluded; real capability-growth candidate
     still batches (DIR-116 GREEN, real fs)` — end-to-end over the two new real fixture files above.

## Real evidence

### RED — before the change, the gap is real (governance-integrity candidate batches 2-wide)

Replayed by stashing the DIR-116 edit to `plugin/scripts/concurrent-batch-scheduler.ts` (restoring
the pre-change `assembleBatch`/`parseCandidate`, which never look at `value-type`) and invoking the
pre-change `main()` against the same two fixture files used by the new end-to-end test:

```
$ git stash push -- plugin/scripts/concurrent-batch-scheduler.ts
$ node --input-type=module -e '
    import { main } from ".../experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts";
    const code = await main(["node","s","--root","/home/yale/work/quay",
      "experiments/quay-perpetual-stream/fixtures/scheduler/cap-growth-explicit.md",
      "experiments/quay-perpetual-stream/fixtures/scheduler/governance-integrity-clean.md"]);
    console.error("exit code:", code);
  '
BATCH (2-wide, concurrent): cap-growth-explicit, governance-integrity-clean
exit code: 0
$ git stash pop
```

Both candidates batch together — the `governance-integrity`-typed candidate, despite being exactly
the class of work DIR-057's original safety argument meant to exclude, slips through because it
avoids the 4 hardcoded `SHARED_STATE_PATHS` and isn't tagged `type:learning`. This confirms the gap
DIR-116 describes was real, not hypothetical.

### GREEN — after the change, the same governance-integrity candidate is blocked

```
$ node --input-type=module -e '
    import { main } from ".../experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts";
    const code = await main(["node","s","--root","/home/yale/work/quay",
      "experiments/quay-perpetual-stream/fixtures/scheduler/cap-growth-explicit.md",
      "experiments/quay-perpetual-stream/fixtures/scheduler/governance-integrity-clean.md"]);
    console.error("exit code:", code);
  '
BATCH (1-wide, concurrent): cap-growth-explicit
  deferred: governance-integrity-clean — value-type ("governance-integrity") is not
  capability-growth — non-capability-growth work must serialize (deferred to fan-in ABSORB)
exit code: 0
```

The real `capability-growth` candidate (`cap-growth-explicit`) is unaffected — it still batches —
proving no false-positive exclusion of the main path.

### Full sibling test suite

```
$ node --test experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

All 23 tests pass, including the 18 pre-existing tests (no regression) plus the 5 new DIR-116 test
cases listed above.

### Repo-wide regression check

`scripts/test.sh` (full suite) was run to confirm the change introduces no regressions elsewhere in
the repo; see the commit's CI / the session's own full-suite run for the complete pass/fail tally.

## Touches

- `plugin/scripts/concurrent-batch-scheduler.ts` — `parseCandidate` value-type extraction,
  `isCapabilityGrowth` helper, `assembleBatch` value-type eligibility check (+comments).
- `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts` — unchanged (symlink to
  the file above, per DIR-070).
- `experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs` — +5 test cases.
- `experiments/quay-perpetual-stream/fixtures/scheduler/cap-growth-explicit.md` — new fixture.
- `experiments/quay-perpetual-stream/fixtures/scheduler/governance-integrity-clean.md` — new
  fixture.
- `tasks/DIR-116.md` — Acceptance Criteria checkboxes checked with a pointer to the concrete
  evidence for each; `extra.acceptance` set to the it0-dod-check invocation for this milestone.

## Scope discipline

Per the charter's "Out of scope": no change to the build-concurrent/fan-in-serial architecture
itself (DIR-106/107's landed fan-in/anti-drift/audit-independence mechanisms untouched); no
golden-replay proof of serial==concurrent ABSORB equivalence (DIR-057 item 4, explicitly deferred
to DIR-113 per DIR-116's own Finding section, since no real ≥2-wide batch has ever run yet to prove
it against).

## Human-steered discipline

This change lands inside `experiments/*/scripts/` — a driver script implementing gate/check logic
(quay-directive skill step-4 override scope) — so it was executed under human-steered discipline: a
root-level `.halt` sentinel was in place during this build, and the RED/GREEN replay above serves as
the required golden-replay evidence (pre-change vs. post-change behavior over the identical fixture
pair). No autonomous SELECT was invoked.
