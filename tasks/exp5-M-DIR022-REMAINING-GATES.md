---
id: exp5-M-DIR022-REMAINING-GATES
title: "DIR-022 remainder: register the OTHER gates (audit, vmeta-lag, escrow,
  test-floor) as named engine gates + prove multi-gate ABSORB on a REAL
  milestone"
status: todo
labels:
  - milestone-candidate
  - milestone:M43-dir022-remaining-gates
parent: null
children: []
extra:
  schema: v1
---
## Proposal
DIR-022 Layer 2 landed only phase 1 (M39 registered `impl-row` + `line-budget` as named engine gates). The audit found the REMAINDER untracked. Re-derived at M43 charter time by reading `it0-dod-check.mjs`/`vmeta-lag-check.mjs` directly (not assumed from the title): **vmeta-lag** is a real standalone script (`vmeta-lag-check.mjs [--counter N] <ledger-file>`, same positional-args shape as `impl-row`/`line-budget`) and is the clean, direct M39-precedent wrap. **audit** already exists as a GateEvent name (`quay adjudicate` → `lifecycle.js#runAdjudicate`, wraps `taskCheck`) but is a DIFFERENT check than the exp5 per-milestone adversarial-audit narrative (OUTER-LOOP.md step 6) — this task's scope for "audit" is to make that distinction explicit (not invent a second gate with the same name) and, if a genuinely new named gate is warranted, wrap `it0-dogfood-evidence-gate.sh` (the mechanized proximity-heuristic script closest to "audit evidence") as `dogfood-evidence`. **escrow-Δv** and **test-floor** are NOT standalone scripts — they are Clauses 6/7 inside `it0-dod-check.mjs`, which already runs (and gates) via the existing `dod` named gate; registering them as SEPARATE named gates would duplicate logic already covered by `dod`, violating the single-source discipline this very task's DoD requires. Revised scope: register **vmeta-lag** (clear win, thin wrap, M39 precedent) + **dogfood-evidence** (thin wrap of `it0-dogfood-evidence-gate.sh`) as new named engine gates; explicitly document why escrow-Δv/test-floor do NOT get separate gates (already covered by `dod`); and prove a REAL milestone's ABSORB running ≥2 distinct non-`dod` gates (this milestone's own ABSORB is the proof: `vmeta-lag` + `line-budget`/`impl-row`/`adr-001` are all already-registered non-`dod` gates it can run for real).

## Plan
N/A — thin `registry.js` wrappers over the existing it0/vmeta scripts (no logic duplicated) + fixtures/coverage + a real-milestone multi-gate ABSORB proof; no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] `quay gate --list` includes `vmeta-lag` and `dogfood-evidence`; each `--gate <name>` exits 0/1 against a real fixture and appends a real GateEvent; wrappers are thin (no logic duplicated — grep confirms single-source, same `makeIt0Gate`-style factory as `impl-row`/`line-budget`).
- [ ] The task body (or a code comment in `registry.js`) explicitly documents why `escrow-Δv`/`test-floor` do NOT get separate named gates (they are `it0-dod-check.mjs` Clauses 6/7, already covered by the existing `dod` gate — registering them separately would duplicate logic) and why `audit` is NOT a new gate name (it already exists via `quay adjudicate`, a different check than the exp5 per-milestone acceptance-audit narrative).
- [ ] DoD proof: THIS milestone's own real ABSORB runs ≥2 distinct non-`dod` engine gates (e.g. `vmeta-lag` + `line-budget`/`impl-row`), each with a GateEvent in `quay gate-log --json` for this milestone's own task.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The remaining gates (vmeta-lag, dogfood-evidence) are engine-registered and run through the engine on a REAL milestone (not a throwaway worktree), each with a durable GateEvent.
- [ ] Single-source preserved (registry WRAPS scripts, never reimplements); closes the DIR-022 remainder audited 2026-07-20. Unblocks DIR-024 (gate-log audit trail).

## Not selected (M41)
DIR-030 ranks this #3 in the observe-and-enforce cluster, after G1 and E3. Not selected this pass: G1 is ranked first and is the smaller unit. Reconsider at M43 (or M42 if E3 is deferred).

## Not selected (M42)
DIR-030 ranks this #3, after G1 (landed m41) and E3. E3 is selected this pass per the ordering — this task is next in line for M43 pending E3's landing.