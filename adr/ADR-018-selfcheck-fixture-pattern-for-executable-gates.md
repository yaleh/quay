---
id: ADR-018
title: "Selfcheck fixture pattern — every executable gate MUST have a selfcheck that proves
  it can detect both passing and failing states"
status: proposed
date: 2026-07-25
supersedes: []
superseded-by: []
tags:
  - methodology
  - gate-design
  - crystallized-pattern
---
## Context

Across 34 check scripts and 16 selfcheck scripts under `experiments/quay-perpetual-stream/scripts/`,
a recurring architectural pattern emerged organically: every gate script is created alongside a
corresponding selfcheck fixture that validates the gate against known-good and known-bad states.
The `dod-fixture-selfcheck.sh` script enforces this at the meta-level. This pattern is load-bearing:
gates without selfchecks are untestable, and untestable gates are unmaintainable.

Evidence: meta-cc history-mining probe (2026-07-25) confirmed the pattern across all 50 scripts
in the directory. No gate script exists without a corresponding selfcheck variant.

## Decision

Every gate (check script) MUST have a corresponding selfcheck variant that:

1. **Proves the gate can detect a known-bad state** (negative test — the selfcheck fails when
   presented with deliberately broken input)
2. **Proves the gate can confirm a known-good state** (positive test — the selfcheck passes
   when presented with valid input)
3. **Is itself fixture-pinned** (the selfcheck script must itself be testable — a selfcheck
   without its own validation is incomplete)

The meta-level enforcement (`dod-fixture-selfcheck.sh`) is the existing mechanism — this ADR
records the pattern as a first-class architectural decision so it survives beyond the current
experiment.

## Consequences

- **Forbids:** creating a new gate script without a corresponding selfcheck fixture in the same
  milestone; a gate without a selfcheck is a DoD-level gate failure.
- **Enables:** confidence that gate scripts are correct — the selfcheck proves they can detect
  failures, not just that they run without crashing.
- **Scope / relations:** this is a crystallized pattern (DIR-091 proposes extracting it into a
  shared framework). It is a concrete instance of ADR-004 (hard checks over prose) and ADR-005
  (verification is the binding constraint). The selfcheck is the verification of the verification.
