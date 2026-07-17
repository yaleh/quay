# Iteration 2: List-page actions (CB-003), sort-by-updated (CB-004/005/012), MCP schema test (CB-011)

**Date**: 2026-07-17
**Driver**: native (QX-008, QX-009, QX-010 all driven through quay:author + quay:execute natively)
**Dimensions advanced**: capability_breadth (CB-003, CB-004, CB-005, CB-011, CB-012 closed), verification_coverage (3 new test blocks added)
**V_meta triggers checked**: all 5 — none fired (see §9)
**Worktree**: `experiments/quay-continuous-bootstrap/worktrees/iteration-2` on branch `experiment-4-iteration-2` — created via `git worktree add`. ENV limitation: Tool writes (Read/Write/Edit) still target main tree absolute paths, as documented in iterations 0 and 1. Worktree created for protocol compliance; deviation noted.
**Gap-list delta**: 0 new gaps found (development phase only; simulated-user pending); 5 gaps closed (CB-003, CB-004, CB-005, CB-011, CB-012); cumulative gaps-closed counter now at 14

---

## 1. Context from prior iteration

**σ_QX before**: 6/7 = 0.857 (QX-001 seed; QX-002..QX-007 native)

**V scores before** (iteration 1 final):
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.62 × 0.68 × 0.95 × 0.97 = 0.388

ΔV_instance (iteration 1): +0.152 (from 0.236)
```
ΔV basis: iteration 1 had significant positive movement (+0.152). PAUSE criterion requires 2+ consecutive flat iterations — not yet applicable (need iteration 2 data first).

**Problems inherited from iteration 1** (in priority order):
1. CB-003 (significant × 2 personas): Action buttons ("Advance") absent from Web UI list page — second-highest cross-persona gap
2. CB-011 (significant, MCP): Registered MCP `task_list` schema in Claude Code does not expose `prefix` parameter — stale snapshot
3. CB-012 (significant, CLI): `--sort updated` silently ignored — no error, no implementation
4. CB-004/CB-005 (significant × 2 personas): Sort-by-time not available on CLI or Web UI
5. UQ-009 (minor): Back link from task detail loses filter/prefix context
6. UQ-006 (minor): Label filter wall (40+ items) — worst on mobile

**Gap list at iteration start**: 16 open gaps (9 CB, 7 UQ, 0 VC, 0 SH).

---

## 2. Preconditions checked

**G6 (manda daemon)**:
- `.manda/hub.addr` read: `http://localhost:46215` (read live, NOT hardcoded)
- `curl -s http://localhost:46215/healthz` → `{"root":"/home/yale/work/quay"}` ✓
- Monitor process check: monitors confirmed running in orchestrator sessions (same topology as prior iterations)

**G7 (web service)**:
- `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}"` → `200` ✓ (at iteration start; restarted after code changes)

**Worktree (DIR-006 standing guardrail)**:
- Created: `git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-2 -b experiment-4-iteration-2`
- Result: SUCCESS
- ENV deviation documented: tool writes still target main tree (same as iterations 0 and 1)

**provenance.md read**: ✓
**gap-list.md read**: ✓ (16 open gaps confirmed)
**directives/pending/ listed**: DIR-004 remains pending (in scope, not yet prioritized)

**V_meta re-trigger check**: all 5 checked — none fired (see §9)

**PAUSE check inputs**:
- ΔV_instance iteration 1: +0.152 (significantly positive — PAUSE criterion cannot be met this iteration since it requires 2+ consecutive flat iterations)
- Iteration 2 is the first opportunity to begin the flat-ΔV window; even if flat, PAUSE would require one more iteration at flat ΔV before recommendation applies

**verification_coverage spot-check**: Full test suite (30/30) passed at iteration start. All prior QX-* capabilities (prefix filter, CLI help, crash guard, help stubs) remain tested.

**system_health regression check**: 30/30 tests pass; Web UI 200; all three inherited snapshots confirmed intact before implementation.

---

## 3. Observe

**Current gap-list state at iteration start** (16 open gaps):

| Dimension | Severity | Count | Highest-priority entries |
|-----------|----------|-------|--------------------------|
| capability_breadth | significant | 7 | CB-003 (list actions), CB-004/005 (sort-by-time), CB-007 (search), CB-008 (packaging), CB-010 (MCP response size), CB-011 (MCP schema), CB-012 (--sort updated silently ignored) |
| capability_breadth | minor | 2 | CB-006 (page size) |
| usability_quality | significant | 1 | UQ-008 (MCP task_list response size) |
| usability_quality | minor | 6 | UQ-003..UQ-009 |

Note: CB-008 is significant (packaging/distribution gap, no single-file executables); CB-010 and UQ-008 overlap (both track MCP response size from different angles — capability and usability respectively).

**V_meta re-trigger check results** (all 5 checked at OBSERVE time):
1. effectiveness: NOT TRIGGERED — no completed scope-matched single-file, no-network task yet
2. reusability: NOT TRIGGERED — no organic GitHub write demand
3. completeness: NOT TRIGGERED — no new Skill Method-step gap found; ENV gap continues
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch
5. open-ended-domain-specific: OBSERVATIONAL — with prefix filter now available via QX-003, MCP self-hosted tracking is practical. Will observe timing on MCP usage this iteration.

**Highest-value cluster chosen**: CB-003 (list-page action buttons), CB-004/CB-005 (sort by time), CB-011 (MCP schema stale), CB-012 (--sort updated silently ignored). Rationale:
- CB-003, CB-004, CB-005 are significant capability gaps found by 2 personas in iteration 1 — highest cross-persona evidence after prefix filtering (now done)
- CB-012 is a quick fix required to make sort-by-time well-behaved rather than silently wrong
- CB-011 (MCP schema stale for `prefix` parameter) is a significant UX gap for MCP-native workflows and is the easiest to verify/test (no source change required — server code already correct since QX-003)
- Together these form a coherent cluster: sort + actions + MCP schema correctness

**PAUSE-check inputs**:
- Iteration 1 ΔV = +0.152 (NOT flat) — PAUSE criterion requires flat ΔV, not applicable
- Iteration 2 is only the first opportunity to START a flat-ΔV window; even if ΔV is flat here, one more flat iteration is needed before recommendation
- Simulated-user finding from iteration 1 found CB-011 (significant) and CB-012 (significant) — both being addressed this iteration, so even if ΔV were flat this iteration, the "no new significant gap" condition would not have been met in iteration 1 (5 significant gaps existed)

---

## 4. Strategy

**Chosen work**: 3 QX-* tasks authored and executed natively:
- QX-008: Sort by updated (CB-004, CB-005, CB-012) — store.js updatedAt via mtime, CLI `--sort updated`, Web UI `?sort=updated` + "Updated ↓" nav
- QX-009: List-page action buttons (CB-003) — inline forms per row, `?from=` redirect preserves list context
- QX-010: MCP schema test (CB-011) — Block 13 in mcp-server.test.mjs verifying `prefix` in `task_list` inputSchema + `updatedAt` in response

**Write-surface boundary check (§Core-scope constraints item 6)**:
- QX-008: New write surface evaluation — `updatedAt` added as read-only field on task view-model from `list()`. Not a write surface; it is metadata on a read path. AUTHORIZED: reads file mtime, not user-supplied data. No new write endpoint.
- QX-009: New write surface evaluation — list-page action buttons POST to the EXISTING `/task/<id>/action/<actionId>` route. No new route. Inline form with `?from=` redirect is a purely UX change to the action routing. The action endpoint itself is unchanged. AUTHORIZED: no new write surface introduced; existing POST handler extended with `?from=` redirect logic only.
- QX-010: No source change to Core. Test-only. N/A.

**Packaging/distribution scope (§Core-scope constraints item 7)**: Not addressed this iteration. DIR-004 remains pending. Sort + actions are higher priority per cross-persona iteration 1 findings.

**V_meta re-trigger assessment**: QX-008 and QX-009 touch multiple Core files (store.js + quay.js + serve.js + 3 test files). QX-010 is test-only. None of the three organically bear on any V_meta re-trigger condition. Noted explicitly.

**G3 trigger**: YES — Core source files changed: `packages/quay-native/src/store.js`, `packages/quay/bin/quay.js`, `packages/quay/src/serve.js`. G3 dispatched by orchestrator (NOT by this executor session). Never via manda. See §10.

---

## 5. Execution

### Self-hosted task tracking

Tasks created via `mcp__quay__task_write` BEFORE implementation (per protocol §5.1 dogfooding requirement):
- QX-008 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 7 ACs checked; advanced to done via gate check
- QX-009 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 6 ACs checked; advanced to done via gate check
- QX-010 (status: todo → done): Created with full Proposal/Plan/AC/DoD body; all 4 ACs checked; advanced to done via gate check

All three tasks created via `mcp__quay__task_write` with complete structured bodies. Tasks queried via `mcp__quay__task_list` (with `prefix="QX"`) and `mcp__quay__task_get`; gate checks performed via `mcp__quay__task_check`. Self-hosted tracking confirmed end-to-end for all three.

### Implementation — files changed (commit 44fa2a7)

**`packages/quay-native/src/store.js`** (QX-008):
- `list()` now calls `fs.statSync(filePathFor(id)).mtimeMs` per task and sets `t.updatedAt = mtime`; wrapped in try/catch (race: file deleted after listIds)
- `toViewModel(frontmatter, body, updatedAt)` updated to accept optional `updatedAt` parameter and sets `vm.updatedAt = updatedAt` when provided
- Comment added before `get()`: "get() does not include updatedAt — it is used for point lookups (task view, gate checks, action triggers, childrenStatus) where mtime is irrelevant."
- Design rationale: task front-matter has no timestamp fields; `fs.statSync().mtimeMs` on the underlying file provides a practical proxy for last-modified time. This flows through MCP interface automatically since MCP `task_list` uses the same `store.list()` call.

**`packages/quay/bin/quay.js`** (QX-008):
- Help text updated: `--sort id|status|updated` with description `Sort by id, status, or last-updated time`
- Sort logic replaced with unified handler for `id`, `status`, and new `updated`:
  - `updated`: `slice().sort((a, b) => (tb - ta))` descending by `updatedAt` mtime (most-recent first); null-safe (`-Infinity` for missing updatedAt)
  - `id`: lexicographic ascending (unchanged)
  - `status`: lexicographic by status then id (unchanged)
  - default: insertion order (unchanged)
- CB-012 resolution: `--sort updated` no longer silently falls through to default order; it is fully implemented

**`packages/quay/src/serve.js`** (QX-008 + QX-009):
- QX-008 additions:
  - `else if (sortKey === "updated")` sort branch (same tb-ta descending logic as CLI)
  - "Updated ↓" link added to sort nav: renders as `<strong>Updated ↓</strong>` when active, otherwise as a `<a href="...">` link
  - `currentListHref = buildHref(statusFilter, sortKey, labelFilter, safePage > 1 ? safePage : null, prefixFilter)` computed before row rendering (preserves all current filters for redirect target)
- QX-009 additions:
  - Table header updated: `<tr><th>id</th><th>status</th><th>role</th><th>title</th><th>labels</th><th>actions</th></tr>`
  - `applicableButtons` computed per task via `(manifest.action_buttons ?? []).filter(b => !b.whenStatus || b.whenStatus.includes(t.status))`
  - Inline action forms rendered per task row: `<form method="post" action="/task/.../action/...?from=<encoded-list-href>" style="display:inline"><button type="submit">...</button></form>`
  - Action POST handler updated: reads `url.searchParams.get("from")`; redirects to `fromParam` if it starts with `/` (security: prevents open redirect to external URLs); otherwise falls back to `/task/<id>`
- "Core stays dumb" constraint satisfied: action composition uses `manifest.action_buttons` (provider-agnostic); no backend-specific conditional rendering

**`packages/quay/test/cli.test.mjs`** (QX-008):
- Test 17: Creates isolated workspace with SORT-A, SORT-B, SORT-C tasks with 50ms waits between creates; asserts `--sort updated --json` returns SORT-C first / SORT-A last (most-recently-updated first); asserts `updatedAt` is positive number on every task

**`packages/quay/test/serve.test.mjs`** (QX-008 + QX-009):
- QX-008 block (port+2): Creates SRT-A, SRT-B, SRT-C with 50ms gaps; asserts `?sort=updated` HTML shows SRT-C before SRT-A; asserts "Updated" text in nav
- QX-009 block (port+3): Creates SRV2-1 (todo), SRV2-2 (done); asserts list page contains "Advance" button text; asserts "actions" in column header; asserts POST to `/task/SRV2-1/action/advance?from=/` redirects to `/`; asserts POST without `from=` redirects to `/task/SRV2-1`

**`packages/quay/test/mcp-server.test.mjs`** (QX-010):
- Block 13: Connects via `connectStdio()` helper; calls `coreSchema.listTools()`; asserts 6 tools present; asserts `task_list` inputSchema.properties includes `prefix` as string type; asserts `status`, `label`, `provider` also present; calls `task_list` and asserts response includes `updatedAt` as positive number

### CB-011 analysis and resolution

CB-011 ("MCP task_list registered schema in Claude Code does not include `prefix` parameter") was analyzed during this iteration. The MCP server code (`packages/quay/src/mcp-server.js`) already had `prefix` in `task_list` inputSchema since QX-003 (iteration 1). Verified via direct JSON-RPC stdio probe: `prefix` was present in `properties` in the wire response. The stale schema in the iteration-1 simulated-user session was a session-cache issue — new sessions get the current schema. Resolution: QX-010 adds Block 13 to `mcp-server.test.mjs` to permanently verify `prefix` is in the inputSchema (test-only change, no source change required). The stale-session issue in iteration 1 is resolved by starting a new session.

### Test results

Full suite before implementation: 30/30 pass.
Full suite after all changes (commit 44fa2a7): 30/30 pass.
- Test 17 (CLI sort-by-updated): PASS — SORT-C confirmed first, SORT-A confirmed last; all `updatedAt` values are positive numbers
- QX-008 serve block: PASS — SRT-C appears before SRT-A; "Updated" in nav
- QX-009 serve block: PASS — "Advance" button in list; "actions" column; `?from=/` redirect works; no-from fallback works
- Block 13 (MCP schema + updatedAt): PASS — 6 tools present; `prefix`, `status`, `label`, `provider` all in task_list inputSchema; `updatedAt` positive number in response

### Gate checks

- QX-008: `task check` → `ok: true` (7/7 AC checked); status advanced to `done`; G3 co-sign pending
- QX-009: `task check` → `ok: true` (6/6 AC checked); status advanced to `done`; G3 co-sign pending
- QX-010: `task check` → `ok: true` (4/4 AC checked); status advanced to `done`; tests pass (30/30); no G3 required (no Core source change per DoD)

### Live verification

Quay serve restarted after code changes. Verified live:
- `GET http://localhost:4173/` — page loads 200; "Updated ↓" link visible in sort nav
- `GET http://localhost:4173/?sort=updated` — tasks appear in descending mtime order; "Updated ↓" shown in bold (active)
- Action buttons ("Advance") visible on list rows for todo tasks; absent for done tasks (correct per `whenStatus` filter)
- POST action from list page with `?from=/` redirects back to `/` (list preserved)

---

## 6. Provenance update

| Task | Iteration | author_by | execute_by | gate_by | σ contribution | Notes |
|------|-----------|-----------|------------|---------|----------------|-------|
| QX-001 | 0 | seed | N/A | N/A | 0/10 | Unchanged |
| QX-002 | 1 | native | native | G3 PASS WITH NOTES | 1/10 | CLI prefix filter |
| QX-003 | 1 | native | native | G3 PASS WITH NOTES | 2/10 | MCP prefix filter |
| QX-004 | 1 | native | native | G3 PASS WITH NOTES | 3/10 | Web UI prefix filter |
| QX-005 | 1 | native | native | G3 PASS WITH NOTES | 4/10 | CLI help |
| QX-006 | 1 | native | native | tests pass (30/30) | 5/10 | --prefix crash fix |
| QX-007 | 1 | native | native | tests pass (30/30) | 6/10 | serve/action --help fix |
| QX-008 | 2 | native | native | G3 pending | 7/10 | Sort by updated (CB-004/005/012): store.js updatedAt, CLI, Web UI |
| QX-009 | 2 | native | native | G3 pending | 8/10 | List-page action buttons (CB-003): inline forms, ?from= redirect |
| QX-010 | 2 | native | native | tests pass (30/30) | 9/10 | MCP schema test (CB-011): Block 13 in mcp-server.test.mjs |

σ_QX before iteration 2: 6/7 = 0.857
σ_QX after iteration 2 (development phase, G3 pending): 9/10 = 0.900
(QX-001 seed; QX-002..QX-010 native. QX-008/QX-009 gate_by "G3 pending" — awaiting orchestrator dispatch. QX-010 gate_by "tests pass" — no G3 required.)

---

## 7. Simulated-user pass (§0c — every iteration)

**Status**: PENDING — dispatched by orchestrator after development phase completes (commit 44fa2a7). This section will be updated with findings from the 3 simulated-user agents once their reports are available.

**Personas to dispatch** (chosen for deliberate angle diversity, different from iteration 1's set):
- **Mobile-only single-task user**: Does one concrete task start-to-finish on a mobile viewport only — tests the new list-page action buttons and sort at 375px width, a surface not thoroughly verified in iteration 1
- **Cross-experiment maintainer** (continued from iteration 1): Re-tests CLI and MCP after sort-by-updated implementation; verifies `?sort=updated` flow; re-checks `task_list` schema in a fresh session (CB-011 resolution verification)
- **New-contributor-with-no-context reviewer**: Re-tests onboarding after list-page action buttons are visible; UQ-003 (no orientation content) and UQ-005 (no visual age indicator) are good new-contributor friction points

**Expected findings**: UQ-003 (no onboarding header), UQ-004 (no timestamp column in CLI list), UQ-005 (no visual age "updated X ago"), UQ-006 (40+ label filter items), UQ-007 (table overflow on mobile), UQ-009 (back link loses filter context) all remain open and are likely to be re-confirmed. New findings possible from mobile-only persona on action buttons at 375px.

---

## 8. V_instance

**Note**: This is a DRAFT calculation reflecting the development phase only. §7 (simulated-user pass) is pending. Final scores will be updated once simulated-user findings are incorporated.

**Gap-list state after development phase**: 11 open gaps (4 CB, 7 UQ, 0 VC, 0 SH); 14 gaps closed all-time (CB-001..005, CB-009, CB-011, CB-012, UQ-001, UQ-002, UQ-010, VC-001, SH-001).

**capability_breadth (DRAFT)**:
Score: ≈ 0.74
Reasoning: CB-003, CB-004, CB-005, CB-011, CB-012 all closed this iteration (5 gaps). Remaining open: CB-006 (minor, page size), CB-007 (significant, no search), CB-008 (significant, no packaging), CB-010 (significant, MCP response size, partial). Iteration 1 scored 0.62 with 9 CB gaps open from 12 known. After iteration 2: 4 CB gaps open from 17 ever-known (9 originally + CB-011, CB-012 added iteration 1 = now closed). Weighted by severity: 2 significant CB gaps remain (CB-007, CB-008, CB-010); CB-006 minor. Score rise from 0.62 reflects 5 closed gaps, tempered by CB-007/CB-008/CB-010 being non-trivial remaining work.
ΔV from iteration 1: ≈ +0.12 (from 0.62)
Evidence: Commit 44fa2a7; test 17 (CLI sort); QX-008 serve block; QX-009 serve block; all pass 30/30.

**usability_quality (DRAFT)**:
Score: ≈ 0.69
Reasoning: No UQ gaps were explicitly closed this iteration. However, CB-003 (action buttons on list page) reduces round-trip friction that was classified primarily as capability_breadth; this has a marginal usability improvement. UQ-003/004/005/006/007/008/009 all remain open. Simulated-user pass pending — verdicts may adjust this score. Score held at ≈ 0.69 (marginal +0.01 improvement from CB-003 reducing workflow friction, pending simulated-user confirmation).
ΔV from iteration 1: ≈ +0.01 (from 0.68)
Evidence: List-page action buttons verified live; reduce detail-page round-trips for standard advance workflow.

**verification_coverage (DRAFT)**:
Score: ≈ 0.97
Reasoning: 3 new test blocks added (CLI test 17, serve QX-008 block, serve QX-009 block, MCP Block 13). All capabilities delivered in this iteration have accompanying automated tests. 30/30 pass. No regression. Small deduction maintained for: no Lighthouse re-run this iteration.
ΔV from iteration 1: ≈ +0.02 (from 0.95)
Evidence: 30/30 test suites pass; test 17, QX-008 serve block, QX-009 serve block, Block 13 all pass.

**system_health (DRAFT)**:
Score: ≈ 0.99
Reasoning: No regressions against any of the three inherited snapshots. 30/30 suites pass before and after all changes. Live Web UI returns 200. No crash-level issues introduced (unlike QX-002's side-effect in iteration 1). G3 pending.
ΔV from iteration 1: ≈ +0.02 (from 0.97)
Evidence: Full test suite pass; live Web UI 200; all inherited test files green.

### DRAFT V_instance calculation:

```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           ≈ 0.74 × 0.69 × 0.97 × 0.99
           ≈ 0.490   (DRAFT — subject to simulated-user and G3 revision)

ΔV_instance ≈ +0.102 over iteration 1 final (0.388)
```

**Cumulative gaps closed (monotonic counter)**: 14 (all-time)

---

## 9. V_meta

**completeness**: 0.77
Re-trigger check: NOT TRIGGERED — no new Skill Method-step gap found. ENV gap (no unconditional native dispatch) continues. No change from iteration 1.

**effectiveness**: 0.26
Re-trigger check: NOT TRIGGERED — QX-008, QX-009, QX-010 each touched multiple files (store.js + quay.js + serve.js + 3 test files for QX-008/QX-009; mcp-server.test.mjs for QX-010). None qualifies as scope-matched to QN-006's single-file, no-network-I/O shape. QX-010 is test-only (no source change), but "test-only" is not the same as "single-file source change" in QN-006's framing — QX-010's value was discovering/verifying schema correctness, not a new capability implementation.
Self-hosted-tracking hypothesis update: with `task_list --prefix=QX` practical since iteration 1, MCP-native dogfooding is now routine. Timing evidence collected this iteration: `task_list` with prefix="QX" returns 10 tasks, well within context limits. Qualitative improvement in dogfooding experience is real, but not yet a re-trigger without a scope-matched single-task timing measurement.

**reusability**: 0.79
Re-trigger check: NOT TRIGGERED — no organic demand for GitHub Provider data.write or new ABI extension observed.

**validation**: 0.900 (σ_QX = 9/10)
σ_QX: QX-001 seed; QX-002..QX-010 all native (author_by=native, execute_by=native). QX-008 and QX-009 gate_by = "G3 pending" — counted as native for σ purposes (gate is confirmed by tests; G3 co-sign is additional quality gate, not provenance gate). QX-010 gate_by = "tests pass (30/30)". 9/10 = 0.900.
Movement: validation went from 0.857 (iteration 1, σ=6/7) to 0.900 (iteration 2 development phase, σ=9/10).

**V_meta total**:
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.900
       = 0.143   (DRAFT)

ΔV_meta from iteration 1 final: +0.007 (from 0.136)
```

**V_meta ceiling**: 0.26 (effectiveness frozen; V_meta ≥ 0.80 arithmetically unreachable — standing fact restated)

**Stall diagnosis**: Unchanged from inherited — effectiveness frozen at 0.26 (largest structural blocker); completeness blocked by ENV gap; reusability blocked by no organic write demand. Validation factor continues upward (0.778 → 0.857 → 0.900). V_meta ceiling remains 0.26. No change to stall structure from prior iterations.

---

## 10. Out-of-band audit (G3)

**G3 IS TRIGGERED this iteration** — Core source files changed:
- `packages/quay-native/src/store.js` (QX-008: updatedAt field added to list() path)
- `packages/quay/bin/quay.js` (QX-008: --sort updated implementation)
- `packages/quay/src/serve.js` (QX-008: ?sort=updated; QX-009: list-page action buttons + ?from= redirect)

**Commit to audit**: 44fa2a7

**Status**: PENDING — orchestrator dispatches G3 audit agent after development phase completes. This section will be updated with the G3 verdict once available.

**Dispatcher**: orchestrator, using native Agent/Task tool, NOT manda, NOT this executor session. Absolute rule maintained per DIR-002/DIR-005 correction history.

**G3 audit file** (to be created): `experiments/quay-continuous-bootstrap/audits/iteration-2-adjudicate.md`

**Expected scope**: Verify (a) `updatedAt` field flows correctly from store.js through CLI and MCP interfaces; (b) `?sort=updated` sort is stable and correct; (c) list-page action forms POST to correct endpoint; (d) `?from=` redirect security guard (`startsWith("/")`) is in place; (e) no regressions; (f) 30/30 suites still pass.

---

## 11. Pause / Convergence Check

- [x] **Meta-layer V_meta ≥ 0.80**: NO — V_meta ≈ 0.143 (up from 0.136), ceiling = 0.26. Arithmetically unreachable. NOT CONVERGED on meta-layer.
- [x] **Instance-layer PAUSE criteria** (ΔV flat < 0.02 for 2+ iterations AND no new significant gap):
  - ΔV_instance ≈ +0.102 (DRAFT) — NOT flat. PAUSE criterion does NOT apply.
  - Additionally: PAUSE criterion requires 2+ consecutive flat iterations; this is only iteration 2 (first data point with a ΔV to compare against). Cannot be evaluated for consecutive flatness yet.
  - Status: NOT PAUSED (correct — significant positive ΔV this iteration)
- [x] **G3 green for all Core/lift tasks**: PENDING — G3 dispatched by orchestrator; verdict expected in `audits/iteration-2-adjudicate.md`. (QX-010 has no G3 requirement per DoD — test-only change.)
- [x] **Simulated-user pass run, findings recorded**: PENDING — dispatched by orchestrator after development phase. Section §7 has placeholder; will be updated with findings.
- [x] **system_health: no regression against any of three inherited snapshots**: YES ✓ (development phase) — 30/30 suites pass; Web UI 200; all inherited test files green. Final confirmation pending G3.

**Status: CONTINUING** (development phase)

Rationale: ΔV_instance ≈ +0.102 (significant positive movement; DRAFT). V_meta ceiling unchanged. 5 significant capability_breadth gaps closed. G3 and simulated-user pass pending — both may adjust the final scores and introduce new gaps. No convergence criterion met.

---

## Problems identified for next iteration

1. **UQ-009** (minor): Back link from task detail page drops filter/prefix context — returns to unfiltered `/` after drilling into a task. Fix: capture current list URL and pass it to task detail as a `?back=` parameter.

2. **CB-007** (significant, comparison reviewer): Full-text/title search still missing from CLI and Web UI. Higher implementation cost. Consistently found by comparison reviewer persona.

3. **CB-008/DIR-004** (significant): No packaging/distribution — users must install Node.js ≥20 separately; no single-file executables. Now the longest-open significant gap without progress.

4. **CB-010 / UQ-008** (significant, persistent): MCP `task_list` unfiltered response still large (~550K chars for 94 tasks). Prefix filter helps when used; unfiltered scalability persists. Consider pagination or summary-only mode at MCP layer.

5. **UQ-003** (minor): No onboarding/orientation content in Web UI — first-time users have no "what is this" header or status lifecycle explanation. Low-cost usability improvement.

6. **UQ-004** (minor): No timestamp column in CLI list output — users cannot identify most-recently-updated task from CLI list at a glance (only available via `--sort updated` ordering, not visible as a column value).

7. **UQ-005** (minor): No visual age indicator on Web UI list rows ("updated X ago"). Now that `updatedAt` is available in task view-models from `list()`, this is lower-cost to implement than before iteration 2.

8. **UQ-006** (minor): Label filter on Web UI is a flat 40+ item inline list — unwieldy on mobile. Consider grouped or collapsible label picker.

9. **Simulated-user findings** (pending §7 completion): May surface new gaps from mobile-only action button test, CB-011 resolution verification in fresh session, and UQ-003/005 new-contributor friction. Update gap-list.md after §7 is complete.

10. **G3 verification** (pending §10 completion): If G3 finds issues requiring fixes, those will be filed as new tasks before finalizing this iteration's scores.
