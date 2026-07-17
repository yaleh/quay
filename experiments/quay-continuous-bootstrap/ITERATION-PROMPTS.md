# Iteration Prompts — Quay Continuous Bootstrap (Experiment 4)

**Experiment**: quay-continuous-bootstrap
**Protocol**: [`docs/proposals/quay-continuous-bootstrap-experiment-v4.md`](../../docs/proposals/quay-continuous-bootstrap-experiment-v4.md) (authoritative — read it before running any iteration)
**Objectives**:
- *Instance* (§4 of protocol): Open-ended continuous improvement of the whole `quay` project — CLI, Core/MCP client, Web UI, packaging/distribution, documentation — measured via four durable quality dimensions (`capability_breadth × usability_quality × verification_coverage × system_health`), each rescored every iteration against the CURRENT best-known gap list, not a fixed checklist frozen at design time. No fixed "Done when" ceiling. `ΔV` (trend), not raw level, is the primary comparative signal; a monotonically-growing cumulative gaps-closed counter is tracked alongside it.
- *Meta* (§6 of protocol): Test whether the inherited methodology (Skill files, directive lifecycle, provenance/gate mechanics, G3 audit discipline) transfers to open-ended, self-directed, continuously-rescoped work — where the methodology must also decide what to work on next, not just execute a known objective. `V_meta`'s formula (`completeness × effectiveness × reusability × validation`) is unchanged in FORM; it continues from experiment 3's stopping value, not reset to zero.

> **STATUS AT TIME OF WRITING THIS FILE**: this document and its companion protocol document are being authored as the operational scaffold for experiment 4, per `DIR-007` (filed in experiment 3, requesting closure of experiment 3 and hand-off to a new, distinctly-scoped experiment 4). `experiments/quay-continuous-bootstrap/README.md` and `provenance.md` have NOT yet been written — they are the orchestrating session's own job, built on top of this document and the protocol. **Iteration 0 has NOT run.** A human must explicitly authorize starting iteration 0 (mirroring the precondition-5 discipline of every prior experiment) once experiment 3's actual closing report exists and the provisional V_meta inheritance value (§2 below) is reconciled against it.

**Inheritance baseline** (per protocol §2 — not to be re-derived as if starting from zero):
- **V_instance** starts fresh on experiment 4's own four dimensions — but "fresh" means "freshly measured," not "assumed near-zero." Experiment 3's iteration-4 report records its own four bounded factors all at 1.0 (`ui_read_capability`, `visual_design_quality`, `verified_by_construction`, `backlog_health`) — a reasonably healthy starting system, not a from-scratch rebuild. Iteration 0's job is to survey the actual current state of `capability_breadth`, `usability_quality`, `verification_coverage`, and `system_health` against a freshly-assembled gap list (protocol §4.4), not to inherit a number.
- **V_meta does NOT reset to zero.** It continues from wherever `quay-webui-bootstrap` (experiment 3) holds it at its own stopping point. **This is a PROVISIONAL number, not yet reconciled against experiment 3's actual closing report** (which did not exist at the time this document was authored — see protocol §2):
  ```
  V_meta (provisional, from experiment 3's iteration-4.md / provenance.md — RE-CONFIRM against
          CLOSING-REPORT.md before trusting this at iteration 0)
        = completeness × effectiveness × reusability × validation
        = 0.77 × 0.26 × 0.79 × 0.778 = 0.123
  ```
  Iteration 0 MUST read `experiments/quay-webui-bootstrap/CLOSING-REPORT.md` if it exists by
  that point, and use ITS values instead of this provisional number if they differ. If the
  closing report does not yet exist, iteration 0 must state that explicitly and flag the
  0.123 figure as provisional pending that reconciliation — do not treat this document's
  number as silently authoritative.
- **σ resets to a fresh count** scoped to experiment 4's own task population, using the
  **`QX-*`** prefix — distinct from `QN-*` (experiment 1), `QC-*` (experiment 2), `QW-*`
  (experiment 3). σ_QX starts at 0/0.

**Target**: there is no fixed numeric ceiling target for `V_instance` (protocol §4.5 — this is
the whole point of the redirection). The operative "target," every iteration, is: (a) genuine,
evidenced `ΔV_instance` movement or an honest diminishing-returns finding: (b) the standing
PAUSE criteria (protocol §4.5) checked explicitly; (c) `V_meta`'s own bounded threshold
(≥ 0.80) still tracked, unchanged in form, as the meta-layer's own (separately bounded)
convergence question.

> Frozen vocabulary applies (`glossary.md`). BAIME terms (`V_instance`, `V_meta`, OCA, `A_n`,
> `M_n`, `O`) are used verbatim per the `methodology-bootstrapping` skill. The inherited
> methodology artifacts live in `.claude/skills/quay-native-methodology/` (Layer-1/Layer-2
> Skill mechanics, gate mechanics, directive lifecycle, G3 audit discipline),
> `.claude/skills/quay-core-bootstrap-methodology/` (manda daemon bug, G3-dispatch-drift case
> study, manda reliability envelope, V_meta ceiling diagnostic, σ-vs-floor trap), and (once
> produced per DIR-007 action 3) `.claude/skills/quay-webui-bootstrap-methodology/`
> (independent-visual-review mechanism, dual-viewport requirement, worktree-isolation
> rationale). Read these, never re-derive them. This document does not repeat their content;
> it cites and applies it.

---

## How to use this document

- **Iteration 0** is fully concrete — execute it as written, once a human has authorized
  starting it. Its job is NOT to build capability from σ=0 (methodology AND a continuing
  V_meta baseline are both inherited); it is to (a) reconcile the provisional V_meta figure
  against experiment 3's real closing report, (b) stand up the self-hosted task-tracking
  mechanism (protocol §5.1) and confirm it actually works end-to-end, (c) run the FIRST
  simulated-user pass (protocol §5.2) to seed the initial gap list, (d) compute experiment
  4's own fresh V_instance baseline from that gap list, and (e) make the open design
  decisions protocol §9 flags (gap-list storage location, provenance-mechanics confirmation)
  explicitly rather than letting them default silently.
- **Iterations 1..k** work the gap list down (closing evidenced gaps) while the standing
  simulated-user mechanism (every iteration) and direct observation keep adding to it — this
  is normal, expected, and not a sign the experiment isn't working. Watch `ΔV`, not raw level,
  as the comparative signal (protocol §4.3).
- Every iteration begins with **§0 Preconditions** and ends with the **Convergence/Pause
  Check**. Do not skip either.
- **Task IDs**: all new tasks in this experiment use the **`QX-*`** prefix — never continue
  the `QN-*`, `QC-*`, or `QW-*` sequences.
- **G3 audit dispatch — correct from iteration 0**: the out-of-band audit is dispatched by the
  **orchestrator**, using the **native Agent/Task tool** — **never** via manda, **never** from
  inside the iteration-executor's own session. Experiment 3's iterations 1, 3, and 4 each fell
  back to inline self-audit citing an unverified "ENV gap." `DIR-002`/`DIR-005` require
  **concrete evidence of the blocker** (the actual negative `ToolSearch` result, not an
  assertion) before any inline fallback is permitted, and require the fallback to be flagged
  explicitly as a deviation requiring separate review. Re-state the correct
  dispatcher/mechanism at the start of every iteration — do not assume it will be remembered.
- **Self-hosted task tracking is mandatory from iteration 0** (protocol §5.1): experiment 4's
  own `QX-*` backlog is tracked via `mcp__quay__task_write` / `task_list` / `task_get` /
  `task_check` — never an ad hoc markdown TODO list maintained outside quay's own tooling.
- **The simulated-user pass runs every iteration** (protocol §5.2) — this is a stronger
  cadence commitment than experiment 3's per-claimed-change visual review. It is the primary
  organic source of new gap-list entries, not merely a verification step.

---

## §0. Preconditions (check before every iteration, from iteration 0 onward)

```
[ ] manda daemon address read LIVE from .manda/hub.addr — NEVER hardcode a port.
    (`cat .manda/hub.addr` then `curl -s <that address>/healthz`.)
[ ] a live `manda monitor <name> --root .` process is confirmed a DIRECT CHILD of
    the current session's own process tree — use the mechanized ps-based procedure
    from experiments/quay-native-bootstrap/ITERATION-PROMPTS.md §0 (G6 operational check);
    a bare daemon /healthz probe is NOT sufficient.
[ ] experiments/quay-continuous-bootstrap/provenance.md has been read (before iteration 0:
    the inheritance record already written there; after: confirm current state)
[ ] previous iteration's experiments/quay-continuous-bootstrap/iterations/iteration-{N-1}.md
    has been read in full
[ ] experiments/quay-continuous-bootstrap/gap-list.md (or equivalent — see the iteration-0
    storage-location decision, protocol §9 item 1) has been read in full; every open gap
    entry's "date last re-confirmed still open" is checked against this iteration's planned
    work
[ ] experiments/quay-continuous-bootstrap/directives/pending/ has been listed (`ls`) and
    every file in it read; each must reach an explicit applied/deferred/rejected outcome
    this iteration, recorded in this iteration's own report — this INCLUDES the two
    directives carried forward from experiment 3 (DIR-004 packaging/distribution, now
    re-filed here per protocol §8; DIR-006 worktree isolation, adopted directly as a
    standing guardrail rather than re-filed as still-open — confirm both are represented
    correctly in this experiment's own directives/ tree at iteration 0)
[ ] G7 standing web-service reachability (protocol §8, new guardrail): is `quay serve`
    currently running and reachable on 0.0.0.0 (not localhost-only)? If not, start it before
    proceeding — the simulated-user mechanism needs a live target every iteration, not a
    service started ad hoc mid-iteration.
[ ] Git worktree isolation (protocol §8, generalized from DIR-006): has a dedicated worktree
    been created for this iteration's development/testing work? If a structural blocker
    prevents it, concrete evidence of the blocker must be shown (not asserted) before falling
    back to direct execution in the shared tree, flagged explicitly as a deviation.
[ ] The V_meta re-trigger conditions (from .claude/skills/quay-native-methodology/
    reference/v-meta-stall-analysis.md, as refined by quay-core-bootstrap-methodology's
    ceiling/floor findings AND by this experiment's own self-hosted-task-tracking-as-
    effectiveness-re-trigger-candidate hypothesis, protocol §6) have been checked against
    this iteration's planned work — do any fire? Record the answer either way.
[ ] Diminishing-returns / PAUSE check inputs (protocol §4.5): what was ΔV_instance last
    iteration (and the iteration before, if this is iteration 2+)? Did the prior iteration's
    simulated-user pass find any new blocking/significant-severity gap? Both feed the
    PAUSE recommendation check at the end of THIS iteration.
[ ] verification_coverage spot-check (protocol §4.2): does every capability/change delivered
    SO FAR (not just this iteration) have a corresponding committed automated test
    (unit/integration/browser-automation as appropriate to the surface)? Continuous
    requirement, re-checked every iteration boundary — a gap here is a dimension regression.
[ ] system_health regression check (protocol §4.2): re-confirm no regression against ALL
    THREE inherited snapshots — quay-native's 8 V-factors (experiment 1's final snapshot),
    quay-core-bootstrap's own 4 V-factors (experiment 2's iteration-10 stopping values), AND
    quay-webui-bootstrap's own 4 V-factors (experiment 3's stopping values, per its closing
    report once it exists — cite the specific snapshot, do not assume).
[ ] (iteration subagent, G3 audit subagent, AND simulated-user subagent, orchestrator-side)
    All THREE dispatches confirmed run_in_background=true — see §0a below. Note this is one
    more standing dispatch than experiment 3 required (visual review was change-triggered,
    not standing-cadence; the simulated-user pass here runs every iteration).
```

**Scope boundary reminder (protocol §3, checked every iteration)**: the whole `quay` project
is in scope (CLI, Core/MCP client, Web UI, packaging/distribution, documentation) — this is
broader than any prior experiment's scope, not narrower. "Core stays dumb" (no backend-specific
conditional rendering, no `if backend === 'github'`) remains unchanged. Experiment 3's
Web-UI-specific write-surface boundary is NOT inherited as a blanket rule (protocol §3) — any
NEW write surface is evaluated on its own merits against gap-list evidence and ordinary G3/G5
discipline, not pre-authorized and not pre-forbidden. State explicitly, per change, which
applies.

---

## §0a. Non-blocking dispatch (inherited from experiment 1, applies unchanged)

The non-blocking-dispatch requirement (DIR-015 + DIR-016) applies verbatim, extended to a
third standing dispatch this experiment adds:
- The iteration-executing subagent, the G3 audit subagent, AND the simulated-user subagent
  (§0c below) must each be dispatched `run_in_background=true` by the orchestrator.
- None of the three can observe its own dispatch mode — confirmation is the orchestrator's
  record, not any of the three subagents'.
- None of the three dispatches may default to synchronous mode.

Full text: `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0a. Not duplicated here
to prevent drift — read that file, not this note.

---

## §0b. Manda nested-subagent guidance (inherited; G3 exclusion is absolute)

The guidance for manda nested-subagent use in development/testing operations applies verbatim,
including the hard rule: a manda depth-1 caller must never be synchronous same-session-as-broker.

**G3 exclusion is absolute, correct from iteration 0**: regardless of the general manda
guidance, **the G3 out-of-band audit itself must never be attempted via manda nested-subagent,
by any session, for any reason.** This drifted in BOTH prior experiments that had the chance
to drift (experiment 2's iterations 3-5, corrected by its own DIR-003; experiment 3's
iterations 1, 3, 4, addressed by DIR-002/DIR-005) — do not treat "manda is available and
plausible-looking for this" as a reason to route G3 through it.

**The same absolute exclusion extends to the simulated-user mechanism (§0c)**: it must never
be dispatched via manda either, for the same independence reasons G3 requires it.

**Manda daemon-address discipline**: any manda healthz/liveness probe must read the current
daemon address from `.manda/hub.addr` at runtime. Never hardcode a port number.

---

## §0c. Continuous simulated-user usage — the standing, every-iteration mechanism (generalizes experiment 3's §0c independent holistic visual review)

**This runs every iteration, not merely when a change is claimed.** Unlike experiment 3's
mechanism (triggered by a claimed `visual_design_quality` improvement), this is the *primary*
organic source of new gap-list entries — an iteration that skips this dispatch has no organic
source of new priorities for the following iteration beyond direct observation.

**Dispatch discipline — identical to G3**: by the orchestrator, using the native Agent/Task
tool, `run_in_background=true`, from a fresh context — never the same session/context that did
the iteration's own development work, and never via manda.

**Persona diversity — dispatch 2-3 parallel reviewers per iteration, not one generic reviewer.**
A single "plausible real task" reviewer tends to re-find the same class of gap iteration after
iteration, because it has no reason to compare quay against anything outside itself. The
concrete gaps the human found by direct observation pre-iteration-0 (cross-experiment task
filtering, missing list-page action buttons, missing sort-by-time, missing page-size config —
recorded in `provenance.md`) were found specifically by comparing real workflows against a
mature tool's expected affordances, not by isolated task-completion probing — a discovery mode
a single generic reviewer would not naturally hit. Each iteration must therefore pick 2-3
personas with **deliberately different angles**, varied iteration to iteration rather than
fixed to the same set every time. Draw from (non-exhaustive):
- **Cross-experiment maintainer**: jumps between this project's own multiple task sets/experiments
  in one session, the way someone managing several concurrent workstreams actually would —
  surfaces gaps in filtering, grouping, and context-switching affordances.
- **Mobile-only single-task user**: does one concrete task start-to-finish on a mobile viewport
  only, no desktop fallback — surfaces gaps a desktop-first reviewer structurally cannot see.
- **Comparison-to-a-mature-tool reviewer**: explicitly holds quay's surface up against a named
  mature tool with overlapping purpose (e.g. a mainstream issue tracker or task manager) and
  asks "what would I expect here that isn't present" — surfaces missing-affordance gaps a
  quay-only frame of reference would not prompt.
- **New-contributor-with-no-context reviewer**: arrives with zero prior knowledge of quay's
  conventions and tries to become productive using only what the interface itself teaches —
  surfaces onboarding/discoverability gaps.
Each persona is an independent dispatch (own fresh context, own report), not one agent
role-playing multiple personas in sequence — the independence is what prevents one persona's
framing from anchoring another's findings.

**What each reviewing agent must do** (protocol §5.2, full text — restated here for operational
use):
1. Approach the system through its assigned persona's lens with a plausible real task in mind
   (e.g. "I'm a new contributor trying to find out what to work on next," "I'm triaging the
   backlog," "I want to trigger an action on a task") — not isolated feature probing.
2. Use more than one surface where the task allows it — CLI, Web UI (desktop AND mobile
   viewport, per the inherited dual-viewport requirement), and MCP tools — asymmetries between
   surfaces are themselves findings.
3. Judge each surface **as a whole first** before itemizing specific friction points — the
   same discipline experiment 3's holistic-review mechanism established, generalized beyond
   visual coherence to overall usability.
4. Render **PASS / CONCERNS / FAIL per surface** (not one verdict for the whole system), with
   concrete friction points/bugs/confusion/missing affordances, each tagged with a proposed
   severity (`blocking` / `significant` / `minor`, protocol §4.4).
5. Write the verdict to
   `experiments/quay-continuous-bootstrap/audits/iteration-{N}-simulated-user-{persona}-{surface}.md`
   (one file per surface reviewed per persona: `cli`, `webui-desktop`, `webui-mobile`, `mcp`, or a
   combined file if the agent genuinely worked across surfaces in one coherent session — state
   which structure was used). Include the persona name/angle at the top of the file so findings
   are traceable to the lens that produced them.

**Findings feed the gap list (protocol §4.4) directly**: a CONCERNS/FAIL finding of severity
`blocking` or `significant` is a new gap-list entry, dated, sourced as "simulated-user
finding," tagged to whichever dimension(s) it affects (`usability_quality` most often;
`capability_breadth` if it's a missing affordance). This is the mechanism's direct link to
`V_instance` (protocol §4.3) and to the PAUSE criterion (protocol §4.5 — "no new
significant-severity gap" is checked against THIS iteration's simulated-user findings).

**Do not conflate this with G3.** G3 audits functional correctness/Core-touching changes. The
simulated-user pass audits holistic usability across all surfaces. Keep them as separate
dispatches with separate report sections ("10. Out-of-band audit (G3)" for G3, "7. Simulated-user
pass" for the simulated-user pass — see report template).

**Relationship to `verification_coverage`**: a simulated-user finding that reveals a bug is
NOT itself a test — filing the gap and later closing it with a fix AND a committed test are
two separate steps (find → gap-list entry → task → fix + test → gap closed), the same
discipline `verified_by_construction` established in experiment 3.

---

## Gap list — storage and mechanics (iteration 0 must decide, see protocol §9 item 1)

Iteration 0 must explicitly choose and record ONE of:
1. **Plain markdown file**: `experiments/quay-continuous-bootstrap/gap-list.md`, human-readable,
   simple to stand up immediately.
2. **QX-* tasks with a `gap` label**: using the self-hosted task-tracking mechanism itself
   (`task_write` with `labels: [gap]`), queried via `task_list --label gap`, more consistent
   with the dogfooding spirit of protocol §5.1 but requires distinguishing "a gap not yet
   turned into actionable work" from "a task actively being executed."

Whichever is chosen, every entry must carry: id, dimension (`capability_breadth` /
`usability_quality` / `verification_coverage` / `system_health`), one-line description,
severity (`blocking` / `significant` / `minor`), source (`direct-observation` /
`simulated-user` / `directive`), date added, date last re-confirmed still open (for open
entries) or date closed + closing iteration + evidence pointer (for closed entries).

**Do not let this default silently** — record the choice and the reasoning in `provenance.md`
at iteration 0, the same discipline experiment 3 applied to its σ-vs-inherited-floor decision.

---

## V_meta ceiling — check early, cite forward (inherited, unchanged mechanics)

Experiment 4 **inherits** `effectiveness = 0.26` as still-frozen at the moment of inheritance
(unless experiment 3's actual closing report records a different final value — reconcile at
iteration 0). Compute the ceiling at iteration 0 using whichever value is confirmed:

```
V_meta_ceiling = completeness_max × effectiveness_inherited × reusability_max × validation_max
              = 1.0 × [inherited effectiveness] × 1.0 × 1.0
```

If `effectiveness` remains frozen, `V_meta ≥ 0.80` is arithmetically unreachable for as long as
the ceiling holds — state this explicitly and as early as it is confirmed. This is a live,
testable hypothesis for experiment 4 specifically: the self-hosted task-tracking mechanism
(protocol §5.1, §6) is a plausible organic re-trigger candidate — a genuinely different
scenario from experiments 2/3's own domains, since it puts task-management tooling directly in
the loop of daily work. Record whichever way it resolves with concrete timing evidence in the
first iteration where it becomes decidable — an assertion without evidence is a scoring error.

---

## Iteration 0: Baseline — confirm inheritance, stand up the two standing mechanisms, establish experiment 4's own V_instance baseline

**Objective**: Reconcile the provisional V_meta inheritance value against experiment 3's actual
closing report. Stand up self-hosted task tracking (protocol §5.1) and confirm it works
end-to-end with a real `task_write`/`task_list`/`task_get`/`task_check` cycle. Run the FIRST
simulated-user pass (protocol §5.2) across all surfaces to seed the initial gap list. Make the
gap-list storage decision explicit. Compute experiment 4's own fresh V_instance baseline from
the seeded gap list. Record everything in `provenance.md` and `iterations/iteration-0.md`.

**Driver**: Seed (no QX-* tasks have been through native authoring/execution/gating yet). This
iteration is primarily observational and infrastructure-standing-up; any gap-filling work done
here is recorded as early seed-provenance evidence, not inflated to native.

**Prompt**:
```
You are running Iteration 0 of the quay-continuous-bootstrap experiment (experiment 4). This
is NOT a restart from σ=0 or from V_meta=0 — methodology AND a continuing V_meta baseline are
both inherited, not invented. This experiment has NO fixed instance-objective ceiling — do not
try to import experiment 3's four bounded factors or its "Done when" clauses; this experiment's
shape is genuinely different (protocol §4). Do not run this iteration until a human has
explicitly authorized starting it.

Read before doing anything else:

INHERITANCE ARTIFACTS (read all, in order, before starting):
  docs/proposals/quay-continuous-bootstrap-experiment-v4.md      ← authoritative protocol (read in full)
  docs/proposals/quay-webui-bootstrap-experiment-v3.md            ← experiment 3's protocol
  docs/proposals/quay-core-bootstrap-experiment-v2.md             ← experiment 2's protocol
  docs/proposals/quay-bootstrap-experiment.md                     ← experiment 1's protocol
  .claude/skills/quay-native-methodology/SKILL.md
  .claude/skills/quay-native-methodology/reference/patterns.md
  .claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md
  .claude/skills/quay-native-methodology/reference/gate-mechanics.md
  .claude/skills/quay-native-methodology/reference/g3-audit-discipline.md
  .claude/skills/quay-native-methodology/reference/directive-lifecycle.md
  .claude/skills/quay-core-bootstrap-methodology/SKILL.md
  .claude/skills/quay-core-bootstrap-methodology/reference/manda-daemon-address-bug.md
  .claude/skills/quay-core-bootstrap-methodology/reference/g3-audit-dispatch-drift-case-study.md
  .claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md
  .claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md
  .claude/skills/quay-core-bootstrap-methodology/reference/sigma-inherited-floor-trap.md
  .claude/skills/quay-core-bootstrap-methodology/reference/transfer-test-outcome.md
  .claude/skills/quay-webui-bootstrap-methodology/SKILL.md         ← IF it exists yet (DIR-007
    action 3 requests it be produced when experiment 3 closes); if it does not yet exist,
    state that explicitly and read experiments/quay-webui-bootstrap/ITERATION-PROMPTS.md and
    provenance.md directly instead, as a substitute source for the same findings.

PROTOCOL DOCUMENTS (read in full):
  docs/proposals/quay-proposal.md
  docs/proposals/quay-native-design.md
  docs/proposals/glossary.md

EXPERIMENT 3's ACTUAL STOPPING STATE (for V_meta reconciliation — THIS IS THE CRITICAL STEP):
  experiments/quay-webui-bootstrap/CLOSING-REPORT.md   ← if it exists, THIS is authoritative,
    NOT the 0.123 provisional figure in this ITERATION-PROMPTS.md. If it does NOT exist yet,
    state that explicitly and fall back to the latest iteration report:
  experiments/quay-webui-bootstrap/iterations/iteration-4.md (or higher-numbered, if more
    iterations ran after this document was authored)
  experiments/quay-webui-bootstrap/provenance.md
  experiments/quay-webui-bootstrap/directives/pending/DIR-004-*.md   ← carry forward (protocol §8)
  experiments/quay-webui-bootstrap/directives/pending/DIR-006-*.md   ← adopt as standing guardrail (protocol §8)
  experiments/quay-webui-bootstrap/directives/pending/DIR-007-*.md   ← the directive that triggered this handoff

MOST RECENT EXPERIMENT 1 and 2 STATE (for system_health's regression baseline):
  experiments/quay-native-bootstrap/CLOSING-REPORT.md
  experiments/quay-core-bootstrap/iterations/iteration-10.md

Precondition check (§0, G6): read .manda/hub.addr for the live daemon address (DO NOT
hardcode a port), confirm the daemon healthz endpoint, confirm a monitor process is a DIRECT
CHILD of this session's own process tree.

1. RECONCILE V_meta INHERITANCE
   State whether experiments/quay-webui-bootstrap/CLOSING-REPORT.md exists. If yes: use its
   recorded final V_meta values (completeness, effectiveness, reusability, validation, and the
   product) as experiment 4's inherited starting V_meta — NOT this document's provisional
   0.123 figure if they differ. If no: state that explicitly, use the latest iteration report's
   values (provisionally 0.123 per iteration-4.md as of this document's authoring) AND flag
   this as a reconciliation still outstanding for a future iteration once the closing report
   is filed. Either way: compute the V_meta ceiling (see "V_meta ceiling" section above) using
   whichever effectiveness value is confirmed.

2. STAND UP SELF-HOSTED TASK TRACKING (protocol §5.1) — CONFIRM IT WORKS END-TO-END
   Perform a real, minimal end-to-end cycle using quay's own MCP task tools — NOT the
   underlying file convention directly, the actual MCP tool surface:
   - mcp__quay__task_write to create one real QX-* task (e.g. QX-001, seeding this
     experiment's own backlog with a genuine first piece of work identified during this
     iteration's survey).
   - mcp__quay__task_list to confirm it appears, filtered by whatever the natural query is.
   - mcp__quay__task_get to confirm the full task content round-trips correctly.
   - mcp__quay__task_check to confirm gate semantics behave as expected for a freshly-created,
     not-yet-done task.
   Record any friction encountered during this cycle AS A GAP-LIST ENTRY (usability_quality
   dimension, source=direct-observation) — this is the mechanism's own first live test of
   "does this feel good to use," applied reflexively to quay's own task tools.

3. RUN THE FIRST SIMULATED-USER PASS (protocol §5.2, §0c) — SEED THE GAP LIST
   Dispatch (orchestrator, native Agent/Task tool, run_in_background=true, fresh context) at
   least one simulated-user session per major surface (CLI, Web UI desktop, Web UI mobile, MCP
   tools) — combine into fewer dispatches only if a single agent can genuinely hold a coherent
   plausible-user narrative across surfaces; state which structure was used. Confirm G7
   (standing web-service reachability on 0.0.0.0) is satisfied before dispatching the Web UI
   passes — start `quay serve` if not already running. Collect PASS/CONCERNS/FAIL verdicts per
   surface with concrete, severity-tagged findings. Write each to
   experiments/quay-continuous-bootstrap/audits/iteration-0-simulated-user-{surface}.md.

4. MAKE AND RECORD THE GAP-LIST STORAGE DECISION
   Choose plain-markdown-file OR QX-*-tasks-with-gap-label (see "Gap list — storage and
   mechanics" section above). Record the choice and reasoning in provenance.md. Populate the
   gap list with every finding from steps 2 and 3, plus any gap found via direct code/doc
   survey this iteration (source=direct-observation).

5. MEASURE EXPERIMENT 4's OWN V_instance BASELINE
   Using the seeded gap list, score each dimension 0.0-1.0 against ITS current gap-list entries
   (protocol §4.2-§4.3) — show the specific evidence per dimension, not a vague estimate:
   (a) capability_breadth — survey CLI subcommand completeness, Core/MCP tool coverage,
       packaging/distribution reachability (currently: none — DIR-004 not yet applied), and any
       carried-forward gap from experiment 3's own final state.
   (b) usability_quality — from the simulated-user pass findings (step 3) plus any mechanical
       check applicable per surface (Lighthouse for Web UI, as experiment 3 established).
   (c) verification_coverage — what fraction of currently-existing, currently-claimed-working
       capability has a committed automated test? Re-confirm experiment 3's inherited
       verified_by_construction state is intact, not assumed.
   (d) system_health — binary-style: re-confirm no regression against ALL THREE inherited
       snapshots (experiment 1's 8 factors, experiment 2's 4 factors, experiment 3's 4 factors)
       AND no open blocking/significant gap from step 3 without an explicit triage decision.
   Compute V_instance = capability_breadth × usability_quality × verification_coverage ×
   system_health. This is experiment 4's OWN fresh baseline — do not inherit experiment 3's
   1.0 as a starting number; measure freshly against the newly-assembled gap list.

6. CARRY FORWARD EXPERIMENT 3's PENDING DIRECTIVES (protocol §8)
   - DIR-004 (packaging/distribution): re-file into experiments/quay-continuous-bootstrap/
     directives/pending/ with a note citing its experiment-3 origin. State explicitly that
     packaging/distribution is now IN SCOPE (protocol §3) — this changes DIR-004's own
     disposition from "deferred, out of scope" to "pending, in scope, not yet prioritized."
   - DIR-006 (worktree isolation): confirm it is adopted as a standing guardrail (protocol §8)
     from iteration 0 onward — this iteration itself should have executed in a dedicated
     worktree if one was used; record whether it was, and if not, show concrete evidence of
     the blocker per the evidentiary bar this same directive originally set.

7. RECORD IN provenance.md
   Write the inheritance record: experiment 1/2/3's final provenance states and closing-report
   citations (or latest-iteration citation if experiment 3's closing report doesn't exist yet),
   the V_meta reconciliation outcome (step 1), the gap-list storage decision (step 4), and the
   QX-001 task (or whichever tasks were created via the self-hosted mechanism this iteration).

8. WRITE experiments/quay-continuous-bootstrap/iterations/iteration-0.md
   Use the iteration report structure at the bottom of this document.

   Pause/Convergence Check (expect NOT PAUSED, meta-layer NOT CONVERGED, at iteration 0):
   [ ] Meta-layer V_meta >= 0.80: NO — inherited ~0.12ish, ceiling ~0.26 if effectiveness frozen
   [ ] Instance-layer PAUSE criteria (both ΔV flat 2+ iterations AND no new significant gap):
       N/A — no prior iteration to compare ΔV against yet (state explicitly)
   [ ] Out-of-band audit (G3): N/A or triggered — depends on whether any Core-touching change
       was made this iteration (state explicitly either way)
   [ ] Simulated-user pass: RUN (this is iteration 0's own required first pass, not N/A)
   Status: NOT PAUSED (expected and correct — this is a seeding iteration, not yet showing any
   trend to assess).
```

**Expected Output**:
- V_meta reconciliation outcome stated explicitly (closing-report-confirmed value, OR
  provisional-with-flagged-caveat).
- Self-hosted task tracking confirmed working end-to-end (real task_write/list/get/check
  cycle), with any friction found recorded as a gap-list entry.
- First simulated-user pass complete across all major surfaces, PASS/CONCERNS/FAIL per surface
  with severity-tagged findings.
- Gap-list storage decision made and recorded explicitly, with the list itself seeded.
- V_instance baseline for experiment 4's four dimensions, freshly measured (not inherited as a
  number) against the seeded gap list.
- Experiment 3's pending directives carried forward (DIR-004 re-filed as in-scope; DIR-006
  adopted as a standing guardrail).
- `experiments/quay-continuous-bootstrap/iterations/iteration-0.md` with honest assessment.
- Status: NOT PAUSED (expected and correct at iteration 0 — no trend exists yet to assess).

---

## V_instance for this experiment

```
V_instance = capability_breadth × usability_quality × verification_coverage × system_health
```

Each dimension is scored 0.0-1.0 **against the CURRENT gap list for that dimension, as it
stood at the start of the current iteration** (protocol §4.3) — not against a fixed checklist.
**The raw level is reported for transparency but is NOT strictly comparable across iterations
where the gap list's size/composition changed. `ΔV` (this iteration's score minus last
iteration's score, both computed the same way) IS the comparable, primary trend signal.** A
separate, monotonically-growing "cumulative gaps closed" counter (per dimension and in total)
is reported alongside and is strictly comparable across the experiment's whole life.

### `capability_breadth`

What fraction of the currently-known capability gap list (missing CLI flags, missing Core/MCP
tool coverage, missing packaging/distribution reachability, any carried-forward gap from prior
experiments) remains open, inverted (1.0 = no open capability_breadth gap currently known).
- 0.0: the gap list for this dimension is large relative to what's already delivered, or freshly
  seeded with many findings not yet triaged
- rising: gaps closed faster than new ones are found (real ΔV signal)
- falling: new gaps found faster than closed (also a real, legitimate ΔV signal — NOT
  automatically a problem; it may mean the simulated-user mechanism is working well)
- Never assume 1.0 "means done forever" — a later iteration's simulated-user pass can always
  surface a new gap and pull this back down. This is intended, not a scoring bug.

### `usability_quality`

Same mechanic, scored against the current `usability_quality`-tagged gap-list entries — both
mechanical checks (Lighthouse, where applicable to Web UI) AND the standing simulated-user
pass's PASS/CONCERNS/FAIL verdicts feed this. A CONCERNS/FAIL verdict on any surface caps
credit for that surface until addressed, the same discipline experiment 3's visual-review
mechanism established, generalized beyond Web UI to every surface reviewed.

### `verification_coverage`

Fraction of ALL currently-existing, currently-claimed-working capability (cumulative, not just
this iteration) with a committed automated test (unit, integration, or browser-automation, as
appropriate to the surface). Continuous, every-iteration-boundary requirement — a gap found at
any boundary is a dimension regression from whatever value it held before, checked with the
same rigor `system_health` regressions are checked.

### `system_health`

Binary-style: **near-1** if none of experiments 1/2/3's inherited V-factor snapshots have
regressed AND no open `blocking`/`significant`-severity gap sits without an explicit triage
decision; degrades toward 0 as regressions/untriaged-significant-gaps accumulate. Re-confirmed
every iteration by checking the current test suites against all three inherited snapshots.

### PAUSE criterion (protocol §4.5 — not a fifth multiplied factor, a standing check)

PAUSE (not CONVERGED, not HALT) is recommended when, for 2 or more consecutive iterations:
1. `ΔV_instance` (the product's iteration-over-iteration delta) is flat, below 0.02, AND
2. The simulated-user pass found no new `blocking` or `significant` severity gap in that same
   window (new `minor` gaps alone do not block a PAUSE recommendation).

State explicitly, every time PAUSE is recommended: **"this is a pause the human can resume, not
a terminal halt."** PAUSE is not this experiment's version of CONVERGED — see the "Pause vs.
Converge vs. Halt" section below.

---

## V_meta for this experiment

```
V_meta = completeness × effectiveness × reusability × validation
```

**Formula shape**: inherited unchanged from experiments 1, 2, and 3. This is deliberate — the
human's redirection targets the instance layer's shape, not the meta layer's.

**Starting values**: whatever experiment 3's actual closing report records (reconciled at
iteration 0), provisionally `completeness=0.77, effectiveness=0.26, reusability=0.79,
validation=0.778` (product 0.123) per the latest recorded state (iteration-4.md) as of this
document's authoring — **DO NOT treat this as final without the iteration-0 reconciliation
step.**

**What must change**: each factor must show either (a) genuine movement with evidence, or (b)
a **different** stalling reason than experiments 1/2/3 recorded. Repeating the same stall
reason after a supposed refinement is itself a finding requiring escalation. Per protocol §6's
explicit hypothesis (not guaranteed): the self-hosted task-tracking mechanism (protocol §5.1)
is a plausible organic re-trigger candidate for `effectiveness` specifically — using quay's own
MCP tools for real daily task management puts the tooling directly in the loop in a way no
prior experiment's domain did. This must be OBSERVED with timing evidence, not assumed.

### V_meta re-trigger watchlist (check all applicable, every iteration)

1. **effectiveness re-trigger**: did any QX-* task arise that is organically scope-matched to
   stage-0 QN-006's shape (single-file, no/minimal source change, no network I/O)? The
   self-hosted task-tracking mechanism's own MCP-tool usage is a NEW, experiment-4-specific
   candidate source for this — record timing whenever a scope-matched task arises, comparing
   against the QN-006 baseline (author ~51s, execute ~2m59s) and QW-003's own confirmation
   (author 32s, execute 170s).
2. **reusability re-trigger**: did organic external demand appear for wider GitHub Provider
   `data.write` capability, OR (new for this experiment, given the widened scope) any other
   Provider-ABI extension demand surfaced by capability_breadth work? Check every iteration.
3. **completeness re-trigger (gap discovery)**: was a new, previously-undocumented Skill
   Method-step gap found — including, specifically for this experiment, a gap in how the
   Method handles STRATEGY FORMATION UNDER AN OPEN-ENDED OBJECTIVE (a genuinely new demand
   this experiment's shape places on the Skill set that no prior experiment tested)?
4. **completeness + reusability/effectiveness joint re-trigger**: did a reliable, unconditional
   native fresh-context subagent-dispatch primitive become available? If yes: re-open
   completeness, and reusability/effectiveness jointly.
5. **open-ended-domain-specific re-trigger (NEW for this experiment)**: does the introduction
   of continuous simulated-user usage as a STANDING, every-iteration mechanism (rather than
   change-triggered, as in experiment 3) itself surface a Skill Method-step gap not previously
   documented? Does the self-hosted task-tracking mechanism (using quay's own MCP tools for
   quay's own backlog) surface friction that is itself evidence for or against
   `effectiveness`/`reusability`? Record findings here explicitly, whichever way they resolve.
6. **Fallback rule**: if none of 1-5 fire within roughly 12 iterations, run one dedicated
   comprehensive full search, mirroring experiment 2's iteration-10 precedent. Prefer early
   discharge (as experiment 2 modeled) over letting the obligation lapse to the deadline.

**Ceiling note**: restate every iteration until/unless a re-trigger fires with evidence.

**Validation mechanics**: `validation` tracks experiment 4's own σ_QX = (# QX-* tasks with all
three fields = native) / (total QX-* tasks). No inherited floor from experiment 3 applies
unless a future decision explicitly re-adopts one — experiment 3 itself reset to a
floor-of-zero design (see its provenance.md), and absent a reason to diverge, experiment 4
inherits that same reset-to-zero framing by default; state this explicitly at iteration 0
rather than silently assuming it.

---

## Iterations 1..k: Work the gap list (template)

**Objective (recurring)**: Close evidenced gaps across the four dimensions while the standing
simulated-user mechanism (every iteration) and direct observation keep the gap list current.
There is no fixed priority order pre-determined by this document — each iteration's own
OBSERVE step determines what the gap list's current highest-severity, highest-value items are.
Update `provenance.md` with any newly completed QX-* tasks. Update the gap list with
closed/newly-found entries every iteration.

### Context extraction (do this first, every iteration)

```
Read, in full, before doing anything else:
  experiments/quay-continuous-bootstrap/iterations/iteration-{N-1}.md  — prior state, V scores, problems
  experiments/quay-continuous-bootstrap/provenance.md                   — current QX-* task provenance
  experiments/quay-continuous-bootstrap/gap-list.md (or QX-*-gap-labeled tasks, per iteration-0 decision)
  experiments/quay-continuous-bootstrap/audits/                         — prior G3 co-signs AND
                                                                            prior simulated-user verdicts
  .claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md
  .claude/skills/quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md
  packages/quay-native/skills/author/SKILL.md
  packages/quay-native/skills/execute/SKILL.md

Extract:
  - current σ_QX (recompute from provenance.md QX-* entries only)
  - the CURRENT gap list, by dimension and severity — this iteration's actual work menu
  - the specific problems iteration {N-1} identified as blocking progress
  - ΔV_instance and ΔV_meta from the last 1-2 iterations — is a PAUSE recommendation close?
  - whether any V_meta re-trigger condition fired last iteration or is imminent
  - any new QX-* directives in experiments/quay-continuous-bootstrap/directives/pending/
```

### Lifecycle capability-reading protocol (inherited, unchanged)

- Read all relevant Skill definitions before the iteration starts.
- Re-read the specific Skill/capability being modified immediately before using it.
- Read `.claude/skills/quay-native-methodology/reference/`,
  `.claude/skills/quay-core-bootstrap-methodology/reference/`, and (once produced)
  `.claude/skills/quay-webui-bootstrap-methodology/reference/` files fresh each iteration.

### Iteration cycle (Observe → Codify → Automate → Evaluate → Convergence/Pause Check)

```
1. OBSERVE
   - Read the current gap list. Which entries are highest severity, and which have been open
     longest without progress? (Cite {N-1}'s problem list; do not invent a new gap without
     evidence — new gaps come from the simulated-user pass or direct observation, recorded as
     such.)
   - Which V_meta re-trigger conditions apply to the planned work? Check all 5.
   - What does the QX-* task backlog show (via task_list, the self-hosted mechanism itself —
     not a file grep)?

2. STRATEGY FORMATION
   - Choose the highest-value gap(s) to close this iteration — "highest-value" is a judgment
     call informed by severity, dimension balance (do not let one dimension's gaps get starved
     for many iterations running without an explicit reason, mirroring experiment 3's
     parallel-advancement discipline, generalized to four dimensions instead of two factors),
     and the standing PAUSE-check inputs (is a PAUSE close? does that change what's worth
     doing this iteration?).
   - If the chosen increment organically bears on a V_meta re-trigger condition: note this now,
     plan to record timing evidence at EVALUATE time.
   - Do NOT manufacture V_meta evidence (G2/G5).
   - Any capability/usability change chosen must ship WITH its test in THIS SAME iteration
     (verification_coverage, protocol §4.2).
   - For any work touching packages/quay: read §Core-scope constraints below first.
   - Confirm the git worktree for this iteration's work (protocol §8 standing guardrail).

3. EXECUTION
   - Drive the chosen QX-* task(s) using the inherited Skill set (quay:author / quay:execute)
     AND the self-hosted task-tracking mechanism (task_write/task_list/task_get/task_check) —
     both are required, not either/or; the Skills drive the Method, the MCP tools ARE the
     backlog interface.
   - Record provenance honestly: {author_by, execute_by, gate_by} ∈ {seed, native}.
   - For any Core (packages/quay) change: G3 out-of-band audit is mandatory.

4. STANDING SIMULATED-USER PASS (§0c — every iteration, not conditional on a claimed change)
   - Dispatch it this iteration, regardless of whether a usability-specific change was made —
     it is the primary source of NEW gap-list entries for the following iteration, not merely
     a verification step for changes already planned.
   - Record PASS/CONCERNS/FAIL per surface with severity-tagged findings.
   - New blocking/significant findings become new gap-list entries dated this iteration.

5. EVALUATE — compute both V's from evidence gathered this iteration

   V_instance = capability_breadth × usability_quality × verification_coverage × system_health
   - Re-check ALL four dimensions, not just the one(s) touched.
   - Compute ΔV_instance against last iteration's SAME-BASIS score (protocol §4.3) — this is
     the primary comparative number, more important than the raw level.
   - Update the cumulative gaps-closed counter (monotonic, never decreases).
   - Show the before/after gap-list composition explicitly (what closed, what was newly found).

   V_meta = completeness × effectiveness × reusability × validation
   - For EACH factor: check the re-trigger watchlist item, update with evidence if fired,
     else state the inherited stall reason explicitly.
   - Restate the ceiling as a standing fact.
   - Report σ_QX and its trend.

6. OUT-OF-BAND AUDIT (G3 — mandatory for any Core change or V-factor lift)
   - Dispatch via the NATIVE Agent/Task tool (run_in_background=true), by the ORCHESTRATOR —
     never the session that authored/executed the task, NEVER via manda.
   - Write the verdict to experiments/quay-continuous-bootstrap/audits/iteration-{N}-adjudicate.md.
   - If no Core change and no V-factor lift this iteration: state "G3 not triggered this
     iteration" explicitly.

7. PAUSE / CONVERGENCE CHECK — every iteration, no partial credit:
   [ ] Meta-layer V_meta >= 0.80: [YES/NO with evidence] — a bounded, genuine convergence
       question, tracked separately from the instance layer's open-ended state
   [ ] Instance-layer PAUSE criteria: ΔV_instance flat (<0.02) for 2+ consecutive iterations
       AND no new blocking/significant gap found by the simulated-user pass in that window —
       [YES/NO with evidence]. If YES: recommend PAUSE explicitly, stating "this is a pause the
       human can resume, not a terminal halt."
   [ ] G3 green for all Core/lift tasks this iteration: [evidence]
   [ ] Simulated-user pass run this iteration, findings recorded: [evidence]
   [ ] system_health: no regression against any of the three inherited snapshots: [evidence]
   Status: CONTINUING | PAUSE RECOMMENDED | (meta-layer only) META-CONVERGED

8. Write experiments/quay-continuous-bootstrap/iterations/iteration-N.md.

9. Evolution guidance (for the Skill set A_n and methodology M_n):
   - Evolve a Skill/methodology element only when: retrospective OBSERVE evidence demonstrates
     a gap + a documented alternative was attempted and failed.
   - For any methodology change: state explicitly (a) which V_meta factor it targets, (b)
     which inherited stall reason it addresses, (c) how the resulting movement will be
     distinguishable from merely re-measuring the same inherited stall.
   - Do NOT evolve on: pattern-matching to what "seems complete," anticipatory design, or
     theoretical completeness alone.
   - Any adaptation to the simulated-user mechanism or the self-hosted task-tracking mechanism
     themselves is exactly the kind of evidence protocol §6's meta objective is asking for —
     document it explicitly, not just as an operational tweak.
```

---

## Pause vs. Converge vs. Halt — the three distinct states this experiment uses

- **PAUSE** (protocol §4.5, the expected, normal, self-terminating instance-layer state):
  `ΔV_instance` flat for 2+ consecutive iterations AND no new blocking/significant gap found.
  **Resumable by construction.** State explicitly every time: "this is a pause the human can
  resume, not a terminal halt."
- **CONVERGED** (retained only for the meta layer, §6 of protocol): `V_meta ≥ 0.80` with the
  same genuine-movement discipline experiments 1-3 applied. If reached while `V_instance` is
  still open (expected — it always will be, by design), record this explicitly as an
  asymmetric state: "meta-layer convergence reached; instance-layer work continues."
- **HALT** (human-directed stop, for any reason, at any time): imposed from outside (directive,
  explicit human decision), distinct from a self-assessed PAUSE. A human may accept a PAUSE
  recommendation (staying paused), override it (resume immediately with new priority), or
  convert it into a HALT (stop for good).

---

## §Core-scope constraints (inherited, apply to every iteration touching `packages/quay`)

These constraints carry over from `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`
§Core-scope work and were re-applied unchanged in experiments 2 and 3. Read the underlying
reasoning there; only the operative constraints are listed here, with two changes for this
experiment (items 6 and 7).

1. **Terminology discipline**: keep "MCP" (Provider ABI transport) and "browser-automation
   tooling (chrome-devtools / playwright MCP)" unambiguous.

2. **G5 discipline**: improving IS the point across all four dimensions (protocol §4.2), but
   silently folding an out-of-scope discovery into the current task is still forbidden — file
   it as a new gap-list entry / QX-* task instead.

3. **Manda-investigation reuse discipline**: cite `.claude/skills/quay-core-bootstrap-methodology/
   reference/manda-reliability-envelope.md` rather than re-discovering from scratch. Do not
   make automated test pass/fail hinge on live manda delivery succeeding.

4. **V-factor attribution**: new capability code → `capability_breadth`; new
   styling/ergonomics/documentation-clarity work → `usability_quality`; new test →
   `verification_coverage`; do not attribute structural work to `effectiveness` or
   `reusability` — those V_meta factors have specific, narrow evidentiary requirements.

5. **G3 extends to Core**: any task touching `packages/quay` source files (or new source
   introduced under this experiment's widened scope, e.g. packaging/build scripts) requires
   the same independent adjudicate dispatch. No self-certification exemption.

6. **Write-surface boundary — RECONSIDERED for this experiment (protocol §3, not inherited as a
   blanket rule)**: experiment 3's "no new write surface beyond the existing action-button
   trigger" boundary was specific to its own bounded Web-UI scope. It does NOT carry forward as
   a blanket prohibition here — quay's own `task_write` MCP tool is a legitimate, already-
   existing write surface the self-hosted task-tracking mechanism relies on directly (protocol
   §5.1). Any NEW write surface (Web UI or otherwise) is evaluated per-change against gap-list
   evidence, the "Core stays dumb" backend-agnosticism principle (unchanged), and ordinary
   G3/G5 discipline — state explicitly, per change, which applies. This is a genuine scope
   widening from experiment 3, not an oversight.

7. **Packaging/distribution scope — NEW, explicitly in scope (protocol §3, carrying forward
   DIR-004)**: build/release-artifact work (Node SEA / Bun compile, GitHub Actions release
   automation) is legitimate `capability_breadth` work under this experiment, unlike
   experiment 3 where it was explicitly deferred as out-of-scope. Any such work still requires
   G3 audit for source/build-script changes and a `verification_coverage`-satisfying test
   (e.g. "the produced executable actually runs the CLI/serve subcommands, verified with
   evidence") per DIR-004's own original requested-action items.

---

## §Inherited methodology constraints

The following mechanics are inherited from `.claude/skills/quay-native-methodology/`,
`.claude/skills/quay-core-bootstrap-methodology/`, and (once produced)
`.claude/skills/quay-webui-bootstrap-methodology/`, and apply as-is. Do not re-derive — read
the source files.

- **Gate mechanics**: `task check` / `checkGate()` — artifact-completeness + checked-state +
  recursive children-done.
- **Directive lifecycle**: pending → archive, one-time consumed, never silently dropped. This
  experiment's own directives live in `experiments/quay-continuous-bootstrap/directives/` —
  directives carried forward from experiment 3 (DIR-004) are re-filed here with a note citing
  their origin, per protocol §8.
- **G3 out-of-band audit discipline**: native Agent/Task tool (not manda), dispatched by the
  orchestrator (not the iteration-executor), is the permanent G3 mechanism. This has caught
  real problems in every prior experiment; treat it as genuinely independent every time.
- **Layer-1/Layer-2 Skill structure**: the inline, degraded-fallback structure is the proven
  artifact — do not assume a cleaner split is "just not yet built." Re-verify any
  subagent-dispatch assumption live before building on top of it.
- **manda daemon address discovery**: read `.manda/hub.addr` at runtime, never hardcode a port.
- **manda reliability envelope**: trivial@90s=success, medium@150s=success,
  complex@90s=timeout, complex@150s=success. 150s floor for anything above trivial complexity
  if manda dispatch is used for any purpose (NOT G3, NOT the simulated-user pass).
- **V_meta ceiling diagnostic**: compute the ceiling the first iteration any factor is
  confirmed frozen with a structural blocker; state it as a standing fact thereafter.
- **Desktop + mobile dual-viewport requirement** (inherited from experiment 3's DIR-003, now a
  standing guardrail, protocol §8): any browser-based check must cover both viewports.
- **Git worktree isolation** (inherited from experiment 3's DIR-006, now a standing guardrail,
  protocol §8): each iteration's dev/test work executes in a dedicated worktree from iteration
  0 onward — this is a change from experiment 3, which never got to apply it before stopping.

---

## Iteration report structure

```markdown
# Iteration N: [title — which dimension(s) were targeted and what work was done]

**Date**: YYYY-MM-DD
**Driver**: [seed | quay:author + quay:execute (native) | mixed — specify per task]
**Dimensions advanced**: [which of capability_breadth / usability_quality /
  verification_coverage / system_health, or "none — observational"]
**V_meta triggers checked**: [which of the 5 re-trigger conditions were checked; any fired?]
**Worktree**: [path/branch used this iteration; merge mechanism; removed after merge? or
  concrete evidence of blocker + deviation flagged]
**Gap-list delta**: [N gaps closed this iteration; M new gaps found (by source: direct-
  observation / simulated-user / directive); cumulative gaps-closed counter now at X]

## 1. Context from prior iteration
[σ_QX before, V scores before (both raw level AND ΔV basis), which dimension(s) were
targeted, problems inherited, current gap-list snapshot at iteration start]

## 2. Preconditions checked
[§0 checklist — every item, confirmed or explicitly N/A; G6 ps-output as evidence; daemon
address confirmed read from .manda/hub.addr; G7 web-service reachability confirmed]

## 3. Observe
[Current gap-list state by dimension/severity; V_meta re-trigger check results; which gap(s)
were chosen and why; PAUSE-check inputs from the last 1-2 iterations]

## 4. Strategy
[The advance(s) chosen; why; whether it organically bears on any V_meta factor; scope-boundary
self-check per §Core-scope constraints item 6/7]

## 5. Execution
[What was actually built/run — cite real runs and outputs. Confirm every change shipped WITH
its test in this same iteration. Confirm self-hosted task-tracking mechanism used for QX-*
provenance, not a file-only shortcut.]

## 6. Provenance update
[Per-QX-* task {author_by, execute_by, gate_by} diffs this iteration; σ_QX before → after]

## 7. Simulated-user pass (§0c — every iteration)
[Personas dispatched this iteration (2-3, deliberately different angles) and why those were
chosen; per-persona, per-surface PASS/CONCERNS/FAIL verdicts; links to
experiments/quay-continuous-bootstrap/audits/iteration-N-simulated-user-{persona}-{surface}.md;
new gap-list entries generated, with severity and which persona surfaced each]

## 8. V_instance
- capability_breadth: 0.XX (ΔV: +/-0.XX from last iteration's same-basis score) — [evidence;
  gap-list entries closed/remaining]
- usability_quality: 0.XX (ΔV: +/-0.XX) — [Lighthouse where applicable; simulated-user verdicts]
- verification_coverage: 0.XX (ΔV: +/-0.XX) — [cumulative fraction covered; specific gap]
- system_health: 0.XX (ΔV: +/-0.XX) — [compared to all THREE inherited snapshots]
- **Total**: 0.XX (product) — **ΔV_instance (product basis)**: +/-0.XX
- **Cumulative gaps closed (monotonic counter)**: N (all-time)

## 9. V_meta
- completeness: 0.XX — [re-trigger check; if not: cite specific inherited blocker]
- effectiveness: 0.XX — [re-trigger check, including the self-hosted-task-tracking hypothesis]
- reusability: 0.XX — [re-trigger check]
- validation: 0.XX — [σ_QX = X/Y]
- **Total**: 0.XX
- **ΔV_meta from inherited baseline**: [+/-]0.XX
- **V_meta ceiling**: [value] — [restate as standing fact]
- **Stall diagnosis**: [same reason as prior experiments, or new?]

## 10. Out-of-band audit (G3)
[adjudicate verdict; link to audits/iteration-N-adjudicate.md; OR "G3 not triggered this
iteration" explicitly. Confirm dispatcher: orchestrator, native Agent/Task tool, NOT manda.]

## 11. Pause / Convergence Check
- [ ] Meta-layer V_meta >= 0.80: [evidence]
- [ ] Instance-layer PAUSE criteria (ΔV flat 2+ iterations AND no new significant gap): [evidence]
- [ ] G3 green for all Core/lift tasks: [evidence]
- [ ] Simulated-user pass run, findings recorded: [evidence]
- [ ] system_health: no regression against any of the three inherited snapshots: [evidence]

**Status**: CONTINUING | PAUSE RECOMMENDED | META-CONVERGED (instance layer still open)

## Problems identified for next iteration
[concrete, evidence-based — feeds directly into the next iteration's context extraction]
```

---

## Execution guidance

- **Perspective**: you are simultaneously (a) developing quay across its whole surface, (b)
  dogfooding quay's own task tools for the experiment's own backlog, (c) continuously
  simulating real usage to find the next priority, and (d) testing whether the inherited
  methodology generalizes to open-ended, self-directed work. Keep all four visible in the
  writeup — do not silently collapse them together or focus on only one.
- **Rigor**: honest four-dimension V_instance and four-factor V_meta calculation, every number
  grounded in evidence from this iteration's actual gap list and actual dispatched audits.
- **Open-endedness honesty**: there is no fixed ceiling to chase. Do not manufacture a sense of
  "almost done" — a healthy gap list that keeps growing via the simulated-user mechanism is a
  SUCCESS signal for that mechanism, not a failure of the instance objective. `ΔV`, not raw
  level, is what to report as the comparative claim.
- **PAUSE honesty**: a PAUSE recommendation is not a failure and not a finish line — state its
  resumability explicitly every time. Do not let "we could recommend PAUSE" become a reason to
  stop looking for real gaps; the simulated-user pass runs every iteration regardless.
- **V_meta honesty**: reconcile the inherited starting value against experiment 3's ACTUAL
  closing report at the earliest point it exists — do not let the provisional 0.123 figure in
  this document calcify into an unverified assumption.
- **Self-hosted-tracking honesty**: use the actual MCP tools (`task_write`/`task_list`/
  `task_get`/`task_check`), not a file-edit shortcut that happens to produce the same file
  format — the point is dogfooding the interface, not just the storage convention.
- **Simulated-user honesty**: every iteration, not just when a change seems to warrant it. Do
  not let the standing cadence quietly lapse into "conditional on a claimed change," which
  would silently regress this experiment back to experiment 3's narrower mechanism.
- **Scope honesty**: the whole `quay` project is in scope, including packaging/distribution
  now — do not silently re-narrow to Web-UI-only work out of habit from experiment 3.
- **Thoroughness**: no token-limit shortcuts. A partial gap-list update, partial audit, or
  partial simulated-user pass is worse than a smaller iteration scope.
- **Authenticity**: the gap list, freshly assessed each iteration, defines the work — not a
  frozen checklist and not an anticipated one.

### Common mistakes specific to this experiment

- **Importing experiment 3's four bounded factors or "Done when" clauses wholesale** instead of
  measuring experiment 4's own four dimensions freshly against the current gap list.
- **Treating the provisional 0.123 V_meta figure as final** without checking whether
  experiment 3's actual closing report exists and reconciling against it.
- **Letting the simulated-user pass become conditional** ("only when a change seems to warrant
  it") instead of standing, every-iteration cadence — this silently regresses to experiment 3's
  narrower mechanism and starves the gap list of its primary organic source.
- **Comparing raw dimension levels across iterations as if they were directly comparable**,
  ignoring that the gap-list denominator moved — always report `ΔV` computed on a consistent
  same-basis comparison, and flag any apparent discontinuity's cause explicitly.
- **Treating PAUSE as a failure state or a finish line** rather than a resumable checkpoint —
  restate its resumability every time it's recommended.
- **Re-applying experiment 3's write-surface boundary as a blanket rule** instead of the
  per-change evaluation this experiment's protocol §3/Core-scope-constraints item 6 calls for.
- **Silently re-narrowing scope back to Web-UI-only** out of habit — packaging, CLI, Core/MCP,
  and documentation are equally in scope from iteration 0.
- **Dispatching G3 or the simulated-user pass via manda, or from inside the iteration-executor's
  own session** — restate the correct dispatcher explicitly every iteration; this drifted in
  every prior experiment that had the chance to drift.
- **Claiming an "ENV gap" for G3/simulated-user dispatch without concrete evidence** (the actual
  negative `ToolSearch` result) — this exact unevidenced-assertion pattern recurred across
  experiment 3's iterations 1, 3, and 4.
- **Skipping the git worktree** without showing concrete evidence of a structural blocker — this
  is now a standing guardrail from iteration 0, not a deferred nice-to-have.
- **Letting `system_health` silently regress** against any of the THREE inherited snapshots
  (not just the two experiment 3 tracked) — a change anywhere can break an inherited baseline
  indirectly.
- **Mixing QX-*, QW-*, QC-*, and QN-* task populations** — this experiment's provenance tracks
  QX-* tasks only.
- **Letting the gap-list storage decision (protocol §9 item 1) default silently** — this must
  be made explicitly at iteration 0 and cited thereafter.
- **Letting the 12-iteration V_meta re-trigger fallback lapse** — if no re-trigger fires within
  12 consecutive iterations, run a dedicated full search; prefer early discharge.
