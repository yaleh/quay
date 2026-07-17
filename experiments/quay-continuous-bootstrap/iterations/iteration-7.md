# Iteration 7: QX-026/027/028 — freq-sort labels (UQ-028+027), doc staleness (UQ-029), body search exclusion (CB-017)

**Date**: 2026-07-17
**Driver**: native (QX-026, QX-027, QX-028 all driven through quay:author + quay:execute natively)
**Dimensions advanced**: usability_quality (UQ-027, UQ-028, UQ-029 closed via QX-026, QX-027), capability_breadth (CB-017 closed via QX-028)
**V_meta triggers checked**: all 5 — none fired (see §9)
**Worktree**: `experiments/quay-continuous-bootstrap/worktrees/iteration-7` on branch `experiment-4-iteration-7` — created via `git worktree add`. ENV limitation: Tool writes (Read/Write/Edit) still target main tree absolute paths, as documented in prior iterations. Worktree created for protocol compliance.
**Gap-list delta (development phase)**: 4 closed (CB-017 via QX-028, UQ-027 via QX-026, UQ-028 via QX-026, UQ-029 via QX-027); 0 new gaps in development phase; G3 + simulated-user PENDING (orchestrator dispatch). Cumulative gaps closed: 40 (development phase).

---

## 1. Context from prior iteration

**σ_QX before**: 24/25 = 0.960 (QX-001 seed; QX-002..025 native; all G3 PASS or PASS-WITH-NOTES)

**V scores before** (iteration 6 final):
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.74 × 0.81 × 0.97 × 0.97 ≈ 0.564

ΔV_instance (iteration 6, FINAL): −0.012 (first negative ΔV)
```
ΔV trend: iter0→1=+0.152, iter1→2=+0.055, iter2→3=+0.048, iter3→4=+0.070, iter4→5=+0.015, iter5→6=−0.012.

**Problems inherited from iteration 6** (in priority order):
1. UQ-028 (significant, NEW): label nav alphabetic ordering hides most-used labels (`v1`=33, `usability_quality`=19)
2. UQ-027 (significant, NEW): active label hidden by alphabetic truncation (no bold, no remove link)
3. UQ-029 (significant, NEW): doc staleness — --help and placeholder say "title", body search is live
4. CB-017 (significant, NEW): body search false positives — "Proposal" matches 117/118 tasks (template headings)
5. CB-014 (significant): MCP task_list schema stale in-session
6. CB-010/UQ-008 (significant): MCP pagination
7. CB-008/DIR-004 (significant): Packaging/distribution
8. UQ-030 (minor): search form buried below label wall on mobile

**Gap list at iteration start**: 16 open gaps (6 CB, 10 UQ, 0 VC, 0 SH) + 1 process (PR-001).

---

## 2. Preconditions checked

**G6 (manda daemon)**:
- `.manda/hub.addr` read live: `http://localhost:46215` (NOT hardcoded)
- `curl -s http://localhost:46215/healthz` → `{"root":"/home/yale/work/quay"}` ✓
- Monitor process confirmed running in orchestrator session (per iteration-7 dispatch)

**G7 (web service)**:
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` → `200` ✓ (running at iteration start; restarted after code changes)

**Worktree (DIR-006 standing guardrail)**:
- Created: `git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-7 -b experiment-4-iteration-7`
- Output: `Preparing worktree (new branch 'experiment-4-iteration-7') HEAD is now at 22f6232` ✓
- ENV deviation documented: tool writes still target main tree (same as prior iterations — structural limitation, not a choice)

**provenance.md read**: ✓
**gap-list.md read**: ✓ (16 open gaps + 1 process confirmed at start)

**Directives/pending/ listed** (genuinely re-run, not recalled from memory):
- `ls experiments/quay-continuous-bootstrap/directives/pending/` actual output: `DIR-004-node-sea-bun-compile-release-artifacts.md`, `DIR-005-land-action-buttons-end-to-end-readme-screenshots-serve-g7.md`, `DIR-006-directives-as-quay-tasks-single-source-of-truth-cutover.md`
- DIR-004: pending, in scope, not yet prioritized. DEFERRED — packaging scope larger than this iteration's focus.
- DIR-005: action buttons landed (QX-009, iteration 2). G7 confirmed 200. README screenshots outstanding but not blocking. DEFERRED.
- DIR-006: directives-as-quay-tasks cutover. PR-001 (mechanism self-application problem) remains unresolved; requires human decision. DEFERRED.

**PAUSE check**:
- ΔV_instance iteration 5: +0.015 (below 0.02 — first)
- ΔV_instance iteration 6 (FINAL): −0.012 (below 0.02 — second consecutive)
- Two consecutive iterations below threshold: YES — PAUSE ΔV condition is met
- "No new significant gap" condition: VIOLATED — iteration 6 found 4 new significant gaps (CB-017, UQ-027, UQ-028, UQ-029)
- **PAUSE: NOT triggered** — ΔV condition met but significant-gap condition fails
- Status: CONTINUING

**V_meta re-trigger check** (all 5 conditions):
1. effectiveness re-trigger: NOT TRIGGERED — QX-026/027/028 each touch multiple source + test files. No scope-matched single-file, no-network task arising.
2. reusability re-trigger: NOT TRIGGERED — no organic GitHub Provider data.write demand.
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new Skill Method-step gap found; ENV gap continues.
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch primitive.
5. open-ended-domain-specific: OBSERVATIONAL — self-hosted tracking functioning; QX-026/027/028 created via MCP tools before implementation. NOT TRIGGERED as methodology gap.

**verification_coverage spot-check**: Full test suite 30/30 pass at iteration start. All prior capabilities retain tests.

**system_health regression check**: 30/30 pass before implementation; 30/30 pass after all changes. All three inherited snapshots confirmed intact.

---

## 3. Observe

**Current gap-list state at iteration start** (16 open gaps):

| Dimension | Severity | Count | Highest-priority entries |
|-----------|----------|-------|--------------------------|
| capability_breadth | significant | 4 | CB-008 (packaging), CB-010 (MCP size), CB-014 (MCP schema stale), CB-017 (body search false positives) |
| capability_breadth | minor | 2 | CB-006 (page size), CB-015 (MCP multi-label) |
| usability_quality | significant | 4 | UQ-008 (MCP response), UQ-027 (active label hidden), UQ-028 (alpha ordering), UQ-029 (doc staleness) |
| usability_quality | minor | 6 | UQ-020, UQ-021, UQ-022, UQ-006, UQ-007, UQ-030 |

**V_meta re-trigger check results**: all 5 NOT TRIGGERED (see §2 above).

**Highest-value cluster chosen**: UQ-028 + UQ-027 (together via QX-026), UQ-029 (via QX-027), CB-017 (via QX-028).

Rationale: all 4 are significant gaps found by the iteration 6 audit; they are the direct feedback from the standing quality mechanism. The iteration-6 analysis itself (§"Problems identified for next iteration") explicitly prioritized these 4 in this order. QX-026 addresses UQ-028 and UQ-027 together (frequency sort naturally resolves most-used-label hiding; active-label pinning resolves the hidden-active-filter correctness gap). QX-027 is a trivial but high-credibility fix. QX-028 fixes the body-search quality degradation that CB-017 describes — necessary for body search (QX-023) to deliver real signal value.

Skip rationale:
- CB-014 (MCP schema stale) — structural/external, design-blocked.
- CB-010/UQ-008 (MCP pagination) — design work requiring new MCP protocol surface.
- CB-008/DIR-004 (packaging) — major scope; correct to defer until dedicated iteration.
- UQ-030 (minor, search form on mobile) — lower priority than the 4 chosen.

**PAUSE-check inputs**:
- Iteration 5 ΔV = +0.015 (below 0.02); iteration 6 ΔV = −0.012 (below 0.02). Two consecutive below threshold. BUT 4 new significant gaps found in iterations 5+6. PAUSE not triggered — significant-gap condition fails.

---

## 4. Strategy

**Chosen work**: 3 QX-* tasks authored and executed natively:
- QX-026: Frequency-based label ordering + pin active labels — serve.js (UQ-028 + UQ-027)
- QX-027: Fix doc staleness — bin/quay.js + serve.js (UQ-029)
- QX-028: Body search template exclusion — stripHeadings() in bin/quay.js + serve.js (CB-017)

**Write-surface boundary check (§Core-scope constraints item 6)**:
- All 3 tasks modify `packages/quay/src/serve.js` and/or `packages/quay/bin/quay.js`.
- No new write path introduced. All changes are display/filter improvements to existing surfaces.
- "Core stays dumb" maintained: no provider-specific conditional in any change.

**V_meta re-trigger assessment**: All 3 tasks are multi-file implementations with test additions. None organically bears on any V_meta re-trigger condition. Noted explicitly.

**G3 trigger**: YES — Core source files changed: `packages/quay/bin/quay.js`, `packages/quay/src/serve.js`. G3 dispatched by orchestrator (NOT by this executor session). Never via manda. See §10.

---

## 5. Execution

### Self-hosted task tracking

Tasks created via `mcp__quay__task_write` BEFORE implementation (per protocol §5.1 dogfooding requirement):
- QX-026 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all ACs checked; UQ-027 + UQ-028 closed
- QX-027 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all ACs checked; UQ-029 closed
- QX-028 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all ACs checked; CB-017 closed

### Implementation — files changed

**`packages/quay/src/serve.js`** (QX-026, QX-027, QX-028):

QX-028 — stripHeadings() function added as a top-level helper (alongside `escapeHtml`):
```javascript
function stripHeadings(text) {
  return (text || "").split("\n").filter((line) => !/^#+\s/.test(line)).join(" ");
}
```

QX-028 — Body search filter updated to use `stripHeadings(t.body)` instead of `(t.body || "")`:
```javascript
(t.title + " " + stripHeadings(t.body)).toLowerCase().includes(qFilter.toLowerCase())
```

QX-026 — Label nav block replaced to implement frequency sort + active-label pinning:
- Count label frequency via `labelCounts` Map (iterating allTasks)
- Sort all distinct labels by count descending, then alphabetically within equal counts
- Identify active labels that fall outside top-25 slots (`activeHidden`)
- Build `pinnedFirst = [...new Set([...activeHidden, ...allLabels])]`
- `visibleLabels = pinnedFirst.slice(0, LABEL_NAV_MAX)` (always 25 or fewer)
- `hiddenLabelCount = allLabels.filter(l => !visibleLabels.includes(l)).length` (accurate)

QX-027 — Placeholder updated:
```
"Search titles…" → "Search titles and descriptions…"
```

**`packages/quay/bin/quay.js`** (QX-027, QX-028):

QX-028 — stripHeadings() function added (identical implementation to serve.js):
```javascript
function stripHeadings(text) {
  return (text || "").split("\n").filter((line) => !/^#+\s/.test(line)).join(" ");
}
```

QX-028 — Search filter in CLI `task list` updated to use `stripHeadings(t.body)`.

QX-027 — Help text updated:
- `--search <query>`: "Filter by title substring" → "Filter by title/body content (case-insensitive)"
- Example: "List tasks with 'bootstrap' in title" → "List tasks with 'bootstrap' in title or body"

**Test files**:

`serve.test.mjs` (QX-026 + QX-027 in port+8 block; QX-028 in port+9 block):

port+8 block (QX-026/QX-027):
- 30 tasks with label "freq-common" + 26 tasks with unique "zzz-rare-*" labels (one each)
- QX-026a: `GET /` — "freq-common" appears in HTML before "zzz-rare-*" (frequency sort confirmed)
- QX-026b: `GET /?label=zzz-rare-z` — "zzz-rare-z" appears in nav with "remove" link (active-label pinning)
- QX-026c: `GET /` — "more labels" text present (truncation indicator preserved)
- QX-027: `GET /` — placeholder contains "Search titles and descriptions"; old placeholder absent

port+9 block (QX-028 — dedicated minimal workspace, 2 tasks only):
- HDNG-1: body is only `## Proposal\n## Plan\n## AC\n## DoD\n` (heading lines only)
- HDNG-2: body has heading lines + prose line containing "xyzzy-prose-only-42z"
- `GET /?q=Proposal` — neither HDNG-1 nor HDNG-2 appears (headings stripped; no prose contains "Proposal")
- `GET /?q=xyzzy-prose-only-42z` — HDNG-2 appears (prose match); HDNG-1 excluded

`cli.test.mjs` (test block 20, QX-028 + QX-027):
- HDNG-1: heading-only body; `--search Proposal --json` must not return HDNG-1
- HDNG-2: prose body with "proposal" in prose line; `--search Proposal --json` must return HDNG-2
- Help text assertions: `--help` includes "title/body content" and "in title or body"; no longer contains "title substring"

### Test results

Full suite before implementation: 30/30 pass.
Full suite after all changes: **30/30 pass**.
(Note: one intermediate test failure during development was caught and fixed before final commit — the QX-028 serve test initially used "xyzzy-proposal-prose-unique" which itself contained the substring "proposal", causing a false assertion. Fixed by using token "xyzzy-prose-only-42z" and restructuring the port+9 block as a dedicated minimal workspace.)

### Gate checks

- QX-026: all 5 ACs checked; status advanced to done; G3 co-sign pending
- QX-027: all 5 ACs checked; status advanced to done; G3 co-sign pending
- QX-028: all 5 ACs checked; status advanced to done; G3 co-sign pending

### Live verification

Quay serve restarted after code changes. Live on `http://localhost:4173/` (200 confirmed).

---

## 6. Provenance update

| Task | Iteration | author_by | execute_by | gate_by | σ contribution | Notes |
|------|-----------|-----------|------------|---------|----------------|-------|
| QX-001 | 0 | seed | N/A | N/A | 0/28 | Unchanged |
| QX-002..QX-025 | 1–6 | native | native | G3 PASS / tests pass | 1–24/28 | Unchanged |
| QX-026 | 7 | native | native | G3 co-sign PENDING | 25/28 | Freq-sort labels + pin active (UQ-028+027) |
| QX-027 | 7 | native | native | G3 co-sign PENDING | 26/28 | Doc staleness (UQ-029) |
| QX-028 | 7 | native | native | G3 co-sign PENDING | 27/28 | Body search heading exclusion (CB-017) |

σ_QX before iteration 7: 24/25 = 0.960
σ_QX after iteration 7 (development phase, G3 pending): 24/25 = 0.960 (QX-026/027/028 not yet co-signed; gate_by pending)

When G3 co-signs: σ_QX will be 27/28 = 0.964.

---

## 7. Simulated-user pass (§0c — every iteration)

**PENDING — orchestrator will dispatch**

Three persona-diverse agents to be dispatched by the orchestrator (run_in_background=true, NOT manda, fresh contexts per §0c). Suggested personas for iteration 7:

1. **New-contributor-with-no-context** — arrives fresh, uses Web UI search and label nav to find tasks; surfaces whether the frequency sort and doc-accurate placeholder improve first-use discoverability.
2. **Comparison-to-mature-tool reviewer (vs GitHub Issues)** — compares quay's search quality (post-CB-017 fix) against GitHub Issues' search; surfaces whether body search is now genuinely useful for structured task bodies.
3. **Cross-experiment maintainer (CLI + Web UI)** — runs `--search` from CLI and checks that "Proposal" no longer floods results; also verifies label nav with active filter now shows the expected bold/remove affordance.

Each persona writes to:
`experiments/quay-continuous-bootstrap/audits/iteration-7-simulated-user-{persona}.md`

New significant findings become gap-list entries dated this iteration.

---

## 8. V_instance (provisional — development phase only; G3 + simulated-user pending)

**capability_breadth (provisional)**: 0.76
- Prior: 0.74.
- CB-017 CLOSED (significant, QX-028): body search heading exclusion implemented — false positives for template terms eliminated. +0.02.
- Net: +0.02 → 0.76.
- Open: CB-006/008/010/014/015 (5 open, as before) = 5 open (4 significant + 1 minor).

**usability_quality (provisional)**: 0.85
- Prior: 0.81.
- UQ-027 CLOSED (significant, QX-026): active label pinning — active filters now always visible in nav. +0.02.
- UQ-028 CLOSED (significant, QX-026): frequency sort — most-used labels (v1, usability_quality) now appear first. +0.015.
- UQ-029 CLOSED (significant, QX-027): doc staleness corrected — help and placeholder now accurately reflect body search. +0.01.
- Net: +0.045 → 0.855 ≈ 0.85.
- Open: UQ-008 (significant) + UQ-006/007/020/021/022/030 (6 minor) = 7 open.

**verification_coverage (provisional)**: 0.97
- 30/30 pass. New test blocks added: serve.test.mjs (port+8 QX-026/027 block + port+9 QX-028 block), cli.test.mjs (test 20 QX-027/028 block).
- No Playwright live mobile verification. Score unchanged from iteration 6.

**system_health (provisional)**: 0.97
- 30/30 pass confirmed before and after all changes. G3 PENDING.
- All three inherited snapshots confirmed intact.
- No regressions. Score unchanged from iteration 6.

### Provisional V_instance:
```
V_instance (provisional) = capability_breadth × usability_quality × verification_coverage × system_health
                         = 0.76 × 0.85 × 0.97 × 0.97

                         = 0.76 × 0.85 = 0.646
                         × 0.97 = 0.627
                         × 0.97 = 0.608

V_instance (provisional) ≈ 0.608

ΔV_instance (provisional) = 0.608 − 0.564 = +0.044
```

**This is a provisional development-phase estimate.** G3 and simulated-user may revise these scores, as occurred in iterations 5 and 6 where provisional and final differed by 0.061 and 0.079 respectively.

**Cumulative gaps closed (development phase): 40** (prior 36 + CB-017, UQ-027, UQ-028, UQ-029)

---

## 9. V_meta (provisional)

**completeness**: 0.77
Re-trigger check: NOT TRIGGERED — no new Skill Method-step gap found. ENV gap continues unchanged.

**effectiveness**: 0.26
Re-trigger check: NOT TRIGGERED — QX-026/027/028 each touched multiple source + test files. No scope-matched single-file, no-network task completed. Self-hosted tracking functioning; QX-026/027/028 created via MCP before implementation — qualitative improvement observed but not a timing-evidenced re-trigger.

**reusability**: 0.79
Re-trigger check: NOT TRIGGERED — no organic demand for GitHub Provider data.write or new ABI extension.

**validation**: 0.960 (σ_QX = 24/25, development phase — G3 co-sign pending)
When G3 co-signs QX-026/027/028: σ_QX = 27/28 = 0.964 → V_meta moves slightly.

**V_meta total (provisional)**:
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.960
       ≈ 0.152

V_meta (provisional, unchanged from iteration 6)
```

**V_meta ceiling**: 0.26 (effectiveness frozen; V_meta ≥ 0.80 arithmetically unreachable — standing fact restated)

**Re-trigger check (all 5 conditions)**:
1. effectiveness re-trigger: NOT TRIGGERED
2. reusability re-trigger: NOT TRIGGERED
3. completeness re-trigger (gap discovery): NOT TRIGGERED
4. completeness + reusability/effectiveness joint: NOT TRIGGERED
5. open-ended-domain-specific: NOT TRIGGERED — domain capability gaps being closed; self-hosted tracking functioning; no new methodology finding.

**Stall diagnosis**: Unchanged — effectiveness frozen at 0.26; completeness blocked by ENV gap; reusability blocked by no organic write demand. Validation moving slowly upward.

---

## 10. Out-of-band audit (G3)

**PENDING — orchestrator will dispatch**

G3 WAS TRIGGERED this iteration — Core source files changed:
- `packages/quay/bin/quay.js` (QX-027 help text + QX-028 stripHeadings)
- `packages/quay/src/serve.js` (QX-026 freq-sort + pin, QX-027 placeholder, QX-028 stripHeadings)

G3 auditor should write to:
`experiments/quay-continuous-bootstrap/audits/iteration-7-adjudicate.md`

Key focus areas for G3:
1. `stripHeadings()` correctness: does `/^#+\s/.test(line)` correctly exclude `## Proposal`, `### Phase 1 —`, `# Title` but NOT `#tag` (no space after hash)?
2. Frequency sort edge case: what happens when `labelCounts` has 0 tasks for a label (shouldn't happen, but confirm Set iteration is consistent)?
3. Active-label pinning: does `[...new Set([...activeHidden, ...allLabels])]` correctly dedup and preserve order?
4. `hiddenLabelCount` calculation: `allLabels.filter(l => !visibleLabels.includes(l)).length` — is this O(n²) for large label sets? Non-blocking note if so.
5. Placeholder update doesn't break any test that asserted the old string.

Confirm dispatcher: orchestrator, native Agent/Task tool, NOT manda.

---

## 11. Pause / Convergence Check (provisional — pending G3 + simulated-user)

- [ ] **Meta-layer V_meta ≥ 0.80**: NO — V_meta ≈ 0.152 (provisional), ceiling = 0.26. Arithmetically unreachable. NOT CONVERGED on meta-layer.
- [ ] **Instance-layer PAUSE criteria** (ΔV flat < 0.02 for 2+ consecutive iterations AND no new significant gap):
  - ΔV_instance iteration 6 (FINAL): −0.012 (below 0.02)
  - ΔV_instance iteration 7 (PROVISIONAL): +0.044 (above 0.02 threshold)
  - Two consecutive iterations below threshold: NO (iteration 7 provisional breaks the streak)
  - **PAUSE: NOT triggered** — ΔV_7 provisional is +0.044 (above threshold)
  - Note: PAUSE check is provisional; final ΔV depends on G3 + simulated-user findings
- [ ] **G3 green for all Core/lift tasks**: PENDING — Core source files changed; awaiting orchestrator dispatch
- [ ] **Simulated-user pass run, findings recorded**: PENDING — orchestrator dispatch required
- [ ] **system_health: no regression against any of the three inherited snapshots**: YES (30/30 pass confirmed; all inherited snapshots intact)

**Status: CONTINUING (provisional)** — G3 and simulated-user pending; no evidence of convergence criteria being met.

ΔV trend (provisional): iter0→1=+0.152, iter1→2=+0.055, iter2→3=+0.048, iter3→4=+0.070, iter4→5=+0.015, iter5→6=−0.012, iter6→7=+0.044 (provisional). Iteration 7 provisionally reverses the negative ΔV from iteration 6.

---

## Problems identified for next iteration

(To be updated after G3 + simulated-user findings. Pre-emptive list from current open gap state.)

Priority order from updated open gap list after development phase:

1. **CB-014** (significant): MCP task_list schema stale in-session — structural gap. Requires session-independent fix.

2. **CB-010/UQ-008** (significant): MCP pagination — no streaming or pagination at MCP layer.

3. **CB-008/DIR-004** (significant): Packaging/distribution — 7 iterations without progress; growing technical debt.

4. **UQ-030** (minor): Move search form above label nav on mobile (or use CSS `order`).

5. **UQ-020/021/022** (minor): CLI edge cases and needs-human guidance.

6. **CB-006** (minor): Configurable page size on Web UI list page.

Any new significant gaps from G3 or simulated-user will be inserted at the top of this list.

Note: If ΔV_7_final ≥ 0.02 AND simulated-user finds no new significant gaps, iteration 8 would be the first iteration where PAUSE criteria could potentially be met. Watch ΔV trend.
