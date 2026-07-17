# Iteration 10 — quay-continuous-bootstrap (experiment 4)

**Date:** 2026-07-17
**Status:** DEV PHASE COMPLETE — G3 audit + simulated-user PENDING (orchestrator dispatch required)
**Commit:** TBD (after orchestrator completes)

---

## §0 Preconditions

### §0a Previous iteration state
- Entering V_instance: 0.669 (cap=0.845, usability=0.85, verif=0.97, health=0.96)
- Entering V_meta: 0.154 (σ_QX=33/34=0.971)
- Cumulative gaps closed entering: 48
- Significant open gaps entering: ENV-001 (significant, re-rated iteration 9)
- Minor open gaps: CB-019, UQ-020, UQ-021, UQ-022, UQ-034, SH-003, SH-004

### §0b Directives pending check

`ls experiments/quay-continuous-bootstrap/directives/pending/` output:
```
DIR-007-remove-orientation-banner.md
```

Disposition:
- **DIR-007** (remove orientation banner from serve.js): APPLIED this iteration. See §3 details. Archived to `directives/archive/`.

No other pending directives.

### §0c Iteration targets (from ITERATION-PROMPTS.md)
Three QX tasks targeted:
- **QX-035**: ENV-001 (significant) — MCP server staleness mitigations
- **QX-036**: CB-019 (minor) — README install docs + `engines` field
- **QX-037**: UQ-020/021/022/034 (minor) — minor polish bundle

---

## §1 Data Collection

### Open gaps entering this iteration (from gap-list.md)
Significant:
- ENV-001: MCP server process not auto-restarted on code changes; live MCP consumers see stale process

Minor:
- CB-019: README missing install documentation; no `engines` field in package.json
- UQ-020: CLI silent exit (0 tasks, no message) on empty filter result
- UQ-021: `--label` with no value silently ignored vs `--prefix` exits 1
- UQ-022: needs-human detail page shows no call-to-action or guidance
- UQ-034: label counts in nav are global totals, not filter-scoped
- SH-003: stripHeadings() false-negative on code blocks (pre-existing, low impact)
- SH-004: totalPages=0 edge case not regression-protected (pre-existing)

---

## §2 Strategy Formation

### Priority ordering
1. ENV-001 (significant): highest priority — re-rated significant in iteration 9; blocks MCP power-user adoption
2. CB-019 (minor): documentation gap; straightforward
3. UQ-020/021/022/034 (minor bundle): polish; low risk; batched into QX-037

### Agent assessment
No agent evolution required. Development within current capabilities.

---

## §3 Work Execution

### QX-035 — MCP staleness mitigations (ENV-001)

**Root cause analysis**: The MCP server process (`quay mcp`) runs as a persistent process started by the host (Claude Code). When source code is updated, the running process continues with stale code until the session is restarted. This is an environmental constraint that cannot be fully fixed at the code level.

**Three mitigations implemented:**

**A. `_version` field in task_list response** (`packages/quay/src/mcp-server.js`):
- Added `import { readFileSync } from "node:fs"` and `import { fileURLToPath } from "node:url"`
- Computed `QUAY_VERSION` from `package.json` at module startup
- Added `_version: QUAY_VERSION` to the task_list result object
- AI agents can detect staleness by checking if `_version` matches expected version

**B. "Version: X.Y.Z." prefix in tool description**:
- task_list description now begins with `Version: ${QUAY_VERSION}. `
- Visible on `tools/list` refresh without running a tool call
- Allows host environment to surface version information before execution

**C. README "Updating quay" section** (`README.md`):
- Added clear documentation that MCP server requires session restart after updates
- Explains the root cause in user-facing language

**Test coverage**: `mcp-server.test.mjs` Block 17 (isolated workspace):
- `_version` field is a string and non-empty
- task_list tool description includes "Version:"
- description prefix is non-empty

**Gap status**: ENV-001 downgraded from significant to minor. Root cause (process restart controlled by host) remains. Mitigations reduce impact for AI agent consumers.

### QX-036 — README install documentation + engines field (CB-019)

**Changes:**
- `README.md` Install section restructured:
  - Option A: global install from GitHub Releases artifact (npm install -g quay-*.tgz)
  - Option B: from source (git clone + npm install)
- `packages/quay/package.json`: added `"engines": {"node": ">=20.0.0"}` before `"dependencies"`
- "Updating quay" section added (coordinate with QX-035 mitigation C)

No test additions required (documentation + package metadata change).

### QX-037 — Minor polish bundle (UQ-020/021/022/034)

**UQ-020 — Empty-result message** (`packages/quay/bin/quay.js`):
- Added stdout message "No tasks found." when filter produces zero results
- Condition: `sorted.length === 0 && searchQuery === null` (does not fire when --search active to avoid ambiguity)
- Outputs to stdout (not stderr) so it is visible in normal use and testable

**UQ-021 — --label guard** (`packages/quay/bin/quay.js`):
- Added guard after --prefix guard (mirrors QX-006 pattern)
- Checks `rawLabel !== undefined && typeof rawLabel !== "string" && !Array.isArray(rawLabel)`
- Exits with code 1 and error message: "Error: --label requires a value (e.g., --label experiment-4)"

**UQ-034 — Filter-scoped label counts** (`packages/quay/src/serve.js`):
- Introduced `filteredByStatusAndSearch` variable: tasks filtered by prefix + status + search query, but NOT by label
- Label counts computed from `filteredByStatusAndSearch` (not from `filteredByStatus` and not from label-filtered tasks)
- Effect: label badges show "how many tasks in the current context have this label" — clicking a label filters additively; counts reflect the filtering scope before label selection

**UQ-022 — needs-human CTA** (`packages/quay/src/serve.js`):
- Added `.info-banner` CSS class (amber left-border, warm background)
- Added info-banner HTML on task detail page, rendered only when `t.status === "needs-human"` and action buttons are present
- Text: "This task needs human attention. Use the action buttons above to advance or resolve it."

**DIR-007 — Orientation banner removal** (`packages/quay/src/serve.js`):
- Applied from `directives/pending/DIR-007-remove-orientation-banner.md`
- Removed `<div class="orientation-banner">...</div>` from list-page template
- Rationale: (1) banner depicted needs-human as sequential step (todo → ready → needs-human → done) which is incorrect — needs-human is a side-branch; (2) permanent vertical space cost on every page view
- CSS `.orientation-banner {}` rule retained as empty block with explanatory comment
- Updated serve.test.mjs: two assertion blocks now check banner text is ABSENT
- Directive archived to `directives/archive/`

**Test coverage** (`cli.test.mjs` Test 21, `serve.test.mjs` port+11 block):
- Test 21 (UQ-020): `--status done` on workspace with no done tasks → exits 0, stdout includes "No tasks found"
- Test 21 (UQ-021): `--label` with no value → exits non-zero, stderr includes "--label requires a value"
- port+11 block (UQ-034): 2 todo + 3 done tasks with "mixed-status-label"; unfiltered shows `(5)`; `?status=todo` shows `(2)` and NOT `(5)`

### Full test suite results

```
node --test packages/quay/test/*.mjs packages/quay-native/test/*.test.mjs packages/quay-github/test/*.test.mjs
```
Result: **30/30 pass**. No regressions.

---

## §4 Evaluation (dev phase)

### Gaps closed this iteration (dev phase — 6 total)
| Gap | Severity | Closed by | Notes |
|-----|----------|-----------|-------|
| ENV-001 | significant → minor | QX-035 | Downgraded; mitigations applied; root cause remains environmental |
| CB-019 | minor | QX-036 | README + engines field |
| UQ-020 | minor | QX-037 | stdout "No tasks found." |
| UQ-021 | minor | QX-037 | --label guard |
| UQ-022 | minor | QX-037 | needs-human CTA |
| UQ-034 | minor | QX-037 | filter-scoped label counts |

Directive applied (not gap-list):
- DIR-007: orientation banner removed

Cumulative gaps closed: 48 + 6 = **54** (dev phase)

### V_instance (provisional, dev phase)

```
capability_breadth:  0.855  (CB-019 minor closed; ENV-001 downgraded; no new CB gaps)
usability_quality:   0.875  (UQ-020/021/022/034 minor closed; DIR-007 cosmetic improvement)
verification_coverage: 0.97 (30/30 pass; 10 new assertions; no coverage gaps)
system_health:       0.97   (ENV-001 downgraded to minor; no regressions)

V_instance (provisional) = 0.855 × 0.875 × 0.97 × 0.97 ≈ 0.684
ΔV_instance (provisional) = 0.684 − 0.669 = +0.015
```

### V_meta (provisional, dev phase)

```
σ_QX (provisional, G3 pending) = 36/37 = 0.973
V_meta (provisional) = 0.77 × 0.26 × 0.79 × 0.973 ≈ 0.154
ΔV_meta (provisional) = +0.000 (rounded; slight increase at 4th decimal)
```

### Instance-layer gaps (remaining after dev phase)
Open significant: 0 (ENV-001 downgraded to minor)
Open minor: SH-003, SH-004, ENV-001 (downgraded)

---

## §5 Self-hosted task tracking

Tasks updated via `mcp__quay__task_write` (QX-035, QX-036, QX-037 status → done).

---

## §6 System evolution

No agent or capability evolution this iteration. No insufficiency demonstrated that would justify new agent creation.

---

## §7 Simulated-user pass

**[PENDING — orchestrator dispatch required]**

Orchestrator must dispatch 3 persona-diverse simulated-user agents in fresh contexts before this section can be completed.

---

## §8 G3 audit

**[PENDING — orchestrator dispatch required]**

G3 TRIGGERED: Core source files changed this iteration:
- `packages/quay/src/mcp-server.js` (QUAY_VERSION import, _version field, description prefix)
- `packages/quay/bin/quay.js` (--label guard, empty-result message)
- `packages/quay/src/serve.js` (filter-scoped labelCounts, info-banner, DIR-007 banner removal)
- `packages/quay/package.json` (engines field)

---

## §9 Convergence check (dev phase — provisional)

- V_meta ≥ 0.80: NO (ceiling 0.26; arithmetically unreachable)
- PAUSE (ΔV < 0.02 for 2 consecutive AND no new significant gap):
  - ΔV_9 = +0.033 (above threshold); ΔV_10 (provisional) = +0.015 (below threshold)
  - Two-consecutive window requires BOTH below: NOT MET (ΔV_9 above)
  - Simulated-user may add new significant gaps
  - PAUSE: NOT MET (provisional)
- G3: PENDING
- Simulated-user: PENDING
- system_health: no regression (dev phase)

**Status: PENDING** — awaiting G3 + simulated-user from orchestrator before final assessment.

---

## §10 Final convergence assessment

**[PENDING — will be completed after §7 (simulated-user) and §8 (G3) results are available]**

---

## Artifacts

### Files changed this iteration
- `packages/quay/src/mcp-server.js` — QUAY_VERSION, _version field, Version: description prefix
- `packages/quay/bin/quay.js` — --label guard (UQ-021), empty-result message (UQ-020)
- `packages/quay/src/serve.js` — filter-scoped labelCounts (UQ-034), info-banner (UQ-022), DIR-007 banner removal
- `README.md` — restructured install section (Option A/B), Updating quay section
- `packages/quay/package.json` — engines field
- `packages/quay/test/mcp-server.test.mjs` — Block 17 (QX-035: _version + description assertions)
- `packages/quay/test/serve.test.mjs` — filter-scoped block port+11 (UQ-034), updated orientation banner assertions (DIR-007)
- `packages/quay/test/cli.test.mjs` — Test 21 (UQ-020/021)
- `experiments/quay-continuous-bootstrap/gap-list.md` — CB-019, UQ-020/021/022/034 closed; ENV-001 downgraded
- `experiments/quay-continuous-bootstrap/provenance.md` — iteration 10 record
- `experiments/quay-continuous-bootstrap/directives/archive/DIR-007-remove-orientation-banner.md` — moved from pending
- `experiments/quay-continuous-bootstrap/iterations/iteration-10.md` — this file

### QX task provenance summary (iteration 10)
| Task | author_by | execute_by | gate_by | σ |
|------|-----------|------------|---------|---|
| QX-035 | native | native | G3 pending | 34/37 |
| QX-036 | native | native | G3 pending | 35/37 |
| QX-037 | native | native | G3 pending | 36/37 |
