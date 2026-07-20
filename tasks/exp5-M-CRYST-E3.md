---
id: exp5-M-CRYST-E3
title: E3 adr-as-contract enforcement — applies-to scope + runnable check as a
  named adr-<id> quay gate (the 'continuously applied' half of E1)
status: todo
labels:
  - milestone-candidate
  - crystallization
  - milestone:M42-cryst-e3
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
E1 made ADRs a first-class STORED kind but explicitly deferred the "continuously applied" half — the piece that makes an ADR a standing constraint, not a static record. E3 builds it (it currently lives only as prose in ADR-001 / E1 / strategy §10, which by our own ADR-DILUTION standard is molten — this task pins it).

Mechanism (epicd's ADR-as-contract harness, which quay's gate engine can actually deliver — epicd left it a proposal): an ADR gains an `applies-to` scope + an `enforcement` field naming a runnable check. An enforceable ADR registers as a **named `adr-<id>` quay gate** via the QENG registry (`packages/quay/src/gate/registry.js` — same wrap-a-script mechanism as `acceptance`/`impl-row`/`line-budget`, no logic duplicated). Its GateEvents become the **"ADR honored" ledger** (`quay gate-log`). The `applies-to`/`enforcement` frontmatter fields ALREADY round-trip verbatim in `adr-store.js` (reserved in E1 for exactly this), so adding them is non-breaking. First wired case: **ADR-001 (TDD)'s enforcement = the B7 check** (load-bearing `scripts/*.mjs` need a sibling test) — E3 wires B7 as `adr-001`'s gate, closing the loop end-to-end. Consult surface: `accepted` ADRs whose `applies-to` matches a change are surfaced at SELECT / plan / review (not merely stored).

Depends on B7 (provides ADR-001's concrete check). Reference: epicd `docs/proposals/2026-07-03-adr-as-contract-harness.md`.

## Plan
N/A — product code across `adr-store.js` (surface applies-to/enforcement), the QENG gate registry (register `adr-<id>` gates), and a consult surface; strict TDD per ADR-001 (red→green, ≥80% coverage).

## Acceptance Criteria
- [ ] An `accepted` ADR carrying `applies-to` + `enforcement` registers as a named `adr-<id>` quay gate; running it appends a real GateEvent (`gate: "adr-<id>"`, verdict pass|fail) queryable via `quay gate-log`.
- [ ] A change that VIOLATES an in-scope ADR makes its gate FAIL; a conforming change PASSES; fixtures pin both.
- [ ] ADR-001 is wired to the B7 check as its enforcement, and honoring/violating it is a GateEvent on a REAL object — not a prose claim.
- [ ] A consult surface lists the `accepted` ADRs whose `applies-to` matches a given path/scope (so the loop can apply them at SELECT/plan/review).
## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] A REAL ADR (ADR-001) is enforced by its named gate on a real change (GateEvent recorded), demonstrating "continuously applied", not asserted.
- [ ] Single-source: the ADR's check LOGIC is one script; the quay gate WRAPS it (no second implementation) — same dual-source guard as D3/M39.
- [ ] Strict TDD across the touched packages; no regression to the E1 ADR surfaces.

## Not selected (M41)
DIR-030 ranks this #2 in the observe-and-enforce cluster (after G1). Not selected this pass: G1 is smaller/more self-contained (pure new metric scripts, no touch to `adr-store.js`/registry), and DIR-030's own ordering puts it first. Reconsider at M42.