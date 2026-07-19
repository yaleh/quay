---
id: exp5-M-CRYST-ADR-CARRYFWD
title: ADR uncritical metric/baseline carry-forward is prohibited — inherited
  V_meta-ceiling / σ-floor / VT₀ must be reset-or-explicitly-re-verified (exp1-5
  recurring)
status: todo
labels:
  - crystallization
  - adr
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
ADR: any metric/baseline carried from a prior experiment/phase is presumptively CARRY-FORWARD-WITH-LOW-CONFIDENCE until re-verified by THIS experiment's own live evidence; multiplicative frozen factors that make a target unreachable are a design smell (do the arithmetic before committing). Evidence: exp2/3/4 V_meta ceiling 0.26<0.80; exp2 σ inherited-floor; exp5 M4 VT₀ carried from exp4's overstated 'closed' (Δv=−6.60).
## Acceptance Criteria
- [ ] ADR captured (E1 form) with the reset-vs-carry decision procedure; back-linked to the evidence.
## Definition of Done
Real: a future baseline-carry decision cites this ADR (and, if mechanizable, a check flags an un-reverified carry).