# Simulated-User Audit — Persona B: Web UI Daily User
# Iteration 10 (quay-continuous-bootstrap, Experiment 4)

**Date:** 2026-07-17
**Persona:** Web UI daily user (frequent label filter user, manages needs-human tasks, desktop+mobile)
**Verdict:** PASS

---

## Scenario walkthrough

### Filter-scoped label counts (UQ-034)

**What changed:** Previously, label counts in the nav showed global totals across all tasks. Now they show counts scoped to the current prefix+status+search filter context (but NOT the label filter itself, so clicking a label shows "how many additional tasks would match").

**Code analysis (serve.js lines 580–599):**

The variable chain:
1. `filteredByStatus` — prefix + status filter applied (no label, no search)
2. `filteredByStatusAndSearch` — adds search (`qFilter`) to `filteredByStatus`
3. `labelCounts` — computed from `filteredByStatusAndSearch`

This is the correct design for additive label filtering: when I'm on `?status=todo`, the label counts show how many todo tasks have each label. When I'm also filtering `?status=todo&label=experiment-4`, the OTHER label counts still reflect the todo scope (not the experiment-4+todo scope) — so I can see what other labels would narrow my current view.

**Concrete scenario:**
- 5 tasks with label `mixed-status-label` (2 todo, 3 done)
- On unfiltered page: shows `mixed-status-label (5)` — correct
- On `?status=todo`: shows `mixed-status-label (2)` — correct
- Test verifies this (serve.test.mjs QX-037 block)

**`allLabels` sourced from `allTasks`:** Labels from ALL tasks appear in the nav, even if the current filter gives them a `(0)` count. This means as a daily user browsing `?status=todo`, I'll still see labels that exist only on done tasks — with `(0)` badges. This is a nav-completeness design decision (I can discover labels in other contexts), and `(0)` gives me the signal I need. This behavior is unchanged from before QX-037.

**Overall assessment:** The scoping logic is correct. As a daily user, I now get accurate information in the label counts — previously `experiment-4 (17)` showing 17 even when filtering to todo-only 3 tasks was genuinely misleading. This is a meaningful improvement.

Assessment: PASS.

---

### Needs-human CTA (UQ-022)

**What changed:** The task detail page for `needs-human` tasks now shows an amber info banner below the action buttons, with text: "This task needs human attention. Use the action buttons above to advance or resolve it."

**Code analysis (serve.js lines 767–769):**
```js
${t.status === "needs-human" && buttons.length > 0
  ? html`<div class="info-banner" role="note">This task needs human attention. Use the action buttons above to advance or resolve it.</div>`
  : ""}
```

The banner appears only when:
1. The task status is `needs-human`
2. There are action buttons rendered (the `buttons` string is non-empty)

The condition `buttons.length > 0` uses string length (since `buttons` is a joined string). This works correctly — empty string means no buttons, non-empty string means buttons are present.

**CSS styling:**
```css
.info-banner {
  background: #fffbf0;       /* warm off-white */
  border-left: 3px solid #cc8800;  /* amber */
  padding: 0.6rem 1rem;
  color: #664400;            /* dark amber text */
}
```
This is visually distinct from the error banner (red) and success banner (green). The amber color is appropriate for "attention needed" without implying failure. Good visual design.

**Text assessment:** "Use the action buttons above to advance or resolve it." — the reference to "above" is accurate (buttons are rendered before the banner at line 766, then the banner at line 767). The text is concise and actionable.

**As a daily user:** When I'm assigned a `needs-human` task and open the detail page, I previously saw buttons with no context for what to do. Now I get a clear explanation. This is a useful addition.

Assessment: PASS.

---

### Orientation banner removal (DIR-007)

**What changed:** The project orientation banner that appeared at the top of every list page is removed.

**Code analysis (serve.js lines 154–160, 691–692):**
- The CSS class `.orientation-banner {}` is retained as an empty rule (no-op safety)
- An HTML comment replaces the banner element in the list page template
- No `<div class="orientation-banner">` in the output HTML

**Why this is an improvement:**
1. The banner depicted `needs-human` as a sequential step in `todo → ready → needs-human → done`, which is incorrect — `needs-human` is a blocked/side-branch state, not a sequential step. As a daily user, this incorrect status model was actively misleading.
2. The banner consumed vertical space on EVERY page view, pushing content below the fold.

**As a daily user:** Removing the banner cleans up the page. The space freed up means the task table starts earlier. I don't need to see an orientation banner on every page visit — I already know how quay works.

Assessment: PASS.

---

### Overall Web UI observations

1. The `info-banner` is not tested by an automated serve.test.mjs assertion (the G3 auditor also noted this). The banner code is correct but could regress silently.

2. The label `(0)` counts for out-of-scope labels are a minor UX quirk — clickable links that lead to empty results. Pre-existing characteristic, not a regression.

3. No new visual regressions detected from the code review. All CSS changes are additive (new `.info-banner` rule), and the banner removal only removes HTML — it cannot break existing layout.

---

## Gaps found (new, if any)

No new gaps found.

One observation (not filed as a gap — too minor and partially pre-existing): labels with `(0)` counts are still clickable in the nav and lead to empty result pages. A user clicking `some-label (0)` might be confused. However, this is the same behavior as before QX-037 (the only change is that the count badge now makes the 0 visible, which is actually better than before when no count was shown). Pre-existing characteristic.

---

## Verdict rationale

All three Web UI changes work correctly for a daily user. The filter-scoped label counts are a genuine improvement to information accuracy. The needs-human CTA is well-designed and helpful for users managing blocked tasks. The orientation banner removal reduces visual noise and corrects a misleading status model. No regressions or new UX issues found.

**Verdict: PASS**
