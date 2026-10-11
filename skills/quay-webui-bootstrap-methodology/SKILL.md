---
name: quay-webui-bootstrap-methodology
description: Reference material for driving methodology into a frontend/visual/UX-shaped scope — the §0c independent holistic visual review mechanism (dual mandatory checks: mechanical Lighthouse threshold plus a fresh-context holistic verdict, four-mode viewport grid, Lighthouse-before-holistic sequencing, browser-tool conflict rule) and the cross-experiment effectiveness-timing corpus used to calibrate a new scope's throughput expectations. Use when a change's quality is a soft/visual criterion that needs dual evidence, not a single mechanical check. Delta reference to quay-native-methodology.
allowed-tools: Read
---

# quay-webui-bootstrap-methodology

Portable reference material for frontend/visual/UX-shaped work: the §0c independent holistic
visual review mechanism and the cross-experiment effectiveness-timing corpus. This is the
reusable operational subset only — experiment-specific V-meta ceiling analysis and the G3
env-gap case study are not duplicated here; consult the source workspace's own methodology
skill for that history. Read `quay-native-methodology`'s reference material first — this skill
documents only what is net-new for a visual/UX scope.

## Spec

```
:: visualReviewMechanism : VisualQualityClaim → DualEvidence
| A "visually coherent and accessible" claim requires BOTH a mechanical Lighthouse
| pass (accessibility ≥ 90, best-practices ≥ 90) AND an independent holistic
| fresh-context review (PASS/CONCERNS/FAIL, judged whole-page-first). Neither
| substitutes for the other. Applied per page × viewport across a four-mode grid.
| → reference: reference/visual-review-mechanism.md

:: effectivenessTimingCorpus : ScopeMatchedTask → ThroughputBaseline
| Cross-experiment timing data (a single-file, logic-change, no-network-I/O
| baseline task, ~230s total) used to calibrate whether a new scope's
| throughput is in-line, faster, or slower than the reference shape — and what
| would actually move the number versus what would not.
| → reference: reference/effectiveness-timing-corpus.md

-- Formal constraints

:: visual_review_requires_both : VisualQualityClaim → DualEvidence
| credit(visual_quality_movement) ⇒ holistic_review(§0c) ∧ lighthouse_pass
| ⊨ neither substitutes for the other

:: dispatcher_discipline : AuditDispatch → OrchestratorConstraint
| dispatch(§0c_visual_review) ⇒ orchestrator_dispatched(¬inline, ¬self, fresh_context)
| ⊨ same dispatcher discipline as any independent-audit requirement — see
|   quay-native-methodology's g3AuditDiscipline
```

## Implementation

1. Read `reference/visual-review-mechanism.md` before crediting any visual-quality claim.
   Run Lighthouse BEFORE the holistic review (mechanical failures are invisible to holistic
   judgment but create false-positive "looks good" verdicts if found after). `mcp__chrome-devtools__*`
   and `mcp__playwright__*` tools cannot run concurrently — they share a browser profile.
2. Define the page/viewport grid explicitly at scope-design time (do not leave it implicit):
   for a multi-page UI, at minimum desktop + mobile per page; extend to every reachable page.
3. State the Lighthouse threshold and the holistic verdict semantics (PASS/CONCERNS/FAIL)
   explicitly in whatever prompt or spec drives the work — a CONCERNS or FAIL verdict blocks
   crediting visual-quality movement for that page/flow until resolved.
4. Read `reference/effectiveness-timing-corpus.md` before setting or re-baselining an
   effectiveness/throughput rubric for a new scope — reuse the scope-matched baseline (single-file,
   logic-change, no-network-I/O) rather than re-deriving from zero, and check the "what would /
   would not move this number" section before claiming a rubric change is warranted.
