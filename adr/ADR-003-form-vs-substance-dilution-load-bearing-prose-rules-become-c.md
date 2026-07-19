---
id: ADR-003
title: Form-vs-substance dilution — load-bearing prose rules become code or
  self-verifying contracts (never re-narrated)
status: accepted
date: 2026-07-19
tags:
  - methodology
  - code-over-prompt
---
## Context
A load-bearing rule that lives only as prose in a pinned Layer-A document is repeatedly paraphrased away whenever a fresh Layer-B prompt is generated from it. Evidence: exp4 DIR-009 — the worktree-isolation rule was diluted 13 consecutive times across generated executor prompts until a pasted-output proof requirement finally forced it. Form-vs-substance dilution is a recurring failure family (see the crystallization ANALYSIS catalog).

## Decision
Load-bearing rules become **CODE** (a coded step cannot be paraphrased) **OR self-verifying `contracts:` on the document.** Generated/derived prompts must **transclude or verify** the rule, **never re-narrate** it — re-narration is where dilution enters.

## Consequences
- **Forbids:** a load-bearing invariant existing only as re-narratable prose in a pinned doc; a generated prompt paraphrasing (rather than transcluding/verifying) such a rule.
- **Enables:** this ADR is the cited rationale for the code-over-prompt work (D3 / Axis-2′) and the self-verifying-contracts work (D1/D2) — they are the fix, not incidental refactors.
- **Landing test:** a real generated prompt transcludes/verifies a load-bearing rule rather than re-narrating it.
