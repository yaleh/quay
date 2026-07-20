---
id: DIR-035-D
title: "DIR-035 split D: single-source the methodology kit (stop per-experiment inherited-core duplication) + wire delivery-standalone-smoke as a named delivery conformance gate"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: pending
  schema: "v1"
  milestone: "M52"
---
## Proposal
SELECTED at M52. Fourth child slice of [[DIR-035]] (ADR-013). Tracks ADR-013's Decision item 3
(methodology-kit half) / DIR-035 Requested action items 3 (kit half) + 4 (wiring): the reusable
"continuous-development-with-Claude-Code" methodology kit (the BAIME loop, `inherited-core.md`, the
DoD meta-enforcer, the general gate scripts, ADR-001..011) must be single-sourced — not duplicated
per-experiment — and once the standalone-smoke count reaches 0, `delivery-standalone-smoke.sh`
itself must be registered as a named delivery conformance gate (ADR-011: the rule ships with its
enforcement).

**Scope for THIS milestone (M52) — see `docs/plans/13-dir035-d-kit-singlesource-and-smoke-gate.md`
"Scope note" for the full reasoning:** Requested action items 1 (kit single-source audit +
consolidation scheme) and 2 (named-gate wiring) are executed here. Requested action item 3
(ADR-013 validation-ladder items 2/3 — the real foreign-repo deployment/application) is a LATER,
more-specific directive's own scope: `tasks/DIR-036.md` (authored 2026-07-20, after this task, with
`blockedBy: DIR-035-D`) already re-splits that exact work into its OWN children DIR-036-A (Level 2)
/ DIR-036-B (Level 3), each with their own AC/DoD. This task's own AC-4 and DoD prose (below,
unedited from original authoring) still name the foreign-repo bar; this Proposal records that
DIR-036 is the operative tracker for that piece going forward, and this milestone does NOT attempt
it — see `## Resolution` for the explicit disposition of that AC item at ABSORB.

## Plan
`docs/plans/13-dir035-d-kit-singlesource-and-smoke-gate.md` — Part 1 (kit single-source audit +
version-pin scheme, doc-only) + Part 2 (`delivery-standalone-smoke` wired as a named
`.quay/gates.yml`-declared gate via a new zero-arg-tolerant factory, mirroring the M39/DIR-035-B
`it0`-gate wiring pattern).

## Finding
This repo's history (exp3/exp4/exp5) shows a pattern of per-experiment `inherited-core`-shaped
methodology docs; ADR-013 names this explicitly as a forbidden duplication ("a second copy of the
methodology kit per experiment"). This item is the cleanup/consolidation half and is naturally
LAST in the dependency order — it only becomes coherent to execute once A (ABI fix), B (data-driven
gates), and C (experiment-data separation) have landed, since "the methodology kit drops into a new
project as one versioned unit" (ADR-013 Consequences) presupposes the product itself already
stands alone.

## Requested action
1. Audit every `inherited-core*.md` / methodology-kit-shaped doc across `experiments/` for
   duplication; consolidate to one single-sourced kit + per-experiment instance-state pointers
   (a kit-version pin), not full copies.
2. Once DIR-035-A/B/C all land and `delivery-standalone-smoke.sh` reports 0 RED, register it as a
   named delivery conformance gate (following the existing `adr-<id>` / named-gate wiring pattern
   already used elsewhere in `packages/quay/src/gate/registry.js`).
3. Complete ADR-013's validation ladder items 2 (deployment: quay drives a real task on a foreign
   repo — archguard/meta-cc — via the ABI) and 3 (application: the methodology kit drives one real
   OUTER-LOOP milestone developing archguard, DoD-audited) — these are DIR-035's own DoD bar, not
   optional polish.

## Acceptance Criteria
- [ ] No duplicated `inherited-core`-shaped methodology doc remains; a single-sourced kit + per-experiment instance-state/kit-version-pin scheme is demonstrated.
- [ ] `delivery-standalone-smoke.sh` is registered as a named `quay gate --gate delivery-standalone-smoke` (or equivalent) entry, wrapping the existing script (not reimplementing it).
- [ ] `bash packages/quay/test/delivery-standalone-smoke.sh; echo $?` is 0 at this task's completion.
- [ ] A REAL foreign-repo deployment (archguard or meta-cc) is demonstrated: quay drives a real task there through the board + a gate via the Provider ABI, with the real command output pasted in this task's own `## Execution record` / the milestone's ABSORB entry.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING — necessary-but-not-
sufficient: the smoke going green on THIS repo alone does not, by itself, satisfy DIR-035's OWN
(parent) DoD, which additionally requires the deployment-level foreign-repo demonstration — that
piece is tracked by DIR-036-A/B per this task's Scope note above, not re-attempted here.
- [ ] The kit single-source audit is complete and a concrete single-sourced-kit + kit-version-pin
      scheme is demonstrated (not merely asserted in prose).
- [ ] `delivery-standalone-smoke.sh` is registered as a named `quay gate --gate
      delivery-standalone-smoke` entry wrapping the existing script (no reimplemented logic),
      evidenced by a real `quay gate <task> --gate delivery-standalone-smoke` invocation + its
      GateEvent.
- [ ] `bash packages/quay/test/delivery-standalone-smoke.sh; echo $?` is 0 at this task's
      completion (re-confirmed, not just cited from a prior milestone).

## Not selected (M48)
NOT selected this milestone — depends on A/B/C landing first (methodology-kit consolidation and the
foreign-repo deployment ladder both presuppose the product already stands alone); naturally the
LAST child in this split's dependency order. Deferred to a future milestone's SELECT, after B and C.

## Resolution (build-phase draft, M52 — adversarial-audit verdict: PENDING)
**This is a BUILD-PHASE draft, not a final resolution.** Per the DIR-032-compliant three-phase
dispatch pattern, the build phase does NOT tick AC/DoD boxes (DIR-020 — only the audit ticks),
does NOT merge, and does NOT self-declare done. See the full ABSORB-entry draft at
`/tmp/m52-absorb-entry.md` for evidence (test suite, smoke, dod-fixture-selfcheck,
schema-check, real `quay gate --gate delivery-standalone-smoke` invocation + GateEvent).

Summary: Requested action items 1 (kit single-source, `inherited-core.md`'s new "Kit version +
single-source convention" section) and 2 (named `delivery-standalone-smoke` gate,
`packages/quay/src/gate/registry.js`'s new `makeFixedScriptGate` + `.quay/gates.yml`'s new `fixed:`
list) are implemented and evidenced above. Item 3 (real foreign-repo deployment, AC-4) is explicitly
OUT OF SCOPE this milestone — see `## Proposal`'s "Scope for THIS milestone" note; DIR-036-A/B now
own that work. The audit should judge whether that disposition is acceptable for THIS task to be
marked `done`, or whether AC-4 blocks closure pending a DIR-035-D/DIR-036 text reconciliation.
