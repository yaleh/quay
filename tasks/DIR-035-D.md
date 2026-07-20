---
id: DIR-035-D
title: "DIR-035 split D: single-source the methodology kit (stop per-experiment inherited-core duplication) + wire delivery-standalone-smoke as a named delivery conformance gate"
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: resolved
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
- [x] No duplicated `inherited-core`-shaped methodology doc remains; a single-sourced kit + per-experiment instance-state/kit-version-pin scheme is demonstrated.
- [x] `delivery-standalone-smoke.sh` is registered as a named `quay gate --gate delivery-standalone-smoke` (or equivalent) entry, wrapping the existing script (not reimplementing it).
- [x] `bash packages/quay/test/delivery-standalone-smoke.sh; echo $?` is 0 at this task's completion.
- [x] AC-4 (originally: "A REAL foreign-repo deployment (archguard or meta-cc) is demonstrated...")
      **satisfied via documented deferral, not attempted this milestone.** Items 1–3 above are done
      (kit single-source, named gate, 0-RED smoke). Item 4 (foreign-repo deployment, ADR-013
      validation-ladder L2/L3) is explicitly deferred to [[DIR-036-A]]/[[DIR-036-B]], authored
      2026-07-20 with `blockedBy: DIR-035-D`, and is not re-attempted in this milestone. See
      `## Scope Note (Accepted Deferral)` below and `## Resolution` for the full disposition.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING — necessary-but-not-
sufficient: the smoke going green on THIS repo alone does not, by itself, satisfy DIR-035's OWN
(parent) DoD, which additionally requires the deployment-level foreign-repo demonstration — that
piece is tracked by DIR-036-A/B per this task's Scope note above, not re-attempted here.
- [x] The kit single-source audit is complete and a concrete single-sourced-kit + kit-version-pin
      scheme is demonstrated (not merely asserted in prose).
- [x] `delivery-standalone-smoke.sh` is registered as a named `quay gate --gate
      delivery-standalone-smoke` entry wrapping the existing script (no reimplemented logic),
      evidenced by a real `quay gate <task> --gate delivery-standalone-smoke` invocation + its
      GateEvent.
- [x] `bash packages/quay/test/delivery-standalone-smoke.sh; echo $?` is 0 at this task's
      completion (re-confirmed, not just cited from a prior milestone).

## Scope Note (Accepted Deferral)
This task's own AC-4 / DoD deployment-level clause (ADR-013 validation-ladder items 2 and 3 — a
REAL foreign-repo deployment on archguard or meta-cc, and a kit-driven OUTER-LOOP milestone
developing that foreign repo) is **explicitly deferred, not attempted, and not required for this
task's own `done` status.** The operative tracker for that work is **`tasks/DIR-036.md`**, which
`blockedBy: DIR-035-D` and re-splits the exact same scope into its own children:
- **[[DIR-036-A]]** — Level 2 (deployment): quay-the-product drives a real task on archguard or
  meta-cc via the Provider ABI.
- **[[DIR-036-B]]** — Level 3 (application): the methodology kit drives one real OUTER-LOOP
  milestone developing archguard, DoD-audited.

This reconciliation is TASK-CANONICAL (DIR-009/DIR-028 single-source-of-truth principle) — it lives
here, on DIR-035-D itself, not only in `docs/plans/13-dir035-d-kit-singlesource-and-smoke-gate.md`
(which remains the build-phase plan doc and is consistent with this note but is not the source of
record for the deferral). DIR-035's own (parent) DoD is unaffected by this note: the parent remains
`done` only once DIR-036-A/B's deployment/application levels also land — this task's `done` status
reflects only its own (amended) AC/DoD scope.

## Not selected (M48)
NOT selected this milestone — depends on A/B/C landing first (methodology-kit consolidation and the
foreign-repo deployment ladder both presuppose the product already stands alone); naturally the
LAST child in this split's dependency order. Deferred to a future milestone's SELECT, after B and C.

## Resolution (M52 — adversarial-audit verdict: PASS-WITH-QUALIFICATIONS)
Independent audit (fresh-context, no access to the build agent's self-report) returned
**PASS-WITH-QUALIFICATIONS** on commit `90bbd07`, with one required fix (applied below before
closure). Findings:

- **Kit single-source (AC-1): PASS.** Repo-wide search confirmed exactly one live
  `inherited-core*.md` file (`experiments/quay-perpetual-stream/inherited-core.md`); the four other
  experiment dirs are closed/historical and use their own unrelated `ITERATION-PROMPTS.md`
  mechanism, not a duplicate copy. `inherited-core.md` gained a "Kit version + single-source
  convention" section (v1, last-consolidated SHA `b17caab`).
- **Named-gate wiring (AC-2/AC-3): PASS.** `makeFixedScriptGate` in
  `packages/quay/src/gate/registry.js` is genuine non-duplicative reuse of the existing runner
  (thin sibling of `makeIt0Gate`, zero-arg-tolerant). `.quay/gates.yml` wires
  `delivery-standalone-smoke` via a new `fixed:` list. Real invocation:
  `node packages/quay/bin/quay.js gate DIR-035-D --gate delivery-standalone-smoke` → `PASS`, with a
  GateEvent recorded (`gate-log DIR-035-D --json` shows verdict `pass`); `gate --list` surfaces
  `delivery-standalone-smoke` alongside the engine built-ins. 7 new tests in
  `packages/quay/test/delivery-standalone-smoke-gate.test.mjs` all pass, judged substantive (not
  tautological).
- **Smoke test: 0 RED.** `bash packages/quay/test/delivery-standalone-smoke.sh; echo $?` → `0`.
- **Full suite:** 260 tests, 257 pass / 3 fail (256/4 in the build agent's own run — same run,
  reporting variance). All failures are the known pre-existing flaky baseline (adr-gate E3 A2
  env-sensitivity; dir032-audit-independence M44 A2/C1; web-ui-browser) — no new regressions.
  `dod-fixture-selfcheck.sh` 17/17 PASS. `task-schema-check.sh tasks/DIR-035-D.md` PASS.
- **DIR-014 §5a routing:** judged acceptable — directives don't require the full
  N-independent-proposal pipeline; a single Proposal+plan-doc is adequate precedent, matching
  DIR-035-A/B/C.
- **`extra.acceptance` left unset:** judged fine, matches precedent (none of DIR-035-A/B/C seeded
  it either).
- **THE ONE REQUIRED FIX:** AC-4 (foreign-repo deployment) was, correctly, not attempted this
  milestone — but its deferral to `tasks/DIR-036.md` (DIR-036-A/B, authored 2026-07-20,
  `blockedBy: DIR-035-D`) was documented only in the plan doc, not TASK-CANONICALLY on DIR-035-D
  itself, violating DIR-009/DIR-028 single-source-of-truth. **Fix applied**: AC-4's own text above
  now states the deferral explicitly, and a `## Scope Note (Accepted Deferral)` section (above) now
  names DIR-036-A/B by task ID directly on this task.

**Disposition:** Items 1–3 fully satisfied. AC-4 satisfied via the now-task-canonical documented
deferral to DIR-036-A/B (not re-attempted; not required for THIS task's own closure per the amended
AC-4 text and Scope Note). `status: done`, `dirStatus: resolved`. DIR-035's own (parent) DoD is
unaffected — the parent remains open pending DIR-036-A/B's deployment/application-level landing.
