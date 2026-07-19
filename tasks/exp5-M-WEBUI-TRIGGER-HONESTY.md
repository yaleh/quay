---
id: exp5-M-WEBUI-TRIGGER-HONESTY
title: "Web UI action_buttons: stop overstating success when trigger delivery
  is degraded/async — either qualify the banner or perform a synchronous
  write when no live dispatcher is configured"
status: in-progress
labels:
  - milestone-candidate
  - surface:web-ui
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created at m28 DRAIN/SELECT boundary (2026-07-18) once
the standing backlog (all 20 prior milestone-candidate rows DONE/STALE, DIR-001 fully closed)
was exhausted — mirrors the M24-task-backlog-projection-impl forward-looking-creation pattern.

## Source
M28-outcome-eval outcome-eval-report.md, Scenario 4 reconciliation, gaps G-S4-01/G-S4-02.

## Value type / cadence
exploit (fix a real, dogfooding-confirmed UX-honesty defect), capability-growth (secondary — Web
UI surface), method infra, VT points TBD at charter-authoring.

## Notes (verbatim provenance from M28's outcome-eval-report.md)
Both M28 iterations independently confirmed the same root mechanism: the Web UI's "Advance"
`action_button` gate-checks correctly, then calls `composePayload()`/`deliverTrigger()` — an
asynchronous trigger dispatch, not a synchronous status write. Without a live `manda` dispatcher
configured, delivery degrades to print-only, and the task's `status`/`updatedAt` remain
byte-identical to their pre-click values — yet the page redirects with an unconditional
"Done: Task ... advanced" success banner. An operator relying only on the UI, without an
independent CLI/`task_get` check, would be misled into believing the task transitioned. This was
severe enough that M28's own reconciled scenario-4 verdict was FAIL (see that report's
reconciliation section for the full reasoning on why iteration-1's PASS-with-caveat framing was
not adopted as the milestone-level verdict).

Two gaps, either or both may be addressed by a future charter:
- **G-S4-01** (UX honesty, likely small/copy-only fix): condition the success banner text on
  actual delivery mode — e.g. "Advance requested" when delivery is known-degraded/async,
  "Advanced" only once a synchronous write is confirmed.
- **G-S4-02** (capability/config gap, larger scope): wire a default in-process delivery mode for
  bare `quay serve` deployments with no external dispatcher configured, so the button is
  functionally complete (produces a real, synchronous status write) without requiring separate
  `manda` setup — or, short of that, prominent in-UI documentation of the limitation.

A future charter selecting this candidate should decide, at charter-authoring time, whether to
scope to G-S4-01 alone (small, safe, immediately actionable), G-S4-02 alone (larger, may need its
own design/line-budget), or both together if line-budget allows — and must re-verify via real
Playwright/chrome-devtools browser automation (per the Web UI verification requirement,
M10-audit-consolidation/DIR-006), not static source inspection, since that is exactly the
evidence class that surfaced this gap in the first place.

## Acceptance Criteria
1. `packages/quay/src/serve.js`'s POST `/task/:id/action/:actionId` handler conditions the
   `?success=` banner text on `deliverTrigger()`'s actual `result.delivered` value
   (`"print"`/`"manda"`/`"mock"`), not an unconditional `"Task <id> advanced"` string — every
   delivery mode's banner text must accurately describe what actually happened (no mode may claim
   a synchronous status write occurred when it did not; `git diff --stat` confirms no
   `packages/quay/bin/quay.js` status-write logic changed, i.e. this is a text/conditional fix, not
   a new synchronous-write capability — that is G-S4-02, explicitly out of scope).
2. The `"print"` (degraded, no live dispatcher) and `"manda"` (async dispatch, no delivery-
   confirmation callback) cases both use "requested"-flavored language (not "advanced"/"done"),
   since neither performs a synchronous status write; the task's `status`/`updatedAt` are not
   claimed to have changed when they have not.
3. Live browser verification (Playwright or chrome-devtools MCP, per M10-audit-consolidation/
   DIR-006's Web UI verification requirement) confirms the corrected banner text actually renders
   for at least the `"print"`-degraded case (the realistic default for a bare `quay serve` with no
   `manda` configured) — not static source inspection alone, since that is exactly the evidence
   class that missed this gap originally (M28's own finding).
4. No regression to the existing `?success=`/`?error=` redirect-param contract or to any existing
   `serve.test.mjs` assertion (`success-banner` element presence, `?success=` param presence on
   gate-pass, absence on gate-fail) — full `packages/quay` test suite green before AND after.
5. G-S4-02 (wiring a real synchronous/in-process delivery mode) is explicitly NOT attempted here —
   confirm via `git diff --stat` that `src/action.js`'s `deliverTrigger()` delivery-mode logic
   itself (the `mock`/`manda`/`print` branches) is unchanged; only the banner-text consumer in
   `serve.js` changes.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5 no-self-exemption, 6
escrow-Δv N/A — not design-only, 7 test-floor — `surface:web-ui` is product-touching, a real
coverage disposition or waiver is required at ABSORB). No task-specific exemption from any clause.

## Status mirror
todo (created @m29 DRAIN/SELECT boundary, 2026-07-18; SELECTed @m33 DRAIN/SELECT boundary,
2026-07-19, scoped to G-S4-01 only per this task's own "future charter should decide scope"
guidance — G-S4-02 remains open/deferred, a separate future candidate if still wanted after G-S4-01
lands)

---
## Not selected (M29)
2026-07-18: Not selected — M-QUAY-CLI-CREATE-ERGONOMICS chosen instead, anchored on GAP-002
(explicitly flagged by M27's own report as the single most severe finding across all evaluations
so far, a real data-integrity bug). This candidate remains charter-ready for a future SELECT.
