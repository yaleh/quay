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
