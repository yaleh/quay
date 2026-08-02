# M195 stale-Prepared-after-Verify fixture

## Provenance
**Synthetic (constructed).** Constructed to preserve testable encoding of pre-reorder cost-ordering baseline.

## Behavior description
Before DIR-117-B/M195, Verify phase's it0 checks ran to completion before Prepared could reject a stale receipt. Verify cost is paid before the fail-closed receipt gate fires.

## Why known-defect?
Public label `known-defect` per AC3 for assertions m195-001/002/003. `internalCategory: "compatibility-only"` because behavior is correct-by-design (Prepared is a pre-Build gate, not a pre-Verify gate). Assertions m195-004/005 are normative (correct fail-closed behavior regardless of ordering).

## DIR-124-C context
DIR-124-C may reorder Prepared before Verify. This fixture is the before-reorder baseline.

- Created: 2026-08-01
- Workflow commit: 74fe7791
