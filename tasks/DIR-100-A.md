---
id: DIR-100-A
title: "Fail-loud scan: unrecognized top-level keys under gates: emit diagnostics"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-100
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-100-A experiments/quay-perpetual-stream/charters/M226-dir-100-a.md
    milestones/M226/absorb-entry.md
---
**type:** execution


**Grounded facts for Plan authors (2026-08-01, from real PlanCheck rounds):**

1. **Built-in gates (`dod`, `acceptance`) short-circuit in `resolveGate`**
   (`registry.ts:100-107`: `if (gateRegistry[name]) return gateRegistry[name]`) and NEVER
   call `loadWorkspaceGates`/`readGatesConfig`. `quay gate <id>` with no `--gate` defaults
   to the built-in `acceptance` gate (quay.ts:1149 `const gate = vf.gate ?? "acceptance"`),
   and `complete`/`promote` delegate to `runGate` with `gate: "acceptance"`/`"dod"` (both
   built-ins). So `quay gate <id>` will NOT surface loader diagnostics on stderr. The
   real-CLI stderr proof MUST use `quay gate --list` (which loads workspace gates via
   `listGates` → `loadWorkspaceGates` → `readGatesConfig`).
2. **CLI binary is `packages/quay/bin/quay.ts`**, NOT `quay.js` (no such file; only the
   npm-pack `dist/quay.js` artifact exists). `node packages/quay/bin/quay.js gate --list`
   fails MODULE_NOT_FOUND.
3. **A config has exactly ONE `gates:` key** — unrecognized-key, wrong-nesting-level, and
   scalar-number diagnostics are mutually exclusive shapes and CANNOT all appear in one
   `gate --list` stderr. Each malformed shape needs its OWN fixture.
4. **`execFileSync` does NOT capture child stderr on a zero exit** — use `spawnSync` or an
   async stderr-stream read for real-CLI stderr assertions.



5. **Scratch-workspace CLI invocation must use an ABSOLUTE path to `quay.ts`** — `gate
   --list` resolves the workspace via `findConfig(process.cwd())` with NO workspace-root
   flag, so every real-CLI run must `cd` into the scratch workspace. But `node
   packages/quay/bin/quay.ts` is a repo-root-RELATIVE path that cannot resolve from a
   scratch cwd (MODULE_NOT_FOUND, verified). Use `node
   /home/yale/work/quay/packages/quay/bin/quay.ts gate --list` (absolute) with the shell
   cwd inside the scratch workspace.
6. **Every `- Command:` MUST use `quay.ts` (never `quay.js`)** — grep-verify zero
   `quay.js` residuals across ALL plan stages before completion (one residual in an
   earlier plan round slipped past despite grounded fact #2).


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
- a scalar `gates:` (string/number) emits a diagnostic via an explicit `typeof` guard
  (a naive `Object.keys(42)` scan returns `[]` and would silently emit nothing, so
  iteration/membership alone must NOT be relied on); an array `gates:` emits per-index
  diagnostics.

First child of the DIR-100 split (`split-multi-mechanism` finding). No dependencies
within the split.

## Chosen mechanism

In `readGatesConfig()` (loader.ts): after extracting the six known arrays, iterate the
top-level keys of the parsed `gates:` map. For each key: if not in
`KNOWN_GATE_SECTIONS`, emit an `error`-severity diagnostic. Additionally, for each known
section, validate its value shape (`Array.isArray`); a non-array value emits a
"wrong nesting level" diagnostic naming the expected array shape. Guard the `gates:`
value itself with an explicit `typeof` guard: a scalar (string/number) emits a
diagnostic naming the scalar (this MUST be a real `typeof` check — a naive
`Object.keys(42)` scan returns `[]` and would emit nothing), and `Array.isArray`
routes arrays to per-index diagnostics; null/map shapes degrade gracefully, never throw.

## Plan

See the checked milestone Plan at `docs/plans/M226-dir-100-a.md` (DIR-117-B
prepared-gate artifact, authored for milestone M226; base revision `f2a0b104`).
Implementation follows that Plan's staged RED/implementation/GREEN sequence with the
standardized stopping rule (at most 3 Plan-check rounds, success only at F_i = 0).

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
   diagnostic; `gates:` null → no crash + no false diagnostic; `gates:` scalar (string
   AND number) → diagnostic each (proves the explicit `typeof` guard — a naive
   `Object.keys(42)` scan would emit nothing); `gates:` array → one diagnostic per
   index (count == element count); clean workspace → zero diagnostics.

## Acceptance Criteria

- [ ] An unrecognized top-level key under `gates:` emits a diagnostic naming the key and
  the expected section set (real stderr capture, not asserted).
- [ ] A known section whose value is a MAP (forgotten list dash) emits a "wrong nesting
  level" diagnostic — the key is known, so membership alone must NOT pass it silently.
- [ ] `gates:` parsed as null/scalar/array degrades gracefully (no TypeError) — a null
  `gates:` produces no false diagnostic (matches current graceful-empty behavior).
- [ ] `gates:` parsed as a scalar (string or number) emits a diagnostic — falsifiable:
  the scalar check is an explicit `typeof` guard, because a naive `Object.keys(42)`
  scan returns `[]` and would silently emit nothing (a numeric scalar must still emit).
- [ ] `gates:` parsed as an array emits one diagnostic per index — falsifiable: the
  diagnostic count equals the number of array elements.
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

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：ask (fail-loud scan of unrecognized gates keys + malformed-shape guards) landed in commit ed1e946f (M226), live in packages/quay/src/gate/config/loader.ts, RED/GREEN in gate-diagnostics.test.mjs.）**
全文见 git 历史（`git log -p -- tasks/DIR-100-A.md`）。

## Touches

- `packages/quay/src/gate/config/loader.ts`
- `packages/quay/test/gate-diagnostics.test.mjs (new)`
- `docs/plans/M226-dir-100-a.md`