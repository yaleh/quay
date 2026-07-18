---
id: exp5-M-WEBUI-TRIGGER-HONESTY
title: "Web UI action_buttons: stop overstating success when trigger delivery
  is degraded/async — either qualify the banner or perform a synchronous
  write when no live dispatcher is configured"
status: todo
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

## Status mirror
todo (created @m29 DRAIN/SELECT boundary, 2026-07-18 — not yet SELECTed)
