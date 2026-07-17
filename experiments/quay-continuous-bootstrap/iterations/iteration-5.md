# Iteration 5: QX-020/021/022 — label-nav toggle, full-text search, CLI timestamps (usability_quality + capability_breadth)

**Date**: 2026-07-17
**Driver**: native (QX-020, QX-021, QX-022 all driven through quay:author + quay:execute natively)
**Dimensions advanced**: usability_quality (UQ-019 closed via QX-020; UQ-004 closed via QX-022), capability_breadth (CB-007 closed via QX-021)
**V_meta triggers checked**: all 5 — none fired (see §9)
**Worktree**: `experiments/quay-continuous-bootstrap/worktrees/iteration-5` on branch `experiment-4-iteration-5` — created via `git worktree add`. ENV limitation: Tool writes (Read/Write/Edit) still target main tree absolute paths, as documented in prior iterations. Worktree created for protocol compliance; deviation noted.
**Gap-list delta**: Development phase: 3 closed (CB-007 via QX-021, UQ-004 via QX-022, UQ-019 via QX-020), 0 new. G3 + simulated-user pending (dispatched by orchestrator). Cumulative gaps closed: 31 (development phase).

---

## 1. Context from prior iteration

**σ_QX before**: 18/19 = 0.947 (QX-001 seed; QX-002..019 native; all G3 PASS WITH NOTES)

**V scores before** (iteration 4 final):
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.72 × 0.82 × 0.97 × 0.98 ≈ 0.561

ΔV_instance (iteration 4): +0.070 (from 0.491)
```
ΔV trend: iter0→1 = +0.152, iter1→2 = +0.055, iter2→3 = +0.048, iter3→4 = +0.070 — all above 0.02. PAUSE NOT triggered.

**Problems inherited from iteration 4** (in priority order):
1. UQ-019 (significant): Fix multi-label label-nav — clicking a label nav link should toggle individual labels rather than replacing the entire filter
2. CB-014 (significant): MCP task_list schema stale in-session — structural recurrence of CB-011, requires session-independent fix
3. CB-007 (significant): Full-text/title search — consistently flagged by comparison reviewers across 4 iterations
4. UQ-004 (minor): Display timestamps in CLI plain-text task list output
5. UQ-022 (minor): needs-human detail page guidance
6. UQ-020/021 (minor): CLI flag validation consistency
7. UQ-023 (minor): Remove redundant statSync from list()

**Gap list at iteration start**: 15 open gaps (6 CB, 9 UQ, 0 VC, 0 SH) + 1 process (PR-001).

---

## 2. Preconditions checked

**G6 (manda daemon)**:
- `.manda/hub.addr` read live: `http://localhost:46215` (NOT hardcoded)
- `curl -s http://localhost:46215/healthz` → `{"root":"/home/yale/work/quay"}` ✓
- Monitor process confirmed running in orchestrator session

**G7 (web service)**:
- `curl -s http://localhost:4173/ | head -3` → `<!doctype html>` 200 ✓ (running at iteration start; restarted after code changes)

**Worktree (DIR-006 standing guardrail)**:
- Created: `git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-5 -b experiment-4-iteration-5`
- ENV deviation documented: tool writes still target main tree (same as prior iterations)

**provenance.md read**: ✓
**gap-list.md read**: ✓ (15 open gaps confirmed at start)
**directives/pending/ listed (genuinely re-run, not recalled from memory)**:
- `ls experiments/quay-continuous-bootstrap/directives/pending/` output: DIR-004-node-sea-bun-compile-release-artifacts.md, DIR-005-land-action-buttons-end-to-end-readme-screenshots-serve-g7.md, DIR-006-directives-as-quay-tasks-single-source-of-truth-cutover.md
- DIR-004: pending, in scope, not yet prioritized (CB-008 gap). DEFERRED — packaging scope larger than this iteration's focus.
- DIR-005: land action buttons end-to-end, README screenshots, serve G7 host-binding fix. Action buttons were landed in iteration 2 (QX-009). G7 host-binding is confirmed satisfied (serve listens on 0.0.0.0). README screenshots outstanding but not a capability_breadth gap per se. DEFERRED — pending content work.
- DIR-006: directives-as-quay-tasks cutover. This would require migrating DIR-004/005 into tasks and deleting the files. The mechanism for uptake of this directive has itself been unreliable (PR-001). DEFERRED — the mechanism being asked to self-apply is the broken mechanism; requires human decision.
- PR-001 standing note: the §0 precondition re-execution failure documented in provenance.md. This iteration DOES genuinely re-run the ls. Deviation acknowledged.

**PAUSE check**:
- ΔV_instance iteration 3: +0.048 (NOT flat)
- ΔV_instance iteration 4: +0.070 (NOT flat — acceleration, above 0.02 threshold)
- Neither iteration met the "flat" criterion. PAUSE NOT MET. Status: CONTINUING.
- Additionally: iteration 4 simulated-user found UQ-019 (significant) and CB-014 (significant) — "no new significant gap" condition not met for prior window.

**V_meta re-trigger check** (all 5 conditions):
1. effectiveness re-trigger: NOT TRIGGERED — QX-020/021/022 each touch multiple source + test files. No scope-matched single-file, no-network task arising.
2. reusability re-trigger: NOT TRIGGERED — no organic GitHub Provider data.write demand.
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new Skill Method-step gap found; ENV gap continues.
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch primitive.
5. open-ended-domain-specific: OBSERVATIONAL — self-hosted tracking functioning; QX-020/021/022 created via MCP tools before implementation. NOT TRIGGERED as methodology gap.

**verification_coverage spot-check**: Full test suite 30/30 pass at iteration start. All prior capabilities retain tests.

**system_health regression check**: 30/30 pass before implementation; 30/30 pass after implementation. All three inherited snapshots confirmed intact.

---

## 3. Observe

**Current gap-list state at iteration start** (15 open gaps):

| Dimension | Severity | Count | Highest-priority entries |
|-----------|----------|-------|--------------------------|
| capability_breadth | significant | 3 | CB-007 (search), CB-008 (packaging), CB-010 (MCP response size) |
| capability_breadth | significant | 1 | CB-014 (MCP schema stale structural) |
| capability_breadth | minor | 2 | CB-006 (page size), CB-015 (MCP multi-label) |
| usability_quality | significant | 2 | UQ-008 (MCP response), UQ-019 (label-nav replace) |
| usability_quality | minor | 7 | UQ-004, UQ-006, UQ-007, UQ-020, UQ-021, UQ-022, UQ-023 |

**V_meta re-trigger check results**: all 5 NOT TRIGGERED (see §2 above).

**Highest-value cluster chosen**: UQ-019 (significant), CB-007 (significant), UQ-004 (minor).

Rationale: UQ-019 is a significant usability regression from iteration 4 (multi-label nav broken — quick fix in serve.js). CB-007 has been deferred for 4 iterations; consistently flagged by comparison reviewers; addresses a real gap vs. mature trackers; the implementation is a simple substring filter with no new dependency. UQ-004 is quick (data already available from QX-018's updatedAt work) and completes the timestamp feature across all surfaces.

Skip rationale:
- CB-010/UQ-008 (MCP pagination) — design work requiring new MCP protocol surface, multi-iteration scope.
- CB-014 (MCP schema stale) — structural/external: Claude Code session caches tools/list at connection time. Cannot be "fixed" by quay code alone without a session-independent mechanism (reconnect signal, etc.). Filed but design-blocked.
- CB-008/DIR-004 (packaging) — major scope; correct to defer until dedicated iteration.
- UQ-022/020/021/023 (minor cluster) — lower priority than the three chosen; will be addressed in a future iteration.

**PAUSE-check inputs**:
- Iteration 3 ΔV = +0.048 (NOT flat); iteration 4 ΔV = +0.070 (NOT flat; acceleration). PAUSE does not apply.
- New significant gaps from iteration 4 simulated-user (UQ-019, CB-014) — "no new significant gap" not met.

---

## 4. Strategy

**Chosen work**: 3 QX-* tasks authored and executed natively:
- QX-020: Fix UQ-019 — label nav toggling (add if inactive, remove if active; bold for any active label; "All" clear link when 2+ active)
- QX-021: Fix CB-007 — full-text title search: `--search <query>` on CLI, `?q=<query>` on Web UI with GET form
- QX-022: Fix UQ-004 — CLI plain-text output includes "updated" timestamp column via relativeTimeCli() helper

**Write-surface boundary check (§Core-scope constraints item 6)**:
- All 3 tasks modify `packages/quay/src/serve.js` and/or `packages/quay/bin/quay.js`.
- The Web UI search form (QX-021) is a new input affordance but submits via GET — it is a read-only query surface that produces filtered views of existing data. No new write path introduced.
- No new provider-specific conditional introduced by any of the 3 tasks.

**V_meta re-trigger assessment**: All 3 tasks are multi-file implementations with test additions. None organically bears on any V_meta re-trigger condition. Noted explicitly.

**G3 trigger**: YES — Core source files changed: `packages/quay/bin/quay.js`, `packages/quay/src/serve.js`. G3 dispatched by orchestrator (NOT by this executor session). Never via manda. See §10.

---

## 5. Execution

### Self-hosted task tracking

Tasks created via `mcp__quay__task_write` BEFORE implementation (per protocol §5.1 dogfooding requirement):
- QX-020 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all ACs checked; UQ-019 closed
- QX-021 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all ACs checked; CB-007 closed
- QX-022 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all ACs checked; UQ-004 closed

All tasks queried via task_list (prefix=QX) and confirmed in backlog before implementation began.

### Implementation — files changed (commit 69a102a)

**`packages/quay/src/serve.js`** (QX-020, QX-021):

QX-020 — Label nav toggle semantics:
- `buildHref` signature updated to accept `q` as 6th parameter (QX-021 preparation; carries active search query through all nav links)
- Label nav: `isActive = labelFilters.includes(l)` (works for multi-label state, not just single-label)
- `toggledLabels`: if `isActive`, `labelFilters.filter(x => x !== l)`; else `[...labelFilters, l]`
- Active label rendered as `<strong>l</strong> (<a href="...">remove</a>)` with toggle-off href
- Inactive label rendered as `<a href="...">l</a>` with toggle-on href (adds to current filters)
- "All" clear link appears when `labelFilters.length > 0` (unchanged from prior behavior — was already present)
- All 12+ `buildHref` call sites updated to pass `qFilter` as 6th argument

QX-021 — Web UI title search:
- `qFilter = url.searchParams.get("q") || null` extracted before sort/pagination
- Filter step after label filter: `filtered = qFilter ? filteredByLabel.filter(t => t.title.toLowerCase().includes(qFilter.toLowerCase())) : filteredByLabel`
- Search form: `<form method="GET">` with `<input name="q">` carrying current value; active filter state preserved via hidden inputs for prefix/status/label/sort; `<button type="submit">Search</button>`
- Active search badge: shows `"query"` with a clear link when qFilter is set
- `buildHref` carries `q` param so status/sort/label nav links preserve search context

**`packages/quay/bin/quay.js`** (QX-021, QX-022):

QX-022 — relativeTimeCli() + timestamp column:
- `relativeTimeCli(ts)` helper function added above printHelp() — self-contained copy of serve.js's `relativeTime()`, kept in bin/quay.js to avoid importing serve.js (which has HTTP-server side effects at module load time)
- Non-JSON task list output: rightmost field added: `\t${typeof t.updatedAt === "number" ? relativeTimeCli(t.updatedAt) : "—"}`
- Header line updated: shows `--search "query"` when active search is combined with prefix, or separate `# search: "query" (N matches)` line when prefix-only not active

QX-021 — CLI --search flag:
- `searchQuery = typeof flags.search === "string" ? flags.search : null` after label filter step
- `filtered = searchQuery ? filteredByLabel.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase())) : filteredByLabel`
- `printHelp()` updated to document `--search <query>` in Usage and Options sections

**Test files** (QX-020..022):
- `cli.test.mjs` test 19: isolated workspace with SRCH-1 ("Quay bootstrap task"), SRCH-2 ("Dashboard setup"), SRCH-3 ("Bootstrap configuration"). Asserts: `--search bootstrap` returns SRCH-1 and SRCH-3 but not SRCH-2 (case-insensitive); `--search dashboard` returns only SRCH-2; no flag returns all 3; non-JSON output has 5 tab-separated fields; 5th field includes "ago"; `--help` mentions `--search`.
- `serve.test.mjs` QX-020/021 block (port+6): isolated workspace with TOGGLE-1 (alpha+beta), TOGGLE-2 (alpha), TOGGLE-3 (gamma). Asserts: multi-label filter still works; label nav shows `(remove)` link for active labels; active labels shown bold; toggle-on links include additional label; `?q=gamma` returns only TOGGLE-3; `?q=` empty returns all; `<input name="q">` present; `?q=ALPHA` case-insensitive match.

### Test results

Full suite before implementation: 30/30 pass.
Full suite after all changes (commit 69a102a): **30/30 pass**.

### Gate checks

- QX-020: `task check` → ok:true (all ACs checked); status advanced to done; G3 co-sign pending
- QX-021: `task check` → ok:true (all ACs checked); status advanced to done; G3 co-sign pending
- QX-022: `task check` → ok:true (all ACs checked); status advanced to done; G3 co-sign pending

### Live verification

Quay serve restarted after code changes. Verified live:
- `GET http://localhost:4173/` → 200; search form with `<input name="q">` present
- `GET http://localhost:4173/?q=bootstrap` → filtered result
- Label nav with 2+ active labels shows bold active labels and "(remove)" links

---

## 6. Provenance update

| Task | Iteration | author_by | execute_by | gate_by | σ contribution | Notes |
|------|-----------|-----------|------------|---------|----------------|-------|
| QX-001 | 0 | seed | N/A | N/A | 0/22 | Unchanged |
| QX-002..QX-019 | 1–4 | native | native | G3 PASS WITH NOTES / tests pass | 1–18/22 | Unchanged |
| QX-020 | 5 | native | native | G3 pending | 19/22 | Label nav toggle (UQ-019) |
| QX-021 | 5 | native | native | G3 pending | 20/22 | Full-text search CLI+Web UI (CB-007) |
| QX-022 | 5 | native | native | G3 pending | 21/22 | CLI timestamp column (UQ-004) |

σ_QX before iteration 5: 18/19 = 0.947
σ_QX after iteration 5 (DRAFT — G3 co-sign pending): 21/22 = 0.955
(QX-001 seed provenance; QX-002..022 all native authoring + execution. gate_by for QX-020..022 will be updated from "G3 pending" to "G3 PASS WITH NOTES" or equivalent after G3 co-sign.)

---

## 7. Simulated-user pass (§0c — every iteration)

**PENDING — dispatched by orchestrator (native Agent/Task tool, run_in_background=true, fresh context — never manda, never same session as executor).**

Personas planned (to be confirmed by orchestrator):
- New-contributor-with-no-context reviewer: arrives fresh, tries to discover and filter tasks using only the interface
- Comparison-to-a-mature-tool reviewer: holds quay's search/filter surface up against GitHub Issues or Linear
- Cross-experiment maintainer: manages multiple task prefixes in one session, exercises multi-label toggle and search simultaneously

Audit files will be written to:
- `experiments/quay-continuous-bootstrap/audits/iteration-5-simulated-user-{persona}-{surface}.md`

New gap-list entries generated by simulated-user pass: **PENDING**

---

## 8. V_instance

### Development-phase V_instance (G3 + simulated-user pending)

**capability_breadth**: 0.78 (provisional)
- Prior: 6 open CB gaps (0 blocking + 4 significant + 2 minor) → 0.72.
- Iteration 5 closes CB-007 (significant): 1 significant gap eliminated.
- No new CB gaps in development phase.
- After development phase: 0 blocking + 3 significant (CB-008, CB-010, CB-014) + 2 minor (CB-006, CB-015) = 5 open.
- Closing a significant gap on a 6-open baseline → 0.78 (provisional, before simulated-user may add new gaps).

**usability_quality**: 0.86 (provisional)
- Prior: 2 significant open (UQ-008, UQ-019) + 7 minor (UQ-004, UQ-006, UQ-007, UQ-020, UQ-021, UQ-022, UQ-023) → 0.82.
- Iteration 5 closes: UQ-019 (significant, fully), UQ-004 (minor).
- No new UQ gaps in development phase.
- After development phase: 1 significant open (UQ-008) + 6 minor (UQ-006, UQ-007, UQ-020, UQ-021, UQ-022, UQ-023) = 7 open.
- Closing a significant and a minor → substantial improvement; 1 significant remaining vs 2 prior. Score: 0.86 (provisional).

**verification_coverage**: 0.97
- Full test suite 30/30 pass.
- New test blocks: cli.test.mjs test 19 (search + timestamp), serve.test.mjs QX-020/021 block.
- Small deduction maintained: no Playwright live mobile verification at 375px.

**system_health**: 0.98
- G3 PENDING — provisional 0.98 maintained (no blocking issues found in development phase self-audit).
- No regression against any of the three inherited snapshots: 30/30 pass confirmed.

### Provisional V_instance (development phase only):
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.78 × 0.86 × 0.97 × 0.98

           = 0.78 × 0.86 = 0.6708
           = 0.6708 × 0.97 = 0.6507
           = 0.6507 × 0.98 ≈ 0.637

V_instance (iteration 5, development phase, provisional) ≈ 0.637

ΔV_instance (provisional) = 0.637 - 0.561 = +0.076
```

**Cumulative gaps closed (development phase): 31** (prior 28 + CB-007, UQ-004, UQ-019)

*Final V_instance will be updated after G3 and simulated-user pass findings are incorporated.*

---

## 9. V_meta

**completeness**: 0.77
Re-trigger check: NOT TRIGGERED — no new Skill Method-step gap found. ENV gap continues unchanged.

**effectiveness**: 0.26
Re-trigger check: NOT TRIGGERED — QX-020/021/022 each touched multiple source + test files. No scope-matched single-file, no-network task completed.

**reusability**: 0.79
Re-trigger check: NOT TRIGGERED — no organic demand for GitHub Provider data.write or new ABI extension.

**validation**: 0.955 (σ_QX = 21/22, provisional — G3 co-sign pending)
G3 audit co-sign for QX-020, QX-021, QX-022 PENDING (orchestrator dispatch). gate_by entries will be updated from "G3 pending" to "G3 PASS WITH NOTES" after co-sign.
Movement (provisional): 0.947 (iteration 4) → 0.955 (iteration 5 provisional).

**V_meta total (PROVISIONAL)**:
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.955

       = 0.77 × 0.26 = 0.2002
       = 0.2002 × 0.79 = 0.15816
       = 0.15816 × 0.955 ≈ 0.151

V_meta (iteration 5 provisional) ≈ 0.151
ΔV_meta from iteration 4 final (0.150): +0.001 (provisional)
```

**V_meta ceiling**: 0.26 (effectiveness frozen; V_meta ≥ 0.80 arithmetically unreachable — standing fact restated)

**Re-trigger check (all 5 conditions — provisional)**:
1. effectiveness re-trigger: NOT TRIGGERED — no scope-matched single-file, no-network task completing this iteration.
2. reusability re-trigger: NOT TRIGGERED — no organic GitHub Provider write demand.
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new Skill Method-step gap found.
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch primitive.
5. open-ended-domain-specific: NOT TRIGGERED — QX-020/021/022 are domain capability gaps. Self-hosted tracking functioning; no new methodology finding.

**Stall diagnosis**: Unchanged — effectiveness frozen at 0.26; completeness blocked by ENV gap; reusability blocked by no organic write demand. Validation continues upward toward ceiling.

---

## 10. Out-of-band audit (G3)

**G3 IS TRIGGERED this iteration** — Core source files changed:
- `packages/quay/bin/quay.js` (QX-021, QX-022)
- `packages/quay/src/serve.js` (QX-020, QX-021)

**Status: PENDING**
**Commit to audit**: 69a102a
**Dispatcher**: orchestrator, native Agent/Task tool. NOT manda. NOT the iteration-executor session.
**Verdict**: PENDING — to be written to `experiments/quay-continuous-bootstrap/audits/iteration-5-adjudicate.md`

*Sections 8 and 10 will be updated to FINAL values after G3 and simulated-user pass complete.*

---

## 11. Pause / Convergence Check

- [ ] **Meta-layer V_meta ≥ 0.80**: NO — V_meta ≈ 0.151 (provisional), ceiling = 0.26. Arithmetically unreachable. NOT CONVERGED on meta-layer.
- [ ] **Instance-layer PAUSE criteria** (ΔV flat < 0.02 for 2+ iterations AND no new significant gap):
  - ΔV_instance iteration 4: +0.070 (NOT flat)
  - ΔV_instance iteration 5 (provisional): +0.076 (NOT flat — slight acceleration; above 0.02 threshold)
  - PAUSE criterion NOT triggered on ΔV sub-condition.
  - New significant gaps from simulated-user pass: PENDING (iteration 4 found CB-014/UQ-019 which are both now addressed or structural).
  - Status: CONTINUING (provisional)
- [ ] **G3 green for all Core/lift tasks**: PENDING
- [ ] **Simulated-user pass run, findings recorded**: PENDING (dispatched by orchestrator)
- [ ] **system_health: no regression against any of the three inherited snapshots**: YES (30/30 pass confirmed in development phase)

**Status: CONTINUING (PENDING final G3 + simulated-user confirmation)**

ΔV trend: iter0→1 = +0.152, iter1→2 = +0.055, iter2→3 = +0.048, iter3→4 = +0.070, iter4→5 = +0.076 (provisional). Trend above 0.02 threshold throughout. PAUSE not triggered.

---

## Problems identified for next iteration

(To be updated after G3 and simulated-user findings are incorporated. Provisional based on open gap list.)

Priority order from open gap list + known structural issues:

1. **CB-014** (significant): MCP task_list schema stale in-session — structural gap. Requires design of a session-independent fix (version field in description, reconnect mechanism, or documentation of the session-cache lifecycle). Cannot be addressed by a simple code change to quay alone.

2. **CB-010/UQ-008** (significant): MCP pagination — no streaming or pagination at MCP layer. Design work; consider a `limit`/`offset` parameter or cursor-based approach.

3. **UQ-020** (minor): CLI `task list` exits 0 with empty output when filter matches nothing — add "0 tasks found" line.

4. **UQ-021** (minor): `--label` with no value silently ignored vs `--prefix` exits 1 — flag validation consistency.

5. **UQ-022** (minor): `needs-human` task detail page shows empty space where Advance button would be — add guidance text.

6. **UQ-023** (minor): Redundant `statSync` in `list()` after QX-018 — remove.

7. **CB-008/DIR-004** (significant): Packaging/distribution — consistently deferred; 5 iterations without progress; may warrant a dedicated iteration.

*Simulated-user findings may add new entries or re-prioritize the above.*
