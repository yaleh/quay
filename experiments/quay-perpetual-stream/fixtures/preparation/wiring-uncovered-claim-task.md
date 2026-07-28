---
id: FIXTURE-WIRING-UNCOVERED
title: Fixture — Proposal with an uncovered mechanism claim (DIR-117-B/M195 wiring-coverage CLI fixture)
status: todo
labels:
  - fixture
extra:
  schema: v1
---
**type:** execution

## Proposal

This fixture exists ONLY to drive the DIR-117-B/M195 wiring-coverage CLI
(`wiring-coverage-check.ts --task …`) through its RED path: its Proposal claims a
mechanism relationship that has NO matching, evidence-requiring Acceptance Criteria
item, so `checkWiringCoverage()` must return `uncovered` and the CLI must emit one
BLOCKING typed ledger finding per uncovered claim.

The newly added `batch-reconciler.ts` dispatches `shard-writer.ts` on every flush
cycle to enforce single-writer ordering. This relationship is claimed here in prose
but is deliberately NOT backed by any falsifiable AC item below — that omission is the
point of the fixture. A second, independent claim: `metrics-emitter.ts` owns
`dashboard.md` regeneration during the Land phase, again with no matching AC proof.

## Acceptance Criteria

- [ ] This item is intentionally unrelated to the claimed relationships above — it
  mentions neither the reconciler/writer pair nor the emitter/dashboard pair, and
  carries no evidence-requiring keyword for them, so both mechanism claims stay
  uncovered.

## Touches

- experiments/quay-perpetual-stream/fixtures/preparation/wiring-uncovered-claim-task.md
