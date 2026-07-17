# DIR-003

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Web UI must support both desktop and mobile layouts; every browser-based test and visual verification must run in both modes

## Finding

The human steering this experiment requires the Web UI (`packages/quay/src/serve.js`
and its rendered pages) to be usable and visually coherent on both desktop
and mobile viewport sizes — not just the single desktop-sized viewport
experiment 3's iterations 0-2 have exercised so far.

As of this directive, no iteration has verified or claimed anything about
mobile-viewport behavior:
- `iteration-0.md`, `iteration-1.md`, `iteration-2.md` (via
  `mcp__chrome-devtools__lighthouse_audit`, `mcp__playwright__browser_*`,
  and screenshot-based holistic visual review) all operate against a
  single, unstated (presumably desktop-default) viewport size.
- `audits/iteration-1-visual-review-{list,detail}.md` and
  `audits/iteration-2-visual-review-{list,detail}.md` judge visual
  coherence for one layout only.
- No responsive CSS (media queries, fluid/flex layout, viewport-relative
  units beyond the existing viewport meta tag) has been confirmed present
  or absent in `pageStyles()` (`packages/quay/src/serve.js`).

This is a **scope addition to `visual_design_quality`** (protocol §4.2)
and, where layout logic itself needs to change, to `ui_read_capability`
(protocol §4.1) — not a new fifth V_instance factor. Both existing
verification mechanisms (mechanical Lighthouse threshold, independent
holistic visual review — see `ITERATION-PROMPTS.md` §0c) already exist and
should be extended to cover this, not replaced.

## Requested action

1. **Define the two target modes explicitly** at the point this directive
   is first applied — a concrete desktop viewport size and a concrete
   mobile viewport size (e.g. via `mcp__chrome-devtools__resize_page` /
   `mcp__playwright__browser_resize`, or the tool's built-in device
   emulation) — and record the exact dimensions chosen in `provenance.md`
   or the applying iteration's report, not left implicit.

2. **Every browser-automation test** (`packages/quay/test/web-ui-browser.test.mjs`
   and any future test file covering `ui_read_capability` or
   `visual_design_quality`) that asserts on rendering/layout must run its
   assertions in BOTH the desktop and mobile viewport, not desktop only.
   Tests that only assert on data/content (not layout) are not required to
   duplicate across viewports, but the iteration applying this directive
   should state explicitly which tests are layout-sensitive and therefore
   in scope.

3. **Every mechanical Lighthouse audit** (`mcp__chrome-devtools__lighthouse_audit`)
   claimed toward `visual_design_quality` must be run once per viewport
   mode (desktop and mobile) for each reachable page — a page that passes
   the accessibility/best-practices threshold on desktop but has not been
   checked on mobile (or vice versa) does not yet satisfy the "Done when"
   clause for that page.

4. **Every independent holistic visual review** (§0c) claimed toward
   `visual_design_quality` must include a screenshot and PASS/CONCERNS/FAIL
   judgment for BOTH viewport modes, written to
   `experiments/quay-webui-bootstrap/audits/iteration-{N}-visual-review-{page}-{desktop|mobile}.md`
   (or an equivalent naming scheme that keeps both judgments distinguishable
   and auditable) — a PASS on desktop does not imply or substitute for a
   mobile verdict, and vice versa.

5. **Retroactive scope note**: iterations 0-2's existing visual/Lighthouse
   evidence is NOT invalidated by this directive (it was correct evidence
   for the single viewport it covered), but it should not be read as
   satisfying the (now expanded) "Done when" clause for
   `visual_design_quality` until the mobile-mode pass is added. The
   iteration that applies this directive should state plainly which prior
   claims are desktop-only and still need a mobile counterpart.

6. Record the resolution of this directive (applied/deferred/rejected,
   with evidence) in whichever iteration first acts on it.

## Resolution
<!-- to be filled in by whichever iteration applies it -->
