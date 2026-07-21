---
id: exp5-M-TS-MIGRATION-P4
title: "TS migration P4 (exp5 method-infra scripts, ADR-012): migrate the
  load-bearing gates/scripts to TS under the golden-diff discipline (like the
  it0-dod-check restructure) — behavior-preserving, autonomous."
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION
children: []
extra:
  schema: v1
---
## Proposal
Phase P4 (final) of [[exp5-M-TS-MIGRATION]] (ADR-012). With the product packages on TS (P3), migrate
exp5's own **method-infrastructure scripts** — the load-bearing gates under
`experiments/quay-perpetual-stream/scripts/` (notably `it0-dod-check.mjs` the DoD meta-enforcer, the
schema checks, the DIR-044 concurrency + DIR-051 routine scripts) — JS→TS, each under the SAME
behavior-preserving + golden-diff discipline used for the it0-dod-check restructure.

These scripts are the loop's own guardrails, so P4 is the highest-care phase: a behavior change in a
gate is a change in what the loop enforces. The golden-diff (fixture-pinned selfchecks: same inputs →
byte-identical verdicts before/after) is the executable safety, NON-WAIVABLE. Runs AUTONOMOUSLY (parent
`human-steered` cleared 2026-07-21) precisely BECAUSE that safety is a runnable check, not prose.

**Scope:** `experiments/quay-perpetual-stream/scripts/*.mjs` load-bearing gates + their vendored plugin
copies (kept in sync by `sync-vendor.sh`).
**Out of scope:** product `packages/**` (P0–P3); any change to a gate's VERDICT logic (this is a
language port, not a policy change).

## Plan
N/A — split-or-commit at SELECT (DIR-026): migrate in fixture-pinned batches (a script + its
`-selfcheck.sh` together), never a gate without its pin. Behavior-preservation verified mechanically:
- each migrated gate's `-selfcheck.sh` (the golden fixture) produces byte-identical verdicts before/after
  — a true golden-diff on the loop's own enforcement;
- `tsc --noEmit` passes; the it0 DoD meta-enforcer (itself a P4 target — migrate it LAST or under
  extra-careful golden-diff, since it gates everything) still passes on all clauses;
- vendored plugin copies re-synced (`sync-vendor.sh`) so the shipped scripts match;
- TDD per ADR-001; fresh-context adversarial audit per DIR-044/048 — did ANY verdict change? is
  `dod-fixture-selfcheck.sh` still pinning it0-dod-check?

## Acceptance Criteria
- [ ] The load-bearing method-infra scripts are `.ts`, pass `tsc --noEmit`, and run under Node native type-stripping; their `-selfcheck.sh` fixtures produce byte-identical verdicts before/after (golden-diff).
- [ ] The it0 DoD meta-enforcer (Clauses 0–9) still passes on all clauses post-migration; `dod-fixture-selfcheck.sh` still pins it; NO gate verdict logic changed (language port only).
- [ ] Vendored plugin copies re-synced so shipped scripts match source; a consumer workspace (archguard) still runs the scripts unchanged.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] The method-infra gates run on TypeScript with byte-identical golden-fixture verdicts (pasted before/after), the it0 meta-enforcer green, no verdict drift — on a real milestone.
- [ ] Single-source held (ADR-004): the vendored copies are re-synced, not hand-edited; TDD per ADR-001; fresh-context adversarial audit confirms zero enforcement change (the loop's guardrails are byte-for-byte equivalent).
- [ ] Per DIR-026 SPLIT-OR-COMMIT: each fixture-pinned batch lands done-or-`needs-human`; parent [[exp5-M-TS-MIGRATION]] is done only when ALL children (P0–P4) are done — this phase closes the program.
