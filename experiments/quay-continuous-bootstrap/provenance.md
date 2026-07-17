# Experiment 4 (quay-continuous-bootstrap) — provenance ledger

This ledger tracks `QX-*` task provenance ({author_by, execute_by, gate_by}) and the
per-iteration V_instance/V_meta history, per the mechanics inherited unchanged from
`experiments/quay-native-bootstrap/directives/README.md` and continued through
experiments 2 and 3.

---

## Inheritance record (2026-07-17, written at scaffold time, before iteration 0)

Experiment 3 (`quay-webui-bootstrap`) HALTed at iteration 5 (2026-07-17), practical
convergence accepted, NOT formally CONVERGED — same structural outcome as experiments 1
and 2. Extraction complete: `.claude/skills/quay-webui-bootstrap-methodology/`.

**Final experiment-3 snapshot** (source: `experiments/quay-webui-bootstrap/HALT-RECOMMENDATION.md`
and `iterations/iteration-5.md`):

```
V_instance = ui_read_capability × visual_design_quality × verified_by_construction × backlog_health
           = 1.0 × 1.0 × 1.0 × 1.0 = 1.0
             (all 10 "Done when" bullets satisfied; Lighthouse 100/100 all 4 modes;
              holistic visual review PASS all pages; 30/30 test suites pass; no regression)

V_meta     = completeness × effectiveness × reusability × validation
           = 0.77 × 0.26 × 0.79 × 0.778 = 0.123
             (unchanged in ceiling terms — effectiveness frozen at 0.26 since experiment 1
              iteration 23, now confirmed by POSITIVE measurement across experiments 2 and 3,
              not merely absence of disconfirming data)

V_meta ceiling = 0.26 (criterion "V_meta >= 0.80" arithmetically unreachable without a
             genuine, non-manufactured re-trigger of `effectiveness` — not this experiment's
             problem to force, per G2)

sigma_QW final = 7/9 = 0.778 (QW-003..QW-009 all-native; QW-001/QW-002 seed-authored,
             floor reset to 0 at experiment 3's own iteration 0)
```

**This experiment (4) inherits V_meta unchanged in value** from the snapshot above — NOT
reset to zero, NOT re-derived from experiment 1's or 2's values. `V_meta_ceiling = 0.26`
remains a standing fact until a genuine re-trigger is found (G2: do not manufacture one).

**sigma_QX starts at 0/0** (no QX-* tasks exist yet — iteration 0 has not run). Whether/how
experiment 3's final sigma_QW = 0.778 is tracked as an inherited floor (vs. reset to 0) is
an explicit decision iteration 0 must make and record here, the same discipline experiment 3
applied to its own sigma-vs-inherited-floor decision at its iteration 0.

**backlog_health / system_health baseline** (no regression permitted against ANY of):
- Experiment 1's final snapshot — `experiments/quay-native-bootstrap/CLOSING-REPORT.md`
  (V_instance = skeleton x abi_symmetry x gate_correctness x skill_convergence
  = 0.85 x 0.97 x 0.76 x 0.96 = 0.6016 at halt, iteration 88).
- Experiment 2's iteration-10 stopping values — core_abi_symmetry=1.0,
  web_ui_verification=1.0, action_delivery_mode=1.0, native_backlog_health=1.0.
- Experiment 3's final snapshot — ui_read_capability=1.0, visual_design_quality=1.0,
  verified_by_construction=1.0, backlog_health=1.0.

**Directives carried forward from experiment 3** (per DIR-007 requested action #4 — see
`experiments/quay-webui-bootstrap/directives/pending/DIR-007-close-experiment-3-hand-off-to-experiment-4-continuous-improvement.md`):
- `DIR-004` (Node SEA / Bun compile release artifacts + GitHub Actions build/publish) —
  deferred under experiment 3 as out-of-scope (Web-UI-only objective); now in scope under
  experiment 4's whole-project objective. Must be re-filed into
  `experiments/quay-continuous-bootstrap/directives/pending/` at iteration 0.
- `DIR-006` (git worktree isolation for iteration execution) — filed but not applied under
  experiment 3. Adopted directly as a standing guardrail from iteration 0 in experiment 4's
  protocol (`docs/proposals/quay-continuous-bootstrap-experiment-v4.md` §8) rather than
  re-filed as pending — record this explicitly at iteration 0 rather than silently treating
  it as "still open."

**Open design questions left for iteration 0** (see protocol §9 for full list; restated
briefly here so this ledger is self-contained):
1. Gap-list storage mechanism: plain `gap-list.md` vs. `QX-*` tasks with a `gap` label —
   iteration 0 must choose and record the choice + reasoning here.
2. Per-gap weighting scheme within a dimension when gaps vary widely in kind/size.
3. Whether `system_health`'s regression check cites experiments 1/2/3's original V-factor
   names directly (assumed default) or QX-*-scoped naming.
4. Whether the inherited "ΔV < 0.02 for 2 consecutive iterations" PAUSE threshold is
   well-calibrated for the open-ended shape — flagged for recalibration from real evidence.
5. Whether provenance mechanics ({author_by, execute_by, gate_by}) need adjustment now that
   `task_write` calls are made THROUGH the MCP tool being dogfooded, rather than assumed
   unchanged.

A first iteration that re-derives V_meta from zero, or from experiment 1's or 2's values
instead of experiment 3's, is a scoring error — see protocol §6.

---

## Iteration 0 record (2026-07-17)

### V_meta inheritance reconciliation
**RECONCILED AGAINST AUTHORITATIVE SOURCE**: `experiments/quay-webui-bootstrap/HALT-RECOMMENDATION.md`
exists and was read in full. Its final recorded values are:
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.778 = 0.123
```
These match the provisional 0.123 in ITERATION-PROMPTS.md. No discrepancy found.
**The 0.123 figure is CONFIRMED, not provisional.** The HALT-RECOMMENDATION.md records this
as the final experiment-3 value (not merely a mid-experiment reading).

V_meta ceiling = 1.0 × 0.26 × 1.0 × 1.0 = **0.26**
V_meta ≥ 0.80 is arithmetically unreachable at this ceiling (0.26 < 0.80).
This is a standing fact restated every iteration until/unless a genuine re-trigger fires.

### Gap-list storage decision
**Decision: plain markdown file** at `experiments/quay-continuous-bootstrap/gap-list.md`.

**Reasoning**: Iteration 0 is primarily observational and the MCP tools themselves are being
tested for friction. Using `QX-* tasks with gap label` would conflate "a known gap not yet
turned into actionable work" with "a task actively being executed." The plain file is simpler
to stand up immediately, immediately available, and the distinction between gap entries and
active tasks is cleaner to maintain. This decision may be revisited in a later iteration if
the gap list grows unwieldy as a flat file and `task_list --label gap` proves a cleaner query.

### DIR-006 standing guardrail confirmation
DIR-006 (git worktree isolation) is adopted as a standing guardrail from iteration 0 onward
per protocol §8. It is NOT re-filed as a pending directive (the protocol itself resolves the
"should we do this" question). This iteration created worktree at:
`experiments/quay-continuous-bootstrap/worktrees/iteration-0` on branch `experiment-4-iteration-0`.
Created via: `git worktree add experiments/quay-continuous-bootstrap/worktrees/iteration-0 -b experiment-4-iteration-0`
Result: SUCCESS (Preparing worktree, HEAD at 6742218).

### DIR-004 re-filing
DIR-004 re-filed as `experiments/quay-continuous-bootstrap/directives/pending/DIR-004-node-sea-bun-compile-release-artifacts.md`.
Scope status changed from "deferred, out of scope" (experiment 3) to "pending, IN SCOPE, not yet prioritized" (experiment 4).
This is a `capability_breadth` gap (CB-008 in gap-list).

### σ_QX-vs-inherited-floor decision (EXPLICIT, iteration 0)
**Decision: RESET the floor to 0 for experiment 4's own validation scoring.**

Same reasoning as experiment 3's iteration 0: experiment 4's task population (QX-*) is
genuinely different from experiment 3's (QW-*). Cross-experiment carry-forward of σ_QW=0.778
as a floor would conflate two different provenance populations and would likely cause the same
inherited-floor trap that burned experiment 2 (σ_QC unable to exceed σ_strict floor within
experiment scope). The reset is the validated design choice per quay-webui-bootstrap-methodology
SKILL.md finding #5.

validation = σ_QX alone: (# QX-* tasks with all three fields = native) / (total QX-* tasks)
σ_QX starts at 0/0. No cross-experiment floor applies.

Consequence: with σ_QX = 0/0 at iteration 0, validation = 0/0 = undefined. Convention
(consistent with experiment 3's iteration 0): use the inherited validation value (0.778) for
iteration 0 before any QX-* task has been driven to done, marking it as inherited-not-yet-own.
Starting from iteration 1, validation = σ_QX exclusively.

### Provenance note: open design question #5 resolution
Protocol §9 item 5: "Does a `task_write` call made through the MCP tool change how provenance
is recorded?" Answer confirmed at iteration 0: NO — provenance mechanics ({author_by, execute_by,
gate_by}) are unchanged. QX-001 was created via `mcp__quay__task_write`, but the provenance
triple records WHO did the authoring (seed = this iteration's setup, not a native Skill-driven
pass). The MCP tool interface used does not change the provenance attribution.

### QX-* tasks created this iteration
| Task | author_by | execute_by | gate_by | σ contribution | Notes |
|------|-----------|------------|---------|----------------|-------|
| QX-001 | seed | N/A | N/A | 0/1 | Created via task_write MCP tool; todo status; not yet driven through quay:author/execute |

σ_QX after iteration 0: 0/1 = 0.000
validation (iteration 0, using inherited floor convention): 0.778 (inherited, not yet own)

### Self-hosted task tracking test result (friction found)
End-to-end MCP cycle completed:
- task_write: SUCCESS (QX-001 created)
- task_list: SUCCESS but returns ALL 94 tasks (no prefix filter) — response was 550,343 chars,
  exceeded context limits, required file + jq post-processing. This confirms CB-009 and CB-010.
- task_get: SUCCESS (QX-001 retrieved cleanly)
- task_check: SUCCESS (gate correctly reports ok:false, 0/4 AC checkboxes checked)

Friction recorded as gap-list entries CB-009 and CB-010 (usability_quality dimension).

### Simulated-user pass: ENV gap record
Native Agent/Task tool search result: ToolSearch query "Agent task spawn subagent" returned
only `mcp__plugin_manda_manda__Agent`, `TaskStop`, and `mcp__quay__task_check`.
No unconditional native Agent/Task tool found in this session's deferred-tool list.
This is the same ENV gap documented in experiments 2 and 3.
Per DIR-002/DIR-005 evidentiary bar: actual ToolSearch result shown (not merely asserted).
Fallback: inline degraded-fallback — all 3 personas simulated in this session sequentially.
Deviation explicitly flagged: this does not satisfy §0c's fresh-context independence requirement.

### V_meta re-trigger checks (iteration 0)
All 5 re-trigger conditions checked:
1. effectiveness re-trigger: NOT TRIGGERED — no QX-* task arising with scope-matched shape
   (single-file, no network I/O) has been COMPLETED this iteration (QX-001 is at todo status).
2. reusability re-trigger: NOT TRIGGERED — no organic demand for GitHub Provider body/title
   writes observed.
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new, previously-undocumented
   Skill Method-step gap found. The ENV gap continues unchanged.
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional
   fresh-context spawn primitive appeared.
5. open-ended-domain-specific: OBSERVATIONAL DATA COLLECTED — self-hosted task tracking
   confirmed friction (CB-009, CB-010, MCP response size). This is the first iteration of
   data; not sufficient to claim re-trigger without timing evidence.

### System health regression check
- Experiment 1 snapshot (V_instance = 0.6016): No regression detected. All inherited code
  paths confirmed by running full test suite: 30/30 proper tests pass.
- Experiment 2 snapshot (all 4 factors = 1.0): No regression. core-three-way-symmetry.test.mjs
  and web-ui-browser.test.mjs both pass.
- Experiment 3 snapshot (V_instance = 1.0): No regression. web-ui-browser.test.mjs:
  30/30 tests pass. http://localhost:4173/ returns 200. Lighthouse not re-run this iteration
  (no visual changes made).

### G3 audit status
G3 NOT TRIGGERED this iteration — no Core source files (`packages/quay`) were changed.
This is the correct and expected outcome for an observational/baseline iteration.

---

## Iteration 1 record (2026-07-17)

### QX-* tasks created and completed this iteration

| Task | author_by | execute_by | gate_by | σ contribution | Status | Notes |
|------|-----------|------------|---------|----------------|--------|-------|
| QX-002 | native | native | G3 PASS WITH NOTES | 1/7 | done | CLI `--prefix` filter; tested in cli.test.mjs test 13 |
| QX-003 | native | native | G3 PASS WITH NOTES | 2/7 | done | MCP `task_list` prefix parameter; tested in mcp-server.test.mjs test 12 |
| QX-004 | native | native | G3 PASS WITH NOTES | 3/7 | done | Web UI `?prefix=` query param + Prefix nav; tested in serve.test.mjs |
| QX-005 | native | native | G3 PASS WITH NOTES | 4/7 | done | CLI `--help` / `-h` / subcommand help; tested in cli.test.mjs test 14 |
| QX-006 | native | native | tests pass (30/30) | 5/7 | done | Fix --prefix crash (SH-001 regression from QX-002); test 15 in cli.test.mjs |
| QX-007 | native | native | tests pass (30/30) | 6/7 | done | Fix quay serve/action --help silent exit (UQ-010); test 16 in cli.test.mjs |

σ_QX before iteration 1: 0/1 = 0.000 (only QX-001 at seed provenance)
σ_QX after iteration 1 (final): 6/7 = 0.857
(QX-001 remains seed provenance, 0 native. QX-002..QX-007 all native authoring + execution.)

### Gate check results (iteration 1)
- QX-002: gate `execute->done` ok:true (4/4 AC checked); G3 co-signed
- QX-003: gate `execute->done` ok:true (4/4 AC checked); G3 co-signed
- QX-004: gate `execute->done` ok:true (5/5 AC checked); G3 co-signed
- QX-005: gate `execute->done` ok:true (5/5 AC checked); G3 co-signed
- QX-006: fix implemented and tested; 30/30 test suites pass; test 15 confirms no TypeError crash
- QX-007: fix implemented and tested; 30/30 test suites pass; test 16 confirms non-empty output

### G3 status (iteration 1)
G3 TRIGGERED and COMPLETE — Core source files changed: `packages/quay/bin/quay.js`, `packages/quay/src/mcp-server.js`, `packages/quay/src/serve.js`.
Verdict: PASS WITH NOTES — 413 assertions, 0 failures across 12 test suites. Commit 36c0a58.
See `experiments/quay-continuous-bootstrap/audits/iteration-1-adjudicate.md`.
Notes: (1) silent serve/action --help → UQ-010 filed and closed this iteration (QX-007); (2) cosmetic duplicate comment in serve.js line 419-420.

### Gaps closed this iteration (final)
- CB-001 (CLI prefix filter) → QX-002
- CB-002 (Web UI prefix filter) → QX-004
- CB-009 (MCP prefix filter) → QX-003
- CB-010 (MCP response size) → PARTIALLY ADDRESSED (filter reduces size when used; full unfiltered response still large)
- UQ-001 (CLI --help one-liner) → QX-005
- UQ-002 (CLI subcommand help broken) → QX-005
- UQ-010 (serve/action --help silent exit) → QX-007 [FILED AND CLOSED SAME ITERATION]
- VC-001 (no CLI help test) → QX-005 (cli.test.mjs test 14)
- SH-001 (--prefix crash, regression from QX-002) → QX-006 [FILED AND CLOSED SAME ITERATION]

### New gaps found this iteration
- CB-011 (significant): MCP task_list registered schema missing prefix parameter — simulated-user cross-experiment maintainer
- CB-012 (significant): --sort updated silently ignored — simulated-user cross-experiment maintainer
- UQ-009 (minor): back link from task detail loses filter context — simulated-user cross-experiment maintainer
- UQ-010 (minor): serve/action --help silent exit — G3 audit note [FILED AND CLOSED SAME ITERATION]
- SH-001 (significant bug): --prefix crash with no value — simulated-user comparison reviewer [FILED AND CLOSED SAME ITERATION]

### System health (iteration 1)
Full test suite (final): 30/30 pass (node --test packages/quay/test/*.mjs packages/quay-native/test/*.test.mjs packages/quay-github/test/*.test.mjs). No regressions against any inherited snapshot. SH-001 crash bug triaged and closed with QX-006.

### V_instance (iteration 1 final)
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.62 × 0.68 × 0.95 × 0.97
           = 0.388

ΔV_instance = 0.388 - 0.236 = +0.152
```

### V_meta (iteration 1 final)
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.857
       = 0.136

ΔV_meta = 0.136 - 0.123 = +0.013
```
Ceiling: 0.26 (effectiveness frozen; unchanged).

### V_meta re-trigger checks (iteration 1)
All 5 conditions checked:
1. effectiveness re-trigger: NOT TRIGGERED — no scope-matched single-file timing comparison yet (QX-002..QX-007 each touched one Core file but none qualify as purely single-file, no-network tasks; they are multi-file implementations with test additions)
2. reusability re-trigger: NOT TRIGGERED — no organic GitHub Provider write demand
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new Skill Method-step gap found; ENV gap continues
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch primitive
5. open-ended-domain-specific: OBSERVATIONAL — prefix filter makes self-hosted tracking (task_list with prefix="QX") practical; qualitative improvement in dogfooding experience noted but not yet decidable as effectiveness re-trigger without timing evidence

---

## Iteration 2 record (2026-07-17)

### QX-* tasks created and completed this iteration

| Task | author_by | execute_by | gate_by | σ contribution | Status | Notes |
|------|-----------|------------|---------|----------------|--------|-------|
| QX-008 | native | native | G3 PASS WITH NOTES | 7/10 | done | Sort by updated (CB-004/CB-005/CB-012): store.js updatedAt, CLI --sort updated, Web UI ?sort=updated + "Updated ↓" nav |
| QX-009 | native | native | G3 PASS WITH NOTES | 8/10 | done | List-page action buttons (CB-003): inline forms with ?from= redirect, "actions" column header |
| QX-010 | native | native | tests pass (30/30) | 9/10 | done | MCP schema test (CB-011): Block 13 in mcp-server.test.mjs verifies prefix in inputSchema + updatedAt in task_list response; no Core source change |

σ_QX before iteration 2: 6/7 = 0.857 (QX-001 seed, QX-002..QX-007 native)
σ_QX after iteration 2 (final): 9/10 = 0.900
(QX-001 remains seed provenance. QX-008, QX-009, QX-010 all native authoring + execution.
 QX-008 and QX-009 gate_by = "G3 PASS WITH NOTES" — G3 co-signed (audits/iteration-2-adjudicate.md).
 QX-010 gate_by = "tests pass (30/30)" — no Core source change, no G3 required per DoD.)

### Gate check results (iteration 2)
- QX-008: gate `execute->done` ok:true (7/7 AC checked); G3 co-sign pending (orchestrator dispatch)
- QX-009: gate `execute->done` ok:true (6/6 AC checked); G3 co-sign pending (orchestrator dispatch)
- QX-010: gate `execute->done` ok:true (4/4 AC checked); tests pass (30/30); no G3 required

### Gaps closed this iteration (development phase)
- CB-003 (action buttons on list page) → QX-009; commit 44fa2a7
- CB-004 (CLI sort by time) → QX-008; commit 44fa2a7
- CB-005 (Web UI sort by time) → QX-008; commit 44fa2a7
- CB-011 (MCP schema stale — task_list missing prefix in session) → QX-010; commit 44fa2a7 (test-only; source already correct since QX-003)
- CB-012 (--sort updated silently ignored regression) → QX-008; commit 44fa2a7

### New gaps found this iteration (development phase)
None during development phase. Simulated-user pass pending (dispatched separately by orchestrator).

### G3 status (iteration 2)
G3 TRIGGERED — Core source files changed: `packages/quay-native/src/store.js`, `packages/quay/bin/quay.js`, `packages/quay/src/serve.js`.
G3 COMPLETE — PASS WITH NOTES. 12/12 test files pass. QX-008 and QX-009 co-signed. See `experiments/quay-continuous-bootstrap/audits/iteration-2-adjudicate.md`.

### System health (iteration 2, development phase)
Full test suite (final): 30/30 pass (node --test packages/quay/test/*.mjs packages/quay-native/test/*.test.mjs packages/quay-github/test/*.test.mjs). No regressions. QX-008 (test 17), QX-009 (serve port+3 block), QX-010 (Block 13) all added.

### V_instance (iteration 2, FINAL)
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.74 × 0.63 × 0.97 × 0.98
           = 0.443

ΔV_instance = 0.443 - 0.388 = +0.055 (over iteration 1 final)
```
Final rationale (post simulated-user + G3):
- capability_breadth: 0.74 — CB-003/004/005/011/012 closed; 4 open (CB-006 minor, CB-007/008/010 significant); simulated-user confirmed all CB work resolved, no new CB gaps
- usability_quality: 0.63 — 4 new significant gaps from simulated-user (UQ-011/012/013/014); UQ-003 escalated to significant; 7 significant UQ gaps now open; CB-003 improvements partially offset by new-surface discoveries
- verification_coverage: 0.97 — G3 confirmed 12/12 test suites pass; 4 new test blocks added
- system_health: 0.98 — G3 PASS WITH NOTES; non-blocking notes; no regressions

### V_meta (iteration 2, FINAL)
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.900
       = 0.142

ΔV_meta = 0.142 - 0.136 = +0.006
```
Ceiling: 0.26 (effectiveness frozen; unchanged).

### V_meta re-trigger checks (iteration 2, FINAL)
All 5 conditions checked:
1. effectiveness re-trigger: NOT TRIGGERED — QX-008/009/010 each touched multiple files (store.js + quay.js + serve.js + 3 test files). No single-file no-network scope-matched task completed.
2. reusability re-trigger: NOT TRIGGERED — no organic GitHub Provider write demand.
3. completeness re-trigger (gap discovery): NOT TRIGGERED — no new Skill Method-step gap found; ENV gap continues.
4. completeness + reusability/effectiveness joint: NOT TRIGGERED — no unconditional native dispatch primitive.
5. open-ended-domain-specific: NOT TRIGGERED — simulated-user pass complete; no new re-trigger evidence found.

### Simulated-user pass (iteration 2, FINAL)
3 personas dispatched by orchestrator; all complete.
- Cross-experiment maintainer: PASS — CB-003/004/005/011/012 all confirmed resolved; UQ-009 (back link) confirmed still open
- Mobile single-task (375px): CONCERNS — UQ-011 (Advance off-screen), UQ-012 (role/labels columns), UQ-013 (gate-fail silent) all found significant
- New contributor: PASS WITH CONCERNS — UQ-014 (Advance no tooltip/confirmation) significant; UQ-003 escalated to significant
New gaps recorded: UQ-011, UQ-012, UQ-013, UQ-014, UQ-015; UQ-003 severity escalated.
Gap-list delta (final): 5 new gaps added (UQ-011..015); UQ-003 escalated; 5 gaps closed (CB-003/004/005/011/012); net open: 16 (4 CB, 12 UQ).

---

## Iteration 3 record (2026-07-17, development phase — G3 + simulated-user pending)

### QX-* tasks created and completed this iteration

| Task | author_by | execute_by | gate_by | σ contribution | Status | Notes |
|------|-----------|------------|---------|----------------|--------|-------|
| QX-011 | native | native | G3 PASS WITH NOTES | 10/15 | done | Back link preserves filter context (UQ-009): ?from= in task title links; detail page back link uses from= param; open-redirect guard; 6 assertions in serve.test.mjs |
| QX-012 | native | native | G3 PASS WITH NOTES | 11/15 | done | Mobile table adaptation (UQ-011/012): col-role/col-labels CSS classes; @media (max-width:600px) rule; 3 assertions in serve.test.mjs |
| QX-013 | native | native | G3 PASS WITH NOTES | 12/15 | done | Gate-fail feedback (UQ-013): gate check before deliverTrigger; ?error= redirect; error/success banners; addParam() helper; 7 assertions in serve.test.mjs |
| QX-014 | native | native | G3 PASS WITH NOTES | 13/15 | done | Advance button tooltip (UQ-014): title= on list-page buttons; target-status title= on detail-page buttons; 2 assertions in serve.test.mjs |
| QX-015 | native | native | G3 PASS WITH NOTES | 14/15 | done | Orientation banner (UQ-003): .orientation-banner div + CSS; 3 assertions in serve.test.mjs; banner text corrected (CR-010: in_progress→ready) in synthesis step |

σ_QX before iteration 3: 9/10 = 0.900 (QX-001 seed, QX-002..010 native; QX-008/009 gate_by G3 PASS WITH NOTES; QX-010 tests pass)
σ_QX after iteration 3 (FINAL): 14/15 = 0.933
(QX-001 remains seed provenance. QX-011..015 all native authoring + execution. gate_by = "G3 PASS WITH NOTES" — co-signed; see audits/iteration-3-adjudicate.md.)

### Gate check results (iteration 3, FINAL)
- QX-011: all 6 ACs checked; status advanced to done; G3 PASS WITH NOTES
- QX-012: all 7 ACs checked; status advanced to done; G3 PASS WITH NOTES
- QX-013: all 9 ACs checked; status advanced to done; G3 PASS WITH NOTES
- QX-014: all 5 ACs checked; status advanced to done; G3 PASS WITH NOTES
- QX-015: all 6 ACs checked; status advanced to done; G3 PASS WITH NOTES

### Gaps closed this iteration (FINAL — 8 total)
Development phase:
- UQ-003 (orientation banner) → QX-015; commit f4b3b8d
- UQ-009 (back link context) → QX-011; commit f4b3b8d
- UQ-011 (Advance off-screen mobile) → QX-012; commit f4b3b8d — PARTIALLY CLOSED; re-opened for long-ID case
- UQ-012 (role/labels columns at mobile) → QX-012; commit f4b3b8d
- UQ-013 (gate-fail silent) → QX-013; commit f4b3b8d
- UQ-014 (no button tooltip) → QX-014; commit f4b3b8d

Synthesis step (found + closed same iteration):
- UQ-016 (banner shows wrong status `in_progress`) → serve.js banner text corrected to `ready`; serve.test.mjs assertions added; commit 05a8ec9
- SH-002 (open-redirect guard incomplete: `//evil.com` bypass) → serve.js guard tightened; serve.test.mjs test added; commit 05a8ec9

### New gaps found this iteration (FINAL)
From simulated-user pass + G3:
- CB-013 (blocking): Multi-label filter broken on CLI (last-wins) and Web UI (first-wins), inconsistent between surfaces
- UQ-011 (significant): Re-opened — actions column still overflows at 375px for long task IDs / unfiltered page
- UQ-016 (significant): Found + closed — banner shows `in_progress` (non-existent status)
- UQ-017 (significant): `updatedAt` tracked but never displayed on list or detail page
- UQ-018 (minor): List-page Advance tooltip generic vs detail-page target-specific

From G3 audit:
- SH-002 (significant): Open-redirect guard accepts protocol-relative URLs (`//evil.com`); found + closed same iteration

### G3 status (iteration 3, FINAL)
G3 COMPLETE — PASS WITH NOTES. 12/12 test files pass. QX-011..015 co-signed.
Security note actioned: SH-002 fixed in synthesis step (serve.js guard tightened + test added).
See `experiments/quay-continuous-bootstrap/audits/iteration-3-adjudicate.md`.

### System health (iteration 3, FINAL)
Full test suite: 30/30 pass. No regressions. QX-011..015 serve.test.mjs block (25 new assertions from development phase; 5 additional from synthesis step: SH-002 redirect test + 2 UQ-016 banner assertions + 2 confirmation tests). All inherited snapshots confirmed intact.

### V_instance (iteration 3, FINAL)
```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
           = 0.68 × 0.76 × 0.97 × 0.98
           ≈ 0.491

ΔV_instance = 0.491 - 0.443 = +0.048 (over iteration 2 final)
```
Component rationale:
- capability_breadth: 0.68 (CB-013 blocking gap added; 5 open CB gaps vs 4 in iteration 2; blocking penalizes below 0.74)
- usability_quality: 0.76 (3 significant open vs 7 in iteration 2; UQ-003/009/012/013/014 fully closed; UQ-011 partial)
- verification_coverage: 0.97 (30 new assertions total; 12/12 test suites pass; no Playwright mobile)
- system_health: 0.98 (SH-002 fixed; CB-013 triaged; no regression)

### V_meta (iteration 3, FINAL)
```
V_meta = completeness × effectiveness × reusability × validation
       = 0.77 × 0.26 × 0.79 × 0.933
       ≈ 0.148

ΔV_meta = 0.148 - 0.142 = +0.006 (over iteration 2 final)
```
σ_QX = 14/15 = 0.933 (confirmed final; G3 co-sign complete).
Ceiling: 0.26 (effectiveness frozen; unchanged).

### Simulated-user pass (iteration 3, FINAL)
3 personas dispatched by orchestrator; all complete.
- New-contributor: PASS — zero blocking, zero significant findings; UQ-003, UQ-013, UQ-009 confirmed resolved; UQ-018 (minor) new gap found
- Mobile single-task (375px): PASS WITH CONCERNS — UQ-013, UQ-009 confirmed resolved; UQ-011 partially resolved (short-ID OK, long-ID still overflows); UQ-011 re-opened significant
- Comparison reviewer (vs GitHub Issues + Linear): CONCERNS — CB-013 (blocking), UQ-017 (significant), UQ-016 (found+closed), UQ-018 (confirmed from new-contributor) found

Gap-list delta (final): 5 new gaps found (CB-013 blocking, UQ-011 re-opened, UQ-016→closed, UQ-017 significant, UQ-018 minor); 2 gaps additionally closed in synthesis (UQ-016, SH-002); total 8 closed this iteration; net open: 14 (5 CB, 9 UQ, 0 VC, 0 SH).

### Convergence check (iteration 3)
- V_meta ≥ 0.80: NO (ceiling 0.26)
- PAUSE (ΔV < 0.02 for 2+ consecutive iterations AND no new significant gap): NOT MET — ΔV = +0.048 (not flat); new significant gaps found (CB-013, UQ-017, UQ-011 re-opened)
- G3: PASS WITH NOTES (security note fixed)
- system_health: no regression (CB-013 triaged)
**Status: CONTINUING**

---

## Human-observed gap-list seed candidates (2026-07-17, pre-iteration-0)

The human, using experiment 3's shipped Web UI directly as a real user (not via the
simulated-user mechanism), observed the following concrete gaps in this same conversation.
These are NOT yet filed as formal gap-list entries (the gap-list mechanism itself doesn't
exist until iteration 0 chooses its storage per the open question above) — recorded here so
iteration 0 does not have to rediscover them, and must seed the gap list with at least these
on top of whatever its own first simulated-user pass finds:

1. **Cross-experiment task filtering**: the most-wanted filter is "show me only this
   experiment's tasks" (e.g. all `QW-*` or all `QN-*`) — today's filter-by-status/label
   doesn't cover this directly. Requires either extending filter capability to match on
   task-id prefix, or a more stable per-experiment labeling convention applied consistently
   at task-creation time across experiments. (`capability_breadth`)
2. **Action buttons (e.g. "Advance") missing from the list page** — currently only available
   on the task detail page; forces a detail-page round-trip to perform an action that's
   contextually obvious from the list. (`capability_breadth` / `usability_quality`)
3. **Sort by time** (e.g. created/updated timestamp) not available on the list page, only
   sort by id/status. (`capability_breadth`)
4. **Configurable page size** on the list page (today fixed at 20/page). (`capability_breadth`)

The human explicitly framed these as illustrative, not exhaustive, and asked the deeper
question this experiment's whole redirection answers: how to structurally strengthen the
iteration's ability to *proactively* discover this class of gap, rather than rely on the
human noticing them ad hoc. See protocol §5.2 (continuous simulated-user usage) and
`ITERATION-PROMPTS.md` §0c for the mechanism designed in direct response to this question.
