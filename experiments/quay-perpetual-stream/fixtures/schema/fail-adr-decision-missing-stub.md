---
id: FIX-ADR-FAIL-DECISION
title: "FAIL fixture: ADR missing the ## Decision section (isolates the adr-kind decision assertion)"
status: proposed
labels:
  - adr
parent: null
children: []
extra:
  schema: "v1"
---
## Context

An ADR that states the situation but never records the actual decision is not a decision record. This
fixture isolates exactly one violation: the required `## Decision` section is absent, so kind=adr must
FAIL on `decision-missing` (and nothing else — Context and Consequences are present and substantive).

## Consequences

Without a Decision, downstream documents have nothing single-source to reference; this is precisely
the empty-shell failure the adr-kind assertion exists to catch.
