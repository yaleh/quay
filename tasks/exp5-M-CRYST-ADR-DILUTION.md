---
id: exp5-M-CRYST-ADR-DILUTION
title: ADR form-vs-substance dilution (Layer-A pinned doc → Layer-B generated
  prompt paraphrases the rule away) — fixed by code-over-prompt + self-verifying
  doc contracts
status: todo
labels:
  - crystallization
  - adr
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
ADR: a rule that lives only in prose in a pinned document (Layer A) is repeatedly paraphrased away when a fresh prompt is generated from it (Layer B). Evidence: exp4 DIR-009 (worktree-isolation rule diluted 13 consecutive times until pasted-output proof forced it). Decision: load-bearing rules become CODE (a coded step cannot be paraphrased) or self-verifying contracts on the document; generated prompts must transclude/verify, never re-narrate.
## Acceptance Criteria
- [ ] ADR captured (E1 form); links to code-over-prompt (D3/Axis-2′) + contracts (D1/D2) as the fix.
## Definition of Done
Real: the ADR is the cited rationale for the code-over-prompt work; a real generated prompt transcludes/verifies rather than re-narrates a load-bearing rule.