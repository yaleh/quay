# M195 stale-Prepared-after-Verify fixture

## Provenance

**Synthetic (constructed)** — does not derive from a real recorded run. Constructed to preserve testable encoding of pre-reorder cost-ordering baseline.

## Behavior description

Before DIR-117-B/M195 enforced-default Prepared gate flip, Verify phase's it0 checks ran to completion (lines 149-177) before Prepared could reject a stale receipt (line 235). Verify cost (~5 agent calls) is paid before the fail-closed receipt gate fires.

## Why known-defect?

Public label `known-defect` per AC3: all "baseline behaviors that should not be normative" carry this label. `internalCategory: "compatibility-only"` because behavior is correct-by-design (Prepared is a pre-Build gate, not a pre-Verify gate).

## DIR-124-C context

DIR-124-C may reorder Prepared before Verify to avoid paying Verify cost when receipt is stale. This fixture is the before-reorder baseline.

- Created: 2026-08-01
- Workflow commit: 74fe7791
