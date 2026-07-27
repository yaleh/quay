# M180 — Append real clause1/clause2/clause7 disposition text into the absorb-entry file before the gate check runs (gap-absorb-entry-clause-disposition-sequencing)

**Task:** gap-absorb-entry-clause-disposition-sequencing · **Counter:** 180 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~1.0 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). `it0-dod-check.sh`'s clause1/clause2/clause7 have
FAILed identically on all 5 human-steered milestones this session (M175-M179) because nothing in
`execute-milestone.js`'s Audit phase ever writes the specific disposition text those clauses grep
for into `$a.absorbEntryFile` before invoking the check. Root-caused in
`gap-absorb-entry-clause-disposition-sequencing` (a second independent audit disproved an earlier
`/tmp`-sandbox-isolation theory with a decisive re-run). This fix closes the actual mechanism.

## Scope
Precisely matching `it0-dod-check.ts`'s own regexes (read directly, not guessed):
1. **clause1** (`it0-dod-check.ts` ~line 234-246): needs `adversarial-audit` within ~200 chars of
   one of `REFUTED|CONCERNS|NO REFUTATION FOUND` (case-insensitive, either order). Audit phase,
   AFTER determining its own verdict (charge items 1-2) and BEFORE invoking `it0-dod-check.sh`
   (charge item 3), must append a line like `adversarial-audit disposition: <VERDICT>` to
   `$a.absorbEntryFile`.
2. **clause2** (~line 250-259): needs `V_meta consolidation-lag` within ~200 chars of one of
   `clear|no rows? (past|over) threshold|resolved|consolidated|carry-forward|K=2`. The Audit phase
   must run the SAME `vmeta-lag-check.sh` invocation the later Gate phase runs (duplicated, cheap —
   a read-only ledger check), and append a real disposition line reflecting its actual result (not
   a fabricated "clear") to `$a.absorbEntryFile` before the gate check.
3. **clause7** (~line 506-533): reads a `surface:<label>` token from the `## Backlog row` line.
   **Critically: when NO `surface:` token is present at all, the check fails closed (treats it as
   product-touching) — but when the Backlog row DOES carry a `surface:` token that is one of the 4
   recognized non-product labels (`method-infra`/`docs`/`cross-cutting`/`packaging`), clause7
   auto-resolves to N/A-PASS with no coverage figure or WAIVER text needed at all.** This is the
   cheapest fix of the three: ensure the ABSORB-entry's own `## Backlog row` pipe-line always
   carries an accurate `surface:` tag (Build phase pre-flight, alongside the existing
   `extra.acceptance` step, or OUTER-LOOP.md's charter-authoring step) — for a genuinely
   product-touching milestone, either a real ≥80% coverage figure or an explicit WAIVER line is
   still required as today.
4. Mirror into `plugin/workflows/execute-milestone.js`.

**Out of scope:** any change to `it0-dod-check.ts` itself (its clause logic is correct and already
well-documented — this fix is entirely about the CALLER supplying the disposition text the checker
already knows how to recognize), and any change to the Gate phase's own `vmeta-lag`/other checks.

## Touches
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js

## Done-when
1. Audit phase prompt contains an explicit step, positioned between AC/DoD determination and the
   mechanical-gate invocation, instructing the agent to append clause1 (verdict-adjacent-to-
   "adversarial-audit") and clause2 (real vmeta-lag-check.sh result-adjacent-to-"V_meta
   consolidation-lag") disposition text into `$a.absorbEntryFile`.
2. The Backlog-row-authoring step (wherever the `## Backlog row` pipe-line is first produced —
   likely the Build phase's pre-flight or the charter-authoring convention documented in
   OUTER-LOOP.md) is instructed to always include an accurate `surface:` tag.
3. A real (non-fixture) execute-milestone dispatch on a genuinely non-product-touching task (e.g.
   this very milestone, which only touches `.claude/workflows/execute-milestone.js`) shows
   `it0-dod-check.sh` passing clause1/clause2/clause7 with NO manual post-hoc edit to the
   absorb-entry file by the orchestrator — the file the orchestrator pre-creates only needs the
   `## Backlog row`/value-hypothesis stub it already carries; the pipeline itself fills in the rest.
4. Both `.claude/workflows/` and `plugin/workflows/` mirrors stay byte-identical.
5. No regression: `node --check` passes on both files; the existing Verify/Build/Gate/Land phase
   logic is untouched.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
