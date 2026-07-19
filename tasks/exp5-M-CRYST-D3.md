---
id: exp5-M-CRYST-D3
title: D3 [subtractive] Rewrite OUTER-LOOP + inherited-core + inner-iteration
  prompts in formalized style; replace deterministic prompt steps with code
  (Axis 2′)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Rewrite ALL repeatable method text (OUTER-LOOP 511 lines, inherited-core, inner-iteration prompts) as compact self-verifying specs + reference offload, moving every deterministic step into code (Axis 2′). This is the biggest molten mass.
## Acceptance Criteria
- [ ] OUTER-LOOP/inherited-core carry a Spec + contracts validated by quay; substantial net line reduction; the loop still runs correctly.
## Definition of Done
Real: a real milestone runs under the rewritten loop with no behavior regression.