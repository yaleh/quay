---
id: exp5-M-CRYST-ADR-CARRYFWD
title: "ADR: uncritical metric/baseline carry-forward is prohibited — inherited
  V_meta-ceiling / σ-floor / VT₀ must be reset-or-re-verified"
status: done
labels:
  - adr
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
  adrStatus: accepted
  date: 2026-07-19
---
## Context
Metrics/baselines carried from a prior experiment or phase were repeatedly inherited without re-verification, several times fatally: exp2/3/4 ran against a V_meta ceiling of 0.26 while the target was 0.80 (a frozen multiplicative factor made the target unreachable — arithmetic never done); exp2 inherited a σ-floor; exp5 M4's VT₀ was carried from exp4's overstated "closed" ledger, producing a Δv=−6.60 instrument-correction milestone. The pattern recurs across exp1–5.

## Decision
Any metric/baseline carried from a prior experiment/phase is **presumptively carry-forward-with-low-confidence until re-verified by THIS experiment's own live evidence.** A multiplicative frozen factor that makes a target unreachable is a design smell — **do the arithmetic before committing** to the carried value.

## Consequences
- **Forbids:** silently inheriting a baseline/ceiling/floor as authoritative; committing to a target without checking the carried factors make it reachable.
- **Enables / requires:** a future baseline-carry decision cites this ADR and records the reset-vs-re-verify choice; if mechanizable, a check flags an un-re-verified carried baseline.
- **Scope:** all inherited metrics — V_meta ceiling, σ-floor, VT₀, and any convergence threshold.