# M192 null-Build continuation fixture

## Provenance
**Synthetic (constructed)** — does not derive from a real recorded run. Constructed post-M208 (fix commit `de5c79a2`) to preserve testable encoding of pre-fix behavior.

## Defect description
Before M208, `execute-milestone.js` Build-phase result gate checked only `buildResult?.outcome === 'needs-human'`. A crashed `agent()` returning `null` meant `null?.outcome` is `undefined`, which is not `'needs-human'`, so the condition was `false` — the null result silently passed to Audit/Gate/Land. Real behavior from M192 through M207.

## Construction methodology
Event stream encodes Build phase where phase-start event has outcome=done (phase initialized successfully) but build-implement agent has null outcome (crashed agent). Subsequent phases are present because pre-fix code did not block on null. All defect-dependent assertions carry `classification: "known-defect"` and `internalCategory: "observed-but-undesired"`.

## Post-M208 behavior
After M208, positive-outcome gate `buildResult?.outcome !== 'done'` catches null. Post-M208 replay reports "defect resolved".

- Created: 2026-08-01
- Workflow commit: 74fe7791
- M208 fix: de5c79a2
