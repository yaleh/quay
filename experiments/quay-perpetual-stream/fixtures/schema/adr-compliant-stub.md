---
id: FIX-ADR-COMPLIANT
title: "Compliant ADR (marked, kind=adr — Context/Decision/Consequences, no Proposal/Plan/AC/DoD)"
status: accepted
labels:
  - adr
parent: null
children: []
extra:
  schema: "v1"
---
## Context

A load-bearing decision was scattered across several prose documents and re-interpreted each cycle.
This ADR is the single source. It carries the concise decision-record form, NOT the task shape —
proving the adr kind is evaluated by Context/Decision/Consequences, and does NOT fail for lacking a
`## Proposal` / `## Plan` / checklist AC / checklist DoD (which a milestone-candidate would require).

## Decision

Adopt the invariant henceforth: the rule lives in exactly one authoritative place, and every derived
document references or verifies it rather than re-narrating it. Imperative, checkable, single-source.

## Consequences

Forbids duplicating the rule into a second hand-authored source; enables a mechanical conformance
check. Scope: applies to all future decision records of this kind.
