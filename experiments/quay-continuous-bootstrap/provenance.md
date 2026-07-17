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
