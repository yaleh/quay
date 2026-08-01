---
id: DIR-100-A
title: "Fail-loud scan: unrecognized top-level keys under gates: emit diagnostics"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-100
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Make the gate loader fail-loud for unrecognized top-level keys under the `gates:`
section of `.quay/config.yml`. Today `readGatesConfig()` extracts the six known arrays
(it0/adr/fixed/testPass/coverageFloor/redGreen) and silently drops anything else. Add a
scan of the parsed `gates:` map's top-level keys; any key not in
`KNOWN_GATE_SECTIONS` emits a stderr diagnostic naming the key and the expected set.

**Malformed-shape guards (the blocking finding from split review):** the scan must also
guard the VALUE shapes, not just top-level key membership:
- a known section whose value is a MAP instead of an array (the "wrong YAML nesting
  level" class, e.g. `gates:\n  testPass:\n    name: v` — a forgotten list dash) must
  emit a diagnostic (the key IS known, so membership alone misses it);
- `gates:` parsed as `null` must NOT crash (`Object.keys(null)` throws) — it degrades
  gracefully to "no gate sections" (matching current graceful-empty behavior);
- a scalar `gates:` (string/number) emits a diagnostic; an array emits per-index
  diagnostics.

First child of the DIR-100 split (`split-multi-mechanism` finding). No dependencies
within the split.

## Chosen mechanism

In `readGatesConfig()` (loader.ts): after extracting the six known arrays, iterate the
top-level keys of the parsed `gates:` map. For each key: if not in
`KNOWN_GATE_SECTIONS`, emit an `error`-severity diagnostic. Additionally, for each known
section, validate its value shape (`Array.isArray`); a non-array value emits a
"wrong nesting level" diagnostic naming the expected array shape. Guard the `gates:`
value itself (`typeof` + `Array.isArray`) so null/scalar/map shapes never throw.

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

`loader.ts` — `readGatesConfig` reads `parsed.gates` (L94-97), early-returns only on
`=== undefined` (null/string/number/array pass through), and reads the six arrays via
optional chaining (yielding empty arrays for non-array values — silent). An unrecognized
top-level key is dropped with zero diagnostic. A known key with a map value is silently
skipped (no diagnostic). `Object.keys(null)` would throw if `gates:` were null.

## Requested action

1. After the six known arrays are extracted, scan the `gates:` map's top-level keys;
   unrecognized keys emit an `error` diagnostic naming the key + expected set.
2. Guard value shapes: known section with non-array value → "wrong nesting level"
   diagnostic; `gates:` null/scalar/array → graceful handling, never a crash.
3. RED/GREEN tests: unrecognized key → diagnostic; known-key-with-map-value →
   diagnostic; `gates:` null → no crash + no false diagnostic; clean workspace → zero
   diagnostics.

## Acceptance Criteria

- [ ] An unrecognized top-level key under `gates:` emits a diagnostic naming the key and
  the expected section set (real stderr capture, not asserted).
- [ ] A known section whose value is a MAP (forgotten list dash) emits a "wrong nesting
  level" diagnostic — the key is known, so membership alone must NOT pass it silently.
- [ ] `gates:` parsed as null/scalar/array degrades gracefully (no TypeError) — a null
  `gates:` produces no false diagnostic (matches current graceful-empty behavior).
- [ ] A correctly-configured workspace produces zero diagnostics (no false positives).
- [ ] Tests: `packages/quay/test/gate-diagnostics.test.mjs` RED/GREEN covering the above
  (>=80% coverage on new paths).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] Real malformed-config fixture shows the loader emitting the diagnostic (stderr).
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does an unrecognized key under `gates:` produce a diagnostic without crashing on
   malformed value shapes?

## Touches

- `packages/quay/src/gate/config/loader.ts`
- `packages/quay/test/gate-diagnostics.test.mjs (new)`
- `docs/plans/M226-dir-100-a.md`
