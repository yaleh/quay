# DIR-007

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Close experiment 3 at the next clean iteration boundary; methodology extraction to follow; hand off to experiment 4 (open-ended continuous improvement, not this experiment's bounded four-factor scope)

## Finding

The human steering this project has decided, in this live conversation, to
change strategic direction: rather than continue toward experiment 3's
originally bounded convergence target (V_instance ≥0.80 AND V_meta ≥0.80,
all four fixed "Done when" clauses per protocol §4.1–§4.4), the human wants
future work to pursue **open-ended, continuous improvement of the whole
`quay` project** — not limited to the Web UI's fixed capability/visual
checklist — using `quay` to drive its own development process, and
continuously simulating a human user observing and using the product to
find the next improvement, indefinitely rather than toward a fixed target.

This is **not** a claim that experiment 3 failed or was mis-scoped. At the
point this directive is filed:
- `iteration-4.md` reports V_instance = 1.0 (all four bounded factors at
  1.0: `ui_read_capability`, `visual_design_quality`,
  `verified_by_construction`, `backlog_health`) — the bounded scope this
  experiment was deliberately designed around (per its own protocol
  framing, a fixed checklist chosen specifically to make V_instance
  completable) is, on the evidence filed so far, satisfied.
- V_meta remains far below the convergence threshold (0.123 vs. required
  ≥0.80), capped at a ceiling of 0.26 by the same `effectiveness`-factor
  environmental gap experiments 1 and 2 also hit (no unconditional
  fresh-context subagent-dispatch primitive) — so experiment 3 was never
  going to reach FULL BAIME convergence under its current protocol, the
  same structural outcome experiments 1 and 2 both had.
- An independent G3 audit for iteration 4 is in flight as of this
  directive (`audits/iteration-4-adjudicate-independent.md` observed as an
  untracked, in-progress file) — this directive does **not** ask the
  executing session to abandon or interrupt that in-flight work. Let it
  complete.

## Requested action

1. **Do not interrupt the in-flight iteration-4 independent G3 audit.**
   Let it finish and be recorded normally.

2. **At the next clean iteration boundary** (i.e., once iteration 4's
   audit trail is fully closed out — do not force this mid-iteration),
   the executing session should treat that point as experiment 3's
   **stopping point**, and record a closing report
   (`experiments/quay-webui-bootstrap/CLOSING-REPORT.md`, following the
   structure of `experiments/quay-native-bootstrap/CLOSING-REPORT.md` and
   `experiments/quay-core-bootstrap/` iteration-10 closing) stating:
   - Final iteration number and date.
   - Status: the bounded V_instance target (all four §4.1–§4.4 factors)
     WAS reached (1.0), but full BAIME convergence (V_instance ≥0.80 AND
     V_meta ≥0.80 simultaneously) was NOT reached, for the same
     structural `effectiveness`-ceiling reason experiments 1 and 2 both
     recorded — this is a deliberate, human-directed stop, not a failure
     to converge under the protocol's own terms.
   - This stop is driven by an explicit strategic redirection (this
     directive), not by the experiment exhausting its own scope
     unsuccessfully.

3. **Run `baime:knowledge-extractor`** against experiment 3's final state
   before or as part of the closing report, producing
   `.claude/skills/quay-webui-bootstrap-methodology/` (or equivalent),
   consistent with how experiments 1 and 2 were each extracted. Record
   which findings are genuinely new relative to the two prior extractions
   (e.g. the independent-visual-review mechanism, the desktop/mobile dual-
   viewport requirement from DIR-003, the G3-dispatch-drift case from
   DIR-002/DIR-005, and this directive's own worktree-isolation
   requirement from DIR-006 if it was applied before the stop) — do not
   re-narrate what experiments 1/2 already extracted.

4. **Any directives still `pending` at stop time** (as of this filing:
   DIR-004 — deferred packaging/distribution scope; DIR-006 — worktree
   isolation, not yet applied) **must be explicitly carried forward** into
   experiment 4's own directive backlog (copy or re-file, with a note
   citing their experiment-3 origin), not silently dropped. A directive
   that was genuinely satisfied by experiment 3's final state (e.g. if
   DIR-006 is applied before the stop) should instead be archived normally
   with its resolution recorded.

5. **This directive does not itself scaffold experiment 4.** The human has
   separately requested that experiment 4 be scaffolded (new
   `experiments/quay-webui-continuous-bootstrap/` or similarly named
   directory — exact name TBD by whoever scaffolds it, not fixed by this
   directive) as its own distinct effort. This directive's scope is
   limited to closing experiment 3 cleanly and ensuring nothing pending is
   lost in the handoff.

6. Record the resolution of this directive (applied/deferred/rejected,
   with evidence) in whichever iteration first acts on it — expected to be
   experiment 3's own final iteration.

## Resolution
<!-- to be filled in by whichever iteration applies it -->
