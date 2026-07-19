---
id: exp5-M-CRYST-D4-LEDGER-STRUCTURED-STATUS
title: D4 [hard-fix] Structured V_meta-ledger status field — retire the prose
  status parser (ADR-004; closes R5's prose-parsing residual)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
R5's V_meta-lag check parses the ledger's status from FREE PROSE, which is irreducibly fragile (ADR-004: soft/erodible — the R5 re-review found multiple natural phrasings that fooled the negation heuristic; the current fix is a fail-closed leading-token parser, an INTERIM). The hard fix (Π_{S→E}, ADR-004) is a STRUCTURED, machine-readable status field in `v-meta-ledger.md` — e.g. a dedicated column or a required leading `[consolidated]` / `status: confirmed@m3` token — that `vmeta-lag-check.mjs` reads directly, fail-closed on any row not conforming to the structured form. Retire the prose leading-token parser once the ledger carries the structured field; migrate the existing rows. Net: removes a class of prose-parsing fragility, not just this instance.

## Plan
N/A — a ledger-format convention change + a parser simplification (read the structured field) + a one-time row migration; no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] `v-meta-ledger.md` rows carry a STRUCTURED status token (machine-readable, one canonical form); the format is documented in the ledger header.
- [ ] `vmeta-lag-check.mjs` reads the structured field and FAILs-closed on any row not in the structured form; the prose leading-token parser is retired; fixtures updated (a non-conforming row → FAIL).
- [ ] All existing ledger rows migrated to the structured form; the live ledger still PASSes; no behavior regression in the selfcheck.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The check no longer parses free prose for status — it reads a structured field (the ADR-004 hard fix for this residual).
- [ ] Single-source preserved; fail-closed preserved; the live ledger + all fixtures green.
- [ ] Cites ADR-004 (hard-over-soft) as the rationale; closes the R5 prose-parsing residual tracked in D3's Progress.