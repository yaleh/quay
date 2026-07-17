# Iteration 3: Usability cluster (UQ-003/009/011/012/013/014) — mobile UX, gate feedback, back-link, orientation

**Date**: 2026-07-17
**Driver**: native (QX-011..QX-015 all driven through quay:author + quay:execute natively)
**Dimensions advanced**: usability_quality (UQ-003, UQ-009, UQ-011, UQ-012, UQ-013, UQ-014 all closed)
**V_meta triggers checked**: all 5 — none fired (see §9)
**Worktree**: `experiments/quay-continuous-bootstrap/worktrees/iteration-3` on branch `experiment-4-iteration-3` — created via `git worktree add`. ENV limitation: Tool writes (Read/Write/Edit) still target main tree absolute paths, as documented in iterations 0, 1, and 2. Worktree created for protocol compliance; deviation noted.
**Gap-list delta**: 0 new gaps found during development phase (simulated-user pass pending); 6 gaps closed (UQ-003, UQ-009, UQ-011, UQ-012, UQ-013, UQ-014); cumulative gaps-closed counter now at 20 (development phase)

---

## 1. Context from prior iteration

**σ_QX before**: 9/10 = 0.900 (QX-001 seed; QX-002..QX-010 native)

**V scores before** (iteration 2 final):
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.74 × 0.63 × 0.97 × 0.98 = 0.443

ΔV_instance (iteration 2): +0.055 (from 0.388)
```
ΔV trend: iter0→1 = +0.152, iter1→2 = +0.055. Both above 0.02 threshold. PAUSE criteria NOT met.

**Problems inherited from iteration 2** (in priority order):
1. UQ-011/UQ-012 (significant, mobile): Mobile table adaptation — role/labels columns crowd out actions column
2. UQ-013 (significant): Gate-fail feedback silent
3. UQ-009 (significant per cross-experiment maintainer): Back link drops filter context
4. UQ-014 (significant): Advance button no tooltip/confirmation
5. UQ-003 (significant, escalated): No project orientation on homepage
6. CB-007, CB-008, CB-010 (significant, deferred): Search, packaging, MCP response size

**Gap list at iteration start**: 16 open gaps (4 CB, 12 UQ, 0 VC, 0 SH).

---

## 2. Preconditions checked

**G6 (manda daemon)**:
- `.manda/hub.addr` read: `http://localhost:46215` (read live, NOT hardcoded)
- `curl -s http://localhost:46215/healthz` → `{"root":"/home/yale/work/quay"}` ✓
- Monitor process check: monitors confirmed running in orchestrator sessions

**G7 (web service)**:
- `curl -s http://localhost:4173/ | head -3` → `<!doctype html>` 200 ✓ (running at iteration start; restarted after code changes)

**Worktree (DIR-006 standing guardrail)**:
- Created: `git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-3 -b experiment-4-iteration-3`
- Result: SUCCESS (HEAD at 28e9f04)
- ENV deviation documented: tool writes still target main tree (same as iterations 0, 1, 2)

**provenance.md read**: ✓
**gap-list.md read**: ✓ (16 open gaps confirmed)
**directives/pending/ listed**: DIR-004 remains pending (in scope, not yet prioritized)

**PAUSE check**:
- ΔV_instance iteration 1: +0.152 (NOT flat)
- ΔV_instance iteration 2: +0.055 (NOT flat — well above 0.02 threshold)
- PAUSE criteria require 2+ consecutive flat iterations. Neither iteration 1 nor 2 was flat. PAUSE NOT MET. Status: CONTINUING.

**V_meta re-trigger check** (all 5 conditions):
1. effectiveness re-trigger: NOT TRIGGERED — no scope-matched single-file, no-network task arising. QX-011..015 each touch serve.js + test files (multi-file changes).
2. reusability re-trigger: NOT TRIGGERED — no organic GitHub Provider write demand.
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new Skill Method-step gap found; ENV gap continues.
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch primitive.
5. open-ended-domain-specific: OBSERVATIONAL — self-hosted tracking continues functioning well. No new re-trigger evidence this iteration. NOT TRIGGERED.

Expected NOT TRIGGERED. Confirmed.

**verification_coverage spot-check**: Full test suite 30/30 pass at iteration start. All prior capabilities retain tests.

**system_health regression check**: 30/30 pass; Web UI 200; all three inherited snapshots confirmed intact before implementation.

---

## 3. Observe

**Current gap-list state at iteration start** (16 open gaps):

| Dimension | Severity | Count | Highest-priority entries |
|-----------|----------|-------|--------------------------|
| capability_breadth | significant | 3 | CB-007 (search), CB-008 (packaging), CB-010 (MCP response size) |
| capability_breadth | minor | 1 | CB-006 (page size) |
| usability_quality | significant | 6 | UQ-003 (orientation), UQ-008 (MCP response), UQ-009 (back link), UQ-011 (Advance off-screen), UQ-012 (role/labels mobile), UQ-013 (gate silent), UQ-014 (no tooltip) |
| usability_quality | minor | 5 | UQ-004, UQ-005, UQ-006, UQ-007, UQ-015 |

**V_meta re-trigger check results**: all 5 NOT TRIGGERED (see §2 above).

**Highest-value cluster chosen**: UQ-003, UQ-009, UQ-011, UQ-012, UQ-013, UQ-014 — the full cluster of significant usability_quality gaps introduced or confirmed in iteration 2.

Rationale: 6 significant UQ gaps, all traceable to 2-3 simulated-user personas in iteration 2. All contained to `packages/quay/src/serve.js` + tests. Addressing the full cluster in one iteration will substantially lift usability_quality. CB gaps (search, packaging, MCP response) are deferred: CB-007/CB-008 require architectural work; CB-010 partially addressed by prefix filter.

**PAUSE-check inputs**:
- Iteration 1 ΔV = +0.152 (NOT flat); iteration 2 ΔV = +0.055 (NOT flat). PAUSE does not apply.
- Simulated-user pass for iteration 2 found 4 new significant gaps — "no new significant gap" condition not met for prior window.

---

## 4. Strategy

**Chosen work**: 5 QX-* tasks authored and executed natively:
- QX-011: Back link preserves filter context (UQ-009) — ?from= in task title links + detail page handler
- QX-012: Mobile table adaptation (UQ-011, UQ-012) — col-role/col-labels CSS classes + @media rule
- QX-013: Gate-fail feedback (UQ-013) — gate check before deliverTrigger, ?error= redirect, error/success banners
- QX-014: Advance button tooltip (UQ-014) — title= on list and detail page buttons
- QX-015: Project orientation banner (UQ-003) — .orientation-banner div + CSS on list page

**Write-surface boundary check (§Core-scope constraints item 6)**:
- All 5 tasks modify only the Web UI rendering path in `packages/quay/src/serve.js`.
- QX-013 adds a gate check call (`client.taskCheck`) before the existing `deliverTrigger` — this is a READ from the existing gate mechanism, not a new write surface. The delivery path itself is unchanged (deliverTrigger called only when gate passes).
- No new write surface introduced by any of the 5 tasks.

**V_meta re-trigger assessment**: All 5 tasks touch serve.js + multiple test files. None organically bears on any V_meta re-trigger condition. Noted explicitly.

**G3 trigger**: YES — Core source file changed: `packages/quay/src/serve.js`. G3 dispatched by orchestrator (NOT by this executor session). Never via manda. See §10.

---

## 5. Execution

### Self-hosted task tracking

Tasks created via `mcp__quay__task_write` BEFORE implementation (per protocol §5.1 dogfooding requirement):
- QX-011 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 6 ACs checked
- QX-012 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 7 ACs checked
- QX-013 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 9 ACs checked
- QX-014 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 5 ACs checked
- QX-015 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 6 ACs checked

All tasks queried via task_list and confirmed in backlog before implementation began.

### Implementation — files changed (commit f4b3b8d)

**`packages/quay/src/serve.js`** (QX-011..QX-015):

QX-015 — Orientation banner:
- `pageStyles()` extended with `.orientation-banner` CSS rule (blue left border, light blue background, 0.9rem text)
- List-page HTML: `<div class="orientation-banner">` added before `<h1>`, describing Quay and the status lifecycle

QX-012 — Mobile table adaptation:
- `pageStyles()` `@media (max-width: 600px)` block extended with `.col-role, .col-labels { display: none; }`
- `<th>role</th>` → `<th class="col-role">role</th>` (list page header)
- `<th>labels</th>` → `<th class="col-labels">labels</th>` (list page header)
- Row `<td>` for role → `<td class="col-role">` ; for labels → `<td class="col-labels">`

QX-013 — Gate-fail feedback:
- `pageStyles()` extended with `.error-banner` and `.success-banner` CSS rules
- `addParam(urlPath, key, value)` helper added to `startServer()` scope
- Action POST handler: `client.taskCheck(decodedId)` called before `composePayload`/`deliverTrigger`
- If `gateResult.ok === false`: redirect to `addParam(baseRedirect, "error", errorMsg)` — no trigger delivery
- If gate passes: deliver trigger; redirect to `addParam(baseRedirect, "success", "Task ${id} advanced")`
- List page: reads `?error=` and `?success=` params; renders `.error-banner` / `.success-banner` divs
- Detail page: same error/success banner logic

QX-011 — Back link filter context:
- Row renderer: task title link changed from `<a href="/task/${t.id}">` to `<a href="/task/${encodeURIComponent(t.id)}?from=${encodeURIComponent(currentListHref)}">`
- Detail page handler: reads `url.searchParams.get("from")`; validates it starts with `/` (open-redirect guard); uses as `backHref` for `← back to list` link; defaults to `/`

QX-014 — Advance button tooltip:
- List page: `<button type="submit">` → `<button type="submit" title="Advance task to next status">`
- Detail page: `nextStatusMap = { todo: "ready", ready: "done" }`; button gets `title="Advance to ${nextStatus}"` or generic fallback

**`packages/quay/test/serve.test.mjs`** (QX-011..QX-015):
- New UX3 test block (port+4): 2 fresh tasks (UX3-1: all ACs checked; UX3-2: unchecked ACs)
- 25 new assertions covering: orientation-banner class, status text, col-role/col-labels classes, @media CSS rule, `title=` attribute on list and detail buttons, ?from= in task title links, back link with from= param, back link default, open-redirect guard, gate-fail redirect with ?error=, no ?success= on gate-fail, error-banner rendered for ?error=, detail page error-banner, gate-pass redirect with ?success=, no ?error= on gate-pass, success-banner rendered for ?success=
- Updated 3 existing assertions: POST redirect Location changed from exact match to `startsWith` (gate-pass now appends ?success=); task title link href changed from exact to prefix match (?from= appended)

**`packages/quay/test/web-ui-browser.test.mjs`**: Updated 5 assertions to accommodate:
- Task title links now include ?from= (exact href → prefix href check)
- POST redirect now appends ?success= (exact Location → startsWith check)
- `<th>labels</th>` now has `class="col-labels"` (updated assertion to accept either form)
- `<td>alpha</td>` now has `class="col-labels"` (updated assertion to check label value via `>alpha<` or class)

**`packages/quay/test/core-three-way-symmetry.test.mjs`**: Updated 1 assertion: POST redirect Location now appends ?success= (exact → startsWith check)

### Test results

Full suite before implementation: 30/30 pass.
Full suite after all changes (commit f4b3b8d): **30/30 pass**.
- QX-015 orientation banner: 3 assertions PASS
- QX-012 col-role/col-labels + CSS: 3 assertions PASS
- QX-014 button title= attributes: 2 assertions PASS
- QX-011 ?from= in title links + back link: 4 assertions PASS (including open-redirect guard)
- QX-013 gate-fail feedback + banners: 7 assertions PASS

### Gate checks

- QX-011: `task check` → ok:true (6/6 AC checked); status advanced to done; G3 co-sign pending
- QX-012: `task check` → ok:true (7/7 AC checked); status advanced to done; G3 co-sign pending
- QX-013: `task check` → ok:true (9/9 AC checked); status advanced to done; G3 co-sign pending
- QX-014: `task check` → ok:true (5/5 AC checked); status advanced to done; G3 co-sign pending
- QX-015: `task check` → ok:true (6/6 AC checked); status advanced to done; G3 co-sign pending

### Live verification

Quay serve restarted after code changes. Verified live:
- `GET http://localhost:4173/` → 200; orientation-banner present; col-role/col-labels in CSS; error-banner/success-banner CSS in styles
- Orientation banner visible: "Quay — AI-assisted task management. Task statuses: todo → in_progress → needs-human → done."
- Task title links include ?from= encoding current list URL
- CSS includes `.col-role, .col-labels { display: none; }` inside @media (max-width: 600px)

---

## 6. Provenance update

| Task | Iteration | author_by | execute_by | gate_by | σ contribution | Notes |
|------|-----------|-----------|------------|---------|----------------|-------|
| QX-001 | 0 | seed | N/A | N/A | 0/15 | Unchanged |
| QX-002..QX-007 | 1 | native | native | G3 PASS WITH NOTES / tests pass | 1..6/15 | Unchanged |
| QX-008 | 2 | native | native | G3 PASS WITH NOTES | 7/15 | Unchanged |
| QX-009 | 2 | native | native | G3 PASS WITH NOTES | 8/15 | Unchanged |
| QX-010 | 2 | native | native | tests pass (30/30) | 9/15 | Unchanged |
| QX-011 | 3 | native | native | G3 pending | 10/15 | Back link filter context (UQ-009) |
| QX-012 | 3 | native | native | G3 pending | 11/15 | Mobile table adaptation (UQ-011/012) |
| QX-013 | 3 | native | native | G3 pending | 12/15 | Gate-fail feedback (UQ-013) |
| QX-014 | 3 | native | native | G3 pending | 13/15 | Advance tooltip (UQ-014) |
| QX-015 | 3 | native | native | G3 pending | 14/15 | Orientation banner (UQ-003) |

σ_QX before iteration 3: 9/10 = 0.900
σ_QX after iteration 3 (development phase, G3 pending): 14/15 = 0.933
(QX-001 seed; QX-002..015 native. QX-011..015 gate_by = "G3 pending" — awaiting orchestrator dispatch.)

---

## 7. Simulated-user pass (§0c — every iteration)

**Status**: PENDING — orchestrator dispatching 3 simulated-user agents after this development phase.

Personas to dispatch this iteration (suggested by development phase findings):
- **Mobile-only single-task user**: re-verify that UQ-011/012 fixes actually make Advance visible at 375px; test gate-fail error banner at mobile; test back-link preservation at mobile
- **New-contributor with no context**: verify orientation banner provides sufficient onboarding; test gate-fail error message clarity; verify back-link and tooltip improve discoverability
- **Comparison-to-a-mature-tool reviewer**: compare current state against a mainstream issue tracker; identify remaining usability gaps not yet addressed

[TO BE FILLED IN BY ORCHESTRATOR — audit files at experiments/quay-continuous-bootstrap/audits/iteration-3-simulated-user-{persona}.md]

---

## 8. V_instance

### Pre-simulated-user estimates (development phase)

**capability_breadth**: ~0.74 (unchanged — no CB work this iteration; 4 CB gaps still open)
ΔV from iteration 2: 0.00

**usability_quality**: ~0.80 (development-phase estimate)
Reasoning: 6 significant UQ gaps closed (UQ-003, UQ-009, UQ-011, UQ-012, UQ-013, UQ-014). Remaining significant open: UQ-008 (MCP response size). Minor open: UQ-004, UQ-005, UQ-006, UQ-007, UQ-015. With 1 significant open vs. 7 before, score should rise substantially from 0.63. Estimate 0.80; final confirmed after simulated-user pass.
ΔV from iteration 2: ~+0.17

**verification_coverage**: ~0.97 (unchanged — 25 new assertions added, maintaining coverage; small deduction for no Playwright live mobile verification)
ΔV from iteration 2: 0.00

**system_health**: ~0.98 (unchanged — 30/30 tests pass; no regressions; G3 pending)
ΔV from iteration 2: 0.00

### Development-phase V_instance estimate:
```
V_instance (estimate) ≈ 0.74 × 0.80 × 0.97 × 0.98
                      ≈ 0.562

ΔV_instance (estimate): +0.119 (over iteration 2 final of 0.443)
```

**NOTE**: Final V_instance to be computed after simulated-user pass findings are incorporated. Simulated-user may find new significant UQ gaps (as in iteration 2) that revise usability_quality downward, or may confirm the fixes were effective (raising confidence). These are labeled as estimates pending.

**Cumulative gaps closed (development phase)**: 20 (all-time, development phase; simulated-user may add new gaps that affect the final count)

---

## 9. V_meta

**completeness**: 0.77
Re-trigger check: NOT TRIGGERED — no new Skill Method-step gap found. ENV gap continues unchanged.

**effectiveness**: 0.26
Re-trigger check: NOT TRIGGERED — QX-011..015 each touched serve.js + multiple test files (multi-file changes). No scope-matched single-file, no-network task completed. The gate-check addition (QX-013) touches client.taskCheck alongside serve.js modifications — still multi-file.

**reusability**: 0.79
Re-trigger check: NOT TRIGGERED — no organic demand for GitHub Provider data.write or new ABI extension.

**validation**: 0.933 (σ_QX = 14/15, development phase; QX-011..015 gate_by "G3 pending")
Movement: validation went from 0.900 (iteration 2) to 0.933 (iteration 3 development phase). Final value after G3 co-sign will be recorded when G3 reports.

**V_meta total (development phase)**:
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.933
       ≈ 0.148

ΔV_meta from iteration 2 final (0.142): +0.006
```

**V_meta ceiling**: 0.26 (effectiveness frozen; V_meta ≥ 0.80 arithmetically unreachable — standing fact restated)

**Stall diagnosis**: Unchanged from inherited — effectiveness frozen at 0.26 (largest structural blocker); completeness blocked by ENV gap; reusability blocked by no organic write demand. Validation continues upward (0.778 → 0.857 → 0.900 → 0.933). No change to stall structure.

---

## 10. Out-of-band audit (G3)

**G3 IS TRIGGERED this iteration** — Core source file changed:
- `packages/quay/src/serve.js` (QX-011, QX-012, QX-013, QX-014, QX-015: multiple Web UI rendering and action handler changes)

**Commit to audit**: f4b3b8d

**Status**: PENDING — awaiting orchestrator dispatch.

Dispatcher: orchestrator, native Agent/Task tool, NOT manda, run_in_background=true.
Audit file: `experiments/quay-continuous-bootstrap/audits/iteration-3-adjudicate.md`

[TO BE FILLED IN BY ORCHESTRATOR]

---

## 11. Pause / Convergence Check

- [ ] **Meta-layer V_meta ≥ 0.80**: NO — V_meta ≈ 0.148, ceiling = 0.26. Arithmetically unreachable. NOT CONVERGED on meta-layer.
- [ ] **Instance-layer PAUSE criteria** (ΔV flat < 0.02 for 2+ iterations AND no new significant gap):
  - ΔV_instance estimate: ~+0.119 — NOT flat (well above 0.02 threshold). PAUSE criterion does NOT apply.
  - Additionally: simulated-user pass pending — cannot confirm "no new significant gap" until it completes.
  - Status: NOT PAUSED
- [ ] **G3 green for all Core/lift tasks**: PENDING — G3 not yet dispatched. Will be confirmed by orchestrator.
- [ ] **Simulated-user pass run, findings recorded**: PENDING — orchestrator dispatching after development phase.
- [ ] **system_health: no regression against any of the three inherited snapshots**: YES (development phase) — 30/30 tests pass; no regressions confirmed before commit.

**Status: CONTINUING** (development phase; final status pending G3 + simulated-user completion)

---

## Problems identified for next iteration

(To be refined after simulated-user pass findings)

1. **CB-007** (significant): Full-text/title search still missing — highest-effort remaining capability gap.

2. **CB-008/DIR-004** (significant): No packaging/distribution — longest-open significant gap without progress. Now iteration 3 without movement.

3. **CB-010 / UQ-008** (significant): MCP task_list unfiltered response size — prefix filter helps; unfiltered scalability persists.

4. **UQ-015** (minor): `updatedAt` absent from `task_get` MCP response — G3 audit note from iteration 2.

5. **UQ-004** (minor): No timestamp column in CLI list output.

6. **UQ-005** (minor): No visual age indicator on Web UI list rows.

7. **UQ-006** (minor): Label filter flat 40+ item list.

8. **Simulated-user findings** (TBD): new gaps from iteration 3's simulated-user pass will be added here after orchestrator dispatch.
