# Visual Review Mechanism (§0c) — Operational Spec

Source: `experiments/quay-webui-bootstrap/` experiment 3. First BAIME
experiment to require this mechanism; no precedent in experiments 1 or 2.
See `experiments/quay-webui-bootstrap/ITERATION-PROMPTS.md` §0c for the
protocol text; this file documents the operational lessons learned running
it across iterations 1-4.

---

## Purpose

`visual_design_quality` is a soft criterion — "visually coherent and
accessible" has no binary pass/fail definition the way a logic test does.
The §0c mechanism addresses this by requiring TWO independent checks before
crediting any visual_design_quality movement:

1. **Mechanical Lighthouse threshold** — accessibility ≥ 90, best-practices
   ≥ 90 (per-page, per-viewport, via `mcp__chrome-devtools__lighthouse_audit`).
   Catches color-contrast failures, missing ARIA attributes, broken heading
   order. Objective, repeatable.

2. **Independent holistic visual review** — a fresh-context agent takes a
   real screenshot and judges the page as a whole before commenting on
   specifics. Renders PASS / CONCERNS / FAIL. Subjective by design.

Both are mandatory; neither substitutes for the other. A page can pass
Lighthouse while remaining visually incoherent, and a polished page can
still fail an accessibility mechanical check.

---

## Dispatcher pattern

The reviewing agent must be:
- Dispatched by the **orchestrator** (the main session managing the
  experiment), NOT by the iteration-executor subagent
- Dispatched via the **native Agent/Task tool**, NOT via manda nested-subagent
- Run with `run_in_background=true`
- A **fresh context** — not the same session that made the visual change

This mirrors exactly the G3 audit dispatcher pattern (see
`reference/g3-visual-review-env-gap.md`). The same ENV gap that prevents
true G3 fresh-context dispatch also prevents true visual review
fresh-context dispatch. See that file for the degraded-fallback pattern
and why both gaps have the same root cause.

---

## Four-mode grid

For a multi-page UI (list + detail), the required grid is:

| Mode | Viewport | Lighthouse | Holistic review |
|------|----------|------------|-----------------|
| list-desktop | 1280×800 | required | required |
| list-mobile | 390×844 (device pixel ratio ×3) | required | required |
| detail-desktop | 1280×800 | required | required |
| detail-mobile | 390×844 (device pixel ratio ×3) | required | required |

All four combinations are treated as a unit. Do not credit
visual_design_quality for a page/viewport until all applicable mode
combinations pass both checks.

Iteration 2 lesson: running Lighthouse on only one combination missed
failures that appeared in other combinations. The four-combination grid
was adopted at iteration 3 and held through iteration 4 (Lighthouse 100/100
on all four combinations in both iterations).

For single-page UIs, the grid collapses to desktop + mobile for that page.
For UIs with more than two pages, extend the grid to cover every reachable
page × each applicable viewport.

---

## Holistic-first verdict

The reviewing agent MUST judge the page as a whole before commenting on
specifics. The explicit protocol prohibition (ITERATION-PROMPTS.md §0c):

> "This explicitly must NOT degrade into an isolated-detail checklist (font
> size here, color there) as the primary mode of review; details are
> secondary commentary, not the verdict's basis."

Operational record: this discipline was applied in each visual review file
(iterations 1-4). No Skill content gap was found — the instruction is
operationally clear. Detail observations appear as secondary commentary
after the whole-page verdict.

Verdict semantics:
- **PASS**: The page coheres as a whole. Any detail observations are
  non-blocking.
- **CONCERNS**: Specific issues noted that should be addressed before
  claiming full visual_design_quality credit for this page.
- **FAIL**: The page is not visually coherent. visual_design_quality cannot
  advance for this page until addressed.

A CONCERNS or FAIL verdict **blocks crediting visual_design_quality movement**
for that page/flow until resolved. Same blocking discipline G3 applies to
Core changes.

---

## Lighthouse sequencing rule

Run Lighthouse BEFORE the holistic visual review, not after.

Reason: Lighthouse catches mechanical failures (color-contrast, broken ARIA,
heading order) that are invisible to holistic judgment but affect
accessibility scores and create false-positive "looks good" verdicts.
Fix mechanical failures first, then run holistic review on the corrected
version.

Concrete example from iteration 4: `.page-nav-disabled` used color
`#adb5bd` (contrast ratio 4.3:1, WCAG AA FAIL). Lighthouse caught it before
the holistic review ran. The fix (changed to `#666`, contrast 5.74:1) was
applied, and holistic review ran on the corrected page.

If the reverse order is used (holistic first), the holistic reviewer may
PASS a page that Lighthouse subsequently fails, creating re-work.

---

## Browser conflict rule

`mcp__chrome-devtools__*` tools and `mcp__playwright__*` tools CANNOT run
concurrently. They share a browser profile. Starting one while the other
is active will fail.

Operational pattern that works:
1. Run Lighthouse (`mcp__chrome-devtools__lighthouse_audit`) — this uses
   chrome-devtools MCP.
2. After Lighthouse completes, run holistic screenshot review using either
   chrome-devtools OR playwright MCP — not both simultaneously.
3. If switching between tools is necessary, close the current browser
   context before opening the other.

This conflict has no equivalent in experiments 1 or 2 (neither used
browser tools). It was discovered in iteration 1 and documented in
`experiments/quay-webui-bootstrap/provenance.md`.

Running Lighthouse and playwright simultaneously in two parallel subagents
will deadlock or corrupt the browser state. Do not attempt it.

---

## Audit file location

Each visual review verdict is written to:
```
experiments/quay-webui-bootstrap/audits/iteration-{N}-visual-review-{page}-{viewport}.md
```

Examples from experiment 3:
- `audits/iteration-3-visual-review-list-desktop.md`
- `audits/iteration-3-visual-review-list-mobile.md`
- `audits/iteration-3-visual-review-detail-desktop.md`
- `audits/iteration-3-visual-review-detail-mobile.md`
- `audits/iteration-4-visual-review-list-desktop.md`
- `audits/iteration-4-visual-review-list-mobile.md`
- `audits/iteration-4-visual-review-detail-desktop.md`

---

## Relationship to Lighthouse threshold values

Experiment 3's thresholds: accessibility ≥ 90, best-practices ≥ 90.

Experiment 3 achieved 100/100 on accessibility and best-practices (and SEO)
on all four mode combinations by iterations 3-4. The threshold of 90 is the
floor; exceeding it is evidence of genuine quality, not just compliance.

Lighthouse does not run an SEO check by default in all configurations;
when SEO is available, include it in the threshold check if the pages are
intended to be indexable.

---

## Consuming scope guidance

When defining a new experiment with a visual_design_quality factor:

1. Define the page/viewport grid at iteration 0. Do not leave it implicit.
2. State the Lighthouse threshold explicitly in the iteration prompt.
3. State the holistic verdict semantics (PASS/CONCERNS/FAIL) explicitly.
4. Write "both checks mandatory, neither substitutes for the other" into the
   convergence criterion for that factor.
5. Address the browser conflict in §0c (or equivalent) of the iteration
   prompt — it is easy to forget until it produces a mysterious tool failure.
6. Address the ENV gap for dispatcher (see `reference/g3-visual-review-env-gap.md`)
   — do not assume orchestrator-level dispatch happens automatically from
   within an executor session.
